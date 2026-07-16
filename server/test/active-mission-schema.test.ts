import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  activeMissionIntegrationSkipReason,
  creatorRewardSnapshot,
  makeCreator,
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

  it("binds every active-mission relationship and creator lookup to one workspace", () => {
    const sql = readFileSync(resolve("supabase/migrations/20260715163350_active_mission_workspace.sql"), "utf8").toLowerCase().replace(/\r\n/g, "\n");

    for (const relationship of [
      "foreign key (mission_id, workspace_id)\n    references public.missions(id, workspace_id)",
      "foreign key (creator_id, workspace_id)\n    references public.creators(id, workspace_id)",
      "foreign key (mission_deliverable_template_id, workspace_id)\n    references public.mission_deliverable_templates(id, workspace_id)",
      "foreign key (mission_submission_id, workspace_id)\n    references public.mission_submissions(id, workspace_id)",
      "foreign key (mission_workflow_id, workspace_id)\n    references public.mission_workflows(id, workspace_id)",
      "foreign key (mission_work_item_id, mission_workflow_id, workspace_id)\n    references public.mission_work_items(id, mission_workflow_id, workspace_id)",
      "foreign key (mission_review_round_id, workspace_id)\n    references public.mission_review_rounds(id, workspace_id)",
    ]) {
      expect(sql, `missing tenant relationship: ${relationship}`).toContain(relationship);
    }

    for (const policy of [
      "mission_templates_creator_read",
      "mission_requirements_creator_read",
      "mission_workflows_creator_read",
      "mission_work_items_creator_read",
      "mission_working_drafts_creator_read",
      "mission_versions_creator_read",
      "mission_assets_creator_read",
      "mission_reviews_creator_read",
      "mission_review_items_creator_read",
      "mission_revision_grants_creator_read",
      "mission_fulfillments_creator_read",
      "mission_events_creator_read",
    ]) {
      const start = sql.lastIndexOf(`create policy ${policy}`);
      const end = sql.indexOf(";", start);
      expect(start, `missing policy: ${policy}`).toBeGreaterThanOrEqual(0);
      expect(sql.slice(start, end), `${policy} must scope ownership joins by workspace_id`).toContain("workspace_id");
    }

    for (const fn of [
      "private.refresh_mission_workflow_state",
      "private.create_mission_workflow",
      "public.refresh_mission_workflow_state",
      "public.create_mission_workflow",
    ]) {
      const start = sql.lastIndexOf(`create or replace function ${fn}`);
      const end = sql.indexOf("\n$$;", start);
      expect(sql.slice(start, end), `${fn} must scope lookups by workspace_id`).toContain("workspace_id");
    }
    expect(sql.match(/i\.mission_workflow_id = v_workflow\.id\s+and i\.workspace_id = v_workflow\.workspace_id/g)).toHaveLength(3);
    expect(sql).toContain("f.mission_workflow_id = v_workflow.id\n      and f.workspace_id = v_workflow.workspace_id");
    expect(sql).toContain("where id = v_workflow.id and workspace_id = v_workflow.workspace_id");
  });

  it("denies execution on every current and future private function", () => {
    const sql = readFileSync(resolve("supabase/migrations/20260715163350_active_mission_workspace.sql"), "utf8").toLowerCase().replace(/\r\n/g, "\n");

    expect(sql).toContain("alter default privileges for role postgres revoke execute on functions from public, anon, authenticated");
    expect(sql).toContain("alter default privileges for role postgres in schema private revoke execute on functions from public, anon, authenticated");
    for (const signature of [
      "private.refresh_mission_workflow_state(uuid)",
      "private.create_mission_workflow(uuid)",
      "private.raise_immutable_record()",
      "private.guard_completed_review_round()",
      "private.guard_finalized_mission_asset()",
      "private.guard_mission_draft_asset_owner()",
    ]) {
      expect(sql).toContain(`revoke all on function ${signature} from public, anon, authenticated, service_role`);
    }
    expect(sql).toContain("private_function_execute_exposed");
  });

  it("requires relationally scoped canonical draft-asset object paths", () => {
    const sql = readFileSync(resolve("supabase/migrations/20260715163350_active_mission_workspace.sql"), "utf8").toLowerCase().replace(/\r\n/g, "\n");
    const canonicalPath = "creator_id::text || '/' || mission_workflow_id::text || '/' || mission_work_item_id::text || '/' || id::text || '.' || file_extension";

    expect(sql).toContain("mission_workflow_id uuid not null");
    expect(sql).toContain("file_extension text not null");
    expect(sql).toContain(`storage_object_path = ${canonicalPath}`);
    expect(sql).toContain("foreign key (creator_id, workspace_id)\n    references public.creators(id, workspace_id)");
    expect(sql).toContain("foreign key (mission_work_item_id, mission_workflow_id, workspace_id)\n    references public.mission_work_items(id, mission_workflow_id, workspace_id)");
    expect(sql).toContain("create constraint trigger mission_draft_assets_owner_guard");
    expect(sql).toContain("execute function private.guard_mission_draft_asset_owner()");
    expect(sql).toContain("s.creator_id = new.creator_id");
    expect(sql).toContain("s.workspace_id = new.workspace_id");
    for (const policy of ["read", "insert", "update", "delete"]) {
      const start = sql.lastIndexOf(`create policy mission_draft_assets_storage_${policy}`);
      const end = sql.indexOf(";", start);
      const definition = sql.slice(start, end);
      expect(definition).toContain("a.creator_id::text || '/' || a.mission_workflow_id::text");
      expect(definition).toContain("a.mission_work_item_id::text || '/' || a.id::text || '.' || a.file_extension");
      expect(definition).toContain("join public.mission_work_items i");
      expect(definition).toContain("join public.mission_workflows w");
      expect(definition).toContain("join public.mission_submissions s");
      expect(definition).toContain("s.creator_id = a.creator_id");
      expect(definition).toContain("s.workspace_id = a.workspace_id");
    }
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

suite(suiteName, () => {
  it("rejects cross-workspace relationships, access, and asset scopes", async () => {
    const id = unique();
    const svc = serviceForTests();
    const alternateWorkspaceId = unique();
    const workspace = await svc.from("workspaces").insert({
      id: alternateWorkspaceId,
      slug: `test-active-cross-${id}`,
      name: `test-active-cross-${id}`,
    });
    expect(workspace.error).toBeNull();

    const crossCreator = await makeCreator(`active-cross-${id}@test.local`, 0);
    const moveCreator = await svc.from("creators")
      .update({ workspace_id: alternateWorkspaceId })
      .eq("id", crossCreator.userId);
    expect(moveCreator.error).toBeNull();

    const crossMission = await svc.from("missions").insert({
      workspace_id: alternateWorkspaceId,
      slug: `test-active-cross-${id}`,
      title: `test-active-cross-${id}`,
      mission_type: "ugc",
      access_type: "open",
      points_reward: 0,
      quota: 1,
      status: "active",
      required_level: "L0",
      creator_workflow_mode: "active_workspace",
      fulfillment_required: false,
    }).select("id").single();
    expect(crossMission.error).toBeNull();
    const crossTemplate = await svc.from("mission_deliverable_templates").insert({
      workspace_id: alternateWorkspaceId,
      mission_id: crossMission.data!.id,
      title: "Cross-workspace post",
      platform: "instagram",
      position: 0,
      required: true,
    });
    expect(crossTemplate.error).toBeNull();
    const crossSubmission = await svc.from("mission_submissions").insert({
      workspace_id: alternateWorkspaceId,
      mission_id: crossMission.data!.id,
      creator_id: crossCreator.userId,
      status: "joined",
    }).select("id").single();
    expect(crossSubmission.error).toBeNull();
    const crossWorkflow = await userForJwt(crossCreator.jwt)
      .rpc("create_mission_workflow", { p_submission: crossSubmission.data!.id });
    expect(crossWorkflow.error).toBeNull();

    const own = await seedActiveMission({
      email: `active-cross-owner-${id}@test.local`,
      slug: `test-active-cross-owner-${id}`,
      deliverables: [{ title: "Owned post", platform: "instagram" }],
    });
    const ownUser = userForJwt(own.creator.jwt);
    const ownWorkflow = await ownUser.rpc("create_mission_workflow", { p_submission: own.submission.id });
    expect(ownWorkflow.error).toBeNull();
    const ownItem = await svc.from("mission_work_items")
      .select("id, workspace_id")
      .eq("mission_workflow_id", ownWorkflow.data.id)
      .single();
    expect(ownItem.error).toBeNull();

    const sameWorkspaceCreator = await makeCreator(`active-same-workspace-${id}@test.local`, 0);

    const hidden = await ownUser.from("mission_workflows")
      .select("id")
      .eq("id", crossWorkflow.data.id);
    expect(hidden.error).toBeNull();
    expect(hidden.data).toEqual([]);
    const deniedRefresh = await ownUser.rpc("refresh_mission_workflow_state", {
      p_workflow: crossWorkflow.data.id,
    });
    expect(deniedRefresh.error?.message).toContain("not_found");

    const crossWorkspaceItem = await svc.from("mission_work_items").insert({
      workspace_id: alternateWorkspaceId,
      mission_workflow_id: ownWorkflow.data.id,
      title: "Invalid cross-workspace item",
      platform: "instagram",
      required: true,
      position: 99,
      state: "drafting",
    });
    expect(crossWorkspaceItem.error?.code).toBe("23503");

    const malformedAssetId = unique();
    const malformedPath = await svc.from("mission_draft_assets").insert({
      id: malformedAssetId,
      workspace_id: ownItem.data!.workspace_id,
      mission_workflow_id: ownWorkflow.data.id,
      mission_work_item_id: ownItem.data!.id,
      creator_id: own.creator.id,
      file_extension: "png",
      storage_object_path: `not-canonical-${malformedAssetId}.png`,
      original_filename: "draft.png",
      mime_type: "image/png",
      byte_size: 1024,
    });
    expect(malformedPath.error?.code).toBe("23514");

    const sameWorkspaceAssetId = unique();
    const sameWorkspaceCreatorAsset = await svc.from("mission_draft_assets").insert({
      id: sameWorkspaceAssetId,
      workspace_id: ownItem.data!.workspace_id,
      mission_workflow_id: ownWorkflow.data.id,
      mission_work_item_id: ownItem.data!.id,
      creator_id: sameWorkspaceCreator.userId,
      file_extension: "png",
      storage_object_path: `${sameWorkspaceCreator.userId}/${ownWorkflow.data.id}/${ownItem.data!.id}/${sameWorkspaceAssetId}.png`,
      original_filename: "draft.png",
      mime_type: "image/png",
      byte_size: 1024,
    });
    expect(sameWorkspaceCreatorAsset.error?.code).toBe("23514");
    expect(sameWorkspaceCreatorAsset.error?.message)
      .toContain("mission_draft_asset_owner_mismatch");

    const crossCreatorAssetId = unique();
    const crossCreatorAsset = await svc.from("mission_draft_assets").insert({
      id: crossCreatorAssetId,
      workspace_id: ownItem.data!.workspace_id,
      mission_workflow_id: ownWorkflow.data.id,
      mission_work_item_id: ownItem.data!.id,
      creator_id: crossCreator.userId,
      file_extension: "png",
      storage_object_path: `${crossCreator.userId}/${ownWorkflow.data.id}/${ownItem.data!.id}/${crossCreatorAssetId}.png`,
      original_filename: "draft.png",
      mime_type: "image/png",
      byte_size: 1024,
    });
    expect(crossCreatorAsset.error?.code).toBe("23503");
  });
});
