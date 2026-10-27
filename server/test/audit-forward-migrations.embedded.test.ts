// @vitest-environment node
import { readFile } from "node:fs/promises";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";

// Local SQL contract target, not a Supabase/Auth/browser rehearsal. No URL, proxy,
// host, filesystem data directory, credential, or fixture cleanup is configurable.
const target = Object.freeze({ storage: "memory://", transport: "in-process-wasm", network: "none" });
const A = "00000000-0000-4000-8000-0000000000aa";
const B = "00000000-0000-4000-8000-0000000000bb";
const staff = "00000000-0000-4000-8000-000000000011";
const otherStaff = "00000000-0000-4000-8000-000000000012";
const creator = "00000000-0000-4000-8000-000000000013";
const otherCreator = "00000000-0000-4000-8000-000000000014";
const mission = "00000000-0000-4000-8000-000000000021";
const submission = "00000000-0000-4000-8000-000000000031";
const request = "00000000-0000-4000-8000-000000000041";
const secondRequest = "00000000-0000-4000-8000-000000000042";
let db: PGlite;
const base = `
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create schema private; grant usage on schema private to service_role;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
create table public.workspaces(id uuid primary key,slug text,name text);
create table public.creators(id uuid primary key references auth.users(id),workspace_id uuid references public.workspaces(id),display_name text,level text default 'L0',scores jsonb default '{}',created_at timestamptz default now());
create table public.staff_users(user_id uuid primary key,email text,active boolean);
create table public.brand_users(user_id uuid primary key,workspace_id uuid,email text,role text,active boolean);
create table public.missions(id uuid primary key,workspace_id uuid,creator_workflow_mode text default 'legacy');
create table public.mission_submissions(id uuid primary key,workspace_id uuid,mission_id uuid,creator_id uuid,status text,content_urls text[],reviewer_notes text,reviewed_at timestamptz);
create table public.creator_social_accounts(id uuid primary key,creator_id uuid,workspace_id uuid,sync_status text,api_synced_at timestamptz);
create table public.assistant_conversations(id uuid primary key default gen_random_uuid(),creator_id uuid references auth.users(id),workspace text,started_at timestamptz default now(),last_message_at timestamptz default now());
create table public.assistant_messages(id uuid primary key default gen_random_uuid(),conversation_id uuid references public.assistant_conversations(id),role text,content text,citations jsonb default '[]',tool_calls jsonb default '[]',created_at timestamptz default now());
insert into public.workspaces values('${A}','a','Synthetic A'),('${B}','b','Synthetic B');
insert into auth.users values('${staff}'),('${otherStaff}'),('${creator}'),('${otherCreator}');
insert into public.creators(id,workspace_id,display_name) values('${creator}','${A}','Synthetic Creator A'),('${otherCreator}','${B}','Synthetic Creator B');
insert into public.staff_users values('${staff}','synthetic-a@example.test',true),('${otherStaff}','synthetic-b@example.test',true);
insert into public.brand_users values('${staff}','${A}','synthetic-a@example.test','member',true),('${otherStaff}','${B}','synthetic-b@example.test','member',true);
insert into public.missions values('${mission}','${A}','legacy');
-- Historical invalid row exists BEFORE the new migration. Never rewrite it during migration.
insert into public.mission_submissions values('${submission}','${A}','${mission}','${creator}','submitted',array['wwww'],'historical reason',null);
`;
async function value<T>(sql: string, params: unknown[] = []): Promise<T> {
  const result = await db.query<{ value: T }>(sql, params); return result.rows[0]?.value;
}
async function count(table: string) { return Number(await value(`select count(*)::integer as value from public.${table}`)); }
async function rejected(sql: string, params: unknown[], message: string) {
  await db.exec("savepoint expected_failure");
  await expect(db.query(sql, params)).rejects.toThrow(message);
  await db.exec("rollback to savepoint expected_failure");
}
const reviewSql = "select public.apply_creator_review_command($1,$2,$3,$4,$5,'approved','low','synthetic summary',$6) as value";
const reviewArgs = [A, staff, request, 0, creator, "synthetic note"];
const reserveSql = "select public.reserve_assistant_request($1,$2,$3,$4,'en',null,'r1') as value";
const reserveArgs = [A, creator, request, "Synthetic message"];

beforeAll(async () => {
  // Identity established before importing or constructing the engine. This literal
  // target cannot resolve to a server or a shared filesystem database.
  expect(target).toEqual({ storage: "memory://", transport: "in-process-wasm", network: "none" });
  const { PGlite: Engine } = await import("@electric-sql/pglite");
  db = await Engine.create(target.storage);
  await db.exec(base);
  await db.exec(await readFile("supabase/migrations/0013_operator_creator_selection_crm.sql", "utf8"));
  for (const file of ["20261022170454_audit_legacy_evidence.sql", "20261022170751_audit_crm_commands.sql", "20261022171111_audit_creator_queue.sql", "20261022171843_audit_assistant_requests.sql", "20261022182544_audit_legacy_review_notes.sql"]) {
    await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
  }
}, 60000);
beforeEach(async () => { await db.exec("begin"); });
afterEach(async () => { await db?.exec("rollback"); });
afterAll(async () => { await db?.close(); });

describe("forward SQL contracts on an owned memory engine", () => {
  it("preserves historical invalid evidence and blocks ordinary approval", async () => {
    expect(await value("select content_urls[1] as value from public.mission_submissions where id=$1", [submission])).toBe("wwww");
    await rejected("update public.mission_submissions set status='approved' where id=$1", [submission], "invalid_evidence");
    expect(await value("select status as value from public.mission_submissions where id=$1", [submission])).toBe("submitted");
  });
  it("returns invalid evidence for correction once, preserving the old reason and URLs", async () => {
    const sql = "select public.request_legacy_evidence_correction($1,$2,$3,$4,0,'Replace the work URL') as value";
    const args = [A, staff, submission, request];
    const first = await value(sql, args); expect(await value(sql, args)).toEqual(first);
    expect(await count("legacy_evidence_corrections")).toBe(1);
    expect(await value("select previous_evidence->>'review_notes' as value from public.legacy_evidence_corrections")).toBe("historical reason");
    await db.query("update public.mission_submissions set content_urls=array['https://example.test/work'],status='submitted' where id=$1", [submission]);
    await db.query("update public.mission_submissions set status='approved' where id=$1", [submission]);
    expect(await value("select status as value from public.mission_submissions where id=$1", [submission])).toBe("approved");
  });
  it("rolls back review, note and receipt when the audit insert fails", async () => {
    await db.exec("create function private.inject_audit_failure() returns trigger language plpgsql as $$begin raise exception 'injected audit outage'; end;$$; create trigger synthetic_audit_fault before insert on public.operator_audit_events for each row execute function private.inject_audit_failure();");
    await rejected(reviewSql, reviewArgs, "injected audit outage");
    expect(await count("creator_review_statuses")).toBe(0); expect(await count("creator_review_notes")).toBe(0); expect(await count("operator_crm_command_receipts")).toBe(0);
  });
  it("replays one receipt and rejects payload reuse and stale revision", async () => {
    const first = await value(reviewSql, reviewArgs); expect(await value(reviewSql, reviewArgs)).toEqual(first);
    expect(await count("creator_review_notes")).toBe(1); expect(await count("operator_audit_events")).toBe(2);
    await rejected(reviewSql, [A, staff, request, 0, creator, "different note"], "IDEMPOTENCY_CONFLICT");
    await rejected(reviewSql, [A, staff, secondRequest, 0, creator, "synthetic note"], "CRM_STALE");
  });
  it("deduplicates an independent note command", async () => {
    const sql="select public.add_creator_review_note_command($1,$2,$3,0,$4,'other','Synthetic note') as value";
    const args=[A,staff,request,creator]; const first=await value(sql,args);
    expect(await value(sql,args)).toEqual(first); expect(await count("creator_review_notes")).toBe(1);
    expect(await count("operator_audit_events")).toBe(1);
  });
  it("does not let a browser role claim that a provider generation started", async () => {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[creator]);
    await value(reserveSql,reserveArgs); await db.exec("set local role authenticated");
    await rejected("select public.claim_assistant_request($1,$2,$3)",[A,creator,request],"permission denied");
  });
  it("enforces database workspace scope independently of the HTTP route", async () => {
    await rejected(reviewSql, [A, otherStaff, request, 0, creator, "synthetic note"], "FORBIDDEN");
    await rejected(reviewSql, [A, staff, request, 0, otherCreator, "synthetic note"], "creator_not_found");
    expect(await count("operator_crm_command_receipts")).toBe(0);
  });
  it("paginates 51 tied rows without leaking workspace B or losing the final creator", async () => {
    await db.exec(`insert into auth.users select ('10000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid from generate_series(1,50) i;
      insert into public.creators(id,workspace_id,display_name) select id,'${A}','Queue synthetic' from auth.users where id::text like '10000000-%';`);
    const sql = "select public.list_creator_review_queue_page($1,$2,null,'',null,null,'level',$3) as value";
    const pages = await Promise.all([1,2,3].map((page) => value<{ creatorIds: string[]; total: number }>(sql, [A, staff, page])));
    expect(pages.map((page) => page.creatorIds.length)).toEqual([25,25,1]);
    expect(pages.every((page) => page.total === 51)).toBe(true);
    expect(new Set(pages.flatMap((page) => page.creatorIds)).size).toBe(51);
    expect(pages.flatMap((page) => page.creatorIds)).not.toContain(otherCreator);
  });
  it("claims a generation once and atomically persists/replays the pair of turns", async () => {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [creator]);
    await value(reserveSql, reserveArgs);
    expect(await value("select public.claim_assistant_request($1,$2,$3) as value", [A,creator,request])).toBe(true);
    expect(await value("select public.claim_assistant_request($1,$2,$3) as value", [A,creator,request])).toBe(false);
    const save = "select public.save_assistant_turn($1,$2,$3,'Synthetic answer','[]') as value";
    const first = await value(save, [A,creator,request]); expect(await value(save, [A,creator,request])).toEqual(first);
    expect(await count("assistant_messages")).toBe(2); expect(await count("assistant_conversations")).toBe(1);
    expect(await value<{ action: string }>(reserveSql,reserveArgs)).toMatchObject({action:"replay"});
  });
  it("rolls back both messages and a new conversation on a persistence fault", async () => {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [creator]);
    await value(reserveSql,reserveArgs); await value("select public.claim_assistant_request($1,$2,$3) as value",[A,creator,request]);
    await db.exec("create function private.inject_message_failure() returns trigger language plpgsql as $$begin if new.role='assistant' then raise exception 'injected message outage'; end if; return new; end;$$; create trigger synthetic_message_fault before insert on public.assistant_messages for each row execute function private.inject_message_failure();");
    await rejected("select public.save_assistant_turn($1,$2,$3,'Synthetic answer','[]')",[A,creator,request],"injected message outage");
    expect(await count("assistant_messages")).toBe(0); expect(await count("assistant_conversations")).toBe(0);
    expect(await value<{action:string}>(reserveSql,reserveArgs)).toMatchObject({action:"wait"});
  });
  it("enforces shared in-flight/quota records and creator ownership", async () => {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[creator]);
    await value(reserveSql,reserveArgs);
    await rejected(reserveSql,[A,creator,secondRequest,"second"],"REQUEST_INFLIGHT");
    for (let i=1;i<=5;i++) {
      const id=`00000000-0000-4000-8000-${String(40+i).padStart(12,"0")}`;
      if(i>1) await value(reserveSql,[A,creator,id,"Synthetic message"]);
      await value("select public.claim_assistant_request($1,$2,$3) as value",[A,creator,id]);
      await db.query("select public.mark_assistant_request_unknown($1,$2,$3)",[A,creator,id]);
    }
    await rejected(reserveSql,[A,creator,"00000000-0000-4000-8000-000000000049","sixth"],"RATE_LIMITED");
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[otherCreator]);
    expect(await value("select public.get_assistant_request($1,$2) as value",[A,request])).toBeNull();
    await rejected(reserveSql,[A,otherCreator,request,"Synthetic message"],"FORBIDDEN");
  });
});
