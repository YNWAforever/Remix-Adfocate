// @vitest-environment node
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../app.js";
import { integrationRoutes } from "../routes/integrations.js";
import { IntegrationService } from "../lib/integrations/service.js";
import { MemoryIntegrationRepository } from "../lib/integrations/memoryRepo.js";
import { createMockProviders } from "../lib/integrations/mockProviders.js";
import { CredentialVault } from "../lib/integrations/credentials.js";

const actor={creatorId:"00000000-0000-4000-8000-000000000011",workspaceId:"00000000-0000-4000-8000-000000000001"};
let service:IntegrationService, app:Hono<Env>;
const env={NODE_ENV:"test",INTEGRATIONS_ENABLED:"true",INTEGRATIONS_MODE:"mock",INSTAGRAM_CONNECTIONS_ENABLED:"true",DRIVE_CONNECTIONS_ENABLED:"true"};
function build(environment=env, authenticated=true) {
  const app=new Hono<Env>();
  if(authenticated)app.use("*",async(c,next)=>{c.set("userId",actor.creatorId);c.set("workspaceId",actor.workspaceId);c.set("jwt","test-session");await next();});
  app.route("/api/me/integrations",integrationRoutes({getService:()=>service,environment}));return app;
}
beforeEach(()=>{service=new IntegrationService(new MemoryIntegrationRepository(),createMockProviders(),new CredentialVault(new Uint8Array(32).fill(7),"test"));app=build();});
const post=(path:string,body:unknown,headers:Record<string,string>={})=>app.request(`http://localhost/api/me/integrations${path}`,{method:"POST",headers:{"Content-Type":"application/json",...headers},body:JSON.stringify(body)});
describe("mock integration HTTP boundary",()=>{
  it("defaults off, blocks production mock execution, and requires an authenticated owner",async()=>{
    for(const environment of [{},{...env,NODE_ENV:"production"}]) {
      const disabled=build(environment as typeof env);
      expect(await (await disabled.request("http://localhost/api/me/integrations")).json()).toEqual({mode:"disabled",connections:[]});
      expect((await disabled.request("http://localhost/api/me/integrations/instagram/start",{method:"POST",body:"{}"})).status).toBe(404);
    }
    expect((await build(env,false).request("http://localhost/api/me/integrations")).status).toBe(401);
  });
  it("rejects cross-origin state changes, oversized JSON, and arbitrary providers",async()=>{
    expect((await post("/instagram/start",{}, {Origin:"https://evil.test"})).status).toBe(403);
    expect((await post("/instagram/start",{extra:"x".repeat(65000)})).status).toBe(413);
    expect((await post("/gmail/start",{})).status).toBe(400);
  });
  it("completes an explicit mock consent, returns no tokens and cannot change the actor",async()=>{
    const start=await (await post("/instagram/start",{returnPath:"https://evil.test",creatorId:"intruder"})).json();
    expect(start.sampleOnly).toBe(true);
    const response=await post("/instagram/complete",{state:start.state,code:"allow",creatorId:"intruder"});expect(response.status).toBe(200);
    const body=await response.json();expect(body.connection.label).toContain("模擬");expect(JSON.stringify(body)).not.toMatch(/accessToken|refreshToken|ciphertext/);
    const result=await (await app.request("http://localhost/api/me/integrations")).json();expect(result.connections).toHaveLength(1);
  });
  it("allows owner revocation when the read/connection flag is turned off",async()=>{
    const start=await service.beginConnection(actor,"instagram","test-session","/connections"), connection=await service.completeConnection(actor,"instagram","test-session","allow",start.state);
    app=build({...env,INTEGRATIONS_ENABLED:"false"});
    const management=await (await app.request("http://localhost/api/me/integrations")).json();
    expect(management).toMatchObject({mode:"disabled",connections:[{id:connection.id}]});
    const result=await post(`/${connection.id}/revoke`,{requestId:crypto.randomUUID()});expect(result.status).toBe(200);expect(await result.json()).toMatchObject({local:"revoked"});
  });
  it("stops resource reads when only the provider flag is switched off",async()=>{
    const start=await service.beginConnection(actor,"google_drive","test-session","/connections"), connection=await service.completeConnection(actor,"google_drive","test-session","allow",start.state);
    app=build({...env,DRIVE_CONNECTIONS_ENABLED:"false"});
    expect((await app.request(`http://localhost/api/me/integrations/${connection.id}/resources`)).status).toBe(404);
  });
  it("never creates a default live provider or follows a file URL",async()=>{
    const external=vi.spyOn(globalThis,"fetch").mockRejectedValue(new Error("network forbidden"));
    const start=await (await post("/google_drive/start",{})).json();const connection=(await(await post("/google_drive/complete",{state:start.state,code:"allow"})).json()).connection;
    expect((await post(`/${connection.id}/resources`,{requestId:crypto.randomUUID(),fileIds:["https://evil.test/private"]})).status).toBe(403);
    expect(external).not.toHaveBeenCalled();external.mockRestore();
  });
});
