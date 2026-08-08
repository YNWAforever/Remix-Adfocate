import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(process.cwd(), "supabase/migrations/20260809100000_creator_studio_mission_workspace.sql");
const typesPath = resolve(process.cwd(), "server/lib/creatorStudio/types.ts");

describe("creator studio mission workspace migration", () => {
  it("establishes owner-scoped tables, RLS, grants, trigger/backfill, replay uniqueness, lineage, and storage policies", () => {
    const sql = readFileSync(migrationPath, "utf8");

    for (const table of [
      "mission_workflows", "mission_work_items", "mission_working_drafts", "mission_draft_versions", "mission_draft_assets",
      "mission_review_rounds", "mission_review_items", "mission_workflow_commands", "mission_workflow_events",
    ]) {
      expect(sql).toMatch(new RegExp(`create table public\\.${table}`));
      expect(sql).toMatch(new RegExp(`alter table public\\.${table} enable row level security`));
    }

    expect(sql).toContain("unique (id, workspace_id)");
    expect(sql).toContain("references public.mission_submissions(id, workspace_id)");
    expect(sql).toContain("(mission_submission_id, actor_id, command_id)");
    expect(sql).toContain("initialize_creator_studio_workflow");
    expect(sql).toContain("refresh_creator_studio_state");
    expect(sql).toContain("for update");
    expect(sql).toContain("after insert or update of status");
    expect(sql).toContain("where status = 'joined'");
    expect(sql).toContain("creator-studio-assets");
    expect(sql).toContain("grant select on public.mission_workflows to authenticated");
    expect(sql).toContain("grant all on public.mission_workflows to service_role");
    expect(sql).toContain("mission_workflows_id_submission_creator_workspace_key");
    expect(sql).toContain("mission_work_items_id_workflow_submission_creator_workspace_key");
    expect(sql).toContain("mission_draft_assets_item_lineage_fk");
    expect(sql).toContain("mission_workflow_events_item_lineage_fk");
    expect(sql).toContain("mission_workflow_commands_submission_creator_lineage_fk");
    expect(sql).toContain("foreign key (mission_submission_id, creator_id, workspace_id) references public.mission_submissions(id, creator_id, workspace_id)");
    expect(sql).toContain("creator_studio_assets_update");
    const storageUpdatePolicy = sql.slice(
      sql.indexOf("create policy creator_studio_assets_update"),
      sql.indexOf("create or replace function public.refresh_creator_studio_state"),
    );
    expect(storageUpdatePolicy).toContain("asset.storage_object_path = name");
    expect(storageUpdatePolicy).toContain("asset.upload_state = 'pending'");
    expect(storageUpdatePolicy).toContain("asset.upload_grant_expires_at > now()");
  });

  it("uses a creator-submission lineage key and append-only guards for immutable ledgers", () => {
    const sql = readFileSync(migrationPath, "utf8");

    const commands = sql.slice(
      sql.indexOf("create table public.mission_workflow_commands"),
      sql.indexOf("create table public.mission_workflow_events"),
    );
    expect(commands).toContain("constraint mission_workflow_commands_submission_creator_lineage_fk");
    expect(commands).toContain("foreign key (mission_submission_id, creator_id, workspace_id)");
    expect(commands).not.toContain("foreign key (mission_submission_id, workspace_id)");

    expect(sql).toContain("create or replace function public.reject_creator_studio_immutable_mutation()");
    for (const table of [
      "mission_draft_versions",
      "mission_review_rounds",
      "mission_review_items",
      "mission_workflow_events",
    ]) {
      expect(sql).toContain(`create trigger ${table}_append_only`);
      expect(sql).toContain(`before update or delete or truncate on public.${table}`);
    }
  });

  it("keeps mission submission lifecycle status distinct from Creator Studio workflow state", () => {
    const types = readFileSync(typesPath, "utf8");

    expect(types).toContain('export type MissionSubmissionStatus = (typeof MISSION_SUBMISSION_STATUSES)[number];');
    expect(types).toContain('status: MissionSubmissionStatus;');
    expect(types).toContain('"applied", "joined", "submitted", "under_review", "approved", "rejected", "expired", "declined"');
  });
});
