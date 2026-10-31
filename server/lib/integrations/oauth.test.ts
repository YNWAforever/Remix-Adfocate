// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OAuthCoordinator, type OAuthStore, type OAuthStateRecord } from "./oauth.js";
import { CredentialVault } from "./credentials.js";
import { createMockProviders } from "./mockProviders.js";
import { IntegrationError, requiredScopes } from "./policy.js";
import type { Actor, IntegrationProvider, ProviderId } from "./types.js";

const actor={creatorId:"creator",workspaceId:"workspace"};
let now:Date, store:OAuthStore, rows:Map<string,OAuthStateRecord & {ticketHash?:string;code?:unknown;ticketExpiresAt?:string;used?:boolean}>;
const configs={google_drive:{clientId:"google-client",redirectUri:"https://pilot.example/api/integration-oauth/google_drive/callback"},instagram:{clientId:"ig-client",redirectUri:"https://pilot.example/api/integration-oauth/instagram/callback"}};
function setup() {
  const providers=createMockProviders();
  const grant={subject:"owned-google",label:"Google 測試帳號",accessToken:"fixture-access",refreshToken:"fixture-refresh",scopes:requiredScopes("google_drive","live_pilot"),expiresAt:new Date(now.getTime()+3600000).toISOString()};
  const authorize=vi.fn().mockResolvedValue(grant);
  const ports={...providers,google_drive:{...providers.google_drive,mode:"live_pilot",sampleOnly:true,authorize}} as Record<ProviderId,IntegrationProvider>;
  const persist=vi.fn(async (_actor:Actor,_provider:ProviderId,_grant:unknown,generation:number)=>({id:"connection",generation:generation+1}));
  return {coordinator:new OAuthCoordinator(store,new CredentialVault(new Uint8Array(32).fill(3),"fixture-key"),ports,configs,persist,()=>now),authorize,persist};
}
beforeEach(()=>{
  now=new Date("2026-10-31T12:00:00Z");rows=new Map();
  store={
    async start(who,row){rows.set(row.stateHash,{...row,actor:who});},
    async callback(input){const row=rows.get(input.stateHash);if(!row||row.provider!==input.provider||row.ticketHash||Date.parse(row.expiresAt)<=now.getTime())throw new IntegrationError("OAUTH_STATE_INVALID",403);Object.assign(row,input);},
    async complete(who,input){const row=[...rows.values()].find(value=>value.ticketHash===input.ticketHash);if(!row||row.actor.creatorId!==who.creatorId||row.actor.workspaceId!==who.workspaceId||row.provider!==input.provider||row.used||Date.parse(row.expiresAt)<=now.getTime()||Date.parse(row.ticketExpiresAt!)<=now.getTime()||(!input.allowRelogin&&row.sessionHash!==input.sessionHash))throw new IntegrationError("OAUTH_STATE_INVALID",403);row.used=true;return {...row,code:row.code};},
  };
});
describe("server OAuth handoff with no network",()=>{
  it("stores only encrypted PKCE/nonce and exchanges only after owner-bound receipt completion",async()=>{
    const {coordinator,authorize,persist}=setup();
    const begin=await coordinator.begin(actor,"google_drive","session","/studio?thread=own",0);
    const url=new URL(begin.authorizationUrl),state=url.searchParams.get("state")!;
    expect(url.origin).toBe("https://accounts.google.com");expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toBe(requiredScopes("google_drive","live_pilot").join(" "));
    expect(JSON.stringify([...rows.values()])).not.toContain(url.searchParams.get("nonce"));
    const callback=await coordinator.callback("google_drive",new URL(`${configs.google_drive.redirectUri}?state=${state}&code=private-code`));
    expect(callback.returnTo).toMatch(/^\/connections#integration=/);expect(callback.returnTo).not.toContain("private-code");
    expect(authorize).not.toHaveBeenCalled();
    await expect(coordinator.complete({...actor,workspaceId:"other"},"google_drive","session",callback.ticket,true)).rejects.toThrow("OAUTH_STATE_INVALID");
    const result=await coordinator.complete(actor,"google_drive","new-session",callback.ticket,true);
    expect(result.returnPath).toBe("/studio?thread=own");expect(persist).toHaveBeenCalledTimes(1);
    expect(authorize).toHaveBeenCalledWith("private-code",actor,now,expect.objectContaining({redirectUri:configs.google_drive.redirectUri,codeVerifier:expect.any(String),nonce:url.searchParams.get("nonce")}));
    await expect(coordinator.complete(actor,"google_drive","session",callback.ticket,true)).rejects.toThrow("OAUTH_STATE_INVALID");
  });
  it("consumes a cancelled authorization without exchanging or persisting a grant",async()=>{
    const {coordinator,authorize,persist}=setup(),begin=await coordinator.begin(actor,"google_drive","session","https://evil.example",0);
    const state=new URL(begin.authorizationUrl).searchParams.get("state")!;
    const callback=await coordinator.callback("google_drive",new URL(`${configs.google_drive.redirectUri}?state=${state}&error=access_denied`));
    await expect(coordinator.complete(actor,"google_drive","session",callback.ticket,false)).rejects.toThrow("AUTHORIZATION_DECLINED");
    expect(authorize).not.toHaveBeenCalled();expect(persist).not.toHaveBeenCalled();
  });
  it("rejects foreign callback origins, duplicate parameters, expired states and receipt replay",async()=>{
    const {coordinator,authorize}=setup(),begin=await coordinator.begin(actor,"google_drive","session","/connections",0);
    const state=new URL(begin.authorizationUrl).searchParams.get("state")!;
    for(const callback of [`https://evil.example/api/integration-oauth/google_drive/callback?state=${state}&code=private-code`,`${configs.google_drive.redirectUri}?state=${state}&state=other&code=x`])await expect(coordinator.callback("google_drive",new URL(callback))).rejects.toThrow("OAUTH_STATE_INVALID");
    now=new Date(now.getTime()+600001);
    await expect(coordinator.callback("google_drive",new URL(`${configs.google_drive.redirectUri}?state=${state}&code=x`))).rejects.toThrow("OAUTH_STATE_INVALID");
    expect(authorize).not.toHaveBeenCalled();
  });
  it("does not turn an unapproved network adapter into a callback executor",()=>{
    const providers=createMockProviders();
    providers.google_drive={...providers.google_drive,mode:"live_pilot",sampleOnly:false};
    expect(()=>new OAuthCoordinator(store,new CredentialVault(new Uint8Array(32).fill(3),"fixture-key"),providers,configs,vi.fn(),()=>now)).toThrow("LIVE_PROVIDER_DISABLED");
  });
});
