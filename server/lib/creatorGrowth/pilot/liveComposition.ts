import {bindProviderMission,type ApprovedMissionSnapshot} from './missionBinding.js';
import type {PublishActor,PublishRepository} from '../publishRepo.js';
export type LivePilotSource=Omit<ApprovedMissionSnapshot,'sampleOnly'>&{sampleOnly:false;provenance:'provider';expiresAt:string};
export type LivePilotDependencies={now:()=>Date;resolveActor:(session:string)=>Promise<PublishActor>;authorize:(actor:PublishActor)=>Promise<boolean>;source:(actor:PublishActor,submissionId:string,workItemId:string)=>Promise<LivePilotSource>;repo:PublishRepository;enqueue:(actor:PublishActor,intentId:string)=>Promise<void>};
/** Server-only composition. Not registered in app.ts and no default dependencies.
 * resolveActor must verify the actual session with the original auth service;
 * authorize checks current creator membership, protocol evidence and run allowlist.
 * source reads original approved mission and independently verified grant/rights.
 */
export function createLivePilotComposition(deps:LivePilotDependencies){
 const denied=():never=>{throw new Error('PILOT_LIVE_DENIED');};
 const resolve=async(session:string,submissionId:string,workItemId:string)=>{
  try{
   const actor=await deps.resolveActor(session);if(!await deps.authorize(actor))return denied();
   const source=structuredClone(await deps.source(actor,submissionId,workItemId));
   const now=deps.now().getTime();
   if(source.submissionId!==submissionId||source.workItemId!==workItemId||source.sampleOnly!==false||source.provenance!=='provider'||!Number.isFinite(now)||!Number.isFinite(Date.parse(source.expiresAt))||Date.parse(source.expiresAt)<=now)return denied();
   const binding=bindProviderMission(actor,source);
   if(!await deps.authorize(actor))return denied();
   return {actor,source,binding};
  }catch{return denied();}
 };
 return {resolve,
  async preview(session:string,submissionId:string,workItemId:string){
   const {actor,source,binding}=await resolve(session,submissionId,workItemId);
   const approval=await deps.repo.issuePreview(actor,binding);
   const current=await resolve(session,submissionId,workItemId);if(current.actor.sessionHash!==actor.sessionHash||current.binding.fingerprint!==binding.fingerprint)return denied();
   return {...approval,mode:'pilot' as const,sampleOnly:false as const,submissionId,workItemId,approvedVersionId:source.approvedVersionId,imageSha256:binding.imageSha256,caption:source.caption,accountSubject:source.account.accountSubject,sponsorIds:[...source.sponsorIds],disclosures:[...source.requiredDisclosures],fingerprint:binding.fingerprint};
  },
  async approve(session:string,input:{submissionId:string;workItemId:string;approvalId:string;nonce:string;fingerprint:string;requestId:string;confirmed:boolean}){
   if(input.confirmed!==true)return denied();
   const {actor,binding}=await resolve(session,input.submissionId,input.workItemId);
   if(input.fingerprint!==binding.fingerprint)return denied();
   const intent=await deps.repo.reserve(actor,{approvalId:input.approvalId,nonce:input.nonce,binding,requestId:input.requestId});
   if(intent.sampleOnly!==false||intent.owner.creatorId!==actor.creatorId||intent.owner.workspaceId!==actor.workspaceId||intent.binding.fingerprint!==binding.fingerprint)return denied();
   const latest=await resolve(session,input.submissionId,input.workItemId);if(latest.actor.sessionHash!==actor.sessionHash||latest.binding.fingerprint!==binding.fingerprint)return denied();
   if(intent.state==='creator_approved')await deps.enqueue(actor,intent.id);
   return {id:intent.id,state:intent.state,version:intent.version,sampleOnly:false as const,mode:'pilot' as const};
  },
  async status(session:string,intentId:string){
   let actor:PublishActor;try{actor=await deps.resolveActor(session);if(!await deps.authorize(actor))return denied();}catch{return denied();}
   const i=await deps.repo.getOwned(actor,intentId);if(i.sampleOnly!==false||i.binding.missionBasis?.kind!=='active_mission_provider'||i.owner.creatorId!==actor.creatorId||i.owner.workspaceId!==actor.workspaceId)return denied();
   try{const latest=await deps.resolveActor(session);if(latest.workspaceId!==actor.workspaceId||latest.creatorId!==actor.creatorId||latest.sessionHash!==actor.sessionHash||!await deps.authorize(latest))return denied();}catch{return denied();}
   return {id:i.id,state:i.state,version:i.version,sampleOnly:false as const,mode:'pilot' as const};
  }
 };
}
