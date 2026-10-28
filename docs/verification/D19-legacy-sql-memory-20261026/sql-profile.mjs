// Original SQL selection only. No server/SDK/network import or database construction.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath, URL } from "node:url";
import { topLevelStatements } from "../../../scripts/audit/b2-bootstrap-profile.mjs";

const root = new URL("../../../", import.meta.url);
const hash = value => createHash("sha256").update(value).digest("hex");
export function createLegacyMemoryProfile() {
  const sources = new Map(), selected = [];
  function take(path, purpose, match, count) {
    let source = sources.get(path);
    if (!source) {
      const bytes = readFileSync(new URL(path, root));
      source = { path, sha256: hash(bytes), text: bytes.toString("utf8"), statements: null };
      source.statements = topLevelStatements(source.text); sources.set(path, source);
    }
    const statements = source.statements.filter(sql => match(sql.toLowerCase().replace(/\s+/g, " ")));
    assert.equal(statements.length, count, `${purpose}: original statement selection drift`);
    selected.push(...statements.map(sql => ({ path, purpose, statementSha256: hash(sql), sql })));
    return statements.map(sql => sql + ";").join("\n");
  }
  const init = take("supabase/migrations/0001_init.sql", "actual workspace,Creator,mission and points table definitions",
    sql => /^create table public\.(workspaces|creators|missions|point_balances|point_transactions)\s*\(/.test(sql), 5);
  const submissions = take("supabase/migrations/0005_mission_submissions.sql", "actual submission table",
    sql => /^create table public\.mission_submissions\s*\(/.test(sql), 1);
  const earnings = take("supabase/migrations/0007_earnings.sql", "actual earnings tables",
    sql => /^create table public\.(earnings_balances|earnings_transactions)\s*\(/.test(sql), 2);
  const quality = take("supabase/migrations/0009_passport_scores.sql", "actual quality-rating column",
    sql => sql.startsWith("alter table public.mission_submissions") && sql.includes("add column quality_rating"), 1);
  const mode = take("supabase/migrations/20260715163350_active_mission_workspace.sql", "actual legacy/active mission policy columns",
    sql => sql.startsWith("alter table public.missions") && sql.includes("add column creator_workflow_mode"), 1);
  const budgets = take("supabase/migrations/0024_brand_budget.sql", "actual budget tables",
    sql => /^create table if not exists public\.(workspace_budgets|workspace_budget_transactions)\s*\(/.test(sql), 2);
  const approve = take("supabase/migrations/0024_brand_budget.sql", "actual final legacy approval core",
    sql => sql.startsWith("create or replace function public.approve_submission("), 1);
  const acl = take("supabase/migrations/0024_brand_budget.sql", "actual legacy approval execute ACL",
    sql => /^(revoke all|grant execute) on function public\.approve_submission\(/.test(sql), 2);
  const revision = take("supabase/migrations/20261022170454_audit_legacy_evidence.sql", "actual evidence revision column",
    sql => sql.startsWith("alter table public.mission_submissions") && sql.includes("add column evidence_revision"), 1);
  const evidence = take("supabase/migrations/20261022170454_audit_legacy_evidence.sql", "actual evidence validator and trigger function",
    sql => /^create function private\.(valid_legacy_evidence|guard_legacy_submission_evidence)\(/.test(sql), 2);
  const evidenceAcl = take("supabase/migrations/20261022170454_audit_legacy_evidence.sql", "actual evidence execute ACL",
    sql => /^(revoke all|grant execute) on function private\.(valid_legacy_evidence|guard_legacy_submission_evidence)\(/.test(sql), 4);
  const trigger = take("supabase/migrations/20261022170454_audit_legacy_evidence.sql", "actual evidence trigger",
    sql => sql.startsWith("create trigger legacy_submission_evidence_guard"), 1);
  const bootstrap = `create role anon;create role authenticated;create role service_role;
    create schema auth;create schema private;revoke all on schema private from public;
    grant usage on schema public,private to service_role;
    create table auth.users(id uuid primary key);`;
  const beforeFixtureSql = [bootstrap, init, submissions, earnings, quality, mode, budgets, revision, approve, acl].join("\n");
  const afterFixtureSql = [evidence, evidenceAcl, trigger].join("\n");
  const metadata = { kind: "ORIGINAL_SQL_CORE_SUBSET_MEMORY_ONLY", root: fileURLToPath(root),
    sources: [...sources.values()].map(({ path, sha256 }) => ({ path, sha256 })),
    statements: selected.map(({ path, purpose, statementSha256 }) => ({ path, purpose, statementSha256 })),
    testBootstrap: "In-process roles/schemas plus auth.users PK only; not real Auth or a replacement application schema.",
    bootstrapSha256: hash(bootstrap), beforeFixtureSha256: hash(beforeFixtureSql), afterFixtureSha256: hash(afterFixtureSql),
    includesFullMigrationReplay: false, includesAuthRlsOrIndependentConnectionConcurrency: false,
    excluded: ["Full73 migration trigger stack", "GoTrue/PostgREST/Hono", "Real Auth/membership/RLS", "Campaign bonus,notification and level hooks", "persistScores API behavior", "Independent-connection concurrency", "Active pending reward flow"] };
  return { ...metadata, profileDigest: hash(JSON.stringify(metadata)), beforeFixtureSql, afterFixtureSql };
}
