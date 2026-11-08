// @vitest-environment node
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const ws = "00000000-0000-4000-8000-000000000001", otherWs = "00000000-0000-4000-8000-000000000002";
const user = "00000000-0000-4000-8000-000000000011", other = "00000000-0000-4000-8000-000000000012";
const mission = "00000000-0000-4000-8000-000000000021", sub = "00000000-0000-4000-8000-000000000031", item = "00000000-0000-4000-8000-000000000041";
let db: PGlite;
async function command(action: string, payload: Record<string, unknown>, request = crypto.randomUUID(), actor = user, workspace = ws) {
  const result = await db.query<{ result: Record<string, unknown> }>("select public.studio_command($1,$2,$3,$4,$5::jsonb) result", [workspace, actor, request, action, JSON.stringify(payload)]);
  return result.rows[0].result;
}
async function thread() { return command("create_thread", { title: "試飲 brief", topic: "creation", missionId: mission }); }
async function source(threadId: unknown, revision = 0, shareable = false) {
  return command("add_source", { threadId, revision, title: "本人的訪問筆記", content: "一人份量", url: null, kind: "manual", shareable, question: "想知道份量？", platform: "manual", region: "HK", language: "zh-Hant", observed_at: "2026-10-30T10:00:00Z" });
}
async function scalar(sql: string, args: unknown[] = []) { return (await db.query<{ n: number }>(sql, args)).rows[0].n; }
async function denied(run: () => Promise<unknown>, message: string) {
  await db.exec("savepoint denied"); await expect(run()).rejects.toThrow(message); await db.exec("rollback to savepoint denied");
}
beforeAll(async () => {
  // Owned in-process SQL only. No database URL, credentials or network transport.
  db = await PGlite.create("memory://");
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
    -- Dependency contract fixture; existing active-mission suites test the canonical save implementation.
    create function private.save_active_mission_draft(uuid,uuid,uuid,uuid,integer,jsonb) returns jsonb language plpgsql as $$
    declare d public.fixture_draft; begin select * into d from public.fixture_draft where id=$4 for update;
      if d.revision<>$5 then return jsonb_build_object('code','WORKFLOW_STALE'); end if;
      update public.fixture_draft set caption=$6->>'caption',revision=revision+1 where id=$4 returning * into d;
      return jsonb_build_object('draft',to_jsonb(d)); end; $$;
    insert into public.workspaces values('${ws}'),('${otherWs}');
    insert into public.creators(id,workspace_id) values('${user}','${ws}'),('${other}','${otherWs}');
    insert into public.missions values('${mission}','${ws}');
    insert into public.mission_submissions values('${sub}','${user}','${ws}','${mission}','joined');
    insert into public.mission_workflows values('${sub}','${sub}','${ws}');
    insert into public.mission_work_items values('${item}','${sub}','${ws}');
    insert into public.fixture_draft values('${item}','original',0);`);
  await db.exec(await readFile("supabase/migrations/20261022171843_audit_assistant_requests.sql", "utf8"));
  await db.exec(await readFile("supabase/migrations/20261030195424_creator_studio_private_artifacts.sql", "utf8"));
}, 30000);
beforeEach(async () => { await db.exec("begin"); });
afterEach(async () => { await db.exec("rollback"); });
afterAll(async () => { await db.close(); });

describe("private studio SQL contracts", () => {
  it("does not let an edit detach private source lineage from an existing paragraph", async () => {
    const t = await thread(), s = await source(t.id);
    await command("save_brief", { threadId:t.id, revision:1, sections:[{id:"hook",text:"private insight",sourceIds:[s.id]}] });
    await denied(() => command("save_brief", { threadId:t.id, revision:2, sections:[{id:"hook",text:"private insight, edited",sourceIds:[]}] }), "SOURCE_LINEAGE_REQUIRED");
  });
  it("creates one thread and conversation on response-loss retry, rejects changed payload", async () => {
    const key = crypto.randomUUID(), payload = { title: "一份 brief", topic: "creation", missionId: mission };
    const first = await command("create_thread", payload, key);
    expect(await command("create_thread", payload, key)).toEqual(first);
    expect(await scalar("select count(*)::int n from public.studio_threads")).toBe(1);
    expect(await scalar("select count(*)::int n from public.assistant_conversations")).toBe(1);
    await denied(() => command("create_thread", { ...payload, title: "different" }, key), "IDEMPOTENCY_CONFLICT");
  });
  it("rejects forged workspace, other owner's thread and suspended creators", async () => {
    const t = await thread();
    await denied(() => command("create_thread", { title: "no", topic: "creation" }, undefined, user, otherWs), "NOT_FOUND");
    await denied(() => command("save_brief", { threadId: t.id, revision: 0, sections: [] }, undefined, other, otherWs), "NOT_FOUND");
    await db.exec(`update public.creators set status='suspended' where id='${user}'`);
    await denied(() => thread(), "NOT_FOUND");
  });
  it("applies owner RLS and denies direct writes and RPC use to browser roles", async () => {
    await thread(); await db.query("select set_config('request.jwt.claim.sub',$1,true)", [other]);
    await db.exec("set local role authenticated");
    expect(await scalar("select count(*)::int n from public.studio_threads")).toBe(0);
    await denied(() => command("create_thread", { title: "forged", topic: "creation" }), "permission denied");
    await denied(() => db.exec("delete from public.studio_threads"), "permission denied");
    await db.exec("reset role"); await db.query("select set_config('request.jwt.claim.sub',$1,true)", [user]);
    await db.exec("set local role authenticated");
    expect(await scalar("select count(*)::int n from public.studio_threads")).toBe(1);
  });
  it("saves private source-derived paragraphs but blocks their transfer", async () => {
    const t = await thread(), s = await source(t.id);
    const b = await command("save_brief", { threadId: t.id, revision: 1, sections: [{ id: "hook", text: "一人份量", sourceIds: [s.id] }] });
    await denied(() => command("share_brief", { threadId: t.id, revision: 2, briefId: b.id, sectionIds: ["hook"], submissionId: sub, workItemId: item, draftRevision: 0 }), "SOURCE_PRIVATE");
    expect(await scalar("select revision n from public.fixture_draft")).toBe(0);
  });
  it("transfers only selected paragraphs atomically into the existing draft and replays once", async () => {
    const t = await thread(), s = await source(t.id, 0, true);
    const b = await command("save_brief", { threadId: t.id, revision: 1, sections: [{ id: "hook", text: "一人份量", sourceIds: [s.id] }, { id: "private", text: "不要分享", sourceIds: [] }] });
    const payload = { threadId: t.id, revision: 2, briefId: b.id, sectionIds: ["hook"], submissionId: sub, workItemId: item, draftRevision: 0 }, key = crypto.randomUUID();
    const receipt = await command("share_brief", payload, key);
    expect(await command("share_brief", payload, key)).toEqual(receipt);
    expect(receipt).toMatchObject({ submission_id: sub, work_item_id: item, draft_revision: 1 });
    const draft = (await db.query<{ caption: string; revision: number }>("select * from public.fixture_draft")).rows[0];
    expect(draft.caption).toContain("未驗證"); expect(draft.caption).not.toContain("不要分享"); expect(draft.revision).toBe(1);
    expect(await scalar("select count(*)::int n from public.point_transactions")).toBe(0);
  });
  it("invalidates confirmation after a revision, revocation or canonical draft conflict", async () => {
    const t = await thread(), s = await source(t.id, 0, true);
    const sections = [{ id: "hook", text: "一人份量", sourceIds: [s.id] }];
    const b = await command("save_brief", { threadId: t.id, revision: 1, sections });
    const payload = { threadId: t.id, revision: 2, briefId: b.id, sectionIds: ["hook"], submissionId: sub, workItemId: item, draftRevision: 9 };
    await denied(() => command("share_brief", payload), "WORKFLOW_STALE");
    expect(await scalar("select count(*)::int n from public.studio_shares")).toBe(0);
    await command("save_brief", { threadId: t.id, revision: 2, sections });
    await denied(() => command("share_brief", { ...payload, revision: 3, draftRevision: 0 }), "STALE_BRIEF");
    await command("revoke_source", { threadId: t.id, revision: 3, sourceId: s.id });
    await denied(() => command("save_brief", { threadId: t.id, revision: 4, sections }), "SOURCE_UNAVAILABLE");
  });
  it("deletes all private studio material on account anonymisation without touching ledgers", async () => {
    const t = await thread(); await source(t.id);
    const request=crypto.randomUUID();
    await db.query("select public.reserve_assistant_request($1,$2,$3,'question','zh-HK',$4,'studio:test')",[ws,user,request,t.conversation_id]);
    await db.query("select public.claim_assistant_request($1,$2,$3)",[ws,user,request]);
    await db.query("select public.save_assistant_turn($1,$2,$3,'private answer',$4)",[ws,user,request,JSON.stringify([{title:"PRIVATE SOURCE",sourceRef:"private-id"}])]);
    await db.exec(`update public.creators set status='deleted' where id='${user}'`);
    for (const table of ["studio_threads", "studio_sources", "studio_commands"]) expect(await scalar(`select count(*)::int n from public.${table}`)).toBe(0);
    expect((await db.query("select citations from public.assistant_messages")).rows).toEqual([{citations:[]},{citations:[]}]);
    expect((await db.query("select result->'citations' citations from public.assistant_requests")).rows).toEqual([{citations:[]}]);
  });
  it("rejects a late generation after deletion instead of restoring private text or citations",async()=>{
    const t=await thread(),request=crypto.randomUUID();
    await db.query("select public.reserve_assistant_request($1,$2,$3,'question','zh-HK',$4,'studio:test')",[ws,user,request,t.conversation_id]);
    await db.query("select public.claim_assistant_request($1,$2,$3)",[ws,user,request]);
    await db.exec(`update public.creators set status='deleted' where id='${user}'`);
    await denied(()=>db.query("select public.save_assistant_turn($1,$2,$3,'LATE PRIVATE ANSWER',$4)",[ws,user,request,JSON.stringify([{title:"LATE SECRET"}])]),"not_found");
    expect(await scalar("select count(*)::int n from public.assistant_messages")).toBe(0);
  });
  it("terminally resolves an unclaimed request after context changes, preserving saved and generating outcomes",async()=>{
    const t=await thread(),request=crypto.randomUUID();
    await db.query("select public.reserve_assistant_request($1,$2,$3,'question','zh-HK',$4,'studio:old')",[ws,user,request,t.conversation_id]);
    const args=[ws,user,request,"question","zh-HK",t.conversation_id,"studio:new"];
    const sql="select public.resolve_studio_request_context($1,$2,$3,$4,$5,$6,$7) result";
    const resolved=(await db.query<{result:unknown}>(sql,args)).rows[0].result;
    expect(resolved).toMatchObject({code:"studio_context_changed",persistence:"failed",generation:"not_started"});
    expect((await db.query<{result:unknown}>(sql,args)).rows[0].result).toEqual(resolved);
    expect((await db.query<{claimed:boolean}>("select public.claim_assistant_request($1,$2,$3) claimed",[ws,user,request])).rows[0].claimed).toBe(false);
    const next=crypto.randomUUID();await db.query("select public.reserve_assistant_request($1,$2,$3,'question','zh-HK',$4,'studio:new')",[ws,user,next,t.conversation_id]);
    await db.query("select public.claim_assistant_request($1,$2,$3)",[ws,user,next]);
    expect((await db.query<{result:unknown}>(sql,[...args.slice(0,2),next,...args.slice(3,6),"studio:third"])).rows[0].result).toMatchObject({persistence:"unknown"});
    await denied(()=>db.query(sql,[ws,user,next,"different","zh-HK",t.conversation_id,"studio:third"]),"IDEMPOTENCY_CONFLICT");
  });
  it("awards a unique non-financial badge only after settlement or a genuine legacy credit", async () => {
    await db.exec(`insert into public.mission_pending_rewards values('${sub}','${user}','${ws}','pending','${sub}')`);
    expect(await scalar("select count(*)::int n from public.studio_badges")).toBe(0);
    await db.exec(`update public.mission_pending_rewards set status='settled' where id='${sub}'`);
    await db.exec(`update public.mission_pending_rewards set status='settled' where id='${sub}'`);
    expect(await scalar("select count(*)::int n from public.studio_badges")).toBe(1);
    expect(await scalar("select count(*)::int n from public.point_transactions")).toBe(0);
    // Canonical approve_submission credits first, then marks the submission approved.
    await db.exec(`delete from public.studio_badges;
      insert into public.point_transactions(creator_id,workspace_id,type,delta,source_ref) values('${user}','${ws}','earn',100,'mission_submission:${sub}')`);
    expect(await scalar("select count(*)::int n from public.studio_badges")).toBe(0);
    await db.exec(`update public.mission_submissions set status='approved' where id='${sub}'`);
    await db.exec(`update public.mission_submissions set status='approved' where id='${sub}'`);
    expect(await scalar("select count(*)::int n from public.studio_badges")).toBe(1);
  });
});
