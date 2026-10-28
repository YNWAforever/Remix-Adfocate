import { fixtureName } from "./helpers";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  activeMissionIntegrationSkipReason, hasSupabaseEnv, serviceForTests, userForJwt,
  makeCreator, makeMission, makeStaff, seedActiveMission,
  makeGift, addCodes, setXp, cleanup, DEMO_WS,
} from "./helpers";
import { seedPublicationProofReleaseFixture } from "./fixtures/publicationProofRelease";

const suite = hasSupabaseEnv ? describe : describe.skip;
const integrationSkipReason = activeMissionIntegrationSkipReason();
const activeSuite = integrationSkipReason === null ? describe : describe.skip;

const migrationPath = resolve(
  "supabase/migrations/20260719200000_active_mission_workflow_notifications.sql",
);
const migrationSql = readFileSync(migrationPath, "utf8")
  .toLowerCase()
  .replace(/\r\n/g, "\n");

const publicationMigrationPath = resolve(
  "supabase/migrations/20260727120000_publication_proof_instrumentation.sql",
);
const publicationMigrationSql = existsSync(publicationMigrationPath)
  ? readFileSync(publicationMigrationPath, "utf8")
    .toLowerCase()
    .replace(/\r\n/g, "\n")
  : "";

const rewardHandoffMigrationPath = resolve(
  "supabase/migrations/20260731130000_reward_handoff_notifications.sql",
);
const rewardHandoffMigrationSql = existsSync(rewardHandoffMigrationPath)
  ? readFileSync(rewardHandoffMigrationPath, "utf8")
    .toLowerCase()
    .replace(/\r\n/g, "\n")
  : "";

function definition(name: string): string {
  const start = migrationSql.lastIndexOf(`create or replace function ${name}(`);
  const end = migrationSql.indexOf("\n$$;", start);
  return start < 0 || end < 0 ? "" : migrationSql.slice(start, end + 4);
}

function publicationDefinition(name: string): string {
  const start = publicationMigrationSql.lastIndexOf(`create or replace function ${name}(`);
  const end = publicationMigrationSql.indexOf("\n$$;", start);
  return start < 0 || end < 0 ? "" : publicationMigrationSql.slice(start, end + 4);
}

function rewardHandoffDefinition(name: string): string {
  const start = rewardHandoffMigrationSql.lastIndexOf(`create or replace function ${name}(`);
  const end = rewardHandoffMigrationSql.indexOf("\n$$;", start);
  return start < 0 || end < 0 ? "" : rewardHandoffMigrationSql.slice(start, end + 4);
}

describe("active-mission notification SQL contract", () => {
  const workflowTypes = [
    "mission_product_shipped",
    "mission_receipt_required",
    "mission_revision_requested",
    "mission_draft_approved",
    "mission_approved_to_publish",
    "mission_deadline_approaching",
    "mission_deadline_overdue",
  ] as const;

  it("admits exactly the seven workflow notification types in this migration", () => {
    const start = migrationSql.indexOf("add constraint notifications_type_check");
    const end = migrationSql.indexOf("));", start);
    const constraint = migrationSql.slice(start, end);
    const found = [...constraint.matchAll(/'(mission_[a-z_]+)'/g)]
      .map((match) => match[1]);

    expect(found).toEqual(workflowTypes);
    expect(new Set(found).size).toBe(workflowTypes.length);
  });

  it("keeps the internal notifier definer-safe and unreachable from API roles", () => {
    const notifier = definition("private.notify_mission_workflow");

    expect(notifier).toContain("returns boolean");
    expect(notifier).toContain("security definer");
    expect(notifier).toContain("set search_path = ''");
    expect(migrationSql).toContain(
      "revoke all on function private.notify_mission_workflow(text, uuid, uuid, timestamptz, integer, text) from public, anon, authenticated, service_role;",
    );
    expect(migrationSql).not.toContain(
      "grant execute on function private.notify_mission_workflow",
    );
  });

  it("claims semantic dedupe atomically and rolls it back with a failed notification insert", () => {
    const notifier = definition("private.notify_mission_workflow");

    expect(migrationSql).toContain(
      "create table private.mission_workflow_notification_dedupe",
    );
    expect(migrationSql).toMatch(
      /primary key \(recipient_id, notification_type, entity_type, entity_id, semantic_key\)/,
    );
    expect(notifier).toMatch(
      /begin\s+insert into private\.mission_workflow_notification_dedupe[\s\S]*?on conflict do nothing[\s\S]*?get diagnostics v_claimed = row_count;[\s\S]*?insert into public\.notifications[\s\S]*?exception\s+when others then\s+return false;\s+end;/,
    );
    expect(migrationSql).toContain(
      "revoke all on table private.mission_workflow_notification_dedupe\n  from public, anon, authenticated, service_role;",
    );
  });

  it("dedupes deadline notices by recipient, type, entity, and deadline only", () => {
    const notifier = definition("private.notify_mission_workflow");
    const deadlineBranch = notifier.match(
      /if p_type in \('mission_deadline_approaching', 'mission_deadline_overdue'\) then([\s\S]*?)else/,
    )?.[1] ?? "";

    expect(deadlineBranch).toContain("v_deadline");
    expect(deadlineBranch).not.toContain("v_version_number");
    expect(deadlineBranch).not.toContain("p_reason_category");
  });

  it("increments the deadline emitter count only for an inserted notification", () => {
    const emitter = definition("public.emit_active_mission_deadline_notifications");

    expect(emitter).toMatch(
      /if private\.notify_mission_workflow\([\s\S]*?\) then\s+v_count := v_count \+ 1;\s+end if;/,
    );
  });

  it("limits payload data and provides a controlled insert-failure boundary", () => {
    const notifier = definition("private.notify_mission_workflow");
    const payload = notifier.match(
      /v_data := jsonb_strip_nulls\(jsonb_build_object\(([\s\S]*?)\)\);/,
    )?.[1] ?? "";
    const keys = [...payload.matchAll(/'([a-z_]+)'\s*,/g)]
      .map((match) => match[1]);

    expect(keys).toEqual([
      "mission_title",
      "mission_slug",
      "submission_id",
      "deliverable_title",
      "deadline",
      "version_number",
      "reason_category",
    ]);
    expect(migrationSql).toContain(
      "constraint notifications_workflow_payload_size_check",
    );
    expect(notifier).toMatch(
      /insert into public\.notifications[\s\S]*?exception\s+when others then\s+return false;/,
    );
  });

  it("adds no scheduler or reward side effects", () => {
    expect(migrationSql).not.toMatch(/\b(?:cron\.schedule|pg_cron|create extension)\b/);
    expect(migrationSql).not.toMatch(
      /(?:insert into|update|delete from) public\.(?:point_balances|point_transactions|earnings_balances|earnings_transactions|workspace_budgets|workspace_budget_transactions|redemptions)\b/,
    );
  });
});

describe("publication-proof notification SQL contract", () => {
  const currentConstraintStart = migrationSql.indexOf(
    "add constraint notifications_type_check",
  );
  const currentConstraintEnd = migrationSql.indexOf("));", currentConstraintStart);
  const currentTypes = [
    ...migrationSql
      .slice(currentConstraintStart, currentConstraintEnd)
      .matchAll(/'([a-z_]+)'/g),
  ].map((match) => match[1]);
  const publicationTypes = [
    "mission_publication_correction_requested",
    "mission_publication_verified",
  ] as const;

  it("additively extends the current notification type and payload-size constraints", () => {
    const typeStart = publicationMigrationSql.indexOf(
      "add constraint notifications_type_check",
    );
    const typeEnd = publicationMigrationSql.indexOf("));", typeStart);
    const found = [
      ...publicationMigrationSql.slice(typeStart, typeEnd).matchAll(/'([a-z_]+)'/g),
    ].map((match) => match[1]);
    const payloadStart = publicationMigrationSql.indexOf(
      "add constraint notifications_workflow_payload_size_check",
    );
    const payloadEnd = publicationMigrationSql.indexOf(")", payloadStart);
    const payloadConstraint = publicationMigrationSql.slice(payloadStart, payloadEnd);

    expect(found).toEqual([...currentTypes, ...publicationTypes]);
    expect(new Set(found).size).toBe(found.length);
    for (const type of publicationTypes) {
      expect(payloadConstraint).toContain(`'${type}'`);
    }
  });

  it("observes only the correction-requested and verified workflow events", () => {
    const trigger = publicationDefinition("private.notify_publication_proof_event");

    expect(publicationMigrationSql).toContain(
      "after insert on public.mission_workflow_events",
    );
    expect(trigger).toContain("'mission_publication_proof_correction_requested'");
    expect(trigger).toContain("'mission_publication_proof_verified'");
    expect(trigger).toContain("mission_publication_proof_review_items");
    expect(trigger).toContain("mission_publication_proof_attempts");
  });

  it("keeps the private notifier definer-safe, revoked, and semantically deduped", () => {
    const notifier = publicationDefinition(
      "private.notify_publication_proof_outcome",
    );

    expect(notifier).toContain("returns boolean");
    expect(notifier).toContain("security definer");
    expect(notifier).toContain("set search_path = ''");
    expect(notifier).toMatch(
      /begin\s+insert into private\.mission_workflow_notification_dedupe[\s\S]*?p_semantic_key[\s\S]*?on conflict do nothing[\s\S]*?get diagnostics v_claimed = row_count;[\s\S]*?if v_claimed = 0 then[\s\S]*?return false;[\s\S]*?end if;[\s\S]*?insert into public\.notifications[\s\S]*?exception\s+when others then\s+return false;\s+end;/,
    );
    expect(publicationMigrationSql).toContain(
      "revoke all on function private.notify_publication_proof_outcome(uuid, text, uuid, text, jsonb) from public, anon, authenticated, service_role;",
    );
    expect(publicationMigrationSql).not.toContain(
      "grant execute on function private.notify_publication_proof_outcome",
    );
  });

  it("limits payload to the approved publication-proof fields", () => {
    const notifier = publicationDefinition(
      "private.notify_publication_proof_outcome",
    );
    const payload = notifier.match(
      /v_data := jsonb_strip_nulls\(jsonb_build_object\(([\s\S]*?)\)\);/,
    )?.[1] ?? "";
    const keys = [...payload.matchAll(/^\s{4}'([a-z_]+)'\s*,/gm)]
      .map((match) => match[1]);

    expect(keys).toEqual([
      "mission_title",
      "mission_slug",
      "submission_id",
      "deliverable_title",
      "deadline",
      "attempt_number",
      "reason_categories",
    ]);
    expect(payload).not.toMatch(/finding|summary|checklist|url|account|creator|operator/);
  });

  it("catches notification insert errors without rolling back the event transition", () => {
    const notifier = publicationDefinition(
      "private.notify_publication_proof_outcome",
    );
    const trigger = publicationDefinition("private.notify_publication_proof_event");

    expect(notifier).toMatch(
      /insert into public\.notifications[\s\S]*?exception\s+when others then\s+return false;/,
    );
    expect(trigger).toMatch(
      /perform private\.notify_publication_proof_outcome\([\s\S]*?return new;[\s\S]*?exception\s+when others then\s+return new;/,
    );
  });

  it("adds no scheduler, reward, submission-status, XP, earnings, or budget mutation", () => {
    expect(publicationMigrationSql).not.toMatch(
      /\b(?:cron\.schedule|pg_cron|create extension)\b/,
    );
    expect(publicationMigrationSql).not.toMatch(
      /(?:insert into|update|delete from)\s+public\.(?:mission_submissions|point_balances|point_transactions|earnings_balances|earnings_transactions|workspace_budgets|workspace_budget_transactions|redemptions)\b/,
    );
    expect(publicationMigrationSql).not.toMatch(
      /(?:set|update)[\s\S]{0,80}\b(?:status|xp|earnings|budget)\s*=/,
    );
  });
});


describe("reward-handoff notification SQL contract", () => {
  const currentConstraintStart = publicationMigrationSql.indexOf(
    "add constraint notifications_type_check",
  );
  const currentConstraintEnd = publicationMigrationSql.indexOf("));", currentConstraintStart);
  const currentTypes = [
    ...publicationMigrationSql
      .slice(currentConstraintStart, currentConstraintEnd)
      .matchAll(/'([a-z_]+)'/g),
  ].map((match) => match[1]);
  const rewardHandoffTypes = [
    "mission_reward_pending",
    "mission_reward_pending_cancelled",
  ] as const;

  it("preserves every existing type and appends exactly two reward-handoff types", () => {
    const typeStart = rewardHandoffMigrationSql.indexOf(
      "add constraint notifications_type_check",
    );
    const typeEnd = rewardHandoffMigrationSql.indexOf("));", typeStart);
    const found = [
      ...rewardHandoffMigrationSql.slice(typeStart, typeEnd).matchAll(/'([a-z_]+)'/g),
    ].map((match) => match[1]);
    const payloadStart = rewardHandoffMigrationSql.indexOf(
      "add constraint notifications_workflow_payload_size_check",
    );
    const payloadEnd = rewardHandoffMigrationSql.indexOf(";", payloadStart);
    const payloadConstraint = rewardHandoffMigrationSql.slice(payloadStart, payloadEnd);
    expect(found).toEqual([...currentTypes, ...rewardHandoffTypes]);
    expect(new Set(found).size).toBe(found.length);
    for (const type of rewardHandoffTypes) expect(payloadConstraint).toContain(`'${type}'`);
  });

  it("observes only approved and cancelled handoff events", () => {
    const trigger = rewardHandoffDefinition("private.notify_reward_handoff_event");
    expect(rewardHandoffMigrationSql).toContain("after insert on public.mission_workflow_events");
    expect(trigger).toContain("'mission_completion_approved'");
    expect(trigger).toContain("'mission_reward_pending_cancelled'");
    expect(trigger).toContain("'mission_reward_pending'");
    expect(trigger).toContain("new.metadata->>'decision_id'");
    expect(trigger).toContain("new.entity_type is distinct from 'mission_pending_reward'");
  });

  it("binds the full canonical reward-handoff ownership chain before notifying", () => {
    const trigger = rewardHandoffDefinition("private.notify_reward_handoff_event");
    const notifierCall = trigger.indexOf("perform private.notify_reward_handoff_outcome");
    const ownershipQuery = trigger.slice(0, notifierCall);

    expect(ownershipQuery).toContain("workflow.id = pending.mission_workflow_id");
    expect(ownershipQuery).toContain("workflow.workspace_id = pending.workspace_id");
    expect(ownershipQuery).toContain("workflow.mission_submission_id = submission.id");

    expect(ownershipQuery).toContain("submission.id = pending.mission_submission_id");
    expect(ownershipQuery).toContain("submission.workspace_id = pending.workspace_id");
    expect(ownershipQuery).toContain("submission.creator_id = pending.creator_id");
    expect(ownershipQuery).toContain("submission.mission_id = pending.mission_id");
    expect(ownershipQuery).toContain("mission.id = pending.mission_id");
    expect(ownershipQuery).toContain("mission.workspace_id = pending.workspace_id");

    expect(ownershipQuery).toContain("join public.mission_reward_contracts contract");
    expect(ownershipQuery).toContain("contract.id = pending.reward_contract_id");
    expect(ownershipQuery).toContain("contract.workspace_id = pending.workspace_id");
    expect(ownershipQuery).toContain(
      "contract.mission_workflow_id = pending.mission_workflow_id",
    );
    expect(ownershipQuery).toContain(
      "contract.mission_submission_id = pending.mission_submission_id",
    );
    expect(ownershipQuery).toContain("contract.mission_id = pending.mission_id");

    expect(ownershipQuery).toContain("pending.id = new.entity_id");
    expect(ownershipQuery).toContain("pending.workspace_id = new.workspace_id");
    expect(ownershipQuery).toContain(
      "pending.mission_workflow_id = new.mission_workflow_id",
    );

    expect(ownershipQuery).toContain("join public.mission_completion_decisions approval");
    expect(ownershipQuery).toContain("approval.id = pending.completion_decision_id");
    expect(ownershipQuery).toContain("approval.workspace_id = pending.workspace_id");
    expect(ownershipQuery).toContain(
      "approval.mission_workflow_id = pending.mission_workflow_id",
    );
    expect(ownershipQuery).toContain("approval.reward_contract_id = contract.id");
    expect(ownershipQuery).toContain(
      "approval.id::text = new.metadata->>'decision_id'",
    );

    expect(ownershipQuery).toContain(
      "left join public.mission_completion_decisions cancellation",
    );
    expect(ownershipQuery).toContain("cancellation.id = pending.cancellation_decision_id");
    expect(ownershipQuery).toContain("cancellation.workspace_id = pending.workspace_id");
    expect(ownershipQuery).toContain(
      "cancellation.mission_workflow_id = pending.mission_workflow_id",
    );
    expect(ownershipQuery).toContain("cancellation.reward_contract_id = contract.id");
    expect(ownershipQuery).toContain("cancellation.pending_reward_id = pending.id");
    expect(ownershipQuery).toContain(
      "cancellation.supersedes_decision_id = pending.completion_decision_id",
    );
    expect(ownershipQuery).toContain(
      "cancellation.id::text = new.metadata->>'decision_id'",
    );
    expect(notifierCall).toBeGreaterThan(
      ownershipQuery.indexOf("cancellation.supersedes_decision_id"),
    );
  });

  it("claims one semantic notification per decision and rolls back failed claims", () => {
    const notifier = rewardHandoffDefinition("private.notify_reward_handoff_outcome");
    const trigger = rewardHandoffDefinition("private.notify_reward_handoff_event");
    expect(notifier).toContain("returns boolean");
    expect(notifier).toContain("security definer");
    expect(notifier).toContain("set search_path = ''");
    expect(notifier).toMatch(
      /begin\s+insert into private\.mission_workflow_notification_dedupe[\s\S]*?p_semantic_key[\s\S]*?on conflict do nothing[\s\S]*?get diagnostics v_claimed = row_count;[\s\S]*?if v_claimed = 0 then[\s\S]*?return false;[\s\S]*?end if;[\s\S]*?insert into public\.notifications[\s\S]*?exception\s+when others then\s+return false;\s+end;/,
    );
    expect(trigger).toMatch(
      /v_semantic_key\s*:=\s*concat\('decision:',\s*new\.metadata->>'decision_id'\)/,
    );
    expect(rewardHandoffMigrationSql).toContain(
      "revoke all on function private.notify_reward_handoff_outcome(uuid, text, uuid, text, jsonb) from public, anon, authenticated, service_role;",
    );
    expect(rewardHandoffMigrationSql).not.toContain("grant execute on function private.notify_reward_handoff_outcome");
  });

  it("rebuilds a bounded payload and never exposes reward amounts", () => {
    const notifier = rewardHandoffDefinition("private.notify_reward_handoff_outcome");
    const trigger = rewardHandoffDefinition("private.notify_reward_handoff_event");
    const payload = notifier.match(
      /v_data := jsonb_strip_nulls\(jsonb_build_object\(([\s\S]*?)\)\);/,
    )?.[1] ?? "";
    const keys = [...payload.matchAll(/^\s{4}'([a-z_]+)'\s*,/gm)]
      .map((match) => match[1]);
    expect(keys).toEqual([
      "mission_title", "mission_slug", "submission_id", "target_at",
      "reward_components", "reason_category",
    ]);
    expect(payload).not.toMatch(/amount|currency|note|url|path|email|handle|error/);
    expect(trigger).toMatch(
      /v_reward_components\s*:=\s*array_remove\(array\[[\s\S]*?'points'[\s\S]*?'cash'[\s\S]*?'xp'[\s\S]*?\],\s*null\);/,
    );
    expect(trigger).toContain("'reward_components', to_jsonb(v_reward_components)");
  });

  it("returns the inserted event unchanged when notification delivery fails", () => {
    const notifier = rewardHandoffDefinition("private.notify_reward_handoff_outcome");
    const trigger = rewardHandoffDefinition("private.notify_reward_handoff_event");
    expect(notifier).toMatch(
      /insert into public\.notifications[\s\S]*?exception\s+when others then\s+return false;/,
    );
    expect(trigger).toMatch(
      /perform private\.notify_reward_handoff_outcome\([\s\S]*?return new;[\s\S]*?exception\s+when others then\s+return new;/,
    );
  });

  it("adds no scheduler, ledger, payout, budget, or reward mutation", () => {
    expect(rewardHandoffMigrationSql).not.toMatch(/\b(?:cron\.schedule|pg_cron|create extension)\b/);
    expect(rewardHandoffMigrationSql).not.toMatch(
      /(?:insert into|update|delete from)\s+public\.(?:mission_pending_rewards|mission_reward_contracts|mission_completion_decisions|point_balances|point_transactions|earnings_balances|earnings_transactions|workspace_budgets|workspace_budget_transactions|redemptions)\b/,
    );
  });
});

/** Seed a submission row directly (service) in a given status; returns its id. */
async function seedSub(creatorId: string, status: string, slug: string) {
  const m = await makeMission({ slug });
  const { data, error } = await serviceForTests()
    .from("mission_submissions")
    .insert({ mission_id: m.id, creator_id: creatorId, workspace_id: DEMO_WS, status,
      content_urls: status === "submitted" ? ["https://example.test/notification-evidence"] : [] })
    .select("id")
    .single();
  if (error) throw error;
  return data!.id as string;
}

/** All notifications visible to a creator (RLS-scoped via their JWT). */
async function notifsFor(jwt: string) {
  const { data, error } = await userForJwt(jwt)
    .from("notifications").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return data as Array<{ type: string; data: Record<string, unknown>; user_id: string }>;
}

suite("notification triggers", () => {
  let koc: { userId: string; jwt: string };
  beforeAll(async () => {
    await cleanup();
    koc = await makeCreator(`notif-trig-${randomUUID()}@test.local`, 1000);
  });
  afterAll(cleanup);

  it("submission_approved carries points + xp deltas", async () => {
    const id = await seedSub(koc.userId, "submitted", fixtureName("test-notif-approve"));
    await serviceForTests().rpc("approve_submission", { p_submission: id, p_notes: "good" });
    const n = (await notifsFor(koc.jwt)).find((x) => x.type === "submission_approved");
    expect(n).toBeTruthy();
    expect(n!.data.points).toBeGreaterThan(0);
    expect(n!.data.xp).toBe(100);
  });

  it("submission_rejected carries the reason", async () => {
    const id = await seedSub(koc.userId, "submitted", fixtureName("test-notif-reject"));
    await serviceForTests().rpc("reject_submission", { p_submission: id, p_notes: "off-brief" });
    const n = (await notifsFor(koc.jwt)).find((x) => x.type === "submission_rejected");
    expect(n?.data.reason).toBe("off-brief");
  });

  it("application_accepted and application_declined fire", async () => {
    const a = await seedSub(koc.userId, "applied", fixtureName("test-notif-accept"));
    await serviceForTests().rpc("accept_application", { p_submission: a });
    const d = await seedSub(koc.userId, "applied", fixtureName("test-notif-decline"));
    await serviceForTests().rpc("decline_application", { p_submission: d, p_notes: "later" });
    const types = (await notifsFor(koc.jwt)).map((x) => x.type);
    expect(types).toContain("application_accepted");
    expect(types).toContain("application_declined");
  });

  it("level_up fires when xp crosses a threshold", async () => {
    await setXp(koc.userId, 500); // L0 -> L1
    const n = (await notifsFor(koc.jwt)).find((x) => x.type === "level_up");
    expect(n?.data.level).toBe("L1");
  });

  it("redemption_ready carries the gift name", async () => {
    const g = await makeGift({ name: fixtureName("test-notif-gift"), points_cost: 100 });
    await addCodes(g.id, ["TEST-CODE-1"]);
    await userForJwt(koc.jwt).rpc("redeem_gift", { p_gift: g.id });
    const n = (await notifsFor(koc.jwt)).find((x) => x.type === "redemption_ready");
    expect(n?.data.gift_name).toBe(fixtureName("test-notif-gift"));
  });

  it("RLS isolates notifications between creators", async () => {
    const other = await makeCreator(`notif-other-${randomUUID()}@test.local`, 0);
    const mine = await notifsFor(koc.jwt);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((n) => n.user_id === koc.userId)).toBe(true);
    const theirs = await notifsFor(other.jwt);
    expect(theirs.length).toBe(0);
  });
});

activeSuite(`active-mission notification live integration${integrationSkipReason ? ` (skipped: ${integrationSkipReason})` : ""}`, () => {
  beforeAll(cleanup);
  afterAll(cleanup);

  it("delivers fulfillment transitions to the owning creator with the bounded payload", async () => {
    const slug = `test-notification-transition-${randomUUID()}`;
    const active = await seedActiveMission({
      email: `notification-transition-${randomUUID()}@test.local`,
      slug,
      fulfillmentRequired: true,
      deliverables: [{ title: "Unboxing", platform: "instagram" }],
    });
    const staff = await makeStaff(`notification-staff-${randomUUID()}@test.local`);
    const created = await userForJwt(active.creator.jwt).rpc("create_mission_workflow", {
      p_submission: active.submission.id,
    });
    expect(created.error).toBeNull();

    const shipped = await serviceForTests().rpc("mark_mission_fulfillment_shipped", {
      p_workflow: created.data.id,
      p_operator: staff.userId,
      p_workspace: DEMO_WS,
      p_note: null,
    });
    expect(shipped.error).toBeNull();

    const notifications = (await notifsFor(active.creator.jwt))
      .filter((notification) => notification.data.submission_id === active.submission.id);
    expect(notifications).toHaveLength(2);
    expect(notifications.map((notification) => notification.type).sort()).toEqual([
      "mission_product_shipped",
      "mission_receipt_required",
    ]);
    for (const notification of notifications) {
      expect(notification.user_id).toBe(active.creator.id);
      expect(notification.data).toEqual({
        mission_title: slug,
        mission_slug: slug,
        submission_id: active.submission.id,
      });
    }
  });

  it("rejects creator JWT emission and suppresses a repeated deadline notification", async () => {
    const active = await seedActiveMission({
      email: `notification-deadline-${randomUUID()}@test.local`,
      slug: `test-notification-deadline-${randomUUID()}`,
      deliverables: [{
        title: "Reel",
        platform: "instagram",
        draftDueOffsetHours: 1,
      }],
    });
    const created = await userForJwt(active.creator.jwt).rpc("create_mission_workflow", {
      p_submission: active.submission.id,
    });
    expect(created.error).toBeNull();
    const item = await serviceForTests()
      .from("mission_work_items")
      .select("id, deadline")
      .eq("mission_workflow_id", created.data.id)
      .single();
    expect(item.error).toBeNull();
    if (!item.data) throw new Error("expected the seeded workflow item");
    const itemData = item.data;

    const denied = await userForJwt(active.creator.jwt).rpc(
      "emit_active_mission_deadline_notifications",
      { p_now: new Date().toISOString() },
    );
    expect(denied.error).not.toBeNull();

    const first = await serviceForTests().rpc("emit_active_mission_deadline_notifications", {
      p_now: new Date().toISOString(),
    });
    const second = await serviceForTests().rpc("emit_active_mission_deadline_notifications", {
      p_now: new Date().toISOString(),
    });
    expect(first.error).toBeNull();
    expect(first.data).toBeGreaterThanOrEqual(1);
    expect(second).toMatchObject({ data: 0, error: null });

    const notifications = await serviceForTests()
      .from("notifications")
      .select("type, entity_id, data")
      .eq("user_id", active.creator.id)
      .eq("type", "mission_deadline_approaching")
      .eq("entity_id", itemData.id);
    expect(notifications.error).toBeNull();
    expect(notifications.data).toHaveLength(1);
    expect(notifications.data?.[0].data).toMatchObject({ deadline: itemData.deadline });
  });

  it("commits a transition after notification failure and does not poison its dedupe claim", async () => {
    const active = await seedActiveMission({
      email: `notification-failure-${randomUUID()}@test.local`,
      slug: `test-notification-failure-${randomUUID()}`,
      fulfillmentRequired: true,
      deliverables: [{ title: "Unboxing", platform: "instagram" }],
    });
    const staff = await makeStaff(`notification-failure-staff-${randomUUID()}@test.local`);
    const created = await userForJwt(active.creator.jwt).rpc("create_mission_workflow", {
      p_submission: active.submission.id,
    });
    expect(created.error).toBeNull();
    expect((await serviceForTests().from("missions")
      .update({ title: "x".repeat(9000) }).eq("id", active.mission.id)).error).toBeNull();

    const shipped = await serviceForTests().rpc("mark_mission_fulfillment_shipped", {
      p_workflow: created.data.id,
      p_operator: staff.userId,
      p_workspace: DEMO_WS,
      p_note: null,
    });
    expect(shipped.error).toBeNull();
    const fulfillment = await serviceForTests().from("mission_fulfillments")
      .select("status").eq("mission_workflow_id", created.data.id).single();
    expect(fulfillment.data?.status).toBe("shipped");
    expect((await notifsFor(active.creator.jwt)).filter((row) =>
      row.data.submission_id === active.submission.id)).toHaveLength(0);

    expect((await serviceForTests().from("missions")
      .update({ title: "Recovered title" }).eq("id", active.mission.id)).error).toBeNull();
    expect((await serviceForTests().from("mission_fulfillments")
      .update({ status: "preparing", shipped_at: null })
      .eq("mission_workflow_id", created.data.id)).error).toBeNull();
    const retried = await serviceForTests().rpc("mark_mission_fulfillment_shipped", {
      p_workflow: created.data.id,
      p_operator: staff.userId,
      p_workspace: DEMO_WS,
      p_note: null,
    });
    expect(retried.error).toBeNull();
    expect((await notifsFor(active.creator.jwt)).filter((row) =>
      row.data.submission_id === active.submission.id)).toHaveLength(2);
  });

  it("does not notify a same-workspace creator through a mismatched reward chain", async () => {
    const owned = await seedActiveMission({
      email: `notification-owned-${randomUUID()}@test.local`,
      slug: `test-notification-owned-${randomUUID()}`,
      deliverables: [{ title: "Owned publication", platform: "instagram" }],
    });
    const foreign = await seedActiveMission({
      email: `notification-foreign-${randomUUID()}@test.local`,
      slug: `test-notification-foreign-${randomUUID()}`,
      deliverables: [{ title: "Foreign publication", platform: "instagram" }],
    });
    const service = serviceForTests();
    const operator = await makeStaff(`notification-chain-${randomUUID()}@test.local`);
    const ownedWorkflow = await userForJwt(owned.creator.jwt).rpc(
      "create_mission_workflow",
      { p_submission: owned.submission.id },
    );
    const foreignWorkflow = await userForJwt(foreign.creator.jwt).rpc(
      "create_mission_workflow",
      { p_submission: foreign.submission.id },
    );
    expect(ownedWorkflow.error).toBeNull();
    expect(foreignWorkflow.error).toBeNull();

    const foreignContract = await service.from("mission_reward_contracts").insert({
      workspace_id: DEMO_WS,
      mission_workflow_id: foreignWorkflow.data.id,
      mission_submission_id: foreign.submission.id,
      mission_id: foreign.mission.id,
      points_amount: 500,
      cash_amount: 125,
      currency: "HKD",
      xp_amount: 0,
      source: "join",
      source_mission_updated_at: null,
    }).select("id").single();
    expect(foreignContract.error).toBeNull();

    const approval = await service.from("mission_completion_decisions").insert({
      workspace_id: DEMO_WS,
      mission_workflow_id: ownedWorkflow.data.id,
      decision_kind: "approved",
      reward_contract_id: foreignContract.data!.id,
      pending_reward_id: null,
      supersedes_decision_id: null,
      workflow_revision: 0,
      required_item_count: 0,
      verified_required_item_count: 0,
      evidence_snapshot: {},
      reason_category: null,
      reason_note: null,
      decided_by: operator.userId,
      idempotency_key: randomUUID(),
      request_hash: "c".repeat(64),
    }).select("id").single();
    expect(approval.error).toBeNull();

    const forgedPending = await service.from("mission_pending_rewards").insert({
      workspace_id: DEMO_WS,
      mission_workflow_id: ownedWorkflow.data.id,
      mission_submission_id: foreign.submission.id,
      creator_id: foreign.creator.id,
      mission_id: foreign.mission.id,
      reward_contract_id: foreignContract.data!.id,
      completion_decision_id: approval.data!.id,
      points_amount: 500,
      cash_amount: 125,
      currency: "HKD",
      xp_amount: 0,
      status: "pending",
      processing_window_days: null,
      target_at: null,
    }).select("id").single();
    expect(forgedPending.error).toBeNull();

    const forgedEvent = await service.from("mission_workflow_events").insert({
      workspace_id: DEMO_WS,
      mission_workflow_id: ownedWorkflow.data.id,
      mission_work_item_id: null,
      actor_type: "system",
      actor_id: null,
      event_type: "mission_completion_approved",
      entity_type: "mission_pending_reward",
      entity_id: forgedPending.data!.id,
      metadata: { decision_id: approval.data!.id },
    });
    expect(forgedEvent.error).toBeNull();

    const wrongCreatorNotifications = (await notifsFor(foreign.creator.jwt)).filter(
      (notification) => notification.type === "mission_reward_pending"
        && notification.data.submission_id === foreign.submission.id,
    );
    expect(wrongCreatorNotifications).toEqual([]);
  });

  it("commits a proof correction after notification failure and permits semantic retry", async () => {
    const fixture = await seedPublicationProofReleaseFixture();
    const svc = serviceForTests();
    const workItemId = fixture.items.optionalEvidence.id;
    const instruction = await svc.from("mission_publication_instructions")
      .select("revision")
      .eq("mission_work_item_id", workItemId)
      .single();
    expect(instruction.error).toBeNull();

    const submitted = await svc.rpc("submit_mission_publication_proof", {
      p_submission: fixture.submission.id,
      p_creator: fixture.creator.id,
      p_workspace: fixture.workspace.id,
      p_work_item: workItemId,
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
    expect(submitted.error).toBeNull();
    const attemptId = submitted.data.attempt.id as string;
    const attemptNumber = submitted.data.attempt.attempt_number as number;
    const started = await svc.rpc("start_publication_proof_review", {
      p_workspace: fixture.workspace.id,
      p_workflow: fixture.workflow.id,
      p_work_item: workItemId,
      p_attempt: attemptId,
      p_expected_state: "proof_submitted",
      p_expected_revision: instruction.data!.revision,
      p_operator: fixture.operator.id,
      p_idempotency_key: randomUUID(),
    });
    expect(started.error).toBeNull();
    expect((await svc.from("missions").update({ title: "x".repeat(9000) })
      .eq("id", fixture.mission.id)).error).toBeNull();

    const corrected = await svc.rpc("request_publication_proof_correction", {
      p_workspace: fixture.workspace.id,
      p_workflow: fixture.workflow.id,
      p_work_item: workItemId,
      p_attempt: attemptId,
      p_expected_state: "proof_under_review",
      p_expected_revision: instruction.data!.revision,
      p_operator: fixture.operator.id,
      p_idempotency_key: randomUUID(),
      p_checklist: {
        publicly_accessible: true,
        platform_matches: true,
        account_matches: true,
        content_matches_approved_version: false,
        timing_acceptable: true,
        disclosures_present: true,
      },
      p_items: [{
        category: "content",
        text: "Publish the approved final cut",
        position: 0,
      }],
      p_summary: "Correction required",
    });
    expect(corrected.error).toBeNull();
    expect(corrected.data.work_item.state).toBe("proof_correction_requested");
    expect((await svc.from("notifications")
      .select("id")
      .eq("user_id", fixture.creator.id)
      .eq("type", "mission_publication_correction_requested")
      .eq("entity_id", workItemId)).data).toEqual([]);

    expect((await svc.from("missions").update({ title: fixture.mission.slug })
      .eq("id", fixture.mission.id)).error).toBeNull();
    const replay = await svc.from("mission_workflow_events").insert({
      workspace_id: fixture.workspace.id,
      mission_workflow_id: fixture.workflow.id,
      mission_work_item_id: workItemId,
      actor_type: "system",
      actor_id: null,
      event_type: "mission_publication_proof_correction_requested",
      entity_type: "mission_publication_proof_review",
      entity_id: corrected.data.review.id,
      metadata: {
        attempt_number: attemptNumber,
        correction_count: 1,
        creator_response_deadline: corrected.data.review.creator_response_deadline,
      },
    });
    expect(replay.error).toBeNull();

    const notifications = await svc.from("notifications")
      .select("type, entity_type, entity_id, data")
      .eq("user_id", fixture.creator.id)
      .eq("type", "mission_publication_correction_requested")
      .eq("entity_id", workItemId);
    expect(notifications.error).toBeNull();
    expect(notifications.data).toHaveLength(1);
    expect(notifications.data?.[0]).toMatchObject({
      type: "mission_publication_correction_requested",
      entity_type: "mission_work_item",
      entity_id: workItemId,
      data: {
        mission_title: fixture.mission.slug,
        mission_slug: fixture.mission.slug,
        submission_id: fixture.submission.id,
        attempt_number: attemptNumber,
        reason_categories: ["content"],
      },
    });
    expect(Object.keys(notifications.data?.[0].data ?? {}).sort()).toEqual([
      "attempt_number",
      "deadline",
      "deliverable_title",
      "mission_slug",
      "mission_title",
      "reason_categories",
      "submission_id",
    ]);
  });
});
