// @vitest-environment node
import { readFile } from "node:fs/promises";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";

// Function/transaction contracts only. The workflow function below is a narrow
// stub, not real workflow/Auth/RLS/Storage or multi-connection race evidence.
const target = Object.freeze({ storage: "memory://", transport: "in-process-wasm", network: "none" });
const A = "00000000-0000-4000-8000-0000000000aa", B = "00000000-0000-4000-8000-0000000000bb";
const actor = "00000000-0000-4000-8000-000000000011", other = "00000000-0000-4000-8000-000000000012";
const creator = "00000000-0000-4000-8000-000000000013", mission = "00000000-0000-4000-8000-000000000021";
const submission = "00000000-0000-4000-8000-000000000031", request = "00000000-0000-4000-8000-000000000041";
let db: PGlite;
const base = `
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create schema private; grant usage on schema private to service_role;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table public.workspaces(id uuid primary key,slug text,name text);
create table public.creators(id uuid primary key references auth.users(id),workspace_id uuid references public.workspaces(id),display_name text,level text default 'L0',scores jsonb default '{}',created_at timestamptz default now(),xp integer default 0);
create table public.staff_users(user_id uuid primary key,email text,active boolean);
create table public.brand_users(user_id uuid primary key,workspace_id uuid,email text,role text,active boolean);
create table public.staff_workspace_roles(user_id uuid,workspace_id uuid,role text,active boolean);
create table public.missions(id uuid primary key,workspace_id uuid,creator_workflow_mode text default 'active_workspace',filled integer default 0,quota integer default 1,status text default 'active',access_type text default 'application',deadline date);
create table public.mission_submissions(id uuid primary key,workspace_id uuid,mission_id uuid,creator_id uuid,status text constraint mission_submissions_status_check check(status in ('joined','submitted','approved')),content_urls text[] default '{}',reviewer_notes text,reviewed_at timestamptz,xp_awarded integer default 0);
create table public.mission_workflows(id uuid primary key default gen_random_uuid(),mission_submission_id uuid unique,state text default 'drafting');
create function public.create_mission_workflow(p_submission uuid) returns jsonb language plpgsql as $$
declare v jsonb; begin
insert into public.mission_workflows(mission_submission_id)values(p_submission)on conflict do nothing;
select to_jsonb(w)into v from public.mission_workflows w where mission_submission_id=p_submission;return v;end;$$;
insert into public.workspaces values('${A}','a','Test A'),('${B}','b','Test B');
insert into auth.users values('${actor}'),('${other}'),('${creator}');
insert into public.creators(id,workspace_id,display_name)values('${creator}','${A}','Test Creator');
insert into public.staff_users values('${actor}','operator-a@example.test',true),('${other}','operator-b@example.test',true);
insert into public.brand_users values('${actor}','${A}','operator-a@example.test','member',true),('${other}','${A}','operator-b@example.test','member',true);
insert into public.staff_workspace_roles values('${actor}','${A}','operator',true),('${other}','${A}','operator',true);
insert into public.missions(id,workspace_id)values('${mission}','${A}');
`;
async function value<T>(sql: string, params: unknown[] = []): Promise<T> { return (await db.query<{ value: T }>(sql, params)).rows[0]?.value; }
const sql = "select public.decide_mission_application($1,$2,$3,$4,$5,$6,$7)as value";
const args = (action = "accept", notes: string | null = null, who = actor, id = request) => [A, who, submission, id, 0, action, notes];
async function rejected(command: string, params: unknown[], message: string) {
  await db.exec("savepoint expected_failure"); await expect(db.query(command, params)).rejects.toThrow(message); await db.exec("rollback to savepoint expected_failure");
}
async function counts() { return value<{ xp: number; filled: number; receipts: number; audit: number; workflows: number; status: string }>(`select jsonb_build_object(
'xp',(select xp from public.creators where id='${creator}'),'filled',(select filled from public.missions where id='${mission}'),
'receipts',(select count(*)from public.operator_crm_command_receipts),'audit',(select count(*)from public.operator_audit_events),
'workflows',(select count(*)from public.mission_workflows),'status',(select status from public.mission_submissions where id='${submission}'))as value`); }
beforeAll(async () => {
  expect(target).toEqual({ storage: "memory://", transport: "in-process-wasm", network: "none" });
  const { PGlite: Engine } = await import("@electric-sql/pglite"); db = await Engine.create(target.storage); await db.exec(base);
  for (const file of ["0013_operator_creator_selection_crm.sql", "0010_applications.sql", "20261022170751_audit_crm_commands.sql", "20261025120934_application_decisions.sql"]) await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
  await db.exec(`insert into public.mission_submissions(id,workspace_id,mission_id,creator_id,status)values('${submission}','${A}','${mission}','${creator}','applied')`);
}, 60000);
beforeEach(async () => { await db.exec("begin"); }); afterEach(async () => { await db.exec("rollback"); }); afterAll(async () => { await db?.close(); });

describe("UC-C25/UC-A10 owned-memory application command", () => {
  it("records actor/time, one workflow, audit and receipt while retaining the original one-time XP/quota semantics", async () => {
    const first = await value<{ decision: { actorId: string; decidedAt: string } }>(sql, args());
    expect(first.decision.actorId).toBe(actor); expect(Date.parse(first.decision.decidedAt)).not.toBeNaN();
    expect(await value(sql, args())).toEqual(first);
    expect(await counts()).toEqual({ xp: 10, filled: 1, receipts: 1, audit: 1, workflows: 1, status: "joined" });
  });
  it("persists a decline reason without quota, workflow or XP changes", async () => {
    const result = await value<{ decision: { action: string; reason: string } }>(sql, args("decline", "Please improve the portfolio"));
    expect(result.decision).toMatchObject({ action: "decline", reason: "Please improve the portfolio" });
    expect(await value(sql, args("decline", "Please improve the portfolio"))).toEqual(result);
    expect(await counts()).toEqual({ xp: 0, filled: 0, receipts: 1, audit: 1, workflows: 0, status: "declined" });
  });
  it("returns the winning decision to another operator without changing the legal terminal state", async () => {
    const first = await value<{ decision: unknown }>(sql, args());
    const second = await value(sql, args("decline", "Retained local reason", other));
    expect(second).toEqual({ conflict: true, decision: first.decision });
    expect(await counts()).toEqual({ xp: 10, filled: 1, receipts: 1, audit: 1, workflows: 1, status: "joined" });
  });
  it("rejects key reuse with a different payload and keeps the first reason", async () => {
    await value(sql, args("decline", "First reason"));
    await rejected(sql, args("decline", "Another reason"), "IDEMPOTENCY_CONFLICT");
    expect(await value("select reviewer_notes as value from public.mission_submissions where id=$1", [submission])).toBe("First reason");
  });
  it("rolls back acceptance, quota, XP, workflow and receipt when the audit insert fails", async () => {
    await db.exec("create function private.audit_fault()returns trigger language plpgsql as $$begin raise exception 'test audit outage';end;$$;create trigger test_audit_fault before insert on public.operator_audit_events for each row execute function private.audit_fault()");
    await rejected(sql, args(), "test audit outage");
    expect(await counts()).toEqual({ xp: 0, filled: 0, receipts: 0, audit: 0, workflows: 0, status: "applied" });
  });
  it("rolls back the application when workflow creation fails", async () => {
    await db.exec("create function private.workflow_fault()returns trigger language plpgsql as $$begin raise exception 'test workflow outage';end;$$;create trigger test_workflow_fault before insert on public.mission_workflows for each row execute function private.workflow_fault()");
    await rejected(sql, args(), "test workflow outage");
    expect(await counts()).toEqual({ xp: 0, filled: 0, receipts: 0, audit: 0, workflows: 0, status: "applied" });
  });
  it("checks live membership/capability even on exact receipt replay", async () => {
    await value(sql, args()); await db.query("update public.brand_users set active=false where user_id=$1", [actor]);
    await rejected(sql, args(), "FORBIDDEN");
    await db.query("update public.brand_users set active=true where user_id=$1", [actor]);
    await db.query("update public.staff_workspace_roles set role='finance_viewer'where user_id=$1", [actor]);
    await rejected(sql, args(), "FORBIDDEN");
  });
  it("does not invent an actor/time or rewrite a historical processed row", async () => {
    await db.query("update public.mission_submissions set status='joined'where id=$1", [submission]);
    expect(await value(sql, args())).toMatchObject({ conflict: true, decision: { actorId: null, decidedAt: null, historicalUnknown: true } });
    expect(await counts()).toEqual({ xp: 0, filled: 0, receipts: 0, audit: 0, workflows: 0, status: "joined" });
  });
  it("denies cross-workspace targets and direct authenticated execution", async () => {
    await rejected(sql, [B, actor, ...args().slice(2)], "FORBIDDEN");
    await db.exec("set local role authenticated"); await rejected(sql, args(), "permission denied");
  });
  it("lets only the service role execute a command with the independently checked staff scope", async () => {
    await db.exec("set local role service_role");
    expect(await value(sql, args())).toMatchObject({ decision: { actorId: actor, revision: 1 } });
    await db.exec("reset role");
    expect(await counts()).toEqual({ xp: 10, filled: 1, receipts: 1, audit: 1, workflows: 1, status: "joined" });
  });
});
