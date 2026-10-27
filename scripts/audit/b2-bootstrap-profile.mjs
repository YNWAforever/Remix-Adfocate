// Pure offline profile builder. No Docker, SQL driver, Auth client or network imports.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const sha = value => createHash("sha256").update(value).digest("hex");
const guard = "supabase/migrations/20261022170454_audit_legacy_evidence.sql";
function tokens(source) {
  const parts = []; let i = 0;
  while (i < source.length) {
    const rest = source.slice(i);
    if (rest.startsWith("--")) { const end = source.indexOf("\n", i); parts.push({ text: " ", literal: false }); i = end < 0 ? source.length : end + 1; }
    else if (rest.startsWith("/*")) { const end = source.indexOf("*/", i + 2); if (end < 0) break; parts.push({ text: " ", literal: false }); i = end + 2; }
    else if (source[i] === "'") {
      let end = i + 1;
      while (end < source.length) { if (source[end] === "'" && source[end + 1] === "'") end += 2; else if (source[end++] === "'") break; }
      if (source[end - 1] !== "'") break;
      parts.push({ text: source.slice(i, end), literal: true }); i = end;
    } else {
      const tag = /^(\$[a-zA-Z_0-9]*\$)/.exec(rest)?.[1];
      if (tag) { const end = source.indexOf(tag, i + tag.length); if (end < 0) break; parts.push({ text: source.slice(i, end + tag.length), literal: true }); i = end + tag.length; }
      else { parts.push({ text: source[i++], literal: false }); }
    }
  }
  return parts;
}
export function topLevelStatements(source) {
  const statements = []; let current = "";
  for (const t of tokens(source)) {
    if (!t.literal && t.text === ";") { if (current.trim()) statements.push(current.trim()); current = ""; }
    else current += t.text;
  }
  return statements;
}
function valueCount(statement) {
  const masked = tokens(statement).map(t => t.literal ? "''" : t.text).join("");
  const values = /\bvalues\b([\s\S]*?)(?:\bon conflict\b|$)/i.exec(masked)?.[1];
  if (!values) return 0;
  let level = 0, count = 0;
  for (const char of values) { if (char === "(") { if (level++ === 0) count++; } else if (char === ")") level--; }
  return count;
}
export function historicalCheckpointSql(h) {
  if (!h || h.phase !== "core" || ![h.workspaceId, h.missionId, h.creatorId, h.submissionId, h.namespace].every(v => /^[a-f0-9-]{36}$/i.test(v))
    || JSON.stringify(h.contentUrls) !== '["wwww"]' || h.queueIndex !== 0) throw new Error("B2 historical exact ID/checkpoint profile invalid");
  return `begin;
insert into public.workspaces(id,slug,name) values('${h.workspaceId}','audit-${h.namespace}','Synthetic audit workspace A');
insert into auth.users(id,email) values('${h.creatorId}','${h.creatorId}@example.test');
insert into public.creators(id,workspace_id,display_name,onboarding_completed) values('${h.creatorId}','${h.workspaceId}','queue-${h.namespace}-0',true);
insert into public.missions(id,workspace_id,slug,title,mission_type,access_type,points_reward,cash_reward,quota,filled,status,required_level,creator_workflow_mode) values('${h.missionId}','${h.workspaceId}','audit-mission-${h.missionId}','Owned historical legacy boundary','ugc','open',500,125,2,1,'active','L0','legacy');
insert into public.mission_submissions(id,workspace_id,mission_id,creator_id,status,content_urls) values('${h.submissionId}','${h.workspaceId}','${h.missionId}','${h.creatorId}','submitted',array['wwww']);
commit;`;
}
export function buildBootstrapProfile(spec, historical, read = path => readFileSync(path, "utf8")) {
  if (spec.fullMigrations?.length !== 72 || new Set(spec.fullMigrations.map(m => m.path)).size !== 72) throw new Error("B2 reviewed 72-file schema profile required");
  const checkpointSql = historicalCheckpointSql(historical), migrations = [], steps = [], inventory = new Map();
  for (const m of spec.fullMigrations) {
    const sql = read(m.path);
    if (sha(sql) !== m.sha256) throw new Error(`B2 migration checksum mismatch: ${m.path}`);
    if (m.path === guard) steps.push({ kind: "owned-historical-checkpoint", phase: "core", sql: checkpointSql, sha256: sha(checkpointSql), additions: { workspaces: 1, auth_users: 1, creators: 1, missions: 1, mission_submissions: 1 }, consumesNormalFixtureCaps: true });
    migrations.push({ ...m }); steps.push({ kind: "migration", ...m });
    for (const statement of topLevelStatements(sql)) {
      const table = /^insert\s+into\s+([a-z_]+\.[a-z_]+)/i.exec(statement)?.[1];
      if (!table) continue;
      const row = inventory.get(table) ?? { table, valueRowCount: 0, sources: [], insertSelect: false };
      row.valueRowCount += valueCount(statement); row.sources.push({ path: m.path, statementSha256: sha(statement) });
      if (!/\bvalues\b/i.test(tokens(statement).filter(t => !t.literal).map(t => t.text).join(""))) row.insertSelect = true;
      inventory.set(table, row);
    }
  }
  if (!steps.some(s => s.kind === "owned-historical-checkpoint")) throw new Error("B2 historical guard migration missing");
  const compatibility = spec.candidateCompatibilityStatementsNewTargetOnly;
  if (compatibility?.length !== 9 || compatibility.some(s => !/^(grant update\("[a-z_]+"\)on public\."[a-z_]+"to authenticated;|revoke execute on function public\.get_assistant_request\(uuid,uuid\)from service_role;)$/.test(s))) throw new Error("B2 exact compatibility profile invalid");
  steps.push(...compatibility.map(sql => ({ kind: "compatibility", sql, sha256: sha(sql), application: "only if effective catalog diff matches the reviewed new-target profile" })));
  const legacySource = read("supabase/migrations/0005_mission_submissions.sql"), budgetSource = read("supabase/migrations/0024_brand_budget.sql");
  if (!legacySource.includes("xp_awarded = xp_awarded + 25") || !legacySource.includes("xp = xp + 10")
    || !budgetSource.includes("xp_awarded = xp_awarded + 100 + v_bonus") || !budgetSource.includes("v_bonus := 50")) throw new Error("B2 legacy XP contract drift");
  const profile = { migrations, steps, seedInventory: [...inventory.values()], historicalLegacy: historical,
    legacyXp: { join: 10, submit: 25, ordinaryApproval: 100, fiveStarBonus: 50, testQualityRating: null, cumulative: 135, activeJoin: 10 },
    seedSqlAllowed: false, replayPolicy: "new empty volume only; 72 forward files; no reset/reapply; checkpoint before guard; baseline after full profile",
    baselinePolicy: "Capture exact IDs/row hashes after replay. Immutable migration seeds separate from the five explicit core-owned checkpoint rows; later fixtures must adopt these rows, not duplicate them." };
  return { ...profile, profileDigest: sha(JSON.stringify(profile)) };
}
