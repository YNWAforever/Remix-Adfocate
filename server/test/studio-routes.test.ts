import { Hono } from "hono";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Env } from "../app";
const mock=vi.hoisted(()=>({rpc:vi.fn(),reads:[] as Array<{table:string;filters:Array<[string,unknown]>;selection:string}>,rows:{} as Record<string,unknown>}));
vi.mock("../lib/supabase",()=>({serviceClient:()=>({rpc:mock.rpc,from:(table:string)=>{
  const read={table,filters:[] as Array<[string,unknown]>,selection:""};mock.reads.push(read);
  const q={select:(fields:string)=>{read.selection=fields;return q;},eq:(key:string,value:unknown)=>{read.filters.push([key,value]);return q;},order:()=>q,range:()=>q,limit:()=>q,maybeSingle:()=>q,
    then:(resolve:(value:unknown)=>unknown)=>Promise.resolve({data:mock.rows[table]??null,error:null}).then(resolve)};return q;
}})}));
import { studioRoutes } from "../routes/studio";
import { publicRoutes } from "../routes/public";
const actor="00000000-0000-4000-8000-000000000011",workspace="00000000-0000-4000-8000-000000000001";
const app=new Hono<Env>().use("*",async(c,next)=>{c.set("userId",actor);c.set("workspaceId",workspace);await next();}).route("/studio",studioRoutes).route("/public",publicRoutes);
beforeEach(()=>{vi.stubEnv("STUDIO_THREADS","true");vi.stubEnv("PUBLIC_MISSION_PREVIEW","true");mock.rpc.mockReset();mock.reads=[];mock.rows={};});
afterEach(()=>vi.unstubAllEnvs());
it("disabled rollout never reads private studio storage",async()=>{
  vi.stubEnv("STUDIO_THREADS","false");expect((await app.request("/studio/threads")).status).toBe(404);expect(mock.reads).toEqual([]);
});
it("binds commands to authenticated middleware identity, not payload claims",async()=>{
  mock.rpc.mockResolvedValue({data:{id:"thread"},error:null});const requestId=crypto.randomUUID();
  const response=await app.request("/studio/commands",{method:"POST",body:JSON.stringify({requestId,action:"create_thread",creatorId:"forged",workspaceId:"forged",payload:{title:"Hello",topic:"creation"}})});
  expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(mock.rpc).toHaveBeenCalledWith("studio_command",expect.objectContaining({p_creator:actor,p_workspace:workspace,p_request:requestId}));
});
it("owner-missing threads stop before reading any sources, outputs or messages",async()=>{
  expect((await app.request(`/studio/threads/${crypto.randomUUID()}`)).status).toBe(404);
  expect(mock.reads).toHaveLength(1);expect(mock.reads[0].filters).toEqual(expect.arrayContaining([["creator_id",actor],["workspace_id",workspace]]));
});
it("rejects invalid manual coverage before the database command",async()=>{
  const response=await app.request("/studio/commands",{method:"POST",body:JSON.stringify({requestId:crypto.randomUUID(),action:"add_source",payload:{region:"US",language:"en"}})});
  expect(response.status).toBe(400);expect(mock.rpc).not.toHaveBeenCalled();
});
it("requires publisher opt-in and projects only safe public mission fields",async()=>{
  mock.rows={workspaces:{id:workspace},missions:[{slug:"tea",title:"Tea",status:"active",points_reward:400,required_level:"L0",deadline:null,description:"private",cash_reward:900,creator_id:actor}]};
  const response=await app.request("/public/missions?workspace=demo");expect(await response.json()).toEqual({missions:[{slug:"tea",title:"Tea",points:400,level:"L0",deadline:null}]});
  expect(mock.reads[1].filters).toEqual(expect.arrayContaining([["workspace_id",workspace],["public_preview_enabled",true],["status","active"]]));
  expect(mock.reads[1].selection).not.toContain("*");
});
