import type {PilotAccount} from "./protocol.js";
import {createHash,randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {MemoryPublishDatabase,MemoryPublishRepository,type PublishActor,type PublishBinding,type PublishIntent,type PublishReceipt,type PublishState,type PublishRepository} from "../publishRepo.js";
import {resolveApprovedPilotSource,type ApprovedSourceDependencies} from "./approvedSource.js";
import {bindApprovedMission,type ApprovedMissionSnapshot} from "./missionBinding.js";
import {FacebookLoginPilotAdapter} from "./facebookLoginAdapter.js";
import {PilotWorker} from "./worker.js";
import {PilotMediaLeaseStore} from "./mediaLease.js";
import type {JobStage,SqlPilotJobStore} from "./jobStore.js";
export type PilotMockScenario="ok"|"unknown"|"changed"|"label"|"private"|"revoked";
export type PilotMockConfirmation={approvalId:string;nonce:string;fingerprint:string;requestId:string;confirmed?:boolean};
export type PilotMockStatus={id:string;state:PublishState;version:number;sampleOnly:true;accountLabel:string;approvedVersionId:string;instructionRevision:number;canSubmitRealProof:false;providerRevocation:"unverified"};
export type PilotMockPreview={sampleOnly:true;caption:string;imageSha256:string;imagePath:string;accountLabel:string;approvedVersionId:string;instructionRevision:number;disclosures:readonly string[];sponsorIds:readonly string[];expiresAt:string;confirmation:PilotMockConfirmation};
export type PilotLocalMeta={scenario:PilotMockScenario;stopped:boolean;counts:{create:number;publish:number;reads:number;proof:number;reward:number}};
export interface PilotPersistence{
 repo:PublishRepository;jobs:SqlPilotJobStore;initial:PilotLocalMeta;
 setSource(binding:PublishBinding,available:boolean):Promise<void>;
 current():Promise<string|null>;saveMeta(meta:PilotLocalMeta):Promise<void>;
}
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const owner={workspaceId:id(1),creatorId:id(11)};
const denied=():never=>{throw new Error("PILOT_MISSION_DENIED");};

/** Explicit local fixture composition. Never imported by production app.ts.
 * The existing repository is authoritative for intents; this object only supplies
 * synthetic original-mission projections and fixture effects for rehearsal. */
export function createMockMissionPilot(options:{outcome?:"unknown";now?:()=>Date;persistence?:PilotPersistence;originalSnapshot?:ApprovedMissionSnapshot;grant?:(actor:PublishActor)=>Promise<PilotAccount>}={}) {
 const now=options.now??(()=>new Date());
 const bytes=new Uint8Array(readFileSync(new URL("../../../test/fixtures/controlled-pilot.jpg",import.meta.url)));
 const sha=createHash("sha256").update(bytes).digest("hex");
 const snapshot:ApprovedMissionSnapshot=options.originalSnapshot??{owner,submissionId:id(1931),workItemId:id(1941),approvedVersionId:id(1951),versionNumber:3,instructionRevision:1,state:"approved_to_publish",caption:"一杯茶的真實體驗，今天分享日常的小片刻。 #合作（合成示例）",asset:{id:id(1961),versionId:id(1951),sha256:sha,mime:"image/jpeg",validated:true,rights:"shareable"},requiredDisclosures:["#合作"],sponsorIds:["44444"],labelVerified:true,account:{product:"facebook_login",appId:"11111",accountSubject:"123456789",connectionId:id(61),grantGeneration:1},sampleOnly:true};
 let scenario:PilotMockScenario=options.outcome==="unknown"?"unknown":"ok",stopped=false,intentId:string|null=null,running:Promise<void>|null=null;
 let currentAccount=snapshot.account;
 let lastBinding:PublishBinding|null=null,readAttempts=0,nextRead=0;
 const counts={create:0,publish:0,reads:0,proof:0,reward:0};
 const db=new MemoryPublishDatabase(now),repo=options.persistence?.repo??new MemoryPublishRepository({database:db,enabled:true,now});db.setOwner(owner,"active");
 if(options.persistence){scenario=options.persistence.initial.scenario;stopped=options.persistence.initial.stopped;Object.assign(counts,options.persistence.initial.counts);}
 const saveMeta=async()=>{await options.persistence?.saveMeta({scenario,stopped,counts:{...counts}});};
 const setSource=async(binding:PublishBinding,available:boolean)=>{if(options.persistence)await options.persistence.setSource(binding,available);else db.setSource({owner,binding,available,grantExpiresAt:"2099-01-01T00:00:00.000Z",assetExpiresAt:"2099-01-01T00:00:00.000Z",sampleOnly:true});};
 const currentId=async()=>options.persistence?options.persistence.current():intentId;
 const source=():ApprovedMissionSnapshot=>{const s=structuredClone(snapshot);return {...s,instructionRevision:s.instructionRevision+(scenario==="changed"?1:0),labelVerified:scenario!=="label",asset:{...s.asset,rights:scenario==="private"?"private":"shareable"},account:{...currentAccount,grantGeneration:scenario==="revoked"?currentAccount.grantGeneration+1:currentAccount.grantGeneration}};};
 const sourceDependencies:ApprovedSourceDependencies= {
  repo:{getWorkspace:async()=>{const s=source();return {workflow:{submissionId:s.submissionId},workItems:[{id:s.workItemId,platform:"instagram",state:s.state,approvedVersionId:s.approvedVersionId,currentSubmittedVersionId:s.approvedVersionId,versions:[{id:s.approvedVersionId,versionNumber:s.versionNumber,state:s.state,caption:s.caption,assets:[{id:s.asset.id,versionId:s.asset.versionId,mimeType:s.asset.mime,checksum:s.asset.sha256,uploadState:"uploaded"}]}]}]};},
   getPublication:async()=>{const s=source();return {workItemId:s.workItemId,platform:"instagram",state:s.state,approvedVersionId:s.approvedVersionId,revision:s.instructionRevision,instructions:{requiredDisclosures:s.requiredDisclosures}};}},
  identity:async()=>{const s=source();if(!s.labelVerified)denied();return {account:s.account,sponsorIds:s.sponsorIds,labelVerified:true,provenance:"fixture"};},
  rights:async()=>{const s=source();if(s.asset.rights!=="shareable"||!s.asset.validated)denied();return {validated:true,shareable:true,sha256:s.asset.sha256,provenance:"fixture"};}
 };
 const authorize=(a:PublishActor)=>{if(!a||a.creatorId!==owner.creatorId||a.workspaceId!==owner.workspaceId||!/^[a-f0-9]{64}$/.test(a.sessionHash))denied();};
 const sync=async(a:PublishActor)=>{
  authorize(a);let binding:PublishBinding;
  try{if(stopped||scenario==="revoked")denied();if(options.grant)currentAccount=await options.grant(a);binding=bindApprovedMission(a,await resolveApprovedPilotSource(a,snapshot.submissionId,snapshot.workItemId,sourceDependencies));}
  catch{if(lastBinding)await setSource(lastBinding,false);return denied();}
  await setSource(binding,true);lastBinding=binding;return binding;
 };
 const status=(i:PublishIntent):PilotMockStatus=>({id:i.id,state:i.state,version:i.version,sampleOnly:true,accountLabel:"@kocmax_demo_only",approvedVersionId:i.binding.missionBasis!.approvedVersionId,instructionRevision:i.binding.missionBasis!.instructionRevision,canSubmitRealProof:false,providerRevocation:"unverified"});
 async function transition(i:PublishIntent,nextState:PublishState,receipt:PublishReceipt={}){return (await repo.transition(owner,{intentId:i.id,expectedVersion:i.version,expectedState:i.state,nextState,fingerprint:i.binding.fingerprint,receipt,requestId:randomUUID()})).intent;}
 async function run(a:PublishActor,intent:PublishIntent,recoveryOnly=false){
  let stage:JobStage="queued",claimed=false;
  const publisher=new FacebookLoginPilotAdapter(source().account,{version:"v99.0",host:"graph.facebook.com",scopes:["instagram_basic","instagram_content_publish","pages_read_engagement"],identityEvidence:"fixture:identity",labelEvidence:"fixture:label",revokeEvidence:"fixture:revoke",status:"verified",provenance:"fixture"},{provenance:"fixture",request:async({operation})=>{
   if(operation==="create"){counts.create++;await saveMeta();return {id:"33333"};}
   if(operation==="status"){counts.reads++;await saveMeta();return {status_code:"FINISHED"};}
   if(operation==="publish"){counts.publish++;await saveMeta();if(scenario==="unknown")throw new Error("FIXTURE_LOST_RESPONSE");return {id:"55555"};}
   counts.reads++;await saveMeta();return {id:"55555",owner:{id:snapshot.account.accountSubject},permalink:"https://www.instagram.com/p/FIXTURE_ONLY/"};
  }});
  const lease=new PilotMediaLeaseStore({now,authorize:async()=>{try{return (await sync(a)).fingerprint===intent.binding.fingerprint;}catch{return false;}},load:async()=>({owner,id:snapshot.asset.id,bytes,sha256:sha,mime:"image/jpeg",width:640,height:640,validated:true,rights:"shareable",sampleOnly:true}),storage:{provenance:"fixture",put:async()=>{},purge:async()=>{}}});
  const worker=new PilotWorker({now,policy:()=>({enabled:true,runId:"controlled-local",allowedCreators:[owner.creatorId],allowedMissionIds:[snapshot.submissionId],stopRequested:stopped}),
   resolve:async()=>{const binding=await sync(a),s=source();return {missionBasis:binding.missionBasis,account:s.account,missionId:s.submissionId,fingerprint:binding.fingerprint,caption:s.caption,sponsorIds:s.sponsorIds,approved:true};},publisher,lease,
   jobs:{claim:async()=>{if(options.persistence)return options.persistence.jobs.claim({workerId:"local-fixture",now:now().toISOString(),leaseUntil:new Date(now().getTime()+60000).toISOString(),recoveryOnly});if(claimed)return null;claimed=true;return {intent,fence:1,stage,containerId:null,mediaId:null};},checkpoint:async c=>{
    if(options.persistence)await options.persistence.jobs.checkpoint(c);
    let i=await repo.getOwned(owner,intent.id);
    if(c.stage==="before_create")await transition(i,"container_preparing");
    if(c.stage==="container_known")await transition(i,"provider_processing",{containerId:c.containerId,status:"processing",sampleOnly:true});
    if(c.stage==="before_publish"){i=await transition(i,"provider_processing",{containerId:c.containerId,status:"ready",sampleOnly:true});await transition(i,"publish_requested");}
    if(c.stage==="receipt_known"&&i.state!=="published")denied();stage=c.stage;
   }},record:async r=>{let i=await repo.getOwned(owner,intent.id);if(i.state==="outcome_unknown")i=await repo.recordLateReceipt(owner,{intentId:i.id,requestId:randomUUID(),target:{connectionId:i.binding.connectionId,accountSubject:i.binding.accountSubject,grantGeneration:i.binding.grantGeneration},receipt:{mediaId:r.receipt.mediaId,status:"published",sampleOnly:true,observedAt:now().toISOString()}});await transition(i,"published",{mediaId:r.receipt.mediaId,status:"published",sampleOnly:true,observedAt:now().toISOString()});}
  });
  const result=await worker.runOne({workerId:"local-fixture"});
  if(result!=="processed"&&result!=="idle"){const i=await repo.getOwned(owner,intent.id);if(!["published","invalidated","cancelled","outcome_unknown"].includes(i.state))await transition(i,i.state==="creator_approved"?"invalidated":"outcome_unknown",i.state==="creator_approved"?{}:{status:"unknown",sampleOnly:true});}
 }
 return {
  async preview(a:PublishActor):Promise<PilotMockPreview>{const binding=await sync(a),s=source(),p=await repo.issuePreview(a,binding);return {sampleOnly:true,caption:s.caption,imageSha256:sha,imagePath:"/api/controlled-pilot-mock/image",accountLabel:"@kocmax_demo_only",approvedVersionId:s.approvedVersionId,instructionRevision:s.instructionRevision,disclosures:[...s.requiredDisclosures],sponsorIds:[...s.sponsorIds],expiresAt:p.expiresAt,confirmation:{approvalId:p.approvalId,nonce:p.nonce,fingerprint:binding.fingerprint,requestId:randomUUID()}};},
  async approve(a:PublishActor,c:PilotMockConfirmation):Promise<PilotMockStatus>{const binding=await sync(a);if(c.confirmed!==true||c.fingerprint!==binding.fingerprint)denied();const i=await repo.reserve(a,{approvalId:c.approvalId,nonce:c.nonce,binding,requestId:c.requestId});intentId=i.id;
   if(i.state==="creator_approved"&&!running){if(options.persistence)await options.persistence.jobs.enqueue(owner,i.id);running=run(a,i);try{await running;}finally{running=null;}}else if(running)await running;
   return status(await repo.getOwned(owner,i.id));},
  async current(a:PublishActor):Promise<PilotMockStatus|null>{authorize(a);const found=await currentId();return found?status(await repo.getOwned(owner,found)):null;},
  async reconcile(a:PublishActor){authorize(a);const found=await currentId();if(found&&options.persistence){let current=await repo.getOwned(owner,found);if(["container_preparing","provider_processing","publish_requested"].includes(current.state)&&await options.persistence.jobs.abandoned(owner,found))current=await transition(current,"outcome_unknown",{status:"unknown",sampleOnly:true});if(current.state!=="published")await run(a,current,true);return status(await repo.getOwned(owner,found));}if(found&&readAttempts<5&&now().getTime()>=nextRead){readAttempts++;nextRead=now().getTime()+60000;counts.reads++;}return found?status(await repo.getOwned(owner,found)):null;},
  async changeScenario(next:PilotMockScenario){scenario=next;await saveMeta();},async stop(){stopped=true;await saveMeta();if(lastBinding)await setSource(lastBinding,false);},
  readiness:()=>({stopped,providerRevocation:"unverified" as const,liveReady:false as const,sampleOnly:true as const}),counts:()=>({...counts}),image:()=>bytes.slice(),snapshot:()=>structuredClone(source()),
 };
}
