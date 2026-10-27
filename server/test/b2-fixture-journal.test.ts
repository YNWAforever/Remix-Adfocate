import { afterEach, describe, expect, it } from "vitest";
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error Native audit helper.
import { FixtureJournal, journalTransportFetch, bindBrowserJournal } from "../../scripts/audit/fixture-journal.mjs";
const dirs: string[] = [];
const lineage = { projectId: "unit-b2", ownerRunId: "unit", phase: "core", namespace: "unit", sourceFingerprint: "unit", manifestSha256: "unit" };
function fixture() { const dir = mkdtempSync(join(tmpdir(), "adfocate-b2-journal-")); dirs.push(dir); return { dir, path: join(dir, "owned.jsonl") }; }
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
describe("B2 durable exact-ID fixture journal", () => {
  it("persists a reservation before executing a write and captures success IDs immediately", async () => {
    const { path } = fixture(), journal = new FixtureJournal(path, lineage, { auth_users: 1 });
    const id = "11111111-1111-4111-8111-111111111111";
    await journal.perform("auth-create", { auth_users: 1 }, async () => {
      const rows = readFileSync(path, "utf8").trim().split("\n").map(line => JSON.parse(line));
      expect(rows.at(-1)).toMatchObject({ state: "intent", lineage, reserve: { auth_users: 1 } });
      return { auth_users: [id] };
    });
    expect(new FixtureJournal(path, lineage, { auth_users: 1 }).owned()).toEqual({ auth_users: [id] });
    expect(() => journal.begin("second", { auth_users: 1 })).toThrow(/cap/i);
  });
  it("retains UNKNOWN reservation across restart and forbids automatic reseed", async () => {
    const { path } = fixture(), journal = new FixtureJournal(path, lineage, { workspaces: 2 });
    await expect(journal.perform("workspaces", { workspaces: 2 }, async () => { throw Error("response lost"); })).rejects.toThrow("response lost");
    const resumed = new FixtureJournal(path, lineage, { workspaces: 2 });
    expect(() => resumed.begin("retry whole phase", {})).toThrow(/UNKNOWN|unresolved/i);
    expect(readFileSync(path, "utf8")).toContain('"state":"unknown"');
  });
  it("treats an interrupted intent as unresolved and rejects foreign evidence lineage", () => {
    const { path } = fixture(), journal = new FixtureJournal(path, lineage, { missions: 1 });
    journal.begin("mission", { missions: 1 });
    expect(() => new FixtureJournal(path, lineage, { missions: 1 }).begin("retry", {})).toThrow(/unresolved/i);
    expect(() => new FixtureJournal(path, { ...lineage, sourceFingerprint: "other" }, { missions: 1 })).toThrow(/lineage/i);
  });
  it("records all planned IDs before a transactional queue write; no success is inferred from intent", () => {
    const { path } = fixture(), journal = new FixtureJournal(path, lineage, { auth_users: 2 });
    const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
    journal.begin("queue", { auth_users: 2 }, { auth_users: ids });
    expect(journal.owned()).toEqual({});
    expect(JSON.parse(readFileSync(path, "utf8").trim()).planned).toEqual({ auth_users: ids });
  });
  it("fails closed on partial/truncated journal and unapproved table families", () => {
    const { path } = fixture(), journal = new FixtureJournal(path, lineage, { workspaces: 1 });
    expect(() => journal.begin("out of scope", { payments: 1 })).toThrow(/family|scope/i);
    appendFileSync(path, '{"state":');expect(()=>new FixtureJournal(path,lineage,{workspaces:1})).toThrow(/truncated/i);
  });
  it("journals outgoing mutation intent before transport, then response UUID references without claiming table ownership",async()=>{
    const {path}=fixture(),journal=new FixtureJournal(path,lineage,{requests:2});
    const id="11111111-1111-4111-8111-111111111111";
    const delegate=async()=>{expect(readFileSync(path,"utf8")).toContain('"state":"intent"');return new Response(JSON.stringify({id}),{status:200});};
    const send=journalTransportFetch(delegate,journal,["http://127.0.0.1:56821"]);
    expect((await send("http://127.0.0.1:56821/rest/v1/rpc/save_assistant_turn",{method:"POST",body:'{"unit":"private authored text"}'})).status).toBe(200);
    expect(journal.owned()).toEqual({});const rows=readFileSync(path,"utf8");expect(rows).toContain(id);expect(rows).not.toContain("private authored text");
    await expect(send("http://127.0.0.1:56821/rest/v1/rpc/close_due_campaigns",{method:"POST"})).rejects.toThrow(/global|pristine/i);
  });
  it("allows concurrent commands in one live process, but a reconstructed process cannot reseed unfinished work",()=>{
    const {path}=fixture(),journal=new FixtureJournal(path,lineage,{requests:2});
    const a=journal.begin("a",{requests:1}),b=journal.begin("b",{requests:1});journal.finish(b,{});
    expect(()=>new FixtureJournal(path,lineage,{requests:2}).begin("restart",{})).toThrow(/unresolved/i);journal.finish(a,{});
  });
  it("persists browser mutation intent before continuing the real request and drains response receipts before close",async()=>{
    const {path}=fixture(),journal=new FixtureJournal(path,lineage,{requests:2});
    const handlers:Record<string,(v:unknown)=>void>={};let routeHandler:(v:unknown)=>Promise<void>=async()=>{};let closed=false;
    const context={route:async(_pattern:string,handler:typeof routeHandler)=>{routeHandler=handler;},on:(name:string,handler:(v:unknown)=>void)=>{handlers[name]=handler;},close:async()=>{closed=true;}};
    await bindBrowserJournal(context,journal,["http://127.0.0.1:56821"]);
    const req={url:()=>"http://127.0.0.1:56821/auth/v1/token",method:()=>"POST"};
    await routeHandler({request:()=>req,continue:async()=>{expect(readFileSync(path,"utf8")).toContain('"state":"intent"');},abort:async()=>{throw Error("unexpected abort");}});
    handlers.response({request:()=>req,status:()=>200,json:async()=>({user:{id:"11111111-1111-4111-8111-111111111111"},access_token:"unit-secret"})});
    await context.close();expect(closed).toBe(true);expect(readFileSync(path,"utf8")).not.toContain("unit-secret");
    expect(()=>new FixtureJournal(path,lineage,{requests:2}).assertReady()).not.toThrow();
  });
});
