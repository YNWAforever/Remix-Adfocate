import { createHash, randomUUID } from "node:crypto";
import { PublishProviderError, type InstagramPublisher, type PublisherTarget } from "./instagramPublisher.js";
import type { MediaLease } from "./mediaLease.js";
import { validatePublishDraft, type InstagramLoginContract, type MissionPublishBasis, type PublishDraft, type PublishGrant } from "./publishPolicy.js";
import { PublishRepositoryError, type PublishActor, type PublishBinding, type PublishErrorCode, type PublishIntent,
  type PublishOwner, type PublishReceipt, type PublishRepository, type PublishState } from "./publishRepo.js";

/** Server-owned projection only. There is no browser/provider credential input. */
export type ResolvedPublishDraft = {
  draft: PublishDraft; assetId: string; connectionId: string; grant: PublishGrant;
  basis: MissionPublishBasis | null; contract: InstagramLoginContract | null;
  accountLabel: string; sourceKind: string; sampleOnly: boolean;
};
export type PublishPreview = Readonly<{
  draftId: string; draftRevision: number; assetId: string; imageSha256: string;
  caption: string; accountSubject: string; accountLabel: string;
  disclosure: Readonly<PublishDraft["disclosure"]>;
  mission: Readonly<{ kind: "active" | "legacy"; submissionId: string; workItemId: string;
    approvedVersionId: string | null; instructionRevision: number; state: string | null }> | null;
  missionBasisVersionId: string | null;
  eligible: boolean; reason?: string; fallback?: "manual_proof";
  approvalId: string | null; nonce: string | null; fingerprint: string | null; expiresAt: string | null;
  sampleOnly: true;
}>;
export type PublishStatus = Readonly<{
  id: string; state: PublishState; version: number; accountSubject: string;
  providerContainerId: string | null; providerMediaId: string | null; permalink: null;
  stopped: boolean; updatedAt: string; sampleOnly: true;
}>;
export type ApprovePublishInput = Readonly<{
  draftId: string; approvalId: string; nonce: string; fingerprint: string; requestId: string;
}>;
export type PublishServiceDependencies = Readonly<{
  enabled?: boolean; repo: PublishRepository; publisher: InstagramPublisher; lease: MediaLease;
  resolveDraft: (owner: PublishOwner, draftId: string) => Promise<ResolvedPublishDraft>;
  now: () => Date; operationTimeoutMs?: number; inFlightTimeoutMs?: number; mediaTtlMs?: number;
}>;

export type PublishServiceErrorCode = PublishErrorCode | "PUBLISH_PROTOCOL_UNVERIFIED";
export class PublishServiceError extends Error {
  constructor(readonly code: PublishServiceErrorCode) { super(code); this.name = "PublishServiceError"; }
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hash = /^[a-f0-9]{64}$/;
const providerId = /^[1-9][0-9]{0,63}$/;
const errorCodes: readonly PublishServiceErrorCode[] = ["PUBLISH_DISABLED", "PUBLISH_INVALID", "PUBLISH_DENIED", "PUBLISH_STALE",
  "PUBLISH_APPROVAL_INVALID", "PUBLISH_CONFLICT", "PUBLISH_CAS", "PUBLISH_TRANSITION", "PUBLISH_UNAVAILABLE", "PUBLISH_LIMIT", "PUBLISH_PROTOCOL_UNVERIFIED"];
const matches = (v: unknown, re: RegExp): v is string => typeof v === "string" && re.test(v);
const sha = (v: string) => createHash("sha256").update(v).digest("hex");
const terminal = (i: PublishIntent) => i.stoppedAt !== null || ["published", "failed", "cancelled", "invalidated", "outcome_unknown"].includes(i.state);
const targetOf = (i: PublishIntent): PublisherTarget => ({ connectionId: i.binding.connectionId, accountSubject: i.binding.accountSubject, grantGeneration: i.binding.grantGeneration });
const equalBinding = (a: PublishBinding, b: PublishBinding) => (Object.keys(a) as (keyof PublishBinding)[]).every(k => a[k] === b[k]);
class DeadlineError extends Error {}

/** Offline orchestration only. Construction cannot select an environment/live transport. */
export class PublishService {
  constructor(private readonly deps?: PublishServiceDependencies) {}

  private enabled(): PublishServiceDependencies {
    const d = this.deps;
    if (d?.enabled !== true) throw new PublishServiceError("PUBLISH_DISABLED");
    if (!d.repo || !d.resolveDraft || !d.now || d.publisher?.mode !== "mock" || d.lease?.mode !== "mock") {
      throw new PublishServiceError("PUBLISH_PROTOCOL_UNVERIFIED");
    }
    for (const [value, maximum] of [[d.operationTimeoutMs ?? 5000, 60_000], [d.inFlightTimeoutMs ?? 60_000, 300_000], [d.mediaTtlMs ?? 60_000, 60_000]]) {
      if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new PublishServiceError("PUBLISH_INVALID");
    }
    this.now();
    return d;
  }

  private now(): Date {
    const now = this.deps!.now();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new PublishServiceError("PUBLISH_UNAVAILABLE");
    return now;
  }

  private owner(owner: PublishOwner, session = false): void {
    if (!owner || !matches(owner.workspaceId, uuid) || !matches(owner.creatorId, uuid)
      || (session && !matches((owner as PublishActor).sessionHash, hash))) throw new PublishServiceError("PUBLISH_INVALID");
  }

  private async safe<T>(action: () => Promise<T>, leaseOwner?: { owner: PublishOwner; intentId: string }): Promise<T> {
    try { this.enabled(); return await action(); }
    catch (e) {
      if ((e instanceof PublishServiceError || e instanceof PublishRepositoryError) && errorCodes.includes(e.code)) {
        // A suspended/deleted owner cannot re-read the intent to discover its
        // stopped state. Closing the known local handle needs no repository read.
        if (e.code === "PUBLISH_DENIED" && leaseOwner) {
          try { this.deps!.lease.close(leaseOwner.owner, leaseOwner.intentId); }
          catch { throw new PublishServiceError("PUBLISH_UNAVAILABLE"); }
        }
        throw new PublishServiceError(e.code);
      }
      throw new PublishServiceError("PUBLISH_UNAVAILABLE");
    }
  }

  /** A timeout never cancels provider acceptance; a late ID is retained as audit. */
  private wait<T>(action: () => Promise<T>, late?: (result: T) => Promise<void>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let expired = false;
      const timer = setTimeout(() => { expired = true; reject(new DeadlineError()); }, this.deps!.operationTimeoutMs ?? 5000);
      Promise.resolve().then(action).then(result => {
        clearTimeout(timer);
        if (expired) { if (late) void late(result).catch(() => undefined); }
        else resolve(result);
      }, error => { clearTimeout(timer); if (!expired) reject(error); });
    });
  }

  private async resolve(owner: PublishOwner, draftId: string): Promise<ResolvedPublishDraft> {
    const r = structuredClone(await this.wait(() => this.deps!.resolveDraft(owner, draftId)));
    if (!r || r.draft?.id !== draftId || r.draft.owner?.workspaceId !== owner.workspaceId || r.draft.owner?.creatorId !== owner.creatorId) {
      throw new PublishServiceError("PUBLISH_DENIED");
    }
    if (!matches(r.assetId, uuid) || !matches(r.connectionId, uuid)
      || typeof r.accountLabel !== "string" || !/^@[a-zA-Z0-9_.]{1,64}$/.test(r.accountLabel)) throw new PublishServiceError("PUBLISH_INVALID");
    return r;
  }

  private policy(r: ResolvedPublishDraft) {
    const p = validatePublishDraft(r.draft, r.grant, r.basis, r.contract, this.now());
    if (r.sampleOnly !== true || r.sourceKind !== "synthetic-fixture" || r.contract?.evidence !== "synthetic") {
      return { ...p, allowed: false, fingerprint: null, reason: "PUBLISH_PROTOCOL_UNVERIFIED", sampleOnly: true,
        ...(r.draft.mission || r.draft.disclosure.sponsored ? { fallback: "manual_proof" as const } : {}) };
    }
    return p;
  }

  private binding(r: ResolvedPublishDraft, fingerprint: string): PublishBinding {
    return { draftId: r.draft.id, draftRevision: r.draft.revision, assetId: r.assetId, imageSha256: r.draft.imageSha256,
      captionSha256: sha(r.draft.caption), connectionId: r.connectionId, accountSubject: r.draft.accountSubject,
      grantGeneration: r.grant.generation, fingerprint };
  }

  async prepare(actor: PublishActor, draftId: string): Promise<PublishPreview> {
    return this.safe(async () => {
      this.owner(actor, true); if (!matches(draftId, uuid)) throw new PublishServiceError("PUBLISH_INVALID");
      const r = await this.resolve(actor, draftId); const p = this.policy(r);
      const approval = p.allowed && p.fingerprint ? await this.wait(() => this.deps!.repo.issuePreview(actor, this.binding(r, p.fingerprint!))) : null;
      if (approval) {
        const current = await this.resolve(actor, draftId); const check = this.policy(current);
        if (!check.allowed || !check.fingerprint || !equalBinding(this.binding(r, p.fingerprint!), this.binding(current, check.fingerprint))
          || !Number.isFinite(Date.parse(approval.expiresAt)) || Date.parse(approval.expiresAt) <= this.now().getTime()) {
          throw new PublishServiceError("PUBLISH_STALE");
        }
      }
      const d = r.draft;
      return Object.freeze({ draftId: d.id, draftRevision: d.revision, assetId: r.assetId, imageSha256: d.imageSha256,
        caption: d.caption, accountSubject: d.accountSubject, accountLabel: r.accountLabel,
        disclosure: Object.freeze({ sponsored: d.disclosure.sponsored, captionText: d.disclosure.captionText,
          platformLabelRequired: d.disclosure.platformLabelRequired, brandTagRequired: d.disclosure.brandTagRequired }),
        mission: d.mission ? Object.freeze({ kind: d.mission.kind, submissionId: d.mission.submissionId, workItemId: d.mission.workItemId,
          approvedVersionId: r.basis?.approvedVersionId ?? null, instructionRevision: d.mission.instructionRevision, state: r.basis?.state ?? null }) : null,
        missionBasisVersionId: r.basis?.approvedVersionId ?? null, eligible: p.allowed,
        ...(p.reason ? { reason: p.reason } : {}), ...(p.fallback ? { fallback: p.fallback } : {}),
        approvalId: approval?.approvalId ?? null, nonce: approval?.nonce ?? null, expiresAt: approval?.expiresAt ?? null,
        fingerprint: approval ? p.fingerprint : null, sampleOnly: true as const });
    });
  }

  async approve(actor: PublishActor, input: ApprovePublishInput): Promise<PublishStatus> {
    return this.safe(async () => {
      this.owner(actor, true);
      if (!input || Object.keys(input).some(k => !["draftId", "approvalId", "nonce", "fingerprint", "requestId"].includes(k))
        || ![input.draftId, input.approvalId, input.requestId].every(v => matches(v, uuid))
        || !matches(input.fingerprint, hash) || !matches(input.nonce, /^[A-Za-z0-9_-]{43,128}$/)) throw new PublishServiceError("PUBLISH_INVALID");
      const r = await this.resolve(actor, input.draftId); const p = this.policy(r);
      if (!p.allowed || p.fingerprint !== input.fingerprint) throw new PublishServiceError("PUBLISH_STALE");
      const i = await this.wait(() => this.deps!.repo.reserve(actor, { approvalId: input.approvalId, nonce: input.nonce,
        binding: this.binding(r, p.fingerprint!), requestId: input.requestId }));
      const check = await this.current(i);
      if (!check.resolved) { if (terminal(check.intent)) this.close(check.intent); throw new PublishServiceError("PUBLISH_STALE"); }
      return this.status(check.intent);
    });
  }

  private read(owner: PublishOwner, intentId: string): Promise<PublishIntent> {
    return this.wait(() => this.deps!.repo.getOwned(owner, intentId));
  }

  private status(i: PublishIntent): PublishStatus {
    if (i.sampleOnly !== true) throw new PublishServiceError("PUBLISH_PROTOCOL_UNVERIFIED");
    if (terminal(i)) this.close(i);
    return Object.freeze({ id: i.id, state: i.state, version: i.version, accountSubject: i.binding.accountSubject,
      providerContainerId: i.receipt.containerId ?? i.lateReceipt.containerId ?? null,
      providerMediaId: i.receipt.mediaId ?? i.lateReceipt.mediaId ?? null,
      permalink: null, stopped: i.stoppedAt !== null, updatedAt: i.updatedAt, sampleOnly: true });
  }

  async getOwned(owner: PublishOwner, intentId: string): Promise<PublishStatus> {
    return this.safe(async () => { this.owner(owner); return this.status(await this.read(owner, intentId)); }, { owner, intentId });
  }

  private close(i: PublishIntent): void { this.deps!.lease.close(i.owner, i.id); }
  private expired(i: PublishIntent): boolean { return this.now().getTime() - Date.parse(i.updatedAt) >= (this.deps!.inFlightTimeoutMs ?? 60_000); }

  private async change(i: PublishIntent, state: PublishState, receipt: PublishReceipt = {}) {
    try {
      return await this.wait(() => this.deps!.repo.transition(i.owner, { intentId: i.id, expectedState: i.state,
        expectedVersion: i.version, nextState: state, fingerprint: i.binding.fingerprint, requestId: randomUUID(),
        receipt: i.state === "creator_approved" ? {} : { ...receipt, sampleOnly: true, observedAt: this.now().toISOString() } }));
    } catch (e) {
      if (e instanceof PublishRepositoryError && ["PUBLISH_CAS", "PUBLISH_STALE"].includes(e.code)) {
        return { applied: false, intent: await this.read(i.owner, i.id) };
      }
      throw e;
    }
  }

  private async halt(i: PublishIntent): Promise<PublishIntent> {
    if (!terminal(i)) i = (await this.change(i, i.state === "creator_approved" ? "invalidated" : "outcome_unknown", { status: "unknown" })).intent;
    if (terminal(i)) this.close(i);
    return i;
  }

  /** Re-read policy and durable authority on both sides of every external await. */
  private async current(i: PublishIntent): Promise<{ intent: PublishIntent; resolved: ResolvedPublishDraft | null }> {
    let latest = await this.read(i.owner, i.id);
    if (latest.version !== i.version || latest.state !== i.state || latest.stoppedAt !== null) return { intent: latest, resolved: null };
    let r: ResolvedPublishDraft;
    try {
      r = await this.resolve(i.owner, i.binding.draftId);
      const p = this.policy(r);
      if (i.sampleOnly !== true || !p.allowed || !p.fingerprint || !equalBinding(i.binding, this.binding(r, p.fingerprint))) return { intent: await this.halt(latest), resolved: null };
    } catch { return { intent: await this.halt(latest), resolved: null }; }
    latest = await this.read(i.owner, i.id);
    if (latest.version !== i.version || latest.state !== i.state || latest.stoppedAt !== null) return { intent: latest, resolved: null };
    // The last read may have crossed grant expiry without changing the intent.
    const policy = this.policy(r);
    if (!policy.allowed || policy.fingerprint !== i.binding.fingerprint) return { intent: await this.halt(latest), resolved: null };
    if (["container_preparing", "provider_processing", "publish_requested"].includes(latest.state) && this.expired(latest)) {
      return { intent: await this.halt(latest), resolved: null };
    }
    return { intent: latest, resolved: r };
  }

  private receipt(result: unknown, kind: "containerId" | "mediaId"): PublishReceipt | null {
    if (!result || typeof result !== "object") return null;
    const value = result as Record<string, unknown>;
    return value.sampleOnly === true && matches(value[kind], providerId) ? { [kind]: value[kind], sampleOnly: true } : null;
  }

  private async late(i: PublishIntent, receipt: PublishReceipt): Promise<PublishIntent> {
    const latest = await this.wait(() => this.deps!.repo.recordLateReceipt(i.owner, { intentId: i.id, requestId: randomUUID(), target: targetOf(i), receipt }));
    if (terminal(latest)) this.close(latest);
    return latest;
  }

  private async after(i: PublishIntent, receipt?: PublishReceipt) {
    const check = await this.current(i);
    if (!check.resolved && receipt) check.intent = await this.late(i, receipt);
    if (!check.resolved && terminal(check.intent)) this.close(check.intent);
    return check;
  }

  private async providerFailure(i: PublishIntent, error: unknown, receipt?: PublishReceipt): Promise<PublishIntent> {
    let latest = await this.read(i.owner, i.id);
    const changed = latest.version !== i.version;
    if (receipt) latest = await this.late(i, receipt);
    if (changed || terminal(latest)) { if (terminal(latest)) this.close(latest); return latest; }
    const rejected = error instanceof PublishProviderError && error.code === "PUBLISH_PROVIDER_REJECTED" && error.outcome === "failed";
    const result = await this.change(latest, rejected ? "failed" : "outcome_unknown",
      { status: rejected ? "failed" : "unknown", code: rejected ? "PROVIDER_REJECTED" : "PROVIDER_TIMEOUT" });
    if (terminal(result.intent)) this.close(result.intent);
    return result.intent;
  }

  /** WORKER ONLY. Approval never calls this method; no API/model tool should expose it. */
  async execute(owner: PublishOwner, intentId: string): Promise<PublishStatus> {
    return this.safe(async () => {
      this.owner(owner); let i = await this.read(owner, intentId);
      if (terminal(i)) { this.close(i); return this.status(i); }
      if (["container_preparing", "publish_requested"].includes(i.state)) {
        if (this.expired(i)) i = (await this.change(i, "outcome_unknown", { status: "unknown", code: "INTERRUPTED" })).intent;
        if (terminal(i)) this.close(i);
        return this.status(i);
      }
      if (i.state === "creator_approved") {
        let check = await this.current(i); if (!check.resolved) return this.status(check.intent);
        const claim = await this.change(i, "container_preparing"); i = claim.intent;
        if (!claim.applied) return this.status(i);
        let observedReceipt: PublishReceipt | undefined;
        try {
          check = await this.current(i); if (!check.resolved) return this.status(check.intent);
          const handle = await this.wait(() => this.deps!.lease.open({ ...i.owner, intentId: i.id, assetId: i.binding.assetId,
            ...targetOf(i), fingerprint: i.binding.fingerprint, imageSha256: i.binding.imageSha256 }, this.deps!.mediaTtlMs ?? 60_000), async () => { this.close(i); });
          check = await this.after(i); if (!check.resolved) return this.status(check.intent);
          if (handle?.sampleOnly !== true || !matches(handle.handle, /^mock-lease:[A-Za-z0-9_-]{43}$/)
            || !Number.isFinite(Date.parse(handle.expiresAt)) || Date.parse(handle.expiresAt) <= this.now().getTime()) throw new Error();
          const created = await this.wait(() => this.deps!.publisher.createImageContainer({ intentId: i.id, target: targetOf(i),
            imageSha256: i.binding.imageSha256, caption: check.resolved!.draft.caption, mediaHandle: handle.handle }), async value => {
            const receipt = this.receipt(value, "containerId"); if (receipt) await this.late(i, receipt);
          });
          const receipt = this.receipt(created, "containerId"); if (!receipt) throw new Error();
          observedReceipt = receipt;
          check = await this.after(i, receipt); if (!check.resolved) return this.status(check.intent);
          const saved = await this.change(i, "provider_processing", { ...receipt, status: "processing" }); i = saved.intent;
          if (!saved.applied) return this.status(await this.late(i, receipt));
        } catch (error) { return this.status(await this.providerFailure(i, error, observedReceipt)); }
      }
      if (i.state !== "provider_processing") return this.status(i);
      if (this.expired(i)) { i = await this.halt(i); return this.status(i); }
      let observedReceipt: PublishReceipt | undefined;
      try {
        let check = await this.current(i); if (!check.resolved) return this.status(check.intent);
        if (!matches(i.receipt.containerId, providerId)) throw new Error();
        const containerId = i.receipt.containerId;
        const response = await this.wait(() => this.deps!.publisher.getContainerStatus(targetOf(i), containerId));
        check = await this.after(i); if (!check.resolved) return this.status(check.intent);
        if (response?.sampleOnly !== true) throw new Error();
        if (response.state === "processing") return this.status(i);
        if (response.state === "failed") throw new PublishProviderError("PUBLISH_PROVIDER_REJECTED");
        if (response.state !== "ready") throw new Error();
        const ready = await this.change(i, "provider_processing", { containerId, status: "ready" }); i = ready.intent;
        if (!ready.applied) return this.status(i);
        check = await this.current(i); if (!check.resolved) return this.status(check.intent);
        const claim = await this.change(i, "publish_requested"); i = claim.intent;
        if (!claim.applied) return this.status(i);
        check = await this.current(i); if (!check.resolved) return this.status(check.intent);
        const published = await this.wait(() => this.deps!.publisher.publishContainer(targetOf(i), containerId), async value => {
          const receipt = this.receipt(value, "mediaId"); if (receipt) await this.late(i, receipt);
        });
        const receipt = this.receipt(published, "mediaId"); if (!receipt) throw new Error();
        observedReceipt = receipt;
        check = await this.after(i, receipt); if (!check.resolved) return this.status(check.intent);
        // Persist the returned ID before the lookup await; the crash state is honest unknown.
        const saved = await this.change(i, "outcome_unknown", { ...receipt, status: "unknown" }); i = saved.intent;
        this.close(i);
        if (!saved.applied) return this.status(await this.late(i, receipt));
        return this.status(await this.lookup(i));
      } catch (error) { return this.status(await this.providerFailure(i, error, observedReceipt)); }
    }, { owner, intentId });
  }

  private async lookup(i: PublishIntent): Promise<PublishIntent> {
    const mediaId = i.receipt.mediaId ?? i.lateReceipt.mediaId;
    if (i.state !== "outcome_unknown" || i.stoppedAt !== null || !matches(mediaId, providerId)) return i;
    let check = await this.current(i); if (!check.resolved) return check.intent;
    try {
      const found = await this.wait(() => this.deps!.publisher.getPublishedMedia(targetOf(i), mediaId));
      check = await this.after(i, { mediaId, sampleOnly: true }); if (!check.resolved) return check.intent;
      if (found?.sampleOnly !== true || found.mediaId !== mediaId || found.accountSubject !== i.binding.accountSubject) return i;
      return (await this.change(i, "published", { mediaId, status: "published" })).intent;
    } catch { return this.read(i.owner, i.id); }
  }

  /** Exact receipt lookup only: no container create, publish, caption/time search or new target. */
  async reconcile(owner: PublishOwner, intentId: string): Promise<PublishStatus> {
    return this.safe(async () => {
      this.owner(owner); const i = await this.read(owner, intentId);
      const result = await this.lookup(i); if (terminal(result)) this.close(result);
      return this.status(result);
    }, { owner, intentId });
  }
}
