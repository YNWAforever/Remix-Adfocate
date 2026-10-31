import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { expect } from "vitest";

export const ws = "00000000-0000-4000-8000-000000000001";
export const otherWs = "00000000-0000-4000-8000-000000000002";
export const actor = "00000000-0000-4000-8000-000000000011";
export const other = "00000000-0000-4000-8000-000000000012";
export const colleague = "00000000-0000-4000-8000-000000000013";
export const mission = "00000000-0000-4000-8000-000000000021";
export const submission = "00000000-0000-4000-8000-000000000031";
export const item = "00000000-0000-4000-8000-000000000041";
export const connectionId = "00000000-0000-4000-8000-000000000051";
export const resourceId = "00000000-0000-4000-8000-000000000061";
export const migrations = [
  "20261031120000_creator_integrations.sql",
  "20261031121000_studio_integration_evidence.sql",
  "20261031122000_integration_privacy_cleanup.sql",
];
// SQL JSON boundary, deliberately independent of service implementations; assertions
// below each call validate the returned shape rather than sharing production types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;
export const credential = { keyId: "fixture-key", iv: "synthetic-iv", ciphertext: "SYNTHETIC-CIPHERTEXT-NEVER-CACHE" };

export async function fixture() {
  // In-process PostgreSQL only; no environment URL, remote client, credentials or network.
  const db = await PGlite.create("memory://");
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema private;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
    create table public.workspaces(id uuid primary key);
    create table public.creators(id uuid primary key, workspace_id uuid, status text default 'active');
    grant select on public.creators to authenticated;
    create table public.missions(id uuid primary key, workspace_id uuid);
    create table public.assistant_conversations(id uuid primary key default gen_random_uuid(),creator_id uuid,workspace text,last_message_at timestamptz);
    create table public.assistant_messages(id uuid primary key default gen_random_uuid(),conversation_id uuid,role text,content text,citations jsonb,tool_calls jsonb default '[]',created_at timestamptz default now());
    create table public.mission_submissions(id uuid primary key,creator_id uuid,workspace_id uuid,mission_id uuid,status text);
    create table public.mission_workflows(id uuid primary key,mission_submission_id uuid,workspace_id uuid);
    create table public.mission_work_items(id uuid primary key,mission_workflow_id uuid,workspace_id uuid);
    create table public.mission_pending_rewards(id uuid primary key,creator_id uuid,workspace_id uuid,status text,mission_submission_id uuid);
    create table public.point_transactions(id uuid primary key default gen_random_uuid(),creator_id uuid,workspace_id uuid,type text,delta int,source_ref text);
    create table public.fixture_draft(id uuid primary key,caption text,revision int);
    -- Only the canonical draft dependency is substituted, as in studio.embedded.test.ts.
    create function private.save_active_mission_draft(uuid,uuid,uuid,uuid,integer,jsonb) returns jsonb language plpgsql as $$
    declare d public.fixture_draft; begin select * into d from public.fixture_draft where id=$4 for update;
      if d.revision<>$5 then return jsonb_build_object('code','WORKFLOW_STALE'); end if;
      update public.fixture_draft set caption=$6->>'caption',revision=revision+1 where id=$4 returning * into d;
      return jsonb_build_object('draft',to_jsonb(d)); end; $$;
    insert into public.workspaces values('${ws}'),('${otherWs}');
    insert into public.creators(id,workspace_id) values('${actor}','${ws}'),('${other}','${otherWs}'),('${colleague}','${ws}');
    insert into public.missions values('${mission}','${ws}');
    insert into public.mission_submissions values('${submission}','${actor}','${ws}','${mission}','joined');
    insert into public.mission_workflows values('${submission}','${submission}','${ws}');
    insert into public.mission_work_items values('${item}','${submission}','${ws}');
    insert into public.fixture_draft values('${item}','original',0);`);
  await db.exec(await readFile("supabase/migrations/20261022171843_audit_assistant_requests.sql", "utf8"));
  await db.exec(await readFile("supabase/migrations/20261030195424_creator_studio_private_artifacts.sql", "utf8"));
  const originalStudio = (await db.query<{ prosrc: string }>("select prosrc from pg_proc where oid='public.studio_command(uuid,uuid,uuid,text,jsonb)'::regprocedure")).rows[0].prosrc;
  const originalSettlement = (await db.query("select pg_get_functiondef('private.studio_settlement_badge()'::regprocedure) definition")).rows[0];
  for (const file of migrations) {
    // Missing new migration = observable RED tests, rather than a fixture import failure.
    const sql = await readFile(`supabase/migrations/${file}`, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (sql) await db.exec(sql);
  }
  return { db, originalStudio, originalSettlement };
}

export async function rpc(db: PGlite, action: string, payload: Row, request: string = crypto.randomUUID(), owner = actor, workspace = ws): Promise<Row> {
  return (await db.query<{ result: Row }>("select public.integration_command($1,$2,$3,$4,$5::jsonb) result", [workspace, owner, request, action, JSON.stringify(payload)])).rows[0].result;
}
export async function studio(db: PGlite, action: string, payload: Row, request: string = crypto.randomUUID()): Promise<Row> {
  return (await db.query<{ result: Row }>("select public.studio_command($1,$2,$3,$4,$5::jsonb) result", [ws, actor, request, action, JSON.stringify(payload)])).rows[0].result;
}
export async function scalar(db: PGlite, sql: string, args: unknown[] = []) {
  return (await db.query<{ n: number }>(sql, args)).rows[0].n;
}
export async function denied(db: PGlite, run: () => Promise<unknown>, message: string) {
  await db.exec("savepoint expected_denial");
  try { await expect(run()).rejects.toThrow(message); }
  finally { await db.exec("rollback to savepoint expected_denial; release savepoint expected_denial"); }
}
export function connection(overrides: Row = {}): Row {
  return { id: connectionId, workspaceId: ws, creatorId: actor, provider: "google_drive", subject: "synthetic-subject", label: "Synthetic Drive", status: "connected", scopes: ["https://www.googleapis.com/auth/drive.file"], generation: 1, lastSyncAt: null, expiresAt: "2099-01-01T00:00:00Z", lastError: null, sampleOnly: true, providerRevocation: "not_requested", consentVersion: "mock-v1", ...overrides };
}
export async function connect(db: PGlite, overrides: Row = {}, expectedGeneration = 0) {
  return rpc(db, "connect", { connection: connection(overrides), credential, expectedGeneration });
}
export function resource(overrides: Row = {}): Row {
  return { id: resourceId, connectionId, workspaceId: ws, creatorId: actor, generation: 1, externalId: "synthetic-file", title: "合成筆記", mimeType: "text/plain", version: "v1", selected: true, canDownload: true, rights: "owned", availability: "available", excerpt: "PRIVATE-SOURCE-EXCERPT", metrics: { reach: { value: null, availability: "missing", reason: "not_returned" }, views: { value: 0, availability: "available", reason: null } }, observedAt: "2026-10-31T01:00:00Z", fetchedAt: "2026-10-31T02:00:00Z", coverage: { region: null, language: null, partial: true }, contentHash: "synthetic-content-hash-v1", sizeBytes: 123, sampleOnly: true, ...overrides };
}
export async function resources(db: PGlite, records = [resource()], request?: string) {
  return rpc(db, "resources", { id: connectionId, generation: 1, resources: records }, request);
}
export async function imported(db: PGlite, options: Row = {}) {
  await connect(db);
  const synced = await resources(db, [resource(options.resource)]);
  const thread = await studio(db, "create_thread", { title: "Integration brief", topic: "creation", missionId: mission });
  const payload = { id: connectionId, generation: 1, threadId: thread.id, revision: 0, resourceIds: [resourceId], question: "What does this show?", modelConsent: true, processingRights: true, shareRights: true, ...options.import };
  const result = await rpc(db, "import", payload);
  return { source: result.sources[0] as Row, thread, payload, snapshotId: synced.resources[0].snapshotId };
}
export async function permit(db: PGlite, sourceIds: string[], use: string, commandPayload?: Row) {
  return rpc(db, "permit", { sourceIds, use, ...(commandPayload ? { commandPayload } : {}) });
}
export function briefPayload(threadId: string, sourceId: string, revision = 1): Row {
  return { threadId, revision, sections: [{ id: "hook", text: "DERIVED-PRIVATE-PARAGRAPH", sourceIds: [sourceId] }] };
}
export function sharePayload(threadId: string, briefId: string, revision = 2): Row {
  return { threadId, revision, briefId, sectionIds: ["hook"], submissionId: submission, workItemId: item, draftRevision: 0 };
}
