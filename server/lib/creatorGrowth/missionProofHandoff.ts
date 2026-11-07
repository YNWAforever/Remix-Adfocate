import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { ActiveMissionError } from "../activeMission/errors.js";
import { validateSubmitPublicationProofInput, type SubmitPublicationProofInput } from "../activeMission/publicationProof.js";
import { assertTransition } from "../activeMission/state.js";
import type { ActiveMissionOwner, ActiveMissionRepository, CreatorPublicationView, PublicationInstructionView } from "../activeMission/repo.js";
import type { PublishDraft } from "./publishPolicy.js";
import type { PublishActor, PublishIntent, PublishOwner } from "./publishRepo.js";

/** Trusted server projection only, never browser/model input. Current sample-only
 * PublishService outputs cannot supply this native evidence and are always denied.
 * A future resolver must verify the official receipt against the durable intent
 * and load the immutable instruction snapshot captured for that publication.
 */
export type PublishedMissionProofSource = Readonly<{
  intent: PublishIntent;
  draft: PublishDraft;
  instructionSnapshot: PublicationInstructionView | null;
  nativeReceipt: Readonly<{
    kind: "instagram_login" | "facebook_login" | "synthetic"; verified: boolean; sampleOnly: boolean;
    intentId: string; fingerprint: string; accountSubject: string; mediaId: string;
    permalink: string | null; publishedAt: string;
    /** Original immutable mission binding at publication, not the current edited draft. */
    approvedMission: Readonly<{ submissionId: string; workItemId: string; approvedVersionId: string; instructionRevision: number }>;
  }> | null;
}>;
/** Resolve through the original owned workspace/publication projections. The
 * expected subject must come from verified identity mapping, not username matching.
 * publication.revision is the existing publication-instruction revision.
 */
export type OriginalMissionProofBasis = Readonly<{
  kind: "active" | "legacy";
  owner: ActiveMissionOwner;
  publication: CreatorPublicationView;
  approvedCaption: string;
  approvedAssetHashes: readonly string[];
  expectedAccountSubject: string | null;
}>;
export type MissionProofHandoffDependencies = Readonly<{
  enabled?: boolean;
  now: () => Date;
  resolvePublished: (owner: PublishOwner, intentId: string) => Promise<PublishedMissionProofSource>;
  resolveMission: (owner: ActiveMissionOwner, workItemId: string) => Promise<OriginalMissionProofBasis>;
  /** Existing authoritative proof gateway, including its ownership, atomic state/
   * revision, URL/evidence validation and durable idempotency checks. No retry wrapper.
   */
  submitProof: ActiveMissionRepository["submitProof"];
}>;
export type MissionProofProposal = Readonly<{
  id: string; fingerprint: string; expiresAt: string; intentId: string;
  submissionId: string; workItemId: string; accountSubject: string;
  caption: string; imageSha256: string; approvedVersionId: string; instructionRevision: number;
  primaryUrl: string; mediaId: string; idempotencyKey: string;
}>;
export type MissionProofConfirmation = Readonly<{ proposalId: string; fingerprint: string; confirmed: boolean }>;
type BlockReason = "DISABLED" | "INVALID" | "NOT_AUTHORIZED" | "SAMPLE_RECEIPT" | "NATIVE_RECEIPT_UNVERIFIED"
  | "PUBLISH_OUTCOME_UNCONFIRMED" | "MANUAL_PROOF_REQUIRED" | "ORIGINAL_REVIEW_REQUIRED"
  | "CONFIRMATION_REQUIRED" | "CONFIRMATION_INVALID" | "CONFIRMATION_EXPIRED" | "CONFIRMATION_USED"
  | "PROOF_OUTCOME_UNKNOWN" | "UNAVAILABLE";
type Blocked = Readonly<{ status: "blocked"; reason: BlockReason; fallback: "manual_proof" | "original_review" | "status_check" | "none" }>;
type ProofReference = Readonly<{ status: "submitted" | "already_submitted"; attemptId: string; submissionId: string; workItemId: string }>;
export type MissionProofHandoffResult = Blocked | ProofReference | Readonly<{ status: "ready"; proposal: MissionProofProposal }>;
type Candidate = {
  status: "candidate"; owner: ActiveMissionOwner; workItemId: string; fingerprint: string;
  input: SubmitPublicationProofInput; content: Omit<MissionProofProposal, "id" | "fingerprint" | "expiresAt">;
};
type ConfirmationRecord = { actor: PublishActor; proposal: MissionProofProposal; used: boolean };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hash = /^[0-9a-f]{64}$/;
const providerId = /^[1-9][0-9]{0,63}$/;
const matches = (value: unknown, pattern: RegExp): value is string => typeof value === "string" && pattern.test(value);
const sameOwner = (a: PublishOwner, b: PublishOwner) => a?.workspaceId === b.workspaceId && a?.creatorId === b.creatorId;
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const blocked = (reason: BlockReason, fallback: Blocked["fallback"] = "original_review"): Blocked => ({ status: "blocked", reason, fallback });

function safePermalink(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && ["instagram.com", "www.instagram.com"].includes(url.hostname)
      && !url.username && !url.password && !url.search && !url.hash && !url.port
      && /^\/p\/[a-zA-Z0-9_-]+\/?$/.test(url.pathname)) return url.href;
  } catch { /* No URL fetch or raw input/error exposure. */ }
  return null;
}

/** Offline injected boundary. No runtime registration and no publishing/reward
 * capabilities. Proposal records guard human confirmation only; original mission
 * state, server authorization and durable idempotency remain the gateway's job.
 */
export class MissionProofHandoff {
  private readonly proposals = new Map<string, ConfirmationRecord>();
  constructor(private readonly deps?: MissionProofHandoffDependencies) {}

  private now(): number {
    const time = this.deps!.now().getTime();
    if (!Number.isFinite(time)) throw new Error("Invalid clock");
    return time;
  }

  private validActor(actor: PublishActor): boolean {
    return !!actor && matches(actor.workspaceId, uuid) && matches(actor.creatorId, uuid) && matches(actor.sessionHash, hash);
  }

  private async inspect(actor: PublishActor, intentId: string): Promise<Candidate | Blocked | ProofReference> {
    const owner: PublishOwner = { workspaceId: actor.workspaceId, creatorId: actor.creatorId };
    const source = structuredClone(await this.deps!.resolvePublished(owner, intentId));
    const { intent, draft, nativeReceipt: receipt, instructionSnapshot } = source;
    if (!intent || intent.id !== intentId || !sameOwner(intent.owner, owner) || !draft || !sameOwner(draft.owner, owner)) return blocked("NOT_AUTHORIZED", "none");
    if (intent.sampleOnly !== false || intent.receipt?.sampleOnly !== false || receipt?.sampleOnly === true) return blocked("SAMPLE_RECEIPT", "manual_proof");
    if (intent.state !== "published") return blocked("PUBLISH_OUTCOME_UNCONFIRMED", "status_check");
    if (!draft.mission || draft.mission.kind !== "active") return blocked("MANUAL_PROOF_REQUIRED", "manual_proof");
    const b = intent.binding;
    if (intent.stoppedAt !== null || !b || !matches(b.fingerprint, hash) || !matches(b.imageSha256, hash)
      || draft.id !== b.draftId || draft.revision !== b.draftRevision || draft.rightsConfirmed !== true
      || typeof draft.caption !== "string" || sha(draft.caption) !== b.captionSha256
      || draft.imageSha256 !== b.imageSha256 || draft.accountSubject !== b.accountSubject) return blocked("ORIGINAL_REVIEW_REQUIRED");
    const facebookBasis=b.missionBasis;
    const productMatches=receipt?.kind==='instagram_login'&&!facebookBasis || receipt?.kind==='facebook_login'&&facebookBasis?.kind==='active_mission_provider'&&facebookBasis.product==='facebook_login'
      &&facebookBasis.submissionId===draft.mission.submissionId&&facebookBasis.workItemId===draft.mission.workItemId&&facebookBasis.approvedVersionId===draft.mission.approvedVersionId&&facebookBasis.instructionRevision===draft.mission.instructionRevision;
    if (!receipt || !productMatches || receipt.verified !== true || receipt.sampleOnly !== false
      || receipt.intentId !== intentId || receipt.fingerprint !== b.fingerprint || receipt.accountSubject !== b.accountSubject
      || !matches(receipt.accountSubject, providerId) || !matches(receipt.mediaId, providerId)
      || intent.receipt.status !== "published" || receipt.mediaId !== intent.receipt.mediaId
      || !Number.isFinite(Date.parse(receipt.publishedAt)) || Date.parse(receipt.publishedAt) > this.now()) return blocked("NATIVE_RECEIPT_UNVERIFIED", "manual_proof");
    const primaryUrl = safePermalink(receipt.permalink);
    if (!primaryUrl) return blocked("NATIVE_RECEIPT_UNVERIFIED", "manual_proof");
    const m = draft.mission;
    if (![m.submissionId, m.workItemId, m.approvedVersionId].every(value => matches(value, uuid))) return blocked("ORIGINAL_REVIEW_REQUIRED");
    const approved = receipt.approvedMission;
    if (!approved || approved.submissionId !== m.submissionId || approved.workItemId !== m.workItemId
      || approved.approvedVersionId !== m.approvedVersionId || approved.instructionRevision !== m.instructionRevision) return blocked("ORIGINAL_REVIEW_REQUIRED");
    const originalOwner: ActiveMissionOwner = { ...owner, submissionId: m.submissionId };
    const original = structuredClone(await this.deps!.resolveMission(originalOwner, m.workItemId));
    const p = original.publication;
    if (!sameOwner(original.owner, owner) || original.owner.submissionId !== m.submissionId || p.workItemId !== m.workItemId) return blocked("NOT_AUTHORIZED", "none");
    if (original.kind !== "active") return blocked("MANUAL_PROOF_REQUIRED", "manual_proof");
    if (p.platform !== "instagram" || p.approvedVersionId !== m.approvedVersionId || p.revision !== m.instructionRevision
      || !Number.isSafeInteger(p.revision) || p.revision < 0 || original.approvedCaption !== draft.caption
      || original.approvedAssetHashes.length !== 1 || original.approvedAssetHashes[0] !== draft.imageSha256
      || original.expectedAccountSubject !== b.accountSubject || !instructionSnapshot
      || !p.instructions.frozenAt || !Number.isFinite(Date.parse(p.instructions.frozenAt))
      || !isDeepStrictEqual(instructionSnapshot,p.instructions)
      || !p.instructions.requiredDisclosures.every(text => typeof text === "string" && text.trim() && draft.caption.includes(text))) return blocked("ORIGINAL_REVIEW_REQUIRED");
    // A changed publish source during the original resolver await invalidates this read.
    const latest = await this.deps!.resolvePublished(owner, intentId);
    if (JSON.stringify(latest) !== JSON.stringify(source)) return blocked("ORIGINAL_REVIEW_REQUIRED");
    const existing = p.attempts.find(attempt => safePermalink(attempt.primaryUrl) === primaryUrl);
    if (existing) return { status: "already_submitted", attemptId: existing.id, submissionId: m.submissionId, workItemId: m.workItemId };
    if (p.state !== "approved_to_publish") return blocked("ORIGINAL_REVIEW_REQUIRED");
    if (Object.keys(p.instructions.proofEvidencePolicy).length > 0) return blocked("MANUAL_PROOF_REQUIRED", "manual_proof");
    assertTransition(p.state, "proof_submitted"); // Validate only; do not transition local mission state.
    const input = validateSubmitPublicationProofInput({ primaryUrl, additionalUrls: [], evidenceAssetIds: [] }, {
      expectedState: p.state, expectedRevision: p.revision, idempotencyKey: intent.id,
    });
    const fingerprint = sha(JSON.stringify([actor, intent.id, intent.version, b, draft, receipt, p.approvedVersionId, p.revision, p.instructions]));
    return { status: "candidate", owner: originalOwner, workItemId: m.workItemId, input, fingerprint,
      content: { intentId, submissionId: m.submissionId, workItemId: m.workItemId, accountSubject: b.accountSubject,
        caption: draft.caption, imageSha256: b.imageSha256, approvedVersionId: m.approvedVersionId, instructionRevision: p.revision,
        primaryUrl, mediaId: receipt.mediaId, idempotencyKey: intent.id } };
  }

  async prepare(actor: PublishActor, intentId: string): Promise<MissionProofHandoffResult> {
    if (this.deps?.enabled !== true) return blocked("DISABLED", "none");
    if (!this.validActor(actor) || !matches(intentId, uuid)) return blocked("INVALID", "none");
    try {
      const now = this.now();
      for (const [key, record] of this.proposals) if (Date.parse(record.proposal.expiresAt) <= now) this.proposals.delete(key);
      const inspected = await this.inspect(actor, intentId);
      if (inspected.status !== "candidate") return inspected;
      const proposal = Object.freeze({ ...inspected.content, id: randomUUID(), fingerprint: inspected.fingerprint, expiresAt: new Date(this.now() + 300_000).toISOString() });
      this.proposals.set(proposal.id, { actor: { ...actor }, proposal, used: false });
      return { status: "ready", proposal };
    } catch { return blocked("UNAVAILABLE"); }
  }

  async confirm(actor: PublishActor, input: MissionProofConfirmation): Promise<MissionProofHandoffResult> {
    if (this.deps?.enabled !== true) return blocked("DISABLED", "none");
    if (!this.validActor(actor) || !input || Object.keys(input).some(key => !["proposalId", "fingerprint", "confirmed"].includes(key))) return blocked("INVALID", "none");
    if (input.confirmed !== true) return blocked("CONFIRMATION_REQUIRED");
    const record = this.proposals.get(input.proposalId);
    if (!record || !sameOwner(record.actor, actor) || record.actor.sessionHash !== actor.sessionHash || record.proposal.fingerprint !== input.fingerprint) return blocked("CONFIRMATION_INVALID", "none");
    if (record.used) return blocked("CONFIRMATION_USED");
    try {
      if (this.now() >= Date.parse(record.proposal.expiresAt)) return blocked("CONFIRMATION_EXPIRED");
      record.used = true; // Consume before awaits: no double click or implicit resubmission.
      const current = await this.inspect(actor, record.proposal.intentId);
      if (current.status !== "candidate") return current;
      if (current.fingerprint !== record.proposal.fingerprint) return blocked("ORIGINAL_REVIEW_REQUIRED");
      if (this.now() >= Date.parse(record.proposal.expiresAt)) return blocked("CONFIRMATION_EXPIRED");
      try {
        const result = await this.deps.submitProof(current.owner, current.workItemId, current.input);
        if (!matches(result.attempt.id, uuid) || safePermalink(result.attempt.primaryUrl) !== current.input.primaryUrl
          || result.publication.workItemId !== current.workItemId) return blocked("PROOF_OUTCOME_UNKNOWN");
        return { status: "submitted", attemptId: result.attempt.id, submissionId: current.owner.submissionId, workItemId: current.workItemId };
      } catch (error) {
        if (error instanceof ActiveMissionError && ["WORKFLOW_STALE", "WRONG_STATE", "PUBLICATION_SETUP_REQUIRED"].includes(error.code)) return blocked("ORIGINAL_REVIEW_REQUIRED");
        return blocked("PROOF_OUTCOME_UNKNOWN");
      }
    } catch { return blocked("UNAVAILABLE"); }
  }
}
