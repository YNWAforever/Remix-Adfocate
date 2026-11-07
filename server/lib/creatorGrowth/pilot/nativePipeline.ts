import {randomUUID} from 'node:crypto';
import type {PublishIntent,PublishReceipt,PublishRepository,PublishState} from '../publishRepo.js';
import {PilotWorker} from './worker.js';
import type {SqlPilotJobStore} from './jobStore.js';
type WorkerDependencies=ConstructorParameters<typeof PilotWorker>[0];
/** Server composition only: callers supply every authority and effect. No runtime registration. */
export function createNativePilotWorker(deps:Omit<WorkerDependencies,'jobs'|'record'|'accepted'>&{jobs:Pick<SqlPilotJobStore,'claim'|'checkpoint'>&Partial<Pick<SqlPilotJobStore,'captureAccepted'>>;repo:PublishRepository;persistReceipt?:(intent:PublishIntent,receipt:Parameters<WorkerDependencies['record']>[0]['receipt'])=>Promise<void>}){
 const claimed=new Map<string,PublishIntent>();
 const transition=async(i:PublishIntent,nextState:PublishState,receipt:PublishReceipt={})=>(await deps.repo.transition(i.owner,{intentId:i.id,expectedVersion:i.version,expectedState:i.state,nextState,fingerprint:i.binding.fingerprint,receipt,requestId:randomUUID()})).intent;
 let lastClaim:PublishIntent|null=null;
 const worker=new PilotWorker({...deps,jobs:{
  claim:async input=>{const job=await deps.jobs.claim(input);if(job){if(job.intent.sampleOnly!==false||job.intent.binding.missionBasis?.kind!=='active_mission_provider')throw new Error('PILOT_NATIVE_DENIED');lastClaim=job.intent;
   if(job.stage==='container_known'&&job.containerId&&job.intent.state==='container_preparing')job.intent=await transition(job.intent,'provider_processing',{containerId:job.containerId,status:'processing',sampleOnly:false});
   claimed.set(job.intent.id,job.intent);lastClaim=job.intent;}return job;},
  checkpoint:async c=>{
   const known=claimed.get(c.intentId);if(!known)throw new Error('PILOT_NATIVE_DENIED');
   try{await deps.jobs.checkpoint(c);}catch(error){
    if(c.stage!=='media_known'||!c.containerId||!c.mediaId||!deps.jobs.captureAccepted)throw error;
    await deps.jobs.captureAccepted(known.owner,c.intentId,c.containerId,c.mediaId);
   }
   let i=await deps.repo.getOwned(known.owner,c.intentId);
   if(c.stage==='before_create')await transition(i,'container_preparing');
   if(c.stage==='container_known')await transition(i,'provider_processing',{containerId:c.containerId,status:'processing',sampleOnly:false});
   if(c.stage==='before_publish'){i=await transition(i,'provider_processing',{containerId:c.containerId,status:'ready',sampleOnly:false});await transition(i,'publish_requested');}
   if(c.stage==='receipt_known'&&i.state!=='published')throw new Error('PILOT_NATIVE_DENIED');
  }
 },accepted:async response=>{
  const known=claimed.get(response.intentId);if(!known)throw new Error('PILOT_NATIVE_DENIED');
  await deps.repo.recordLateReceipt(known.owner,{intentId:known.id,requestId:randomUUID(),target:{connectionId:known.binding.connectionId,accountSubject:known.binding.accountSubject,grantGeneration:known.binding.grantGeneration},receipt:{containerId:response.containerId,mediaId:response.mediaId,status:'unknown',sampleOnly:false,observedAt:deps.now().toISOString()}});
 },record:async outcome=>{
  const known=claimed.get(outcome.intentId);if(!known||outcome.sampleOnly!==false||outcome.receipt.provenance!=='provider'||outcome.receipt.sampleOnly!==false||outcome.receipt.accountSubject!==known.binding.accountSubject)throw new Error('PILOT_NATIVE_DENIED');
  let i=await deps.repo.getOwned(known.owner,known.id);
  let receipt:PublishReceipt={mediaId:outcome.receipt.mediaId,status:'published',sampleOnly:false,observedAt:deps.now().toISOString()};
  if(i.state==='outcome_unknown'&&i.lateReceipt.mediaId===receipt.mediaId&&i.lateReceipt.observedAt)receipt={...receipt,observedAt:i.lateReceipt.observedAt};
  if(i.state==='outcome_unknown')i=await deps.repo.recordLateReceipt(i.owner,{intentId:i.id,requestId:randomUUID(),target:{connectionId:i.binding.connectionId,accountSubject:i.binding.accountSubject,grantGeneration:i.binding.grantGeneration},receipt});
  if(deps.persistReceipt)await deps.persistReceipt(i,outcome.receipt);
  if(i.state!=='published')await transition(i,'published',receipt);
 }},'provider');
 let running=false;
 return {async runOne(input:{workerId:string}){
  if(running)return 'blocked' as const;running=true;lastClaim=null;
  try{
   const result=await worker.runOne(input);
   const previous=lastClaim as PublishIntent|null;
   if(previous&&(result==='held_unknown'||result==='blocked')){
    try{const i=await deps.repo.getOwned(previous.owner,previous.id);
     if(['container_preparing','provider_processing','publish_requested'].includes(i.state))await transition(i,'outcome_unknown',{status:'unknown',sampleOnly:false});
     else if(i.state==='creator_approved'&&result==='blocked')await transition(i,'invalidated');
    }catch{return 'held_unknown' as const;}
   }
   return result;
  }finally{running=false;claimed.clear();}
 }};
}


