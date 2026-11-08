// @vitest-environment node
import { Hono } from "hono";
import { afterEach, expect, it, vi } from "vitest";
import type { Env } from "../app.js";
const h=vi.hoisted(()=>({rpc:vi.fn(),run:vi.fn(),authorize:vi.fn()}));
vi.mock("../lib/supabase.js",()=>({makeUserClient:()=>({}),serviceClient:()=>({rpc:h.rpc})}));
vi.mock("../lib/assistant/chat.js",()=>({runAssistant:h.run}));
vi.mock("../lib/integrations/evidence.js",()=>({authorizeIntegrationSources:h.authorize}));
vi.mock("../lib/studio/assistantContext.js",()=>({loadStudioContext:async()=>({context:{title:"Tea",topic:"creation",sources:[]},contextVersion:"studio:current",history:[],integrationSources:[{id:"source"}]})}));
import { assistantRoutes } from "../routes/assistant.js";
afterEach(()=>vi.unstubAllEnvs());
it("never returns a derived answer when revocation wins the final database save race",async()=>{
  vi.stubEnv("STUDIO_THREADS","true");h.authorize.mockResolvedValue(undefined);h.run.mockResolvedValue({answer:"PRIVATE DERIVED ANSWER",citations:[]});
  h.rpc.mockImplementation(async(name:string)=>name==="reserve_assistant_request"?{data:{action:"reserved"},error:null}:name==="claim_assistant_request"?{data:true,error:null}:name==="save_assistant_turn"?{data:null,error:{message:"SOURCE_UNAVAILABLE",code:"P0001"}}:{data:null,error:null});
  const app=new Hono<Env>().use("*",async(c,next)=>{c.set("userId","owner");c.set("workspaceId","workspace");c.set("jwt","test");await next();}).route("/assistant",assistantRoutes());
  const response=await app.request("/assistant/chat",{method:"POST",body:JSON.stringify({message:"brief",client_request_id:crypto.randomUUID(),conversation_id:crypto.randomUUID()})});
  const result=await response.json();expect(JSON.stringify(result)).not.toContain("PRIVATE DERIVED ANSWER");expect(result.persistence).toBe("failed");expect(response.status).toBe(409);
});
