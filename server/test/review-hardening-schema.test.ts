// server/test/review-hardening-schema.test.ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** The 20260805120000 migration closes six direct-PostgREST paths that the Hono handlers cannot
 *  reach. Docker is not available in CI, so these assertions read the migration text — they pin
 *  the shape of each fix so a later edit cannot quietly drop one. */

const migrationSql = () => readFileSync(
  resolve("supabase/migrations/20260805120000_review_hardening.sql"),
  "utf8",
).replace(/\r\n/g, "\n");

function functionBlock(sql: string, qualifiedName: string) {
  const start = sql.indexOf(`create or replace function ${qualifiedName}(`);
  expect(start, `missing function: ${qualifiedName}`).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf("\n$$;", start);
  expect(end, `unterminated function body: ${qualifiedName}`).toBeGreaterThan(start);
  return sql.slice(start, end + 4);
}

function policyBlock(sql: string, policy: string) {
  const start = sql.indexOf(`create policy ${policy} on`);
  expect(start, `missing policy: ${policy}`).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf(";", start);
  expect(end, `unterminated policy: ${policy}`).toBeGreaterThan(start);
  return sql.slice(start, end + 1);
}

function columnGrant(sql: string, table: string) {
  const marker = `) on public.${table} to authenticated;`;
  const end = sql.indexOf(marker);
  expect(end, `missing column grant for ${table}`).toBeGreaterThanOrEqual(0);
  const start = sql.lastIndexOf("grant update (", end);
  expect(start, `missing column grant for ${table}`).toBeGreaterThanOrEqual(0);
  return sql.slice(start, end + marker.length);
}

describe("review hardening migration contract", () => {
  it("A: replaces the table-wide missions UPDATE with the brand authoring columns", () => {
    const sql = migrationSql();
    expect(sql).toContain("revoke update on public.missions from authenticated;");

    const grant = columnGrant(sql, "missions");
    // Everything routes/brand.ts writes (EDITABLE_COLS + brief + publish/close stamps).
    for (const column of [
      "slug", "title", "description", "category", "mission_type", "access_type", "required_level",
      "points_reward", "cash_reward", "cpm_rate", "cpm_budget_pool", "deadline", "quota",
      "deliverables", "requirements", "platforms", "effort",
      "target_audience", "dos", "donts", "key_messages", "reference_links",
      "status", "published_at", "closed_at", "updated_at",
    ]) {
      expect(grant, `brand authoring needs ${column}`).toMatch(new RegExp(`\\b${column}\\b`));
    }
    // Never writable by a brand: the fill counter, tenancy, and the workflow policy columns.
    for (const column of [
      "workspace_id", "filled", "created_by", "created_at",
      "creator_workflow_mode", "fulfillment_required", "revision_limit",
      "review_sla_hours", "revision_response_hours",
    ]) {
      expect(grant, `${column} must not be brand-writable`).not.toMatch(new RegExp(`\\b${column}\\b`));
    }
  });

  it("A: freezes mission reward fields once the mission leaves draft", () => {
    const sql = migrationSql();
    const helper = functionBlock(sql, "private.mission_brand_update_allowed");

    expect(helper).toContain("language sql stable security definer set search_path = ''");
    const collapsed = helper.replace(/\s+/g, " ");
    for (const column of ["points_reward", "cash_reward", "cpm_rate", "cpm_budget_pool"]) {
      expect(collapsed, `${column} must be compared against the pre-image`)
        .toContain(`mission.${column} is not distinct from p_${column}`);
    }
    // Demoting a live mission back to draft would unfreeze the rewards on the next request.
    expect(collapsed).toContain("(mission.status = 'draft' or p_status <> 'draft')");
    expect(collapsed).toContain("from public.missions mission where mission.id = p_mission");
    expect(sql).toContain(
      "grant execute on function private.mission_brand_update_allowed(uuid, text, integer, numeric, numeric, numeric)\n  to authenticated;",
    );

    expect(sql).toContain("drop policy if exists missions_brand_update on public.missions;");
    const policy = policyBlock(sql, "missions_brand_update");
    expect(policy).toContain("for update to authenticated");
    expect(policy).toContain(
      "private.mission_brand_update_allowed(id, status, points_reward, cash_reward, cpm_rate, cpm_budget_pool)",
    );
  });

  it("B: keeps campaign status, settlement stamps and prize tiers out of brand writes", () => {
    const sql = migrationSql();
    expect(sql).toContain("revoke update on public.campaigns from authenticated;");

    const grant = columnGrant(sql, "campaigns");
    for (const column of [
      "slug", "title", "description", "starts_at", "ends_at",
      "goal_target", "completion_bonus_points", "completion_bonus_xp", "updated_at",
    ]) {
      expect(grant, `campaign authoring needs ${column}`).toMatch(new RegExp(`\\b${column}\\b`));
    }
    for (const column of ["status", "settled_at", "closed_at", "published_at", "prize_tiers", "workspace_id"]) {
      expect(grant, `${column} belongs to the settle/close RPCs`).not.toMatch(new RegExp(`\\b${column}\\b`));
    }
  });

  it("B: asserts the campaign wallet before settle_campaign mints prize points", () => {
    const sql = migrationSql();
    const settle = functionBlock(sql, "public.settle_campaign");

    const pointsStart = settle.indexOf("-- POINTS: HOME workspace");
    const xpStart = settle.indexOf("-- XP.");
    expect(pointsStart, "settle_campaign lost its points branch").toBeGreaterThanOrEqual(0);
    expect(xpStart).toBeGreaterThan(pointsStart);
    const points = settle.slice(pointsStart, xpStart);

    expect(points).toContain("from public.workspace_budgets where workspace_id = v_c.workspace_id for update;");
    expect(points).toContain("raise exception 'insufficient_budget';");
    // The guard must precede the ledger write, or points are minted before it can fire.
    expect(points.indexOf("raise exception 'insufficient_budget'"))
      .toBeLessThan(points.indexOf("insert into public.point_transactions"));
    // The cash cap is untouched.
    expect(settle).toContain("if coalesce(v_bgt_enf, false) and coalesce(v_bgt_bal, 0) < v_cash then");
    expect(sql).toContain("revoke all on function public.settle_campaign(uuid) from public, anon, authenticated;");
  });

  it("C: gates the legacy join/submit RPCs on creator_workflow_mode", () => {
    const sql = migrationSql();
    const join = functionBlock(sql, "public.join_mission");
    const submit = functionBlock(sql, "public.submit_mission");

    for (const [name, block] of [["join_mission", join], ["submit_mission", submit]] as const) {
      expect(block, `${name} must read the mission workflow mode`)
        .toContain("select creator_workflow_mode into v_mode from public.missions where id = p_mission;");
      expect(block, `${name} must reject the active workflow`)
        .toContain("if v_mode = 'active_workspace' then raise exception 'workflow_mode_mismatch'; end if;");
    }
    // Legacy missions keep the legacy body verbatim.
    expect(join).toContain("return private.join_mission(p_mission);");
    expect(submit).toContain("if v_sub.status <> 'joined' then raise exception 'wrong_state'; end if;");
    expect(functionBlock(sql, "private.join_mission")).toContain("raise exception 'mission_full';");

    // The active-workspace entry point must bypass the public gate, not the workflow.
    const active = functionBlock(sql, "public.join_active_mission");
    expect(active).toContain("v_submission := private.join_mission(p_mission);");
    expect(active).not.toContain("public.join_mission(");
    expect(active).toContain("v_workflow := private.create_mission_workflow(v_submission.id);");

    expect(sql).toContain(
      "revoke all on function private.join_mission(uuid) from public, anon, authenticated, service_role;",
    );
    expect(sql).toContain("grant execute on function public.join_active_mission(uuid) to authenticated;");
  });

  it("D: short-circuits operator-owned workflow states in the refresh derivation", () => {
    const sql = migrationSql();
    const refresh = functionBlock(sql, "private.refresh_mission_workflow_state");

    expect(refresh).toContain(
      "if v_workflow.state in ('reward_pending', 'cancelled', 'expired') then return v_workflow; end if;",
    );
    // The guard must run before the work-item derivation that would overwrite the state.
    expect(refresh.indexOf("'reward_pending', 'cancelled', 'expired'"))
      .toBeLessThan(refresh.indexOf("update public.mission_workflows"));

    // The short-circuit is the whole fix: the wrapper keeps its own ownership check, so it stays
    // creator-callable and active-mission-schema.test.ts keeps pinning that contract.
    expect(sql).toContain(
      "grant execute on function public.refresh_mission_workflow_state(uuid) to authenticated, service_role;",
    );
  });

  it("E: drops the verified badge when a social handle or profile url moves", () => {
    const sql = migrationSql();
    const guard = functionBlock(sql, "private.clear_social_account_verification");

    // handle_normalized is a stored generated column, so BEFORE-trigger code recomputes it.
    expect(guard).toContain("lower(regexp_replace(new.handle, '^@+', '')) is distinct from old.handle_normalized");
    expect(guard).toContain("new.profile_url is distinct from old.profile_url");
    for (const assignment of [
      "new.owner_verified := false;",
      "new.verified_at := null;",
      "new.verification_code := null;",
      "new.verification_code_expires_at := null;",
    ]) {
      expect(guard, `re-verification state left behind: ${assignment}`).toContain(assignment);
    }
    expect(guard).toContain("set search_path = ''");

    expect(sql).toContain(
      "drop trigger if exists creator_social_accounts_clear_verification on public.creator_social_accounts;",
    );
    expect(sql).toContain("before update of handle, profile_url on public.creator_social_accounts");
    expect(sql).toContain("for each row when (old.owner_verified)");
    expect(sql).toContain("execute function private.clear_social_account_verification();");
  });

  it("F: hides draft missions from creators while keeping closed ones readable", () => {
    const sql = migrationSql();
    expect(sql).toContain("drop policy if exists missions_workspace on public.missions;");

    const policy = policyBlock(sql, "missions_workspace");
    expect(policy).toContain("for select");
    expect(policy).toContain("workspace_id = private.current_workspace_id()");
    expect(policy).toContain("status in ('active', 'closed')");
    expect(policy, "a creator must still read a mission they engaged with after it closes")
      .not.toContain("status = 'active'");
  });

  it("pins search_path on every security definer function it defines", () => {
    const sql = migrationSql();
    const definers = sql.split("security definer").length - 1;
    expect(definers).toBeGreaterThanOrEqual(6);
    const pinned = sql.match(/security definer\s*(\n)?\s*set search_path = ('' |''|public)/g) ?? [];
    expect(pinned.length, "every security definer function must pin search_path").toBe(definers);
  });
});
