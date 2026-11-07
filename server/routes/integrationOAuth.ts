import { Hono, type Context } from "hono";
import type { Env } from "../app.js";
import type { OAuthCoordinator } from "../lib/integrations/oauth.js";
import type { Actor, ProviderId } from "../lib/integrations/types.js";
import { boundedText, IntegrationError, validateProvider } from "../lib/integrations/policy.js";
import { pilotReadiness } from "../lib/integrations/pilotPolicy.js";
import type { PickerTokenChannel } from "../lib/integrations/pickerToken.js";

type OAuthDeps={
  /** Trusted composition's fixed origin; never derive approval from Host/forwarded headers. */
  approvedOrigin?:string;
  /** Existing offline injection seam. D1 runtime returns null and installs no coordinator. */
  getCoordinator?:()=>OAuthCoordinator|null;
  currentConnection?:(actor:Actor,provider:ProviderId)=>Promise<{generation:number;providerRevocation:string}|null>;
  picker?:PickerTokenChannel;
};
function safeHeaders(c:Context<Env>){
  c.header("Cache-Control","private, no-store");c.header("Referrer-Policy","no-referrer");
  c.header("Content-Security-Policy","default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  c.header("X-Content-Type-Options","nosniff");
}
function errors(app:Hono<Env>){
  app.onError((error,c)=>{
    const known=error instanceof IntegrationError?error:new IntegrationError("INTEGRATIONS_UNAVAILABLE",503);
    return c.json({code:known.code,error:"連接尚未完成。請重新檢查帳號，原有草稿仍保留。"},known.status as 400|401|403|404|409|503);
  });
}
const actor=(c:Context<Env>):Actor=>({creatorId:c.get("userId"),workspaceId:c.get("workspaceId")});

/** Public protocol callback. No actor is accepted from query/body; no coordinator exists by default. */
export function integrationOAuthCallbacks(deps:OAuthDeps={}){
  const app=new Hono<Env>();errors(app);
  app.use("*",async(c,next)=>{safeHeaders(c);await next();});
  app.get("/:provider/callback",async c=>{
    const coordinator=deps.getCoordinator?.();
    if(!coordinator)return c.json({code:"PILOT_APPROVAL_REQUIRED",...pilotReadiness()},503);
    const result=await coordinator.callback(validateProvider(c.req.param("provider")),new URL(c.req.url));
    return c.redirect(result.returnTo,303);
  });
  return app;
}

/** Already-authenticated completion stays separate from the provider's public redirect. */
export function integrationOAuthRoutes(deps:OAuthDeps={}){
  const app=new Hono<Env>();errors(app);
  app.use("*",async(c,next)=>{
    safeHeaders(c);
    if(!c.get("userId")||!c.get("workspaceId")||!c.get("jwt"))return c.json({code:"no_auth",error:"請先登入"},401);
    if(deps.approvedOrigin!==undefined&&new URL(c.req.url).origin!==deps.approvedOrigin)return c.json({code:"ORIGIN_DENIED"},403);
    const origin=c.req.header("Origin");
    if(c.req.method!=="GET"&&((origin&&origin!==new URL(c.req.url).origin)||c.req.header("Sec-Fetch-Site")==="cross-site"))return c.json({code:"ORIGIN_DENIED"},403);
    if(!deps.getCoordinator?.())return c.json({code:"PILOT_APPROVAL_REQUIRED",...pilotReadiness()},503);
    if(c.req.method!=="GET"){
      const raw=await c.req.text();if(raw.length>16384)return c.json({code:"INVALID_INPUT"},413);
      try{const data=JSON.parse(raw);if(!data||typeof data!=="object"||Array.isArray(data))throw new Error();}catch{return c.json({code:"INVALID_INPUT"},400);}
    }
    await next();
  });
  app.post("/:provider/start",async c=>{
    const provider=validateProvider(c.req.param("provider")),who=actor(c),body=await c.req.json();
    if(!deps.currentConnection)throw new IntegrationError("PILOT_APPROVAL_REQUIRED",503);
    const existing=await deps.currentConnection(who,provider);
    if(existing&&["pending","manual_action"].includes(existing.providerRevocation))throw new IntegrationError("REVOCATION_PENDING",409);
    return c.json(await deps.getCoordinator!()!.begin(who,provider,c.get("jwt"),typeof body.returnPath==="string"?body.returnPath:"/connections",existing?.generation??0));
  });
  app.post("/:provider/complete",async c=>{
    const body=await c.req.json();
    return c.json(await deps.getCoordinator!()!.complete(actor(c),validateProvider(c.req.param("provider")),c.get("jwt"),boundedText(body.ticket,128),body.confirmAccount===true));
  });
  app.post("/:provider/picker-token",async c=>{
    if(validateProvider(c.req.param("provider"))!=="google_drive")throw new IntegrationError("INVALID_PROVIDER");
    if(!deps.picker)throw new IntegrationError("PILOT_APPROVAL_REQUIRED",503);
    const body=await c.req.json();
    return c.json(await deps.picker.issue(actor(c),boundedText(body.connectionId,128),body.generation));
  });
  return app;
}
