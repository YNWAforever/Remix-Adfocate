import {createHash} from "node:crypto";
import type { PublishIntent } from "../publishRepo.js";
import type { JobClaim, SqlPilotJobStore } from "./jobStore.js";
import type { PilotMediaLeaseStore } from "./mediaLease.js";
import type { FacebookLoginPilotAdapter } from "./facebookLoginAdapter.js";
import { assertPilotAccount, assertSamePilotAccount, providerId, type PilotAccount } from "./protocol.js";
import { mayRunPilotWrite, type PilotRuntimePolicy } from "./runtime.js";

type Projection = Readonly<{missionBasis?: PublishIntent["binding"]["missionBasis"]; account: PilotAccount; missionId: string; fingerprint: string; caption: string; sponsorIds: readonly string[]; approved: boolean}>;
type Outcome = {intentId: string; fence: number; state: "published"; sampleOnly: boolean; receipt: {mediaId: string; accountSubject: string; permalink: string; provenance: "fixture"|"provider"; sampleOnly: boolean}};
type Publisher = {
  createImageContainer(input: Parameters<FacebookLoginPilotAdapter["createImageContainer"]>[0]): Promise<{containerId: string}>;
  getContainerStatus(target: PilotAccount, id: string): Promise<{state: string}>;
  publishContainer(target: PilotAccount, id: string): Promise<{mediaId: string}>;
  getPublishedMedia(target: PilotAccount, id: string): Promise<Outcome["receipt"]>;
};
type Dependencies = {
  jobs: Pick<SqlPilotJobStore, "claim" | "checkpoint">;
  resolve(intent: PublishIntent): Promise<Projection>;
  policy(): PilotRuntimePolicy | undefined;
  publisher: Publisher;
  lease: {open(input:Parameters<PilotMediaLeaseStore["open"]>[0]):Promise<{leaseId:string;expiresAt:string;assetSha256:string;provenance:"fixture"|"provider";publicUrl?:string}>;close:PilotMediaLeaseStore["close"]};
  record(outcome: Outcome): Promise<void>;
  accepted?(response:{intentId:string;containerId:string;mediaId:string}):Promise<void>;
  now(): Date;
};

/** Offline orchestration only. No scheduler, default transport, credentials or proof command. */
export class PilotWorker {
  constructor(private readonly deps: Dependencies,private readonly mode:"fixture"|"provider"="fixture") {}

  async runOne({workerId}: {workerId: string}): Promise<"idle" | "processed" | "held_unknown" | "blocked" | "waiting"> {
    const now = this.deps.now().getTime();
    if (!Number.isFinite(now)) return "blocked";
    let job: JobClaim | null;
    try { job = await this.deps.jobs.claim({workerId, now: new Date(now).toISOString(), leaseUntil: new Date(now + 60000).toISOString()}); }
    catch { return "blocked"; }
    if (!job) return "idle";
    if (job.stage === "before_create" || job.stage === "before_publish") return "held_unknown";
    // A durable receipt is handled by reconciliation, never another publish.
    if (job.stage === "receipt_known") return "held_unknown";
    if (job.stage === "media_known") {
      try {
        const current = await this.deps.resolve(structuredClone(job.intent));
        const b = job.intent.binding;
        assertPilotAccount(current.account);
        if (job.intent.sampleOnly!==(this.mode==="fixture") || !providerId(job.mediaId) || !providerId(job.containerId)
          || current.account.connectionId !== b.connectionId || current.account.accountSubject !== b.accountSubject
          || current.account.grantGeneration !== b.grantGeneration
          || (b.missionBasis && (current.account.appId !== b.missionBasis.appId || current.account.product !== b.missionBasis.product))) return "held_unknown";
        // Known accepted writes only: recovery never opens a lease, creates or publishes.
        const receipt = await this.deps.publisher.getPublishedMedia(current.account, job.mediaId);
        if (receipt.mediaId !== job.mediaId || receipt.accountSubject !== b.accountSubject
          || receipt.sampleOnly !== (this.mode==="fixture") || receipt.provenance !== this.mode
          || !/^https:\/\/www\.instagram\.com\/p\/[a-zA-Z0-9_-]+\/$/.test(receipt.permalink)) return "held_unknown";
        await this.deps.record({intentId:job.intent.id,fence:job.fence,state:"published",sampleOnly:this.mode==="fixture",receipt});
        await this.deps.jobs.checkpoint({intentId:job.intent.id,workerId,fence:job.fence,stage:"receipt_known",containerId:job.containerId,mediaId:job.mediaId});
        return "processed";
      } catch { return "held_unknown"; }
    }
    const intent = structuredClone(job.intent);
    let projection: Projection | undefined;
    let runId: string | undefined;
    let externalAttempted = job.stage !== "queued";
    let leaseOpened = job.stage==='container_known';
    let result: "processed" | "held_unknown" | "blocked" | "waiting" = "blocked";
    const check = async () => {
      const current = structuredClone(await this.deps.resolve(structuredClone(intent)));
      const policy = this.deps.policy();
      assertPilotAccount(current.account);
      const basis = intent.binding.missionBasis;
      if(this.mode==="provider"&&basis?.kind!=="active_mission_provider")throw new Error("PILOT_DENIED");
      if (basis && ((!current.missionBasis || Object.keys(basis).some(key=>current.missionBasis![key as keyof typeof basis]!==basis[key as keyof typeof basis]))
        || current.account.product !== basis.product || current.account.appId !== basis.appId
        || current.missionId !== basis.submissionId)) throw new Error("PILOT_DENIED");
      if (intent.sampleOnly!==(this.mode==="fixture") || intent.stoppedAt || !(job.stage==='container_known'?['creator_approved','provider_processing'].includes(intent.state):intent.state==='creator_approved')
        || !current.approved || current.fingerprint !== intent.binding.fingerprint
        || createHash("sha256").update(current.caption).digest("hex") !== intent.binding.captionSha256
        || current.account.connectionId !== intent.binding.connectionId
        || current.account.accountSubject !== intent.binding.accountSubject
        || current.account.grantGeneration !== intent.binding.grantGeneration
        || !mayRunPilotWrite(policy, intent.owner.creatorId, current.missionId)
        || !Number.isFinite(this.deps.now().getTime()) || this.deps.now().getTime() >= now + 60000) throw new Error("PILOT_DENIED");
      if (projection) {
        assertSamePilotAccount(projection.account, current.account);
        if (current.missionId !== projection.missionId || current.caption !== projection.caption
          || JSON.stringify(current.sponsorIds) !== JSON.stringify(projection.sponsorIds) || policy?.runId !== runId) throw new Error("PILOT_DENIED");
      } else { projection = current; runId = policy?.runId; }
      return current;
    };
    const checkpoint = (stage: "before_create" | "container_known" | "before_publish" | "media_known" | "receipt_known", containerId?: string, mediaId?: string) =>
      this.deps.jobs.checkpoint({intentId: intent.id, workerId, fence: job.fence, stage, containerId, mediaId});
    try {
      let current = await check();
      let containerId = job.containerId;
      if (job.stage === "queued") {
        const lease = await this.deps.lease.open({owner: intent.owner, intentId: intent.id, approvedAssetId: intent.binding.assetId, sha256: intent.binding.imageSha256, ttlSeconds: 900});
        leaseOpened = true;
        if (lease.provenance !== this.mode || lease.assetSha256 !== intent.binding.imageSha256
          || !Number.isFinite(Date.parse(lease.expiresAt)) || Date.parse(lease.expiresAt) <= this.deps.now().getTime()) throw new Error("PILOT_DENIED");
        if(this.mode==="provider"&&(!lease.publicUrl||!/^https:\/\//.test(lease.publicUrl)))throw new Error("PILOT_DENIED");
        await checkpoint("before_create");
        current = await check();
        externalAttempted = true;
        const created = await this.deps.publisher.createImageContainer({intentId: intent.id, target: current.account, imageSha256: intent.binding.imageSha256, caption: current.caption, sponsorIds: current.sponsorIds, isPaidPartnership: true, mediaHandle: this.mode==="fixture"?`fixture-lease:${lease.leaseId}`:lease.publicUrl!});
        if (!providerId(created.containerId)) throw new Error("PILOT_DENIED");
        containerId = created.containerId;
        await checkpoint("container_known", containerId);
      }
      if (!providerId(containerId)) throw new Error("PILOT_DENIED");
      current = await check();
      const status = await this.deps.publisher.getContainerStatus(current.account, containerId);
      if(status.state==='processing'){result='waiting';return result;}
      if (status.state !== "ready") throw new Error("PILOT_DENIED");
      await checkpoint("before_publish", containerId);
      current = await check();
      externalAttempted = true;
      const published = await this.deps.publisher.publishContainer(current.account, containerId);
      if (!providerId(published.mediaId)) throw new Error("PILOT_DENIED");
      await this.deps.accepted?.({intentId:intent.id,containerId,mediaId:published.mediaId});
      await checkpoint("media_known", containerId, published.mediaId);
      // Accepted writes are reconciled even if a local stop arrives during the call.
      const receipt = await this.deps.publisher.getPublishedMedia(current.account, published.mediaId);
      if (receipt.mediaId !== published.mediaId || receipt.accountSubject !== current.account.accountSubject
        || receipt.sampleOnly !== (this.mode==="fixture") || receipt.provenance !== this.mode
        || !/^https:\/\/www\.instagram\.com\/p\/[a-zA-Z0-9_-]+\/$/.test(receipt.permalink)) throw new Error("PILOT_DENIED");
      await this.deps.record({intentId: intent.id, fence: job.fence, state: "published", sampleOnly: this.mode==="fixture", receipt});
      await checkpoint("receipt_known", containerId, receipt.mediaId);
      result = "processed";
    } catch { result = externalAttempted ? "held_unknown" : "blocked"; }
    finally {
      if (leaseOpened && result!=='waiting') {
        try { await this.deps.lease.close(intent.owner, intent.id); }
        catch { result = "held_unknown"; }
      }
    }
    return result;
  }
}
