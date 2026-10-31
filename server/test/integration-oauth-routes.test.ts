// @vitest-environment node
import { Hono } from "hono";
import { describe,expect,it,vi } from "vitest";
import type { Env } from "../app.js";
import { integrationOAuthCallbacks,integrationOAuthRoutes } from "../routes/integrationOAuth.js";
import type { OAuthCoordinator } from "../lib/integrations/oauth.js";
import type { PickerTokenChannel } from "../lib/integrations/pickerToken.js";

describe("inactive D0 OAuth surfaces",()=>{
  it("denies callbacks/start without constructing a provider, regardless of environment flags",async()=>{
    const app=new Hono<Env>();app.route("/api/integration-oauth",integrationOAuthCallbacks());app.route("/api/me/integration-oauth",integrationOAuthRoutes());
    const callback=await app.request("https://pilot.example/api/integration-oauth/google_drive/callback?code=secret&state=secret");
    expect(callback.status).toBe(503);expect(await callback.text()).not.toContain("secret");
    expect(callback.headers.get("cache-control")).toContain("no-store");expect(callback.headers.get("referrer-policy")).toBe("no-referrer");
    expect((await app.request("https://pilot.example/api/me/integration-oauth/google_drive/start",{method:"POST",body:"{}"})).status).toBe(401);
  });
  it("uses authenticated owner and rejects cross-origin writes before an injected offline coordinator",async()=>{
    const begin=vi.fn().mockResolvedValue({authorizationUrl:"fixture-only"});
    const coordinator={begin,complete:vi.fn()} as unknown as OAuthCoordinator;
    const app=new Hono<Env>();app.use("*",async(c,next)=>{c.set("userId","creator");c.set("workspaceId","workspace");c.set("jwt","session");await next();});
    app.route("/api/me/integration-oauth",integrationOAuthRoutes({getCoordinator:()=>coordinator,currentConnection:async()=>null}));
    const url="https://pilot.example/api/me/integration-oauth/google_drive/start";
    const denied=await app.request(url,{method:"POST",headers:{Origin:"https://evil.example"},body:"{}"});expect(denied.status).toBe(403);expect(begin).not.toHaveBeenCalled();
    const success=await app.request(url,{method:"POST",headers:{Origin:"https://pilot.example","Content-Type":"application/json"},body:JSON.stringify({creatorId:"other",workspaceId:"other",returnPath:"/studio"})});
    expect(success.status).toBe(200);expect(begin).toHaveBeenCalledWith({creatorId:"creator",workspaceId:"workspace"},"google_drive","session","/studio",0);
  });
  it("redirects with only an opaque ticket and does not echo raw errors or authorization codes",async()=>{
    const callback=vi.fn().mockResolvedValue({returnTo:"/connections#integration=google_drive&ticket=opaque"});
    const app=new Hono<Env>();app.route("/api/integration-oauth",integrationOAuthCallbacks({getCoordinator:()=>({callback}) as unknown as OAuthCoordinator}));
    const response=await app.request("https://pilot.example/api/integration-oauth/google_drive/callback?code=private-code&state=random");
    expect(response.status).toBe(303);expect(response.headers.get("location")).not.toContain("private-code");
    callback.mockRejectedValueOnce(new Error("provider-token-secret"));
    const failed=await app.request("https://pilot.example/api/integration-oauth/google_drive/callback?code=private-code&state=random");
    expect(failed.status).toBe(503);expect(await failed.text()).not.toContain("provider-token-secret");
  });
  it("keeps Picker access tokens in a protected no-store POST response",async()=>{
    const issue=vi.fn().mockResolvedValue({accessToken:"fixture-access",generation:2});
    const app=new Hono<Env>();app.use("*",async(c,next)=>{c.set("userId","creator");c.set("workspaceId","workspace");c.set("jwt","session");await next();});
    app.route("/api/me/integration-oauth",integrationOAuthRoutes({getCoordinator:()=>({}) as OAuthCoordinator,picker:new Proxy({}, {get:()=>issue}) as PickerTokenChannel}));
    const url="https://pilot.example/api/me/integration-oauth/google_drive/picker-token",body=JSON.stringify({connectionId:"connection",generation:2,creatorId:"other"});
    expect((await app.request(url,{method:"POST",headers:{Origin:"https://evil.example"},body})).status).toBe(403);expect(issue).not.toHaveBeenCalled();
    const value=await app.request(url,{method:"POST",headers:{Origin:"https://pilot.example"},body});
    expect(value.status).toBe(200);expect(value.headers.get("cache-control")).toContain("no-store");
    expect(issue).toHaveBeenCalledWith({creatorId:"creator",workspaceId:"workspace"},"connection",2);
  });
});
