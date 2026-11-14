import { randomUUID } from "node:crypto";
import type { MissionPublicationView } from "../../src/lib/activeMission";
import { canonicalDeltaJson } from "./delta-evidence";
import { ProviderRehearsalFailure, requireProviderFact, type ProviderActor, type ProviderCaseResult, type ProviderRehearsalRuntime } from "./delta-provider-contracts";
import { createProviderMission, providerFixtureJson, providerFixtureUuid, providerJourneyRequest as request, providerNeutrality, providerWorkspace,
  requiredProviderItem, seedProviderIssuedHistory, type ProviderNeutralitySnapshot } from "./delta-provider-journey-fixtures";

export const PROVIDER_JOURNEY_CASES = ["journey-legacy-join-xp", "journey-null-mode-schema-guard", "journey-legacy-resubmission", "journey-active-join-neutrality",
  "journey-active-draft-review", "journey-active-proof-correction", "journey-active-pending-reward", "journey-synthetic-issued-anchor-preserved"] as const;
function same(left: unknown, right: unknown, code: string) { requireProviderFact(canonicalDeltaJson(left) === canonicalDeltaJson(right), code); }
function unchanged(before: ProviderNeutralitySnapshot, after: ProviderNeutralitySnapshot) { same(before, after, "journey-neutrality"); }
function xpDelta(before: ProviderNeutralitySnapshot, after: ProviderNeutralitySnapshot, creator: string, amount: number) {
  const expected = { ...before.xp, [creator]: before.xp[creator]! + amount }; same(expected, after.xp, "journey-xp-delta"); same(before.financial, after.financial, "journey-financial-delta");
}
async function legacyAnchor(runtime: ProviderRehearsalRuntime, submission: string): Promise<unknown> {
  const workspace = providerFixtureUuid(runtime.workspaceId), id = providerFixtureUuid(submission);
  const result = await providerFixtureJson<{ submission: { id: string; status: string; points_awarded: number; xp_awarded: number }; pointLedger: unknown[]; cashLedger: unknown[]; budgetLedger: unknown[] }>(runtime, `begin read only; select jsonb_build_object('submission',(select to_jsonb(s) from public.mission_submissions s where s.id='${id}' and s.workspace_id='${workspace}'),
    'pointLedger',(select jsonb_agg(to_jsonb(t) order by id) from public.point_transactions t where workspace_id='${workspace}' and source_ref='mission_submission:${id}'),
    'cashLedger',(select jsonb_agg(to_jsonb(t) order by id) from public.earnings_transactions t where workspace_id='${workspace}' and source_ref='mission_submission:${id}'),
    'budgetLedger',(select jsonb_agg(to_jsonb(t) order by id) from public.workspace_budget_transactions t where workspace_id='${workspace}' and source_ref='mission_submission:${id}')); commit;`, "issued-anchor");
  requireProviderFact(result.submission?.id === id && result.submission.status === "approved" && result.submission.points_awarded === 500 && result.submission.xp_awarded === 135
    && result.pointLedger?.length === 1 && result.cashLedger?.length === 1 && result.budgetLedger?.length === 1, "journey-history-anchor-prerequisite");
  return result;
}
async function submissionEvents(runtime: ProviderRehearsalRuntime, submission: string) {
  const workspace = providerFixtureUuid(runtime.workspaceId), id = providerFixtureUuid(submission);
  return providerFixtureJson<Array<{ id: string; event: string; previous_status: string; reviewer_notes_snapshot: string; xp_snapshot: number; points_snapshot: number; request_id: string; payload_hash: string }>>(runtime,
    `begin read only; select coalesce(jsonb_agg(to_jsonb(t) order by created_at,id),'[]'::jsonb) from public.mission_submission_events t where workspace_id='${workspace}' and mission_submission_id='${id}'; commit;`, "legacy-events");
}
export async function runProviderJourneys(runtime: ProviderRehearsalRuntime): Promise<ProviderCaseResult[]> {
  try {
    await runtime.assertOwned(); providerFixtureUuid(runtime.runId); providerFixtureUuid(runtime.workspaceId);
    const cases: ProviderCaseResult[] = [], creator = runtime.actors.creator, reviewer = runtime.actors.reviewer, operator = runtime.actors.operator;
    const history = await seedProviderIssuedHistory(runtime), historyBefore = await legacyAnchor(runtime, history.submissionId);
    let checkpoint = runtime.httpRequests;
    const legacy = await createProviderMission(runtime, "legacy"), beforeJoin = await providerNeutrality(runtime);
    const joined = await request<{ id: string; status: string; xp_awarded: number }>(runtime, creator, `/api/missions/${legacy.slug}/join`, "POST");
    providerFixtureUuid(joined.id); requireProviderFact(joined.status === "joined" && joined.xp_awarded === 10, "journey-legacy-join");
    const afterJoin = await providerNeutrality(runtime); xpDelta(beforeJoin, afterJoin, creator.id, 10);
    const duplicate = await request<{ code: string }>(runtime, creator, `/api/missions/${legacy.slug}/join`, "POST", undefined, undefined, 409);
    requireProviderFact(duplicate.code === "already_joined", "journey-legacy-replay"); unchanged(afterJoin, await providerNeutrality(runtime));
    cases.push(runtime.record(PROVIDER_JOURNEY_CASES[0], { beforeJoin, afterJoin, duplicateDenied: true, submissionId: joined.id }, checkpoint));

    checkpoint = runtime.httpRequests;
    const visibleLegacy = await request<{ id: string }>(runtime, creator, `/api/missions/${legacy.slug}`); requireProviderFact(visibleLegacy.id === legacy.id, "journey-schema-prerequisite");
    const schema = await providerFixtureJson<{ notNull: boolean }>(runtime, "begin read only; select jsonb_build_object('notNull',attnotnull) from pg_attribute where attrelid='public.missions'::regclass and attname='creator_workflow_mode' and not attisdropped; commit;", "null-mode-schema");
    requireProviderFact(schema.notNull === true, "journey-null-schema");
    cases.push(runtime.record(PROVIDER_JOURNEY_CASES[1], { notNull: true, historicalNullModeProviderJoin: "not-covered", ddlChanged: false }, checkpoint));

    checkpoint = runtime.httpRequests;
    const badEvidence = await request<{ code: string }>(runtime, creator, `/api/missions/${legacy.slug}/submit`, "PUT", { content_urls: ["invalid"] }, undefined, 400);
    requireProviderFact(badEvidence.code === "invalid_evidence", "journey-legacy-validation"); unchanged(afterJoin, await providerNeutrality(runtime));
    await request(runtime, creator, `/api/missions/${legacy.slug}/submit`, "PUT", { content_urls: ["https://example.test/provider-initial-proof"] });
    const submittedSnapshot = await providerNeutrality(runtime); xpDelta(afterJoin, submittedSnapshot, creator.id, 25);
    const reject = async (note: string) => request<{ status: string }>(runtime, reviewer, `/api/admin/submissions/${joined.id}/reject`, "POST", { notes: note });
    requireProviderFact((await reject("Synthetic first rejection")).status === "rejected", "journey-legacy-rejected");
    const firstKey = randomUUID(), firstBody = { content_urls: ["https://example.test/provider-corrected-proof"], submission_data: { note: "Synthetic correction" }, request_id: firstKey };
    const first = await request<{ id: string; status: string; resubmit_count: number; reviewer_notes: null; reviewed_at: null }>(runtime, creator, `/api/missions/${legacy.slug}/submit`, "PUT", firstBody);
    requireProviderFact(first.id === joined.id && first.status === "submitted" && first.resubmit_count === 1 && first.reviewer_notes === null && first.reviewed_at === null, "journey-legacy-resubmit");
    const replay = await request<typeof first>(runtime, creator, `/api/missions/${legacy.slug}/submit`, "PUT", firstBody); requireProviderFact(replay.id === first.id && replay.resubmit_count === 1, "journey-legacy-exact-replay");
    const conflict = await request<{ code: string }>(runtime, creator, `/api/missions/${legacy.slug}/submit`, "PUT", { ...firstBody, content_urls: ["https://example.test/provider-conflict"] }, undefined, 409);
    requireProviderFact(conflict.code === "IDEMPOTENCY_CONFLICT", "journey-legacy-conflict");
    const stale = await request<{ code: string }>(runtime, creator, `/api/missions/${legacy.slug}/submit`, "PUT", { ...firstBody, request_id: randomUUID() }, undefined, 409);
    requireProviderFact(stale.code === "wrong_state", "journey-legacy-stale-state");
    const firstEvents = await submissionEvents(runtime, joined.id);
    requireProviderFact(firstEvents.length === 1 && firstEvents[0]!.event === "resubmitted" && firstEvents[0]!.previous_status === "rejected"
      && firstEvents[0]!.reviewer_notes_snapshot === "Synthetic first rejection" && firstEvents[0]!.request_id === firstKey && firstEvents[0]!.xp_snapshot === 35
      && firstEvents[0]!.points_snapshot === 0 && /^[a-f0-9]{64}$/.test(firstEvents[0]!.payload_hash), "journey-legacy-event");
    unchanged(submittedSnapshot, await providerNeutrality(runtime));
    requireProviderFact((await reject("Synthetic second rejection")).status === "rejected", "journey-legacy-second-rejection");
    const second = await request<{ resubmit_count: number }>(runtime, creator, `/api/missions/${legacy.slug}/submit`, "PUT", { content_urls: ["https://example.test/provider-second-proof"], request_id: randomUUID() });
    requireProviderFact(second.resubmit_count === 2, "journey-legacy-second-resubmit");
    requireProviderFact((await reject("Synthetic exhausted rejection")).status === "rejected", "journey-legacy-limit-prerequisite");
    const exhausted = await request<{ code: string }>(runtime, creator, `/api/missions/${legacy.slug}/submit`, "PUT", { content_urls: ["https://example.test/provider-exhausted-proof"], request_id: randomUUID() }, undefined, 409);
    requireProviderFact(exhausted.code === "revision_limit_reached", "journey-legacy-revision-limit");
    const mine = await request<{ submissions: Array<{ id: string; closed: boolean; resubmit_count: number; resubmit_remaining: number }> }>(runtime, creator, "/api/missions/my");
    const row = mine.submissions.find(candidate => candidate.id === joined.id);
    requireProviderFact(row?.closed === true && row.resubmit_count === 2 && row.resubmit_remaining === 0, "journey-legacy-reload");
    const finalEvents = await submissionEvents(runtime, joined.id); requireProviderFact(finalEvents.length === 2, "journey-legacy-event-count");
    unchanged(submittedSnapshot, await providerNeutrality(runtime));
    cases.push(runtime.record(PROVIDER_JOURNEY_CASES[2], { firstEvents, finalEvents, submittedSnapshot, after: await providerNeutrality(runtime), exactReplay: true, changedReplayDenied: true, staleStateDenied: true, revisionExhausted: true }, checkpoint));

    checkpoint = runtime.httpRequests;
    const active = await createProviderMission(runtime, "active_workspace"), activeBefore = await providerNeutrality(runtime);
    const actors = [creator, runtime.actors.otherCreator];
    const actorRows = await providerFixtureJson<Array<{ id: string; workspace_id: string }>>(runtime, `begin read only; select jsonb_agg(jsonb_build_object('id',id,'workspace_id',workspace_id) order by id) from public.creators where id in ('${providerFixtureUuid(actors[0]!.id)}','${providerFixtureUuid(actors[1]!.id)}'); commit;`, "quota-actors");
    requireProviderFact(actorRows.length === 2 && actorRows.every(actor => actor.workspace_id === runtime.workspaceId), "journey-quota-actor-workspace");
    const joins = await Promise.all(actors.map(async actor => {
      const response = await runtime.request(actor, `/api/missions/${active.slug}/join`, { method: "POST", headers: { "X-Workspace-Slug": runtime.workspaceSlug }, redirect: "error" });
      return { actor, status: response.status, body: await response.json() as { submission?: { id: string; xp_awarded: number }; workflow?: { id: string }; code?: string } };
    }));
    requireProviderFact(joins.filter(result => result.status === 200).length === 1 && joins.filter(result => result.status === 409 && result.body.code === "mission_full").length === 1, "journey-active-quota");
    const winner = joins.find(result => result.status === 200)!, activeCreator: ProviderActor = winner.actor;
    const submissionId = providerFixtureUuid(winner.body.submission!.id), workflowId = providerFixtureUuid(winner.body.workflow!.id);
    requireProviderFact(winner.body.submission!.xp_awarded === 0, "journey-active-join-xp");
    const joinReplay = await request<{ submission: { id: string }; workflow: { id: string } }>(runtime, activeCreator, `/api/missions/${active.slug}/join`, "POST");
    requireProviderFact(joinReplay.submission.id === submissionId && joinReplay.workflow.id === workflowId, "journey-active-join-replay");
    const joinCounts = await providerFixtureJson<{ filled: number; submissions: number; workflows: number; contracts: number }>(runtime,
      `begin read only; select jsonb_build_object('filled',filled,'submissions',(select count(*) from public.mission_submissions where mission_id=m.id),'workflows',(select count(*) from public.mission_workflows w join public.mission_submissions s on s.id=w.mission_submission_id where s.mission_id=m.id),'contracts',(select count(*) from public.mission_reward_contracts where mission_id=m.id)) from public.missions m where id='${active.id}' and workspace_id='${providerFixtureUuid(runtime.workspaceId)}'; commit;`, "quota-counts");
    same(joinCounts, { filled: 1, submissions: 1, workflows: 1, contracts: 1 }, "journey-active-join-counts"); unchanged(activeBefore, await providerNeutrality(runtime));
    cases.push(runtime.record(PROVIDER_JOURNEY_CASES[3], { joinCounts, before: activeBefore, after: await providerNeutrality(runtime), concurrentQuota: true, replay: true }, checkpoint));

    checkpoint = runtime.httpRequests;
    let workspace = await providerWorkspace(runtime, activeCreator, submissionId), item = requiredProviderItem(workspace);
    requireProviderFact(item.state === "drafting" && item.draft && item.requirements.length > 0, "journey-active-drafting");
    const creatorPath = `/api/my-missions/${submissionId}/work-items/${item.id}`, operatorPath = `/api/admin/active-missions/${workflowId}/work-items/${item.id}`;
    const checklist = Object.fromEntries(item.requirements.map(requirement => [requirement.id, true])), initialRevision = item.draft.revision;
    await request(runtime, activeCreator, `${creatorPath}/draft`, "PATCH", { revision: initialRevision, caption: "Synthetic first draft", checklist });
    const staleDraft = await request<{ code: string }>(runtime, activeCreator, `${creatorPath}/draft`, "PATCH", { revision: initialRevision, caption: "Synthetic stale overwrite" }, undefined, 409);
    requireProviderFact(staleDraft.code === "WORKFLOW_STALE", "journey-stale-draft-code");
    workspace = await providerWorkspace(runtime, activeCreator, submissionId); item = requiredProviderItem(workspace);
    requireProviderFact(item.draft?.caption === "Synthetic first draft", "journey-stale-draft-preserved");
    const draftKey = randomUUID(), draftBody = { expectedRevision: item.draft.revision };
    await request(runtime, activeCreator, `${creatorPath}/submit`, "POST", draftBody, draftKey); await request(runtime, activeCreator, `${creatorPath}/submit`, "POST", draftBody, draftKey);
    workspace = await providerWorkspace(runtime, activeCreator, submissionId); item = requiredProviderItem(workspace);
    const firstVersion = providerFixtureUuid(item.currentSubmittedVersionId!);
    await request(runtime, reviewer, `${operatorPath}/start-review`, "POST", { expectedState: item.state });
    await request(runtime, reviewer, `${operatorPath}/request-revision`, "POST", { expectedState: "under_review", versionId: firstVersion,
      deadline: new Date(Date.now() + 86_400_000).toISOString(), items: [{ category: "quality", text: "Synthetic required revision", required: true }] });
    workspace = await providerWorkspace(runtime, activeCreator, submissionId); item = requiredProviderItem(workspace); requireProviderFact(item.state === "revision_requested" && item.draft, "journey-revision-requested");
    await request(runtime, activeCreator, `${creatorPath}/draft`, "PATCH", { revision: item.draft.revision, caption: "Synthetic revised draft", checklist });
    workspace = await providerWorkspace(runtime, activeCreator, submissionId); item = requiredProviderItem(workspace);
    await request(runtime, activeCreator, `${creatorPath}/submit`, "POST", { expectedRevision: item.draft!.revision }, randomUUID());
    workspace = await providerWorkspace(runtime, activeCreator, submissionId); item = requiredProviderItem(workspace);
    requireProviderFact(item.currentSubmittedVersionId && item.currentSubmittedVersionId !== firstVersion, "journey-revised-version");
    await request(runtime, reviewer, `${operatorPath}/start-review`, "POST", { expectedState: item.state });
    await request(runtime, reviewer, `${operatorPath}/approve-to-publish`, "POST", { expectedState: "under_review", versionId: item.currentSubmittedVersionId });
    workspace = await providerWorkspace(runtime, activeCreator, submissionId); item = requiredProviderItem(workspace);
    requireProviderFact(item.state === "approved_to_publish" && workspace.workflow.state === "approved_to_publish" && workspace.workItems.some(candidate => !candidate.required && candidate.state === "drafting"), "journey-approved-not-complete");
    const versions = await providerFixtureJson<{ count: number }>(runtime, `begin read only; select jsonb_build_object('count',count(*)) from public.mission_draft_versions where mission_work_item_id='${providerFixtureUuid(item.id)}' and workspace_id='${providerFixtureUuid(runtime.workspaceId)}'; commit;`, "draft-versions");
    requireProviderFact(versions.count === 2, "journey-draft-replay-count"); unchanged(activeBefore, await providerNeutrality(runtime));
    cases.push(runtime.record(PROVIDER_JOURNEY_CASES[4], { versions, staleOverwriteDenied: true, revisedVersionId: item.currentSubmittedVersionId, approvalIsNotCompletion: true, before: activeBefore, after: await providerNeutrality(runtime) }, checkpoint));

    checkpoint = runtime.httpRequests;
    const publicationPath = `/api/my-missions/${submissionId}/publication/${item.id}`;
    const publication = async () => (await request<{ publication: MissionPublicationView }>(runtime, activeCreator, publicationPath)).publication;
    let proof = await publication();
    await request(runtime, activeCreator, `${publicationPath}/proofs`, "POST", { expectedState: proof.state, expectedRevision: proof.revision,
      primaryUrl: `https://www.instagram.com/p/${randomUUID().replaceAll("-", "")}/`, additionalUrls: [], evidenceAssetIds: [] }, randomUUID());
    proof = await publication(); requireProviderFact(proof.state === "proof_submitted" && proof.currentAttempt?.metadataStatus === "unavailable", "journey-original-metadata-egress-blocked");
    const firstAttempt = providerFixtureUuid(proof.currentAttempt.id);
    await request(runtime, reviewer, `${operatorPath}/proof-review/start`, "POST", { expectedState: proof.state, expectedRevision: proof.revision, attemptId: firstAttempt }, randomUUID());
    proof = await publication();
    const proofChecklist = { publicly_accessible: true, platform_matches: true, account_matches: true, content_matches_approved_version: true, timing_acceptable: true, disclosures_present: true };
    await request(runtime, reviewer, `${operatorPath}/proof-review/corrections`, "POST", { expectedState: proof.state, expectedRevision: proof.revision, attemptId: firstAttempt,
      checklist: { ...proofChecklist, content_matches_approved_version: false }, corrections: [{ category: "content", text: "Synthetic content correction", position: 0 }] }, randomUUID());
    proof = await publication(); requireProviderFact(proof.state === "proof_correction_requested", "journey-proof-correction");
    await request(runtime, activeCreator, `${publicationPath}/proofs`, "POST", { expectedState: proof.state, expectedRevision: proof.revision,
      primaryUrl: `https://www.instagram.com/p/${randomUUID().replaceAll("-", "")}/`, additionalUrls: [], evidenceAssetIds: [] }, randomUUID());
    proof = await publication(); requireProviderFact(proof.currentAttempt && proof.currentAttempt.id !== firstAttempt && proof.attempts.length === 2, "journey-proof-attempts");
    await request(runtime, reviewer, `${operatorPath}/proof-review/start`, "POST", { expectedState: proof.state, expectedRevision: proof.revision, attemptId: proof.currentAttempt.id }, randomUUID());
    proof = await publication();
    await request(runtime, reviewer, `${operatorPath}/proof-review/verify`, "POST", { expectedState: proof.state, expectedRevision: proof.revision, attemptId: proof.currentAttempt!.id, checklist: proofChecklist }, randomUUID());
    workspace = await providerWorkspace(runtime, activeCreator, submissionId); requireProviderFact(workspace.workflow.state === "proof_verified", "journey-proof-verified"); unchanged(activeBefore, await providerNeutrality(runtime));
    cases.push(runtime.record(PROVIDER_JOURNEY_CASES[5], { attempts: 2, corrected: true, syntheticManualReview: true, originalMetadataInspector: true, externalPublicationPerformed: false, metadataEgress: "blocked", before: activeBefore, after: await providerNeutrality(runtime) }, checkpoint));

    checkpoint = runtime.httpRequests;
    const completionPath = `/api/admin/active-missions/${workflowId}/completion`;
    const eligibility = await request<{ completionEligibility: { eligible: boolean; blockers: string[] }; rewardContract: { pointsAmount: number; cashAmount: number; xpAmount: number } }>(runtime, operator, completionPath);
    requireProviderFact(eligibility.completionEligibility.eligible && eligibility.completionEligibility.blockers.length === 0 && eligibility.rewardContract.pointsAmount === 500
      && eligibility.rewardContract.cashAmount === 125 && eligibility.rewardContract.xpAmount === 0, "journey-completion-prerequisite");
    const completionBody = { expectedState: "proof_verified", expectedRevision: workspace.workflow.revision }, completionKey = randomUUID();
    const completion = await request<{ pendingReward: { id: string }; decision: { id: string } }>(runtime, operator, completionPath, "POST", completionBody, completionKey);
    const completionReplay = await request<typeof completion & { idempotent: boolean }>(runtime, operator, completionPath, "POST", completionBody, completionKey);
    requireProviderFact(completionReplay.idempotent === true && completionReplay.pendingReward.id === completion.pendingReward.id && completionReplay.decision.id === completion.decision.id, "journey-completion-replay");
    providerFixtureUuid(completion.pendingReward.id); workspace = await providerWorkspace(runtime, activeCreator, submissionId);
    requireProviderFact(workspace.workflow.state === "reward_pending" && workspace.pendingReward?.status === "pending", "journey-pending-reward");
    const pending = await providerFixtureJson<{ count: number; pending: number }>(runtime, `begin read only; select jsonb_build_object('count',count(*),'pending',count(*) filter(where status='pending')) from public.mission_pending_rewards where mission_workflow_id='${workflowId}' and workspace_id='${providerFixtureUuid(runtime.workspaceId)}'; commit;`, "pending-counts");
    same(pending, { count: 1, pending: 1 }, "journey-pending-count"); unchanged(activeBefore, await providerNeutrality(runtime));
    cases.push(runtime.record(PROVIDER_JOURNEY_CASES[6], { pending, pendingRewardId: completion.pendingReward.id, exactReplay: true, settlementPerformed: false, cancellationPerformed: false, before: activeBefore, after: await providerNeutrality(runtime) }, checkpoint));

    checkpoint = runtime.httpRequests;
    const finalMine = await request<{ submissions: Array<{ id: string; status: string }> }>(runtime, creator, "/api/missions/my");
    requireProviderFact(finalMine.submissions.some(candidate => candidate.id === history.submissionId && candidate.status === "approved"), "journey-history-visible");
    const historyAfter = await legacyAnchor(runtime, history.submissionId); same(historyBefore, historyAfter, "journey-history-preserved");
    cases.push(runtime.record(PROVIDER_JOURNEY_CASES[7], { sourceFixtureHistorySynthetic: true, actualLegacyIssuancePerformed: false, before: historyBefore, after: historyAfter }, checkpoint));
    same(cases.map(result => result.name), PROVIDER_JOURNEY_CASES, "journey-case-set"); return cases;
  } catch (error) { if (error instanceof ProviderRehearsalFailure) throw error; throw new ProviderRehearsalFailure("journey-runtime"); }
}
