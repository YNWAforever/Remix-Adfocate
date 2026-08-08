import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(process.cwd(), "supabase/migrations/20260809100000_creator_studio_mission_workspace.sql");

describe("creator studio mission workspace migration", () => {
  it("establishes owner-scoped tables, RLS, grants, trigger/backfill, replay uniqueness, and storage policies", () => {
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
  });
});
