import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  activeMissionIntegrationSkipReason,
  creatorRewardSnapshot,
  seedActiveMission,
  serviceForTests,
  userForJwt,
} from "./helpers";

const integrationSkipReason = activeMissionIntegrationSkipReason();
const suite = integrationSkipReason === null ? describe : describe.skip;
const suiteName = integrationSkipReason === null ? "active mission workflow schema" : `active mission workflow schema (skipped: ${integrationSkipReason})`;
const unique = () => randomUUID();

describe("active mission migration contract", () => {
  it("runs live cases only against an explicitly enabled loopback Supabase", () => {
    const localEnv = {
      RUN_INTEGRATION: "1",
      SUPABASE_URL: "http://127.0.0.1:54321",
      SUPABASE_SERVICE_KEY: "service-key",
      SUPABASE_ANON_KEY: "anon-key",
    };

    expect(activeMissionIntegrationSkipReason(localEnv)).toBeNull();
    expect(activeMissionIntegrationSkipReason({ ...localEnv, RUN_INTEGRATION: "0" }))
      .toBe("RUN_INTEGRATION=1 is required");
    expect(activeMissionIntegrationSkipReason({ ...localEnv, SUPABASE_URL: "https://example.supabase.co" }))
      .toBe("SUPABASE_URL must use localhost or 127.0.0.1");
  });

  it("defines the normalized workflow, guarded RPCs, RLS, private assets, and reward boundary", () => {
    const migrationPath = resolve("supabase/migrations/20260715163350_active_mission_workspace.sql");
    const sql = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8").toLowerCase() : "";

    for (const token of [
      "creator_workflow_mode",
      "create table public.mission_deliverable_templates",
      "create table public.mission_workflows",
      "create table public.mission_work_items",
      "create table public.mission_draft_versions",
      "create table public.mission_workflow_events",
      "create or replace function public.create_mission_workflow",
      "create or replace function public.refresh_mission_workflow_state",
      "security definer",
      "private.create_mission_workflow",
      "enable row level security",
      "mission-draft-assets",
      "immutable_record",
    ]) {
      expect(sql, `missing migration contract token: ${token}`).toContain(token);
    }
    for (const table of [
      "mission_deliverable_templates",
      "mission_deliverable_requirements",
      "mission_workflows",
      "mission_work_items",
      "mission_working_drafts",
      "mission_draft_versions",
      "mission_draft_assets",
      "mission_review_rounds",
      "mission_review_items",
      "mission_revision_grants",
      "mission_fulfillments",
      "mission_workflow_events",
    ]) {
      expect(sql).toContain(`alter table public.${table} enable row level security`);
      expect(sql).toContain(`on public.${table}`);
    }
    expect(sql).toContain("revoke all on function private.create_mission_workflow(uuid) from public, anon, authenticated, service_role");
    expect(sql).not.toContain("grant execute on function private.create_mission_workflow(uuid) to authenticated");
    expect(sql).toContain("if v_workflow.state in ('cancelled', 'expired') then return v_workflow");
    expect(sql).toContain("foreign key (current_submitted_version_id, id, workspace_id)");
    expect(sql).toContain("foreign key (mission_draft_version_id, mission_work_item_id, workspace_id)");
    expect(sql).toContain("private_rpc_exposed");
    expect(sql).toContain("authenticated_grant_drift");
    expect(sql).toContain("ownership_index_required");
    expect(sql).not.toContain("update public.point_balances");
    expect(sql).not.toContain("update public.earnings_balances");
    expect(sql).not.toContain("update public.workspace_budgets");
    expect(sql).not.toContain("update public.creators set xp");
  });
});

// Immutable workflow history is intentionally not deleted in-test. The integration harness
// resets its disposable local database, while full UUIDs keep each fixture isolated until reset.
suite(suiteName, () => {
  it("creates one idempotent active workflow without changing the reward anchor", async () => {
    const id = unique();
    const { mission, creator, submission } = await seedActiveMission({
      email: `active-schema-${id}@test.local`,
      slug: `test-active-schema-${id}`,
      fulfillmentRequired: false,
      deliverables: [{
        title: "Instagram Reel",
        platform: "instagram",
        required: true,
        requirements: [{ category: "compliance", text: "Show the required disclosure" }],
      }],
    });
    const before = await creatorRewardSnapshot(creator.id);
    const user = userForJwt(creator.jwt);

    const first = await user.rpc("create_mission_workflow", { p_submission: submission.id });
    expect(first.error).toBeNull();
    expect(first.data).toMatchObject({ state: "drafting", mission_submission_id: submission.id });

    const second = await user.rpc("create_mission_workflow", { p_submission: submission.id });
    expect(second.error).toBeNull();
    expect(second.data.id).toBe(first.data.id);

    const svc = serviceForTests();
    const [anchor, items, drafts, events] = await Promise.all([
      svc.from("mission_submissions").select("status, xp_awarded, points_awarded").eq("id", submission.id).single(),
      svc.from("mission_work_items").select("id, state, title, platform, requirements_snapshot").eq("mission_workflow_id", first.data.id),
      svc.from("mission_working_drafts").select("id, mission_work_item_id, revision"),
      svc.from("mission_workflow_events").select("event_type").eq("mission_workflow_id", first.data.id),
    ]);
    expect(anchor.error).toBeNull();
    expect(anchor.data).toEqual({ status: "joined", xp_awarded: 0, points_awarded: 0 });
    expect(items.error).toBeNull();
    expect(items.data).toHaveLength(1);
    expect(items.data?.[0]).toMatchObject({ state: "drafting", title: "Instagram Reel", platform: "instagram" });
    expect(drafts.data?.filter((draft) => draft.mission_work_item_id === items.data?.[0].id)).toHaveLength(1);
    expect(events.data).toEqual([{ event_type: "workflow_created" }]);
    expect(await creatorRewardSnapshot(creator.id)).toEqual(before);
    expect(mission.creator_workflow_mode).toBe("active_workspace");
  });

  it("starts fulfilment-required work blocked and keeps the private bucket private", async () => {
    const id = unique();
    const { creator, submission } = await seedActiveMission({
      email: `active-fulfillment-${id}@test.local`,
      slug: `test-active-fulfillment-${id}`,
      fulfillmentRequired: true,
      deliverables: [{ title: "Unboxing Reel", platform: "instagram", required: true }],
    });
    const result = await userForJwt(creator.jwt).rpc("create_mission_workflow", { p_submission: submission.id });
    expect(result.error).toBeNull();
    expect(result.data.state).toBe("fulfillment_pending");

    const svc = serviceForTests();
    const [fulfilment, items, bucket] = await Promise.all([
      svc.from("mission_fulfillments").select("status").eq("mission_workflow_id", result.data.id).single(),
      svc.from("mission_work_items").select("state").eq("mission_workflow_id", result.data.id),
      svc.storage.getBucket("mission-draft-assets"),
    ]);
    expect(fulfilment.data?.status).toBe("preparing");
    expect(items.data).toEqual([{ state: "blocked_by_fulfillment" }]);
    expect(bucket.error).toBeNull();
    expect(bucket.data).toMatchObject({ public: false, file_size_limit: 20 * 1024 * 1024 });
    expect(bucket.data?.allowed_mime_types).toEqual(expect.arrayContaining(["image/jpeg", "image/png", "video/mp4"]));
  });

  it("allows creator self-read only and protects append-only records", async () => {
    const id = unique();
    const own = await seedActiveMission({
      email: `active-owner-${id}@test.local`,
      slug: `test-active-owner-${id}`,
      deliverables: [{ title: "Story", platform: "instagram" }],
    });
    const other = await seedActiveMission({
      email: `active-other-${id}@test.local`,
      slug: `test-active-other-${id}`,
      deliverables: [{ title: "Video", platform: "tiktok" }],
    });
    const ownWorkflow = await userForJwt(own.creator.jwt).rpc("create_mission_workflow", { p_submission: own.submission.id });
    await userForJwt(other.creator.jwt).rpc("create_mission_workflow", { p_submission: other.submission.id });

    const ownRows = await userForJwt(own.creator.jwt).from("mission_workflows").select("id");
    expect(ownRows.error).toBeNull();
    expect(ownRows.data).toEqual([{ id: ownWorkflow.data.id }]);

    const svc = serviceForTests();
    const event = await svc.from("mission_workflow_events").select("id").eq("mission_workflow_id", ownWorkflow.data.id).single();
    const mutation = await svc.from("mission_workflow_events").update({ event_type: "tampered" }).eq("id", event.data!.id);
    expect(mutation.error?.message).toContain("immutable_record");
    const deletion = await svc.from("mission_workflow_events").delete().eq("id", event.data!.id);
    expect(deletion.error?.message).toContain("immutable_record");
  });
  it("preserves terminal state and rejects cross-owner create", async () => {
    const id = unique();
    const own = await seedActiveMission({
      email: `active-terminal-${id}@test.local`,
      slug: `test-active-terminal-${id}`,
      deliverables: [{ title: "Post", platform: "instagram" }],
    });
    const other = await seedActiveMission({
      email: `active-terminal-other-${id}@test.local`,
      slug: `test-active-terminal-other-${id}`,
      deliverables: [{ title: "Post", platform: "instagram" }],
    });
    const ownUser = userForJwt(own.creator.jwt);
    const created = await ownUser.rpc("create_mission_workflow", { p_submission: own.submission.id });
    expect(created.error).toBeNull();

    const crossCreate = await ownUser.rpc("create_mission_workflow", { p_submission: other.submission.id });
    expect(crossCreate.error?.message).toContain("not_found");

    const svc = serviceForTests();
    const terminal = await svc.from("mission_workflows").update({ state: "cancelled" }).eq("id", created.data.id);
    expect(terminal.error).toBeNull();

    const refreshed = await ownUser.rpc("refresh_mission_workflow_state", { p_workflow: created.data.id });
    expect(refreshed.error).toBeNull();
    expect(refreshed.data.state).toBe("cancelled");
    const retried = await ownUser.rpc("create_mission_workflow", { p_submission: own.submission.id });
    expect(retried.error).toBeNull();
    expect(retried.data.state).toBe("cancelled");
  });

  it("rejects linking a draft version to another work item", async () => {
    const id = unique();
    const first = await seedActiveMission({
      email: `active-fk-first-${id}@test.local`,
      slug: `test-active-fk-first-${id}`,
      deliverables: [{ title: "First", platform: "instagram" }],
    });
    const second = await seedActiveMission({
      email: `active-fk-second-${id}@test.local`,
      slug: `test-active-fk-second-${id}`,
      deliverables: [{ title: "Second", platform: "tiktok" }],
    });
    const firstWorkflow = await userForJwt(first.creator.jwt).rpc("create_mission_workflow", { p_submission: first.submission.id });
    const secondWorkflow = await userForJwt(second.creator.jwt).rpc("create_mission_workflow", { p_submission: second.submission.id });
    const svc = serviceForTests();
    const firstItem = await svc.from("mission_work_items").select("id, workspace_id").eq("mission_workflow_id", firstWorkflow.data.id).single();
    const secondItem = await svc.from("mission_work_items").select("id").eq("mission_workflow_id", secondWorkflow.data.id).single();
    const version = await svc.from("mission_draft_versions").insert({
      workspace_id: firstItem.data!.workspace_id,
      mission_work_item_id: firstItem.data!.id,
      version_number: 1,
      submitted_by: first.creator.id,
      content_checksum: `checksum-${id}`,
    }).select("id").single();
    expect(version.error).toBeNull();

    const crossLink = await svc.from("mission_work_items")
      .update({ current_submitted_version_id: version.data!.id })
      .eq("id", secondItem.data!.id);
    expect(crossLink.error?.code).toBe("23503");
  });
});
