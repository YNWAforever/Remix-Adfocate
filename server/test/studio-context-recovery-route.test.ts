import { Hono } from "hono";
import { afterEach, expect, it, vi } from "vitest";
import type { Env } from "../app";
const h=vi.hoisted(()=>({rpc:vi.fn(),run:vi.fn()}));
vi.mock("../lib/supabase.js",()=>({makeUserClient:()=>({}),serviceClient:()=>({rpc:h.rpc})}));
vi.mock("../lib/assistant/chat.js",()=>({runAssistant:h.run}));
vi.mock("../lib/studio/assistantContext.js",()=>({loadStudioContext:async()=>({context:{title:"Tea",topic:"creation",sources:[]},contextVersion:"studio:new",history:[]})}));
import { assistantRoutes } from "../routes/assistant";
afterEach(()=>vi.unstubAllEnvs());
it("returns a terminal context-change receipt without claiming or regenerating the old request",async()=>{
  vi.stubEnv("STUDIO_THREADS","true");
  const result={code:"studio_context_changed",persistence:"failed",generation:"not_started"};
  h.rpc.mockImplementation(async(name:string)=>name==="reserve_assistant_request"?{data:null,error:{message:"IDEMPOTENCY_CONFLICT"}}:{data:result,error:null});
  const app=new Hono<Env>().use("*",async(c,next)=>{c.set("jwt","fixture");c.set("userId","owner");c.set("workspaceId","workspace");await next();}).route("/assistant",assistantRoutes());
  const response=await app.request("/assistant/chat",{method:"POST",body:JSON.stringify({message:"Shorten option B",client_request_id:crypto.randomUUID(),conversation_id:crypto.randomUUID()})});
  expect(response.status).toBe(200);expect(await response.json()).toEqual(result);expect(h.run).not.toHaveBeenCalled();
  expect(h.rpc.mock.calls.map(c=>c[0])).toEqual(["reserve_assistant_request","resolve_studio_request_context"]);
  expect(h.rpc.mock.calls[1][1]).toMatchObject({p_creator:"owner",p_workspace:"workspace",p_context_version:"studio:new",p_message:"Shorten option B"});
});
