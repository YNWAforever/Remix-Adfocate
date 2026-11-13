// @vitest-environment node
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
// @ts-expect-error The existing executable SQL parser has no declaration file.
import { topLevelStatements } from "../../scripts/audit/b2-bootstrap-profile.mjs";

// Actual assignment/workflow/decision SQL on one owned memory connection. The
// supporting schema is reduced and refresh only returns the workflow. This
// does not verify hosted Auth/RLS/Storage or independent-connection concurrency.
const migration = "20261113090001_active_assignment_xp_neutrality.sql";
const workspace = "00000000-0000-4000-8000-0000000000aa";
const otherWorkspace = "00000000-0000-4000-8000-0000000000bb";
const creator = "00000000-0000-4000-8000-000000000011";
const otherCreator = "00000000-0000-4000-8000-000000000012";
const operator = "00000000-0000-4000-8000-000000000013";
let db: PGlite;
let priorAcl: unknown;
const base = `
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create schema private;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('role',current_setting('request.jwt.claim.role',true))$$;
create table public.workspaces(id uuid primary key);
create table public.creators(id uuid primary key,workspace_id uuid not null,level text default 'L0',xp integer default 217);
create table public.creator_social_accounts(creator_id uuid,owner_verified boolean);
create table public.staff_users(user_id uuid primary key,email text,active boolean);
create table public.brand_users(user_id uuid,workspace_id uuid,active boolean);
create table public.staff_workspace_roles(user_id uuid,workspace_id uuid,role text,active boolean);
create table public.missions(id uuid primary key,workspace_id uuid not null,status text default 'active',access_type text default 'open',deadline date,
  required_level text default 'L0',quota integer default 1,filled integer default 0,creator_workflow_mode text default 'active_workspace',
  points_reward integer default 350,cash_reward numeric default 12.50,updated_at timestamptz default '2026-11-01T00:00:00Z',
  fulfillment_required boolean default false,revision_limit integer default 2,review_sla_hours integer default 48,revision_response_hours integer default 48,
  unique(id,workspace_id));
create table public.mission_submissions(id uuid primary key default gen_random_uuid(),mission_id uuid,creator_id uuid,workspace_id uuid,status text constraint mission_submissions_status_check check(status in ('joined','submitted','approved')),
  xp_awarded integer default 0,reviewer_notes text,reviewed_at timestamptz,unique(mission_id,creator_id),unique(id,workspace_id),
  foreign key(mission_id,workspace_id) references public.missions(id,workspace_id));
create table public.mission_workflows(id uuid primary key default gen_random_uuid(),workspace_id uuid,mission_submission_id uuid unique,state text,
  accepted_at timestamptz,deadline timestamptz,fulfillment_required boolean,revision_limit integer,review_sla_hours integer,revision_response_hours integer);
create table public.mission_deliverable_templates(id uuid primary key default gen_random_uuid(),mission_id uuid,workspace_id uuid,required boolean default true,
  title text default 'Required post',platform text default 'instagram',position integer default 0,draft_due_offset_hours integer);
create table public.mission_deliverable_requirements(id uuid primary key,mission_deliverable_template_id uuid,workspace_id uuid,
  category text,requirement_text text,required boolean,position integer);
create table public.mission_work_items(id uuid primary key default gen_random_uuid(),workspace_id uuid,mission_workflow_id uuid,source_template_id uuid,
  title text,platform text,requirements_snapshot jsonb,required boolean,position integer,deadline timestamptz,state text);
create table public.mission_working_drafts(workspace_id uuid,mission_work_item_id uuid);
create table public.mission_fulfillments(workspace_id uuid,mission_workflow_id uuid,status text);
create table public.mission_workflow_events(workspace_id uuid,mission_workflow_id uuid,actor_type text,actor_id uuid,event_type text,
  entity_type text,entity_id uuid,metadata jsonb);
create function private.refresh_mission_workflow_state(p_workflow uuid) returns public.mission_workflows language sql as $$
  select * from public.mission_workflows where id=p_workflow$$;
create table public.operator_crm_command_receipts(workspace_id uuid,operator_id uuid,request_id uuid,payload_hash text,result jsonb,
  primary key(workspace_id,operator_id,request_id));
create table public.operator_audit_events(id uuid default gen_random_uuid(),workspace_id uuid,operator_id text,actor_label text,event_type text,
  target_type text,target_id text,creator_id uuid,metadata jsonb,created_at timestamptz default now());
-- Detect even an UPDATE OF xp/xp_awarded that assigns the same value.
create table public.test_xp_writes(kind text);
create function private.test_xp_write() returns trigger language plpgsql as $$begin
  insert into public.test_xp_writes values(TG_TABLE_NAME);return new;end;$$;
create trigger creator_xp_write after update of xp on public.creators for each row execute function private.test_xp_write();
create trigger anchor_xp_write after update of xp_awarded on public.mission_submissions for each row execute function private.test_xp_write();
insert into public.workspaces values('${workspace}'),('${otherWorkspace}');
insert into public.creators(id,workspace_id)values('${creator}','${workspace}'),('${otherCreator}','${otherWorkspace}');
insert into public.staff_users values('${operator}','operator@example.test',true);
insert into public.brand_users values('${operator}','${workspace}',true);
insert into public.staff_workspace_roles values('${operator}','${workspace}','operator',true);
`;
async function value<T = unknown>(sql: string, params: unknown[] = []): Promise<T> {
  return (await db.query<{ value: T }>(sql, params)).rows[0]?.value;
}
async function loadFunction(file: string, name: string, last = false) {
  const statements = topLevelStatements(await readFile(`supabase/migrations/${file}`, "utf8")) as string[];
  const matches = statements.filter(sql => sql.toLowerCase().startsWith(`create or replace function ${name}(`));
  expect(matches.length, name).toBeGreaterThan(0);
  await db.exec(matches[last ? matches.length - 1 : 0]!);
}
async function identity(role: "authenticated" | "service_role" = "authenticated", user = creator) {
  await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true)", [user, role]);
}
async function seed(mode: string | null = "active_workspace", access = "open", ws = workspace) {
  const id = randomUUID();
  await db.query("insert into public.missions(id,workspace_id,creator_workflow_mode,access_type) values($1,$2,$3,$4)", [id, ws, mode, access]);
  await db.query("insert into public.mission_deliverable_templates(mission_id,workspace_id)values($1,$2)", [id, ws]);
  return id;
}
async function apply(mission: string, xp = 0) {
  const id = randomUUID();
  await db.query("insert into public.mission_submissions(id,mission_id,creator_id,workspace_id,status,xp_awarded)values($1,$2,$3,$4,'applied',$5)", [id, mission, creator, workspace, xp]);
  return id;
}
async function rejected(sql: string, params: unknown[], message: string) {
  await db.exec("savepoint expected_failure");
  await expect(db.query(sql, params)).rejects.toThrow(message);
  await db.exec("rollback to savepoint expected_failure; release savepoint expected_failure");
}
async function snapshot() {
  return value(`select jsonb_build_object('xp',(select xp from public.creators where id='${creator}'),
    'awarded',coalesce((select sum(xp_awarded) from public.mission_submissions),0),'filled',coalesce((select sum(filled)from public.missions),0),
    'submissions',(select count(*)from public.mission_submissions),'workflows',(select count(*)from public.mission_workflows),
    'contracts',(select count(*)from public.mission_reward_contracts),'receipts',(select count(*)from public.operator_crm_command_receipts),
    'audit',(select count(*)from public.operator_audit_events),'xpWrites',(select count(*)from public.test_xp_writes))as value`);
}
const aclSql = `select jsonb_agg(jsonb_build_object('name',p.oid::regprocedure::text,'acl',p.proacl,'definer',p.prosecdef,'config',p.proconfig)order by p.oid::regprocedure::text)as value
  from pg_proc p where p.oid in ('private.join_mission(uuid)'::regprocedure,'public.accept_application(uuid)'::regprocedure)`;
const decisionSql = "select public.decide_mission_application($1,$2,$3,$4,0,'accept',null)as value";
const decisionArgs = (submission: string, request = randomUUID()) => [workspace, operator, submission, request];

beforeAll(async () => {
  db = await (await import("@electric-sql/pglite")).PGlite.create("memory://");
  await db.exec(base);
  await loadFunction("0005_mission_submissions.sql", "public.level_ordinal");
  await db.exec(await readFile("supabase/migrations/0010_applications.sql", "utf8"));
  await loadFunction("20260715163350_active_mission_workspace.sql", "private.create_mission_workflow", true);
  await loadFunction("20260715163350_active_mission_workspace.sql", "public.create_mission_workflow", true);
  await loadFunction("20260715163350_active_mission_workspace.sql", "private.raise_immutable_record");
  const contractSql = topLevelStatements(await readFile("supabase/migrations/20260731100000_reward_handoff_schema.sql", "utf8")) as string[];
  await db.exec(contractSql.find(sql => sql.startsWith("create table public.mission_reward_contracts ("))!);
  await db.exec("create trigger reward_contract_immutable before update or delete on public.mission_reward_contracts for each row execute function private.raise_immutable_record()");
  for (const name of ["private.join_mission", "public.join_mission", "public.join_active_mission"]) {
    await loadFunction("20260805120000_review_hardening.sql", name);
  }
  await db.exec(await readFile("supabase/migrations/20261029120000_application_reward_contract.sql", "utf8"));
  await db.exec(`revoke all on function private.join_mission(uuid),private.create_mission_workflow(uuid)from public,anon,authenticated,service_role;
    revoke all on function public.join_active_mission(uuid)from public,anon,authenticated,service_role;
    revoke all on function public.join_mission(uuid),public.create_mission_workflow(uuid)from public,anon;
    grant execute on function public.join_mission(uuid),public.create_mission_workflow(uuid)to authenticated,service_role;
    grant execute on function public.join_active_mission(uuid)to authenticated;`);
  priorAcl = await value(aclSql);
  // Historical earned awards precede the migration and must survive its application.
  const historicalMission = await seed();
  const historical = await apply(historicalMission, 93);
  await db.query("update public.mission_submissions set status='joined'where id=$1", [historical]);
  const before = await snapshot();
  await db.exec(await readFile(`supabase/migrations/${migration}`, "utf8"));
  expect(await snapshot()).toEqual(before);
  await db.query("delete from public.mission_submissions where id=$1", [historical]);
  await db.query("delete from public.mission_deliverable_templates where mission_id=$1", [historicalMission]);
  await db.query("delete from public.missions where id=$1", [historicalMission]);
}, 60000);
beforeEach(async () => { await db.exec("begin"); await identity(); });
afterEach(async () => { await db?.exec("rollback"); });
afterAll(async () => { await db?.close(); });

describe("active assignment XP neutrality on offline PostgreSQL", () => {
  it("keeps existing function ACLs, search paths and definer settings exactly", async () => {
    expect(await value(aclSql)).toEqual(priorAcl);
    for (const role of ["anon", "authenticated", "service_role"]) {
      await db.exec(`set local role ${role}`);
      await rejected("select private.join_mission($1)", [randomUUID()], "permission denied");
      if (role !== "service_role") await rejected("select public.accept_application($1)", [randomUUID()], "permission denied");
      if (role !== "authenticated") await rejected("select public.join_active_mission($1)", [randomUUID()], "permission denied");
      await db.exec("reset role");
    }
  });

  it("creates a neutral active assignment, actual workflow/items and immutable reward snapshot", async () => {
    const mission = await seed();
    await db.exec("set local role authenticated");
    const result = await value<{ submission: { id: string; xp_awarded: number }; rewardContract: { id: string; points_amount: number; cash_amount: number; xp_amount: number } }>("select public.join_active_mission($1)as value", [mission]);
    await db.exec("reset role");
    expect(result.submission.xp_awarded).toBe(0);
    expect(result.rewardContract).toMatchObject({ points_amount: 350, cash_amount: 12.5, xp_amount: 0 });
    expect(await snapshot()).toMatchObject({ xp: 217, awarded: 0, filled: 1, submissions: 1, workflows: 1, contracts: 1, xpWrites: 0 });
    expect(await value("select count(*)::int as value from public.mission_work_items")).toBe(1);
    await db.query("update public.missions set points_reward=999,cash_reward=99 where id=$1", [mission]);
    expect(await value("select to_jsonb(c)as value from public.mission_reward_contracts c")).toEqual(result.rewardContract);
    await rejected("update public.mission_reward_contracts set points_amount=999", [], "immutable_record");
    const before = await snapshot();
    await rejected("select public.join_active_mission($1)", [mission], "already_joined");
    expect(await snapshot()).toEqual(before);
  });

  it.each(["legacy", null])("preserves +10 legacy join behavior for mode %s", async mode => {
    const mission = await seed(mode);
    expect(await value("select to_jsonb(public.join_mission($1))as value", [mission])).toMatchObject({ xp_awarded: 10, status: "joined" });
    expect(await snapshot()).toMatchObject({ xp: 227, awarded: 10, filled: 1, xpWrites: 1 });
  });

  it("leaves the legacy public join gate and active-wrapper legacy rollback intact", async () => {
    const active = await seed();
    await rejected("select public.join_mission($1)", [active], "workflow_mode_mismatch");
    const legacy = await seed("legacy");
    const before = await snapshot();
    await rejected("select public.join_active_mission($1)", [legacy], "legacy_mission");
    expect(await snapshot()).toEqual(before);
  });

  it.each([
    ["status='closed'", "closed"], ["deadline=current_date-1", "closed"],
    ["access_type='application'", "not_open"], ["required_level='L1'", "level_locked"],
    ["quota=0", "mission_full"],
  ])("retains open join gate %s", async (update, message) => {
    const mission = await seed();
    await db.query(`update public.missions set ${update} where id=$1`, [mission]);
    const before = await snapshot();
    await rejected("select public.join_active_mission($1)", [mission], message);
    expect(await snapshot()).toEqual(before);
  });

  it("enforces authentication, tenant and verified-handle gates without XP writes", async () => {
    const mission = await seed();
    const before = await snapshot();
    await identity("authenticated", "");
    await rejected("select public.join_active_mission($1)", [mission], "not_authenticated");
    await identity("authenticated", otherCreator);
    await rejected("select public.join_active_mission($1)", [mission], "not_found");
    await identity();
    await db.query("update public.creators set level='L2'where id=$1", [creator]);
    await db.query("update public.missions set required_level='L2'where id=$1", [mission]);
    await rejected("select public.join_active_mission($1)", [mission], "verification_required");
    expect(await snapshot()).toEqual(before);
    await db.query("insert into public.creator_social_accounts values($1,true)", [creator]);
    await value("select public.join_active_mission($1)as value", [mission]);
    expect(await snapshot()).toMatchObject({ xp: 217, awarded: 0, xpWrites: 0 });
  });

  it.each([0, 93])("accepts active applications preserving prior anchor XP %s and exact replay", async xp => {
    const mission = await seed("active_workspace", "application");
    const submission = await apply(mission, xp);
    await identity("service_role", "");
    await db.exec("set local role service_role");
    const accepted = await value("select to_jsonb(public.accept_application($1))as value", [submission]);
    expect(accepted).toMatchObject({ status: "joined", xp_awarded: xp });
    expect(await value("select to_jsonb(public.accept_application($1))as value", [submission])).toEqual(accepted);
    await db.exec("reset role");
    expect(await snapshot()).toMatchObject({ xp: 217, awarded: xp, filled: 1, xpWrites: 0 });
  });

  it.each(["legacy", null])("preserves one-time legacy acceptance +10 for mode %s", async mode => {
    const mission = await seed(mode, "application");
    const submission = await apply(mission, 93);
    const accepted = await value("select to_jsonb(public.accept_application($1))as value", [submission]);
    expect(accepted).toMatchObject({ status: "joined", xp_awarded: 103 });
    expect(await value("select to_jsonb(public.accept_application($1))as value", [submission])).toEqual(accepted);
    expect(await snapshot()).toMatchObject({ xp: 227, awarded: 103, filled: 1, xpWrites: 2 });
  });

  it("runs the latest staff decision wrapper with neutral XP, frozen contract, audit and receipt replay", async () => {
    const mission = await seed("active_workspace", "application");
    const submission = await apply(mission);
    await identity("service_role", "");
    await db.exec("set local role service_role");
    const args = decisionArgs(submission);
    const first = await value(decisionSql, args);
    expect(await value(decisionSql, args)).toEqual(first);
    await db.exec("reset role");
    expect(first).toMatchObject({ submission: { xp_awarded: 0 }, decision: { action: "accept", actorId: operator } });
    expect(await snapshot()).toMatchObject({ xp: 217, awarded: 0, filled: 1, workflows: 1, contracts: 1, receipts: 1, audit: 1, xpWrites: 0 });
    const frozen = await value("select to_jsonb(c)as value from public.mission_reward_contracts c");
    expect(frozen).toMatchObject({ xp_amount: 0, points_amount: 350, cash_amount: 12.5, source: "join" });
    await db.query("update public.missions set points_reward=999 where id=$1", [mission]);
    expect(await value("select to_jsonb(c)as value from public.mission_reward_contracts c")).toEqual(frozen);
    await db.query("update public.brand_users set active=false where user_id=$1", [operator]);
    await rejected(decisionSql, args, "FORBIDDEN");
  });

  it("keeps staff, tenant, role and request-key gates in the latest decision wrapper", async () => {
    const mission = await seed("active_workspace", "application");
    const submission = await apply(mission);
    const before = await snapshot();
    await identity("service_role", "");
    await rejected(decisionSql, [otherWorkspace, ...decisionArgs(submission).slice(1)], "FORBIDDEN");
    await db.query("insert into public.brand_users values($1,$2,true);", [operator, otherWorkspace]);
    await db.query("insert into public.staff_workspace_roles values($1,$2,'operator',true)", [operator, otherWorkspace]);
    await rejected(decisionSql, [otherWorkspace, ...decisionArgs(submission).slice(1)], "application_not_found");
    await db.query("update public.staff_workspace_roles set role='finance_viewer'where workspace_id=$1", [workspace]);
    await rejected(decisionSql, decisionArgs(submission), "FORBIDDEN");
    expect(await snapshot()).toEqual(before);
    await db.query("update public.staff_workspace_roles set role='operator'where workspace_id=$1", [workspace]);
    const args = decisionArgs(submission);
    await value(decisionSql, args);
    await rejected("select public.decide_mission_application($1,$2,$3,$4,0,'decline','Different decision')", args, "IDEMPOTENCY_CONFLICT");
    await db.exec("set local role authenticated");
    await rejected(decisionSql, args, "permission denied");
    await db.exec("reset role");
  });

  it("retains acceptance capacity and state checks without partial writes", async () => {
    const mission = await seed("active_workspace", "application");
    const submission = await apply(mission);
    await db.query("update public.missions set filled=quota where id=$1", [mission]);
    const before = await snapshot();
    await rejected("select public.accept_application($1)", [submission], "mission_full");
    expect(await snapshot()).toEqual(before);
    await db.query("update public.mission_submissions set status='declined'where id=$1", [submission]);
    await rejected("select public.accept_application($1)", [submission], "wrong_state");
  });

  it.each(["workflow", "contract", "audit"])("rolls all assignment effects back on %s failure", async stage => {
    const mission = await seed("active_workspace", "application");
    const submission = await apply(mission, 93);
    const table = { workflow: "mission_workflows", contract: "mission_reward_contracts", audit: "operator_audit_events" }[stage]!;
    await db.exec(`create function private.test_fault()returns trigger language plpgsql as $$begin raise exception 'test assignment outage';end;$$;
      create trigger test_fault before insert on public.${table} for each row execute function private.test_fault()`);
    const before = await snapshot();
    await identity("service_role", "");
    await rejected(decisionSql, decisionArgs(submission), "test assignment outage");
    expect(await snapshot()).toEqual(before);
    await identity();
    const open = await seed();
    if (stage !== "audit") {
      const beforeJoin = await snapshot();
      await rejected("select public.join_active_mission($1)", [open], "test assignment outage");
      expect(await snapshot()).toEqual(beforeJoin);
    }
  });
});
