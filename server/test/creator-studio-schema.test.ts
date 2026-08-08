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
    expect(storageUpdatePolicy.match(/owner_id = \(select auth\.uid\(\)::text\)/g)).toHaveLength(2);
    expect(storageUpdatePolicy).not.toContain("owner_id = (select auth.uid())");
    expect(storageUpdatePolicy).toContain("asset.storage_object_path = name");
    expect(storageUpdatePolicy).toContain("asset.upload_state = 'pending'");
    expect(storageUpdatePolicy).toContain("asset.upload_grant_expires_at > now()");
  });

  it("explicitly closes direct Creator Studio table writes to anon and authenticated roles", () => {
    const sql = readFileSync(migrationPath, "utf8");
    const tables = [
      "mission_workflows", "mission_work_items", "mission_working_drafts", "mission_draft_versions", "mission_draft_assets",
      "mission_review_rounds", "mission_review_items", "mission_workflow_commands", "mission_workflow_events",
    ];

    for (const table of tables) {
      for (const role of ["anon", "authenticated"]) {
        const revokedPrivileges = Array.from(sql.matchAll(new RegExp(
          `revoke\\s+([^;]+)\\s+on\\s+(?:table\\s+)?public\\.${table}\\s+from\\s+([^;]+);`,
          "gi",
        )))
          .filter(([, , grantees]) => new RegExp(`\\b${role}\\b`, "i").test(grantees))
          .map(([, privileges]) => privileges)
          .join(" ");

        for (const privilege of ["insert", "update", "delete"]) {
          expect(revokedPrivileges).toMatch(new RegExp(`\\b(?:${privilege}|all(?:\\s+privileges)?)\\b`, "i"));
        }
      }
    }
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
      "mission_workflow_commands",
      "mission_workflow_events",
    ]) {
      expect(sql).toContain(`create trigger ${table}_append_only`);
      expect(sql).toContain(`before update or delete or truncate on public.${table}`);
    }
  });

  it("keeps finalized asset metadata immutable while preserving editable pending reservations", () => {
    const sql = readFileSync(migrationPath, "utf8");
    const assetStateGuard = sql.slice(
      sql.indexOf("create or replace function public.require_creator_studio_asset_work_item_editable"),
      sql.indexOf("create trigger mission_draft_assets_editable_work_item"),
    );

    expect(assetStateGuard).toContain("v_asset public.mission_draft_assets");
    expect(assetStateGuard).toContain("if tg_op <> 'INSERT' and old.upload_state = 'finalized' then");
    expect(assetStateGuard).toContain("raise exception 'asset_finalized'");
    expect(assetStateGuard).toContain("for update");
    expect(assetStateGuard).toContain("not_started', 'drafting', 'ready_to_submit', 'changes_requested");
    expect(assetStateGuard).toContain("raise exception 'invalid_transition'");
    expect(sql).toContain("create trigger mission_draft_assets_editable_work_item");
    expect(sql).toContain("before insert or update or delete on public.mission_draft_assets");
    expect(sql).toContain("create trigger mission_draft_assets_prevent_truncate");
    expect(sql).toContain("before truncate on public.mission_draft_assets");
    expect(sql).toContain("for each statement execute function public.reject_creator_studio_asset_truncate()");
  });

  it("configures the private Creator Studio bucket with the exact upload constraints", () => {
    const sql = readFileSync(migrationPath, "utf8");
    const bucketSetup = sql.slice(
      sql.indexOf("insert into storage.buckets"),
      sql.indexOf("create policy creator_studio_assets_read"),
    );

    expect(bucketSetup).toContain("file_size_limit");
    expect(bucketSetup).toContain("allowed_mime_types");
    expect(bucketSetup).toContain("52428800");
    expect(bucketSetup).toContain("'image/jpeg'");
    expect(bucketSetup).toContain("'image/png'");
    expect(bucketSetup).toContain("'image/webp'");
    expect(bucketSetup).toContain("'video/mp4'");
    expect(bucketSetup).toContain("'application/pdf'");
    expect(bucketSetup).toMatch(/array\[\s*'image\/jpeg',\s*'image\/png',\s*'image\/webp',\s*'video\/mp4',\s*'application\/pdf'\s*\]::text\[\]/);
    expect(bucketSetup).toContain("on conflict (id) do update set");
    expect(bucketSetup).toContain("file_size_limit = excluded.file_size_limit");
    expect(bucketSetup).toContain("allowed_mime_types = excluded.allowed_mime_types");
  });

  it("allows the owner to select pending upload reservations while retaining finalized asset reads", () => {
    const sql = readFileSync(migrationPath, "utf8");
    const pendingReadPolicyStart = sql.indexOf("create policy creator_studio_assets_pending_read");
    const finalizedReadPolicy = sql.slice(
      sql.indexOf("create policy creator_studio_assets_read"),
      pendingReadPolicyStart,
    );
    const pendingReadPolicy = sql.slice(
      pendingReadPolicyStart,
      sql.indexOf("create policy creator_studio_assets_insert"),
    );

    expect(finalizedReadPolicy).toContain("asset.storage_object_path = name");
    expect(finalizedReadPolicy).toContain("asset.upload_state = 'finalized'");
    expect(pendingReadPolicy).toContain("for select to authenticated using");
    expect(pendingReadPolicy).toContain("bucket_id = 'creator-studio-assets'");
    expect(pendingReadPolicy).toContain("owner_id = (select auth.uid()::text)");
    expect(pendingReadPolicy).toContain("asset.storage_object_path = name");
    expect(pendingReadPolicy).toContain("asset.creator_id = (select auth.uid())");
    expect(pendingReadPolicy).toContain("asset.upload_state = 'pending'");
    expect(pendingReadPolicy).toContain("asset.upload_grant_expires_at > now()");
  });

  it("keeps mission submission lifecycle status distinct from Creator Studio workflow state", () => {
    const types = readFileSync(typesPath, "utf8");

    expect(types).toContain('export type MissionSubmissionStatus = (typeof MISSION_SUBMISSION_STATUSES)[number];');
    expect(types).toContain('status: MissionSubmissionStatus;');
    expect(types).toContain('"applied", "joined", "submitted", "under_review", "approved", "rejected", "expired", "declined"');
  });
});
