import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  activeMissionIntegrationSkipReason, hasSupabaseEnv, serviceForTests, userForJwt,
  makeCreator, makeMission, makeStaff, seedActiveMission,
  makeGift, addCodes, setXp, cleanup, DEMO_WS,
} from "./helpers";

const suite = hasSupabaseEnv ? describe : describe.skip;
const integrationSkipReason = activeMissionIntegrationSkipReason();
const activeSuite = integrationSkipReason === null ? describe : describe.skip;

const migrationPath = resolve(
  "supabase/migrations/20260719200000_active_mission_workflow_notifications.sql",
);
const migrationSql = readFileSync(migrationPath, "utf8")
  .toLowerCase()
  .replace(/\r\n/g, "\n");

function definition(name: string): string {
  const start = migrationSql.lastIndexOf(`create or replace function ${name}(`);
  const end = migrationSql.indexOf("\n$$;", start);
  return start < 0 || end < 0 ? "" : migrationSql.slice(start, end + 4);
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


/** Seed a submission row directly (service) in a given status; returns its id. */
async function seedSub(creatorId: string, status: string, slug: string) {
  const m = await makeMission({ slug });
  const { data, error } = await serviceForTests()
    .from("mission_submissions")
    .insert({ mission_id: m.id, creator_id: creatorId, workspace_id: DEMO_WS, status })
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
    koc = await makeCreator("notif-trig@test.local", 1000);
  });
  afterAll(cleanup);

  it("submission_approved carries points + xp deltas", async () => {
    const id = await seedSub(koc.userId, "submitted", "test-notif-approve");
    await serviceForTests().rpc("approve_submission", { p_submission: id, p_notes: "good" });
    const n = (await notifsFor(koc.jwt)).find((x) => x.type === "submission_approved");
    expect(n).toBeTruthy();
    expect(n!.data.points).toBeGreaterThan(0);
    expect(n!.data.xp).toBe(100);
  });

  it("submission_rejected carries the reason", async () => {
    const id = await seedSub(koc.userId, "submitted", "test-notif-reject");
    await serviceForTests().rpc("reject_submission", { p_submission: id, p_notes: "off-brief" });
    const n = (await notifsFor(koc.jwt)).find((x) => x.type === "submission_rejected");
    expect(n?.data.reason).toBe("off-brief");
  });

  it("application_accepted and application_declined fire", async () => {
    const a = await seedSub(koc.userId, "applied", "test-notif-accept");
    await serviceForTests().rpc("accept_application", { p_submission: a });
    const d = await seedSub(koc.userId, "applied", "test-notif-decline");
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
    const g = await makeGift({ name: "test-notif-gift", points_cost: 100 });
    await addCodes(g.id, ["TEST-CODE-1"]);
    await userForJwt(koc.jwt).rpc("redeem_gift", { p_gift: g.id });
    const n = (await notifsFor(koc.jwt)).find((x) => x.type === "redemption_ready");
    expect(n?.data.gift_name).toBe("test-notif-gift");
  });

  it("RLS isolates notifications between creators", async () => {
    const other = await makeCreator("notif-other@test.local", 0);
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
});
