// @vitest-environment node
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActiveMissionError } from "../activeMission/errors.js";
import { validateSubmitPublicationProofInput } from "../activeMission/publicationProof.js";
import { assertTransition, deriveWorkflowState } from "../activeMission/state.js";
import type { ActiveMissionRepository, PublicationProofAttemptView } from "../activeMission/repo.js";
import { MissionProofHandoff, type MissionProofProposal, type OriginalMissionProofBasis, type PublishedMissionProofSource } from "./missionProofHandoff.js";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor = { workspaceId: id(1), creatorId: id(2), sessionHash: "a".repeat(64) };
const owner = { workspaceId: id(1), creatorId: id(2) };
const caption = "  已核准的原文 🌱\n\n#合作\n";
const permalink = "https://www.instagram.com/p/ApprovedPost/";
const instructions = {
  publicationInstructions: "只發佈這張圖片，保留完整文案。", requiredDisclosures: ["#合作"],
  expectedAccount: "@creator.hk", proofEvidencePolicy: {},
  publishDueAt: "2026-11-05T12:00:00.000Z", frozenAt: "2026-11-04T09:00:00.000Z",
};

/** Native-shaped trusted resolver fixtures only. No real native receipt exists in this pilot. */
function fixture() {
  let time = Date.parse("2026-11-04T12:00:00.000Z");
  let source: PublishedMissionProofSource = {
    intent: {
      id: id(10), owner, requestId: id(11), state: "published", version: 5,
      binding: { draftId: id(20), draftRevision: 1, assetId: id(30), imageSha256: "b".repeat(64),
        captionSha256: createHash("sha256").update(caption).digest("hex"), connectionId: id(40),
        accountSubject: "17841400001", grantGeneration: 1, fingerprint: "c".repeat(64) },
      receipt: { mediaId: "18000000001", status: "published", observedAt: "2026-11-04T11:00:00.000Z", sampleOnly: false },
      lateReceipt: {}, sampleOnly: false, stoppedAt: null,
      createdAt: "2026-11-04T10:00:00.000Z", updatedAt: "2026-11-04T11:00:00.000Z", retentionUntil: "2026-12-04T10:00:00.000Z",
    },
    draft: { id: id(20), revision: 1, owner, accountSubject: "17841400001", imageSha256: "b".repeat(64), rightsConfirmed: true,
      caption, asset: { mime: "image/jpeg", byteSize: 1024, width: 400, height: 500, validated: true },
      disclosure: { sponsored: true, captionText: "#合作", platformLabelRequired: false, brandTagRequired: false },
      mission: { kind: "active", submissionId: id(50), workItemId: id(60), approvedVersionId: id(70), instructionRevision: 7 } },
    instructionSnapshot: structuredClone(instructions),
    nativeReceipt: { kind: "instagram_login", verified: true, sampleOnly: false, intentId: id(10), fingerprint: "c".repeat(64),
      accountSubject: "17841400001", mediaId: "18000000001", permalink, publishedAt: "2026-11-04T11:00:00.000Z",
      approvedMission: { submissionId: id(50), workItemId: id(60), approvedVersionId: id(70), instructionRevision: 7 } },
  };
  let mission: OriginalMissionProofBasis = {
    kind: "active", owner: { ...owner, submissionId: id(50) },
    publication: { workItemId: id(60), platform: "instagram", state: "approved_to_publish", revision: 7, approvedVersionId: id(70),
      instructions: structuredClone(instructions), attempts: [], currentAttempt: null, acceptedAttempt: null },
    approvedCaption: caption, approvedAssetHashes: ["b".repeat(64)], expectedAccountSubject: "17841400001",
  };
  // Test gateway follows the existing proof interface/validator/state transition.
  // Its map stands in for original RPC idempotency; it is not live database evidence.
  const attempts = new Map<string, Awaited<ReturnType<ActiveMissionRepository["submitProof"]>>>();
  const resolvePublished = vi.fn(async () => structuredClone(source));
  const resolveMission = vi.fn(async () => structuredClone(mission));
  const submitProof = vi.fn<ActiveMissionRepository["submitProof"]>(async (originalOwner, workItemId, input) => {
    const checked = validateSubmitPublicationProofInput(input, input);
    const key = [originalOwner.workspaceId, workItemId, checked.idempotencyKey].join(":");
    const existing = attempts.get(key);
    if (existing) return structuredClone(existing);
    if (checked.expectedState !== mission.publication.state || checked.expectedRevision !== mission.publication.revision) throw new ActiveMissionError("WORKFLOW_STALE", "original conflict");
    assertTransition(mission.publication.state, "proof_submitted");
    const attempt: PublicationProofAttemptView = { id: id(80 + attempts.size), attemptNumber: attempts.size + 1,
      primaryUrl: checked.primaryUrl, additionalUrls: checked.additionalUrls ?? [], submittedAt: new Date(time).toISOString(),
      submittedLate: false, metadataStatus: "unavailable", metadataSnapshot: {}, metadataErrorCategory: null,
      evidence: [], review: null, corrections: [] };
    mission = { ...mission, publication: { ...mission.publication, state: "proof_submitted", attempts: [...mission.publication.attempts, attempt], currentAttempt: attempt } };
    const result = { attempt, publication: structuredClone(mission.publication) };
    attempts.set(key, result);
    return result;
  });
  const deps = { enabled: true, now: () => new Date(time), resolvePublished, resolveMission, submitProof };
  const handoff = new MissionProofHandoff(deps);
  return { handoff, deps, resolvePublished, resolveMission, submitProof, attempts,
    get source() { return source; }, get mission() { return mission; },
    setSource: (next: PublishedMissionProofSource) => { source = next; },
    setMission: (next: OriginalMissionProofBasis) => { mission = next; },
    advance: (ms: number) => { time += ms; } };
}

async function proposal(f: ReturnType<typeof fixture>): Promise<MissionProofProposal> {
  const result = await f.handoff.prepare(actor, id(10));
  expect(result.status).toBe("ready");
  if (result.status !== "ready") throw new Error("Expected a native-shaped fixture proposal");
  return result.proposal;
}
const confirmation = (p: MissionProofProposal) => ({ proposalId: p.id, fingerprint: p.fingerprint, confirmed: true });

beforeEach(() => { vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network forbidden"); })); });
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe("offline default-off mission proof handoff", () => {
  it('accepts Facebook receipt only with its exact provider mission binding',async()=>{
    const f=fixture();let source=structuredClone(f.source);const m=source.draft.mission!;
    source={...source,nativeReceipt:{...source.nativeReceipt!,kind:'facebook_login'}};
    f.setSource(source);expect((await f.handoff.prepare(actor,id(10))).status).toBe('blocked');
    source={...source,intent:{...source.intent,binding:{...source.intent.binding,missionBasis:{kind:'active_mission_provider',product:'facebook_login',appId:'11111',submissionId:m.submissionId,workItemId:m.workItemId,approvedVersionId:m.approvedVersionId,instructionRevision:m.instructionRevision,disclosureSha256:'d'.repeat(64)}}}};
    f.setSource(source);await proposal(f);expect(f.submitProof).not.toHaveBeenCalled();
  });
  it('accepts unchanged instructions after JSONB-style key reordering',async()=>{
    const f=fixture(),s=f.source;
    f.setSource({...s,instructionSnapshot:Object.fromEntries(Object.entries(s.instructionSnapshot!).reverse()) as typeof s.instructionSnapshot});
    await proposal(f);
  });
  it("is disabled before reading any source or calling the original gateway", async () => {
    const f = fixture();
    for (const handoff of [new MissionProofHandoff(), new MissionProofHandoff({ ...f.deps, enabled: false })]) {
      expect(await handoff.prepare(actor, id(10))).toMatchObject({ status: "blocked", reason: "DISABLED" });
      expect(await handoff.confirm(actor, { proposalId: id(99), fingerprint: "c".repeat(64), confirmed: true })).toMatchObject({ reason: "DISABLED" });
    }
    expect(f.resolvePublished).not.toHaveBeenCalled(); expect(f.submitProof).not.toHaveBeenCalled();
  });

  it("proposes exact approved content and a stable intent-derived key without submitting", async () => {
    const f = fixture(); const p = await proposal(f);
    expect(p).toMatchObject({ intentId: id(10), submissionId: id(50), workItemId: id(60), accountSubject: "17841400001",
      caption, imageSha256: "b".repeat(64), approvedVersionId: id(70), instructionRevision: 7,
      mediaId: "18000000001", primaryUrl: permalink, idempotencyKey: id(10), expiresAt: "2026-11-04T12:05:00.000Z" });
    expect(Object.isFrozen(p)).toBe(true);
    expect(f.resolvePublished).toHaveBeenCalledWith(owner, id(10));
    expect(f.resolveMission).toHaveBeenCalledWith({ ...owner, submissionId: id(50) }, id(60));
    expect(f.submitProof).not.toHaveBeenCalled();
  });

  it("uses only the original validated proof payload after explicit current confirmation", async () => {
    const f = fixture(); const p = await proposal(f);
    expect(await f.handoff.confirm(actor, confirmation(p))).toEqual({ status: "submitted", attemptId: id(80), submissionId: id(50), workItemId: id(60) });
    expect(f.submitProof).toHaveBeenCalledTimes(1);
    expect(f.submitProof).toHaveBeenCalledWith({ ...owner, submissionId: id(50) }, id(60), {
      expectedState: "approved_to_publish", expectedRevision: 7, idempotencyKey: id(10),
      primaryUrl: permalink, additionalUrls: [], evidenceAssetIds: [],
    });
    expect(f.mission.publication.currentAttempt?.review).toBeNull();
    expect(deriveWorkflowState({ fulfillment: null, items: [{ state: f.mission.publication.state, required: true }] })).toBe("publication_in_progress");
  });

  it.each(["intent", "receipt", "missing_receipt_flag"] as const)("rejects synthetic or unknown provenance at %s despite published state", layer => {
    const f = fixture();
    f.setSource({ ...f.source, intent: { ...f.source.intent,
      ...(layer === "intent" ? { sampleOnly: true } : {}),
      receipt: { ...f.source.intent.receipt, sampleOnly: layer === "receipt" ? true : layer === "missing_receipt_flag" ? undefined : false } } });
    return expect(f.handoff.prepare(actor, id(10))).resolves.toMatchObject({ status: "blocked", reason: "SAMPLE_RECEIPT", fallback: "manual_proof" }).then(() => {
      expect(f.resolveMission).not.toHaveBeenCalled(); expect(f.submitProof).not.toHaveBeenCalled();
    });
  });

  it.each([
    null,
    { kind: "synthetic" }, { verified: false }, { sampleOnly: true }, { intentId: id(999) },
    { fingerprint: "d".repeat(64) }, { mediaId: "18000000099" }, { accountSubject: "17841400099" },
    { publishedAt: "invalid" }, { publishedAt: "2026-11-04T14:00:00Z" },
  ])("denies missing/unverified/mismatched native evidence %j", async patch => {
    const f = fixture();
    f.setSource({ ...f.source, nativeReceipt: patch === null ? null : { ...f.source.nativeReceipt!, ...patch } as PublishedMissionProofSource["nativeReceipt"] });
    expect(await f.handoff.prepare(actor, id(10))).toMatchObject({ status: "blocked" });
    expect(f.submitProof).not.toHaveBeenCalled();
  });

  it.each(["javascript:alert(1)", "https://user:password@instagram.com/p/ApprovedPost/", "https://www.instagram.com/p/ApprovedPost/?token=secret", "https://instagram.com.evil.test/p/ApprovedPost/", null])("rejects unsafe or absent receipt URL %s without echoing it", async permalink => {
    const f = fixture(); f.setSource({ ...f.source, nativeReceipt: { ...f.source.nativeReceipt!, permalink } });
    const result = await f.handoff.prepare(actor, id(10));
    expect(result).toMatchObject({ status: "blocked", fallback: "manual_proof" });
    expect(JSON.stringify(result)).not.toContain("secret"); expect(f.submitProof).not.toHaveBeenCalled();
  });

  it.each(["container_preparing", "provider_processing", "publish_requested", "outcome_unknown"] as const)("sends %s to status check, never proof or publishing", async state => {
    const f = fixture(); f.setSource({ ...f.source, intent: { ...f.source.intent, state } });
    expect(await f.handoff.prepare(actor, id(10))).toEqual({ status: "blocked", reason: "PUBLISH_OUTCOME_UNCONFIRMED", fallback: "status_check" });
    expect(f.resolveMission).not.toHaveBeenCalled(); expect(f.submitProof).not.toHaveBeenCalled();
  });

  it.each(["creator", "workspace", "draft_owner", "mission_owner", "mission_target"] as const)("rejects wrong owned scope: %s", async kind => {
    const f = fixture();
    if (kind === "creator" || kind === "workspace") f.setSource({ ...f.source, intent: { ...f.source.intent, owner: { ...owner, [kind === "creator" ? "creatorId" : "workspaceId"]: id(999) } } });
    if (kind === "draft_owner") f.setSource({ ...f.source, draft: { ...f.source.draft, owner: { ...owner, creatorId: id(999) } } });
    if (kind === "mission_owner") f.setMission({ ...f.mission, owner: { ...f.mission.owner, workspaceId: id(999) } });
    if (kind === "mission_target") f.setMission({ ...f.mission, publication: { ...f.mission.publication, workItemId: id(999) } });
    expect(await f.handoff.prepare(actor, id(10))).toMatchObject({ status: "blocked", reason: "NOT_AUTHORIZED" });
    expect(f.submitProof).not.toHaveBeenCalled();
  });

  it.each(["caption", "image", "account", "draft_revision", "version", "instruction_revision", "instruction_text", "expected_account", "disclosure", "rights"] as const)("returns changed %s to original review", async field => {
    const f = fixture();
    const p = await proposal(f);
    if (field === "caption") f.setSource({ ...f.source, draft: { ...f.source.draft, caption: caption.trim() } });
    if (field === "image") f.setSource({ ...f.source, draft: { ...f.source.draft, imageSha256: "d".repeat(64) } });
    if (field === "account") f.setSource({ ...f.source, draft: { ...f.source.draft, accountSubject: "17841499999" } });
    if (field === "draft_revision") f.setSource({ ...f.source, draft: { ...f.source.draft, revision: 2 } });
    if (field === "version") f.setMission({ ...f.mission, publication: { ...f.mission.publication, approvedVersionId: id(999) } });
    if (field === "instruction_revision") f.setMission({ ...f.mission, publication: { ...f.mission.publication, revision: 8 } });
    if (field === "instruction_text") f.setMission({ ...f.mission, publication: { ...f.mission.publication, instructions: { ...instructions, publicationInstructions: "Changed without revision" } } });
    if (field === "expected_account") f.setMission({ ...f.mission, expectedAccountSubject: "17841499999" });
    if (field === "disclosure") f.setMission({ ...f.mission, publication: { ...f.mission.publication, instructions: { ...instructions, requiredDisclosures: ["#new"] } } });
    if (field === "rights") f.setSource({ ...f.source, draft: { ...f.source.draft, rightsConfirmed: false } });
    expect(await f.handoff.confirm(actor, confirmation(p))).toMatchObject({ status: "blocked", reason: "ORIGINAL_REVIEW_REQUIRED", fallback: "original_review" });
    expect(f.submitProof).not.toHaveBeenCalled();
  });

  it.each(["legacy", "personal", "evidence_required"] as const)("preserves the original manual flow for %s", async kind => {
    const f = fixture();
    if (kind === "legacy") f.setSource({ ...f.source, draft: { ...f.source.draft, mission: { ...f.source.draft.mission!, kind: "legacy" } } });
    if (kind === "personal") f.setSource({ ...f.source, draft: { ...f.source.draft, mission: undefined } });
    if (kind === "evidence_required") {
      const required = { ...instructions, proofEvidencePolicy: { screenshot: true } };
      f.setSource({ ...f.source, instructionSnapshot: required });
      f.setMission({ ...f.mission, publication: { ...f.mission.publication, instructions: required } });
    }
    expect(await f.handoff.prepare(actor, id(10))).toMatchObject({ status: "blocked", fallback: "manual_proof" });
    expect(f.submitProof).not.toHaveBeenCalled();
  });

  it.each(["mission", "version"] as const)("cannot retarget a published intent to another matching canonical %s", async kind => {
    const f = fixture();
    const changed = { ...f.source.draft.mission!, ...(kind === "mission" ? { submissionId: id(150), workItemId: id(160) } : { approvedVersionId: id(170) }) };
    f.setSource({ ...f.source, draft: { ...f.source.draft, mission: changed } });
    f.setMission({ ...f.mission, owner: { ...owner, submissionId: changed.submissionId }, publication: {
      ...f.mission.publication, workItemId: changed.workItemId, approvedVersionId: changed.approvedVersionId,
    } });
    expect(await f.handoff.prepare(actor, id(10))).toMatchObject({ status: "blocked", reason: "ORIGINAL_REVIEW_REQUIRED" });
    expect(f.submitProof).not.toHaveBeenCalled();
  });

  it("rejects a source that changes while resolving the original mission", async () => {
    const f = fixture();
    f.resolveMission.mockImplementationOnce(async () => {
      f.setSource({ ...f.source, draft: { ...f.source.draft, caption: "changed during await" } });
      return structuredClone(f.mission);
    });
    expect(await f.handoff.prepare(actor, id(10))).toMatchObject({ status: "blocked", reason: "ORIGINAL_REVIEW_REQUIRED" });
    expect(f.submitProof).not.toHaveBeenCalled();
  });

  it.each(["no_human", "session", "fingerprint", "expired", "forged_id"] as const)("requires a current human confirmation: %s", async kind => {
    const f = fixture(); const p = await proposal(f);
    if (kind === "expired") f.advance(300_000);
    const result = await f.handoff.confirm(kind === "session" ? { ...actor, sessionHash: "d".repeat(64) } : actor, {
      ...confirmation(p), ...(kind === "no_human" ? { confirmed: false } : {}),
      ...(kind === "fingerprint" ? { fingerprint: "d".repeat(64) } : {}), ...(kind === "forged_id" ? { proposalId: id(999) } : {}),
    });
    expect(result.status).toBe("blocked"); expect(f.submitProof).not.toHaveBeenCalled();
  });

  it("returns an existing original attempt for a repeated receipt without another proof path", async () => {
    const f = fixture(); const p = await proposal(f);
    await f.handoff.confirm(actor, confirmation(p));
    const again = await new MissionProofHandoff(f.deps).prepare(actor, id(10));
    expect(again).toEqual({ status: "already_submitted", attemptId: id(80), submissionId: id(50), workItemId: id(60) });
    expect(f.submitProof).toHaveBeenCalledTimes(1); expect(f.attempts.size).toBe(1);
  });

  it("uses the same original idempotency key across independently prepared confirmations", async () => {
    const f = fixture(); const second = new MissionProofHandoff(f.deps);
    const firstProposal = await proposal(f); const other = await second.prepare(actor, id(10));
    if (other.status !== "ready") throw new Error("Expected second proposal");
    const results = await Promise.all([f.handoff.confirm(actor, confirmation(firstProposal)), second.confirm(actor, confirmation(other.proposal))]);
    expect(results.every(result => result.status === "submitted" || result.status === "already_submitted")).toBe(true);
    expect(f.submitProof.mock.calls.every(call => call[2].idempotencyKey === id(10))).toBe(true);
    expect(f.attempts.size).toBe(1);
  });

  it("does not automatically retry an ambiguous gateway failure or leak its error", async () => {
    const f = fixture(); const p = await proposal(f);
    f.submitProof.mockRejectedValue(new Error("private-token=https://user:secret@private.invalid"));
    const result = await f.handoff.confirm(actor, confirmation(p));
    expect(result).toEqual({ status: "blocked", reason: "PROOF_OUTCOME_UNKNOWN", fallback: "original_review" });
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(await f.handoff.confirm(actor, confirmation(p))).toMatchObject({ status: "blocked", reason: "CONFIRMATION_USED" });
    expect(f.submitProof).toHaveBeenCalledTimes(1);
  });

  it("locks a double confirmation while the original submit gateway is pending", async () => {
    const f = fixture(); const p = await proposal(f);
    let finish!: () => void;
    const original = f.submitProof.getMockImplementation()!;
    f.submitProof.mockImplementation(async (...args) => {
      await new Promise<void>(resolve => { finish = resolve; });
      return original(...args);
    });
    const first = f.handoff.confirm(actor, confirmation(p));
    await vi.waitFor(() => expect(f.submitProof).toHaveBeenCalledTimes(1));
    expect(await f.handoff.confirm(actor, confirmation(p))).toMatchObject({ reason: "CONFIRMATION_USED" });
    finish();
    expect(await first).toMatchObject({ status: "submitted" });
    expect(f.attempts.size).toBe(1);
  });

  it("rechecks confirmation expiry after asynchronous canonical reads", async () => {
    const f = fixture(); const p = await proposal(f);
    f.resolveMission.mockImplementationOnce(async () => { f.advance(300_000); return structuredClone(f.mission); });
    expect(await f.handoff.confirm(actor, confirmation(p))).toMatchObject({ reason: "CONFIRMATION_EXPIRED" });
    expect(f.submitProof).not.toHaveBeenCalled();
  });

  it("honours a stale original proof gateway without introducing new review or reward authority", async () => {
    const f = fixture(); const p = await proposal(f);
    f.submitProof.mockRejectedValue(new ActiveMissionError("WORKFLOW_STALE", "stale", { private: "secret" }));
    expect(await f.handoff.confirm(actor, confirmation(p))).toEqual({ status: "blocked", reason: "ORIGINAL_REVIEW_REQUIRED", fallback: "original_review" });
    expect(f.submitProof).toHaveBeenCalledTimes(1);
    expect(f.mission.publication.state).toBe("approved_to_publish"); expect(f.mission.publication.acceptedAttempt).toBeNull();
  });
});

