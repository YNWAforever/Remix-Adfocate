import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  activeMissionIntegrationSkipReason,
  cleanup,
  creatorRewardSnapshot,
  DEMO_WS,
  makeStaff,
  seedActiveMission,
  serviceForTests,
  userForJwt,
} from "./helpers";

const skipReason = activeMissionIntegrationSkipReason();
const integrationSuite = skipReason === null ? describe : describe.skip;
const checklist = (passed = true) => ({
  publicly_accessible: passed,
  platform_matches: true,
  account_matches: true,
  content_matches_approved_version: true,
  timing_acceptable: true,
  disclosures_present: true,
});

async function makePublicationOperator(label: string) {
  const email = `proof-review-${label}-${randomUUID()}@test.local`;
  const operator = await makeStaff(email);
  const linked = await serviceForTests().from("brand_users").insert({
    user_id: operator.userId,
    workspace_id: DEMO_WS,
    email,
    role: "member",
    active: true,
  });
  expect(linked.error).toBeNull();
  return operator;
}

async function seedSubmittedPublicationProof(label: string) {
  const active = await seedActiveMission({
    email: `proof-review-creator-${label}-${randomUUID()}@test.local`,
    slug: `test-proof-review-${label}-${randomUUID()}`,
    deliverables: [{ title: "Publication proof", platform: "instagram" }],
  });
  const svc = serviceForTests();
  const created = await userForJwt(active.creator.jwt).rpc("create_mission_workflow", {
    p_submission: active.submission.id,
  });
  expect(created.error).toBeNull();
  const [workflowResult, itemResult] = await Promise.all([
    svc.from("mission_workflows")
      .select("id, revision_response_hours")
      .eq("id", created.data.id)
      .single(),
    svc.from("mission_work_items")
      .select("id")
      .eq("mission_workflow_id", created.data.id)
      .single(),
  ]);
  expect(workflowResult.error).toBeNull();
  expect(itemResult.error).toBeNull();
  const workflow = workflowResult.data!;
  const workItem = itemResult.data!;

  const saved = await svc.rpc("save_active_mission_draft", {
    p_submission: active.submission.id,
    p_creator: active.creator.id,
    p_workspace: DEMO_WS,
    p_work_item: workItem.id,
    p_expected_revision: 0,
    p_patch: { caption: "Approved publication copy" },
  });
  expect(saved.error).toBeNull();
  const submitted = await svc.rpc("submit_active_mission_draft", {
    p_submission: active.submission.id,
    p_creator: active.creator.id,
    p_workspace: DEMO_WS,
    p_work_item: workItem.id,
    p_expected_revision: 1,
    p_idempotency_key: randomUUID(),
  });
  expect(submitted.error).toBeNull();

  const approver = await makeStaff(`proof-approver-${label}-${randomUUID()}@test.local`);
  const started = await svc.rpc("start_mission_review", {
    p_workflow: workflow.id,
    p_work_item: workItem.id,
    p_operator: approver.userId,
    p_workspace: DEMO_WS,
    p_expected_state: "submitted",
  });
  expect(started.error).toBeNull();
  const approved = await svc.rpc("approve_mission_version", {
    p_workflow: workflow.id,
    p_work_item: workItem.id,
    p_version: submitted.data.version.id,
    p_operator: approver.userId,
    p_workspace: DEMO_WS,
    p_expected_state: "under_review",
  });
  expect(approved.error).toBeNull();

  const instruction = await svc.from("mission_publication_instructions")
    .select("revision, publication_due_at")
    .eq("mission_work_item_id", workItem.id)
    .single();
  expect(instruction.error).toBeNull();
  const proof = await svc.rpc("submit_mission_publication_proof", {
    p_submission: active.submission.id,
    p_creator: active.creator.id,
    p_workspace: DEMO_WS,
    p_work_item: workItem.id,
    p_expected_state: "approved_to_publish",
    p_expected_revision: instruction.data!.revision,
    p_idempotency_key: randomUUID(),
    p_proof: {
      primary_url: `https://www.instagram.com/p/${randomUUID()}`,
      additional_urls: [],
      metadata_status: "unavailable",
      metadata_snapshot: {},
      metadata_error_category: "platform_blocked",
    },
    p_evidence_asset_ids: [],
  });
  expect(proof.error).toBeNull();
  return {
    active,
    svc,
    workflow,
    workItem,
    revision: instruction.data!.revision,
    attemptId: proof.data.attempt.id as string,
  };
}

integrationSuite("publication proof operator review live integration", () => {
  beforeAll(cleanup);
  afterAll(cleanup);

  it("enforces tenant, concurrent claim, ownership, correction deadline, retry, and reward neutrality", async () => {
    const ctx = await seedSubmittedPublicationProof("correction");
    const before = await creatorRewardSnapshot(ctx.active.creator.id);
    const unlinked = await makeStaff(`proof-unlinked-${randomUUID()}@test.local`);
    const denied = await ctx.svc.rpc("start_publication_proof_review", {
      p_workspace: DEMO_WS,
      p_workflow: ctx.workflow.id,
      p_work_item: ctx.workItem.id,
      p_attempt: ctx.attemptId,
      p_expected_state: "proof_submitted",
      p_expected_revision: ctx.revision,
      p_operator: unlinked.userId,
      p_idempotency_key: randomUUID(),
    });
    expect(denied.error?.message.toLowerCase()).toContain("not_authorized");

    const operators = await Promise.all([
      makePublicationOperator("claim-a"),
      makePublicationOperator("claim-b"),
    ]);
    const claimKeys = [randomUUID(), randomUUID()];
    const claims = await Promise.all(operators.map((operator, index) =>
      ctx.svc.rpc("start_publication_proof_review", {
        p_workspace: DEMO_WS,
        p_workflow: ctx.workflow.id,
        p_work_item: ctx.workItem.id,
        p_attempt: ctx.attemptId,
        p_expected_state: "proof_submitted",
        p_expected_revision: ctx.revision,
        p_operator: operator.userId,
        p_idempotency_key: claimKeys[index],
      })));
    const winnerIndex = claims.findIndex((result) => result.error === null);
    expect(winnerIndex).toBeGreaterThanOrEqual(0);
    expect(claims.filter((result) => result.error === null)).toHaveLength(1);
    expect(claims[1 - winnerIndex].error?.message.toLowerCase()).toContain("workflow_stale");
    const winner = operators[winnerIndex];
    const loser = operators[1 - winnerIndex];

    const exactClaimRetry = await ctx.svc.rpc("start_publication_proof_review", {
      p_workspace: DEMO_WS,
      p_workflow: ctx.workflow.id,
      p_work_item: ctx.workItem.id,
      p_attempt: ctx.attemptId,
      p_expected_state: "proof_submitted",
      p_expected_revision: ctx.revision,
      p_operator: winner.userId,
      p_idempotency_key: claimKeys[winnerIndex],
    });
    expect(exactClaimRetry.error).toBeNull();
    expect(exactClaimRetry.data.idempotent).toBe(true);

    const baseCorrection = {
      p_workspace: DEMO_WS,
      p_workflow: ctx.workflow.id,
      p_work_item: ctx.workItem.id,
      p_attempt: ctx.attemptId,
      p_expected_state: "proof_under_review",
      p_expected_revision: ctx.revision,
      p_checklist: checklist(false),
      p_items: [{ category: "content", text: "Publish the approved final cut", position: 0 }],
      p_summary: "Correction required",
    };
    const wrongOwner = await ctx.svc.rpc("request_publication_proof_correction", {
      ...baseCorrection,
      p_operator: loser.userId,
      p_idempotency_key: randomUUID(),
    });
    expect(wrongOwner.error?.message.toLowerCase()).toContain("workflow_stale");
    const invalid = await ctx.svc.rpc("request_publication_proof_correction", {
      ...baseCorrection,
      p_operator: winner.userId,
      p_idempotency_key: randomUUID(),
      p_items: [],
    });
    expect(invalid.error?.message.toLowerCase()).toContain("validation_failed");

    const correctionKey = randomUUID();
    const beforeDecision = Date.now();
    const corrected = await ctx.svc.rpc("request_publication_proof_correction", {
      ...baseCorrection,
      p_operator: winner.userId,
      p_idempotency_key: correctionKey,
    });
    expect(corrected.error).toBeNull();
    expect(corrected.data).toMatchObject({
      idempotent: false,
      work_item: { state: "proof_correction_requested" },
    });
    const responseDeadline = Date.parse(corrected.data.review.creator_response_deadline);
    expect(responseDeadline).toBeGreaterThan(beforeDecision);
    expect(responseDeadline).toBeLessThanOrEqual(
      beforeDecision + ctx.workflow.revision_response_hours * 3_600_000 + 2_000,
    );
    const exactDecisionRetry = await ctx.svc.rpc("request_publication_proof_correction", {
      ...baseCorrection,
      p_operator: winner.userId,
      p_idempotency_key: correctionKey,
    });
    expect(exactDecisionRetry.error).toBeNull();
    expect(exactDecisionRetry.data.idempotent).toBe(true);
    expect(await creatorRewardSnapshot(ctx.active.creator.id)).toEqual(before);
  });

  it("verifies only the exact claimed attempt and completes the required aggregate without rewards", async () => {
    const ctx = await seedSubmittedPublicationProof("verify");
    const before = await creatorRewardSnapshot(ctx.active.creator.id);
    const operator = await makePublicationOperator("verify");
    const claim = await ctx.svc.rpc("start_publication_proof_review", {
      p_workspace: DEMO_WS,
      p_workflow: ctx.workflow.id,
      p_work_item: ctx.workItem.id,
      p_attempt: ctx.attemptId,
      p_expected_state: "proof_submitted",
      p_expected_revision: ctx.revision,
      p_operator: operator.userId,
      p_idempotency_key: randomUUID(),
    });
    expect(claim.error).toBeNull();
    const verifyBase = {
      p_workspace: DEMO_WS,
      p_workflow: ctx.workflow.id,
      p_work_item: ctx.workItem.id,
      p_expected_state: "proof_under_review",
      p_expected_revision: ctx.revision,
      p_operator: operator.userId,
      p_checklist: checklist(),
      p_summary: "Publication verified",
    };
    const wrongAttempt = await ctx.svc.rpc("verify_publication_proof", {
      ...verifyBase,
      p_attempt: randomUUID(),
      p_idempotency_key: randomUUID(),
    });
    expect(wrongAttempt.error?.message.toLowerCase()).toContain("workflow_stale");
    const incomplete = await ctx.svc.rpc("verify_publication_proof", {
      ...verifyBase,
      p_attempt: ctx.attemptId,
      p_idempotency_key: randomUUID(),
      p_checklist: checklist(false),
    });
    expect(incomplete.error?.message.toLowerCase()).toContain("validation_failed");

    const decisionKey = randomUUID();
    const verified = await ctx.svc.rpc("verify_publication_proof", {
      ...verifyBase,
      p_attempt: ctx.attemptId,
      p_idempotency_key: decisionKey,
    });
    expect(verified.error).toBeNull();
    expect(verified.data).toMatchObject({
      idempotent: false,
      work_item: {
        state: "proof_verified",
        verified_proof_attempt_id: ctx.attemptId,
      },
    });
    const exactRetry = await ctx.svc.rpc("verify_publication_proof", {
      ...verifyBase,
      p_attempt: ctx.attemptId,
      p_idempotency_key: decisionKey,
    });
    expect(exactRetry.error).toBeNull();
    expect(exactRetry.data.idempotent).toBe(true);
    const aggregate = await ctx.svc.from("mission_workflows")
      .select("state")
      .eq("id", ctx.workflow.id)
      .single();
    expect(aggregate.error).toBeNull();
    expect(aggregate.data!.state).toBe("proof_verified");
    expect(await creatorRewardSnapshot(ctx.active.creator.id)).toEqual(before);
  });
});
