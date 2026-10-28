import { readFileSync, readdirSync } from "node:fs";
import { dirname } from "node:path";
import { FixtureJournal, durableJson } from "./fixture-journal.mjs";
function list(values) {
  if (!Array.isArray(values) || values.some(v => !/^[a-f0-9-]{36}$/i.test(v))) throw new Error("B2 inventory exact ID list invalid");
  return values.length ? values.map(v => `'${v}'`).join(",") : "null";
}
export function fixtureInventorySql(scopes, owned) {
  const workspaces = list(owned.workspaces ?? []), users = list(owned.auth_users ?? []), academy = list(owned.academy_content ?? []);
  const selectors = {
    workspace: `t.workspace_id in (${workspaces})`, "workspace-self": `t.id in (${workspaces})`,
    "auth-self": `t.id::text in (${users})`, "auth-user": `t.user_id::text in (${users})`, "creator": `t.creator_id in (${users})`,
    recipient: `t.recipient_id in (${users})`,
    "staff-command": `t.request_id in (select request_id from public.staff_access_audit where user_id in (${users}))`,
    conversation: `t.conversation_id in (select id from public.assistant_conversations where creator_id in (${users}))`,
    academy: `t.id in (${academy})`, lesson: `t.track_id in (${academy})`,
    storage: `t.owner_id::text in (${users})`,
    "auth-audit": `t.payload->>'actor_id' in (${users})`,
    "auth-session": `t.session_id in (select id from auth.sessions where user_id in (${users}))`,
    "auth-factor": `t.factor_id in (select id from auth.mfa_factors where user_id in (${users}))`,
  };
  const entries = Object.entries(scopes).map(([family, scope]) => {
    if (!/^[a-z_]+$/.test(family) || !/^(public|private|auth|storage)\.[a-z_]+$/.test(scope.relation)
      || !Array.isArray(scope.key) || scope.key.length === 0 || scope.key.some(k => !/^[a-z_]+$/.test(k))) throw new Error("B2 inventory relation/key invalid");
    const where = selectors[scope.selector]; if (!where) throw new Error("B2 inventory selector invalid");
    const key = scope.key.map(k => `coalesce(t.${k}::text,'')`).join("||':'||");
    return `'${family}',(select jsonb_build_object('count',count(*),'ids',coalesce(jsonb_agg(${key} order by ${key}),'[]'::jsonb),'rowHashes',coalesce(jsonb_object_agg(${key},md5(to_jsonb(t)::text)),'{}'::jsonb)) from ${scope.relation} t where ${where})`;
  });
  // PostgreSQL variadic functions accept at most 100 arguments; chunk the manifest.
  const chunks = []; for (let i = 0; i < entries.length; i += 40) chunks.push(`jsonb_build_object(${entries.slice(i, i + 40).join(",")})`);
  return `begin read only;select ${chunks.length ? chunks.join("||") : "'{}'::jsonb"};commit;`;
}
export function preflightB2FixtureShape(target) {
  if (!target.context) return;
  const scopes = target.context.manifest.fixture.rowScopes;
  if (!scopes || Object.keys(scopes).length === 0) throw new Error("B2 explicit inventory profile required before client/setup");
  // Empty exact-ID predicates resolve every required relation/column without reading other subjects.
  JSON.parse(target.sql(fixtureInventorySql(scopes, {workspaces:[],auth_users:[]})));
}
export function assertInventoryCaps(inventory, caps) {
  for (const [family, cap] of Object.entries(caps)) {
    if (family === "requests") continue;
    if (!inventory[family] || !Number.isInteger(inventory[family].count)) throw new Error(`B2 inventory missing family: ${family}`);
    if (inventory[family].count > cap) throw new Error(`B2 inventory row cap exceeded: ${family}`);
  }
}
export function captureB2Inventory(target) {
  const context = target.context; if (!context) return null;
  const journal = new FixtureJournal(context.privatePath("owned-journal.jsonl"), context.lineage, context.manifest.fixture.rowCaps[context.phase]);
  journal.assertReady();
  for (const name of readdirSync(dirname(context.privatePath("owned-journal.jsonl"))).filter(n => /^(?:(?:owner-)?transport-\d+|transport-browser-[a-z0-9-]+)\.jsonl$/.test(n))) {
    new FixtureJournal(context.privatePath(name), context.lineage, {requests:context.manifest.fixture.transportWriteCapPerProcess}).assertReady();
  }
  const owned = journal.owned();
  // Exact IDs only. This query returns opaque keys and hashes, never row contents, JWTs or emails.
  const inventory = JSON.parse(target.sql(fixtureInventorySql(context.manifest.fixture.rowScopes, owned)));
  assertInventoryCaps(inventory, context.manifest.fixture.rowCaps[context.phase]);
  durableJson(context.publicPath("fixture-inventory.json"), { lineage: context.lineage, target: target.identity, inventory, cleanupApproved: false, at: new Date().toISOString() });
  return inventory;
}
export function assertPhaseDependency(context, phase) {
  const result = context.assertLineage(JSON.parse(readFileSync(context.publicPath("phase-result.json", phase), "utf8")), phase);
  if (result.exitCode !== 0 || result.signal) throw new Error("B2 predecessor phase did not pass");
}
