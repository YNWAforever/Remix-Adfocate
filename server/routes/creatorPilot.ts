import {Hono} from 'hono';
import {bodyLimit} from 'hono/body-limit';
import type {Env} from '../app.js';
import {publishActorFromVerifiedSession} from '../lib/creatorGrowth/publishSession.js';
import type {PublishActor} from '../lib/creatorGrowth/publishRepo.js';
import type {createLivePilotComposition} from '../lib/creatorGrowth/pilot/liveComposition.js';
import type {MissionProofConfirmation,MissionProofHandoffResult} from '../lib/creatorGrowth/missionProofHandoff.js';
import type {SqlPilotReceiptStore} from '../lib/creatorGrowth/pilot/receiptStore.js';
export type CreatorPilotRouteDependencies={create:(actor:PublishActor,verifiedJwt:string)=>ReturnType<typeof createLivePilotComposition>&{
 collection?:(session:string,intentId:string)=>ReturnType<SqlPilotReceiptStore['collection']>;
 prepareProof?:(session:string,intentId:string)=>Promise<MissionProofHandoffResult>;
 confirmProof?:(session:string,input:MissionProofConfirmation)=>Promise<MissionProofHandoffResult>;
}};
const id=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
/** Mount only behind workspaceAuth. The server factory binds its resolver to the
 * verified actor/JWT and revalidates session/allowlist on each command. */
export function createCreatorPilotRoutes(deps?:CreatorPilotRouteDependencies){
 const route=new Hono<Env>();
 route.use('*',async(c,next)=>{c.header('Cache-Control','no-store');if(!deps)return c.json({code:'PILOT_DISABLED'},503);await next();});
 route.use('*',bodyLimit({maxSize:8192,onError:c=>c.json({code:'PILOT_LIMIT'},413)}));
 route.post('/:command',async c=>{
  try{
   const origin=c.req.header('Origin');if(origin&&origin!==new URL(c.req.url).origin)return c.json({code:'PILOT_DENIED'},403);
   if(c.req.header('Content-Type')?.split(';')[0].trim()!=='application/json')return c.json({code:'PILOT_INVALID'},400);
   const b:unknown=await c.req.json();if(!b||typeof b!=='object'||Array.isArray(b))return c.json({code:'PILOT_INVALID'},400);
   const body=b as Record<string,unknown>,command=c.req.param('command');
   const lookup=['status','collection','prepare-proof'].includes(command);
   const keys=command==='preview'?['submissionId','workItemId']:command==='approve'?['submissionId','workItemId','approvalId','nonce','fingerprint','requestId','confirmed']:lookup?['intentId']:command==='confirm-proof'?['proposalId','fingerprint','confirmed']:[];
   if(!keys.length||Object.keys(body).length!==keys.length||Object.keys(body).some(k=>!keys.includes(k)))return c.json({code:'PILOT_INVALID'},400);
   if(command==='confirm-proof'?!id(body.proposalId)||typeof body.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(body.fingerprint)||body.confirmed!==true:lookup?!id(body.intentId):!id(body.submissionId)||!id(body.workItemId))return c.json({code:'PILOT_INVALID'},400);
   if(command==='approve'&&(!id(body.approvalId)||!id(body.requestId)||typeof body.nonce!=='string'||!/^[A-Za-z0-9_-]{32,128}$/.test(body.nonce)||typeof body.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(body.fingerprint)||body.confirmed!==true))return c.json({code:'PILOT_INVALID'},400);
   const jwt=c.get('jwt'),actor=publishActorFromVerifiedSession({workspaceId:c.get('workspaceId'),creatorId:c.get('userId'),verifiedJwt:jwt});
   const service=deps!.create(actor,jwt);
   if(command==='preview')return c.json(await service.preview(jwt,body.submissionId as string,body.workItemId as string));
   if(command==='status')return c.json(await service.status(jwt,body.intentId as string));
   if(command==='collection')return service.collection?c.json(await service.collection(jwt,body.intentId as string)):c.json({code:'PILOT_DISABLED'},503);
   if(command==='prepare-proof')return service.prepareProof?c.json(await service.prepareProof(jwt,body.intentId as string)):c.json({code:'PILOT_DISABLED'},503);
   if(command==='confirm-proof')return service.confirmProof?c.json(await service.confirmProof(jwt,body as MissionProofConfirmation)):c.json({code:'PILOT_DISABLED'},503);
   return c.json(await service.approve(jwt,body as Parameters<typeof service.approve>[1]));
  }catch{return c.json({code:'PILOT_DENIED'},403);}
 });return route;
}
/** Dedicated final-JPEG origin surface, deliberately uninstalled by default.
 * No cache/CDN may be placed in front of it: every fetch rechecks expiry/fence. */
export function createPilotMediaRoutes(store?:{read:(path:string)=>Promise<Uint8Array|null>}){
 const route=new Hono();route.get('/pilot/:workspace/:creator/:intent/:file',async c=>{
  c.header('Cache-Control','private, no-store, max-age=0');c.header('X-Content-Type-Options','nosniff');c.header('Referrer-Policy','no-referrer');
  const p=c.req.param();if(!store||![p.workspace,p.creator,p.intent].every(id)||!p.file.endsWith('.jpg')||!id(p.file.slice(0,-4)))return c.body(null,404);
  try{const bytes=await store.read(`pilot/${p.workspace}/${p.creator}/${p.intent}/${p.file}`);if(!bytes)return c.body(null,404);return new Response(new Uint8Array(bytes).buffer,{headers:{'Content-Type':'image/jpeg','Cache-Control':'private, no-store, max-age=0','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});}catch{return c.body(null,404);}
 });return route;
}

