// Scenario: active-workspace completion → finance hand-off → settlement into ledgers (F-007).
// The proof-verified state is reached with the same direct fixture inserts the repository's
// reward-handoff acceptance seed uses; completion and settlement run through the real RPC/API.
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { api, balances, DEMO_WORKSPACE as WS, newCreator, newMission, newStaff, notificationTypes, service, sql, q, type Actor } from "../support/fixture";

async function pendingHandoff(points = 500, cash = 125) {
  const creator = await newCreator();
  const operator = await newStaff("operator");
  const m = newMission({ mode: "active_workspace", points, cash });
  sql(`insert into public.mission_deliverable_templates(workspace_id,mission_id,title,platform,position,required,publication_instructions,publication_window_hours,required_disclosures,proof_evidence_policy)
       values (${q(WS)},${q(m.id)},'Reel','instagram',0,true,'Publish the approved content',72,'[]','{}');`);
  const join = await api("POST", `/missions/${m.slug}/join`, { jwt: creator.jwt });
  expect(join.status, JSON.stringify(join.body)).toBe(200);
  const workflowId = sql(`select w.id from public.mission_workflows w join public.mission_submissions s on s.id=w.mission_submission_id where s.mission_id=${q(m.id)} and s.creator_id=${q(creator.id)};`);
  const itemId = sql(`select id from public.mission_work_items where mission_workflow_id=${q(workflowId)};`);
  const attempt = await service.from("mission_publication_proof_attempts").insert({
    workspace_id: WS, mission_work_item_id: itemId, attempt_number: 1, primary_url: `https://www.instagram.com/p/${randomUUID().slice(0, 8)}`,
    additional_urls: [], submitted_by: creator.id, submitted_late: false, metadata_status: "unavailable", metadata_snapshot: {},
    metadata_error_category: "platform_blocked", content_checksum: `sha256:${randomUUID()}`, submission_idempotency_key: randomUUID(),
  }).select("id").single();
  expect(attempt.error).toBeNull();
  const review = await service.from("mission_publication_proof_reviews").insert({
    workspace_id: WS, mission_publication_proof_attempt_id: attempt.data!.id, review_number: 1, state: "verified", decision: "verified",
    reviewer_id: operator.id, reviewed_at: new Date().toISOString(), summary: "review fixture", decision_idempotency_key: randomUUID(),
    checklist: { publicly_accessible: true, platform_matches: true, account_matches: true, content_matches_approved_version: true, timing_acceptable: true, disclosures_present: true },
  });
  expect(review.error).toBeNull();
  expect((await service.from("mission_work_items").update({ state: "proof_verified", current_proof_attempt_id: attempt.data!.id, verified_proof_attempt_id: attempt.data!.id }).eq("id", itemId)).error).toBeNull();
  expect((await service.from("mission_workflows").update({ state: "proof_verified", revision: 7, updated_at: new Date().toISOString() }).eq("id", workflowId)).error).toBeNull();
  const approved = await service.rpc("approve_mission_completion", {
    p_workspace: WS, p_workflow: workflowId, p_operator: operator.id, p_expected_state: "proof_verified", p_expected_revision: 7, p_idempotency_key: randomUUID(),
  });
  expect(approved.error, approved.error?.message).toBeNull();
  const pendingId = sql(`select id from public.mission_pending_rewards where mission_workflow_id=${q(workflowId)};`);
  const submissionId = sql(`select mission_submission_id from public.mission_workflows where id=${q(workflowId)};`);
  return { creator, operator, pendingId, submissionId };
}

const settle = (admin: Actor, id: string, key = randomUUID()) =>
  api("POST", `/admin/reward-handoffs/${id}/settle`, { jwt: admin.jwt, ws: null, headers: { "Idempotency-Key": key } });

describe("reward hand-off settlement (F-007)", () => {
  it("[F-007 fixed] a workspace admin settles a hand-off: ledgers credited once, creator notified, wallet pending cleared", async () => {
    const { creator, pendingId, submissionId } = await pendingHandoff(500, 125);
    const admin = await newStaff("workspace_admin");
    const before = balances(creator.id);
    const walletBefore = await api("GET", "/wallet/earnings", { jwt: creator.jwt });
    expect(Number(walletBefore.body.pending)).toBe(125); // hand-off now counted as pending

    const key = randomUUID();
    const res = await settle(admin, pendingId, key);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const after = balances(creator.id);
    expect(after.points - before.points).toBe(500);
    expect(after.cash - before.cash).toBe(125);
    expect(sql(`select status from public.mission_pending_rewards where id=${q(pendingId)};`)).toBe("settled");
    expect(notificationTypes(creator.id)).toContain("mission_reward_settled");
    expect(Number(sql(`select count(*) from public.operator_audit_events where event_type='reward.settled' and target_id=${q(pendingId)};`))).toBe(1);

    // Exact replay is idempotent; a different key is refused; nothing is credited twice.
    expect((await settle(admin, pendingId, key)).status).toBe(200);
    expect((await settle(admin, pendingId)).status).toBe(409);
    expect(balances(creator.id)).toEqual(after);

    const walletAfter = await api("GET", "/wallet/earnings", { jwt: creator.jwt });
    expect(Number(walletAfter.body.pending)).toBe(0);
    // The creator's workspace now shows the settled reward instead of losing the card.
    const handoff = await creator.client.rpc("get_my_mission_reward_handoff", { p_submission: submissionId });
    expect(handoff.error).toBeNull();
    expect(handoff.data.status).toBe("settled");
    expect(handoff.data.settledAt).toBeTruthy();
  }, 120000);

  it("only a workspace admin may settle; operators and finance viewers are refused", async () => {
    const { pendingId } = await pendingHandoff(100, 0);
    const operator = await newStaff("operator");
    const finance = await newStaff("finance_viewer");
    expect((await settle(operator, pendingId)).status).toBe(403);
    expect((await settle(finance, pendingId)).status).toBe(403);
    expect(sql(`select status from public.mission_pending_rewards where id=${q(pendingId)};`)).toBe("pending");
  }, 120000);

  it("a settled row cannot be edited outside the settlement transition", async () => {
    const { pendingId } = await pendingHandoff(50, 0);
    const admin = await newStaff("workspace_admin");
    expect((await settle(admin, pendingId)).status).toBe(200);
    const tamper = await service.from("mission_pending_rewards").update({ points_amount: 99999 }).eq("id", pendingId);
    expect(tamper.error?.message ?? "").toMatch(/immutable_record/);
  }, 120000);
});
