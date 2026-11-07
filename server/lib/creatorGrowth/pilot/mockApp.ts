import type {PilotPrivateWorkspace} from "./privateWorkspace.js";
import {Hono,type Context} from "hono";
import {createMockMissionPilot,type PilotMockConfirmation,type PilotMockScenario} from "./missionService.js";
import type {OriginalPilotJourney} from "./originalJourney.js";
const prefix="/api/controlled-pilot-mock";
/** LOCAL FIXTURE ONLY. Header personas are rehearsal controls, not authentication.
 * Mounted only in Vite serve+fixture mode on loopback, never in app.ts. */
export function createControlledPilotMockApp(pilot=createMockMissionPilot(),journey?:OriginalPilotJourney,privateWorkspace?:PilotPrivateWorkspace){
 const app=new Hono();
 app.use(`${prefix}/*`,async(c,next)=>{
  const url=new URL(c.req.url),origin=c.req.header("Origin");
  c.header("Cache-Control","private, no-store");c.header("Referrer-Policy","no-referrer");c.header("X-Content-Type-Options","nosniff");
  if(!["localhost","127.0.0.1","[::1]"].includes(url.hostname)||(origin&&origin!==url.origin))return c.json({error:"LOCAL_ONLY"},403);
  if(!/^[a-f0-9]{64}$/.test(c.req.header("X-Pilot-Fixture-Session")??""))return c.json({error:"SESSION_REQUIRED"},401);
  const role=c.req.header("X-Pilot-Fixture-Role"),operator=["operator","workspace_admin"].includes(role??"");
  const adminPath=[`${prefix}/operator`,`${prefix}/stop`,`${prefix}/scenario`].includes(url.pathname);
  const journeyPath=url.pathname===`${prefix}/journey`;
  if(journeyPath?!["creator","reviewer","operator","workspace_admin"].includes(role??""):adminPath?!operator:role!=="creator")return c.json({error:"PILOT_DENIED"},403);
  await next();
 });
 app.onError((_e,c)=>c.json({error:"PILOT_RECHECK_REQUIRED"},409));
 const actor=(session:string)=>({workspaceId:"00000000-0000-4000-8000-000000000001",creatorId:"00000000-0000-4000-8000-000000000011",sessionHash:session});
 async function body(c:Context,keys:readonly string[]){
  if(c.req.header("Content-Type")?.split(";")[0]!=="application/json")return null;
  const text=await c.req.text();if(text.length>8192)return null;
  try{const value=JSON.parse(text);if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k))||keys.some(k=>!(k in value)))return null;return value as Record<string,unknown>;}catch{return null;}
 }
 app.post(`${prefix}/preview`,async c=>{if(!await body(c,[]))return c.json({error:"INVALID"},400);return c.json(await pilot.preview(actor(c.req.header("X-Pilot-Fixture-Session")!)));});
 app.post(`${prefix}/approve`,async c=>{const b=await body(c,["approvalId","nonce","fingerprint","requestId","confirmed"]);if(!b||typeof b.confirmed!=="boolean"||["approvalId","nonce","fingerprint","requestId"].some(k=>typeof b[k]!=="string"))return c.json({error:"INVALID"},400);return c.json(await pilot.approve(actor(c.req.header("X-Pilot-Fixture-Session")!),b as PilotMockConfirmation));});
 app.get(`${prefix}/current`,async c=>c.json(await pilot.current(actor(c.req.header("X-Pilot-Fixture-Session")!))));
 app.get(`${prefix}/snapshot`,c=>c.json(pilot.snapshot()));
 app.get(`${prefix}/image`,c=>c.body(pilot.image().buffer as ArrayBuffer,200,{"Content-Type":"image/jpeg"}));
 app.post(`${prefix}/reconcile`,async c=>{if(!await body(c,[]))return c.json({error:"INVALID"},400);return c.json(await pilot.reconcile(actor(c.req.header("X-Pilot-Fixture-Session")!)));});
 app.get(`${prefix}/journey`,async c=>journey?c.json(await journey.read()):c.json({error:"OFFLINE_ENGINE_REQUIRED"},409));
 app.post(`${prefix}/journey`,async c=>{const b=await body(c,["action","confirmed"]);if(!journey||!b||!["proof","review","completion","settlement"].includes(String(b.action))||b.confirmed!==true)return c.json({error:"INVALID"},400);return c.json(await journey.act(c.req.header("X-Pilot-Fixture-Role")!,b.action as "proof"|"review"|"completion"|"settlement",true));});
 app.get(`${prefix}/private`,async c=>{if(!privateWorkspace)return c.json({error:"UNAVAILABLE"},409);const a=actor(c.req.header("X-Pilot-Fixture-Session")!);return c.json({connection:await privateWorkspace.status(a),collection:await privateWorkspace.collection(a)});});
 app.post(`${prefix}/private`,async c=>{
  const b=await body(c,["action","state","briefId","draftId","text","confirmed"]);if(!privateWorkspace||!b||b.confirmed!==true||["action","state","briefId","draftId","text"].some(k=>typeof b[k]!=="string"))return c.json({error:"INVALID"},400);
  const a=actor(c.req.header("X-Pilot-Fixture-Session")!);
  switch(b.action){
   case "begin":return c.json(await privateWorkspace.begin(a));
   case "complete":return c.json(await privateWorkspace.complete(a,b.state as string,true));
   case "revoke":return c.json(await privateWorkspace.revoke(a));
   case "save_receipt":return c.json(await privateWorkspace.saveReceipt(a,true));
   case "copy":return c.json(await privateWorkspace.copy(a,b.briefId as string));
   case "save_draft":return c.json(await privateWorkspace.saveDraft(a,b.draftId as string,b.text as string));
   default:return c.json({error:"INVALID"},400);
  }
 });
 app.get(`${prefix}/operator`,c=>c.json({readiness:pilot.readiness(),counts:pilot.counts()}));
 app.post(`${prefix}/stop`,async c=>{if(!await body(c,[]))return c.json({error:"INVALID"},400);await pilot.stop();return c.json(pilot.readiness());});
 app.post(`${prefix}/scenario`,async c=>{const b=await body(c,["scenario"]);if(!b||!["ok","unknown","changed","label","private","revoked"].includes(String(b.scenario)))return c.json({error:"INVALID"},400);await pilot.changeScenario(b.scenario as PilotMockScenario);return c.json({sampleOnly:true});});
 return app;
}
