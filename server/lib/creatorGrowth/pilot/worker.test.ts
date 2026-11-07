// @vitest-environment node
import {createHash} from "node:crypto";
import type {SqlPilotJobStore} from "./jobStore.js";
import {expect,it,vi} from "vitest";
import {PilotWorker} from "./worker.js";
import type {JobClaim} from "./jobStore.js";
import type {PublishIntent} from "../publishRepo.js";
const id="00000000-0000-4000-8000-000000000091";
const account={product:"facebook_login" as const,appId:"11111",accountSubject:"22222",connectionId:"00000000-0000-4000-8000-000000000051",grantGeneration:1};
function setup(stage:JobClaim['stage']="queued"){
 const intent:PublishIntent={id,owner:{workspaceId:"00000000-0000-4000-8000-000000000001",creatorId:"00000000-0000-4000-8000-000000000011"},binding:{draftId:id,draftRevision:1,assetId:id,imageSha256:"a".repeat(64),captionSha256:createHash("sha256").update("Tea").digest("hex"),connectionId:account.connectionId,accountSubject:account.accountSubject,grantGeneration:1,fingerprint:"c".repeat(64)},requestId:id,state:"creator_approved",version:1,receipt:{},lateReceipt:{},sampleOnly:true,stoppedAt:null,createdAt:"2030-01-01T00:00:00.000Z",updatedAt:"2030-01-01T00:00:00.000Z",retentionUntil:"2099-01-01T00:00:00.000Z"};
 const job={intent,fence:1,stage,containerId:stage==="queued"||stage==="before_create"?null:"33333",mediaId:null};
 const claim=vi.fn(async()=>job as JobClaim|null),checkpoint=vi.fn<SqlPilotJobStore["checkpoint"]>(async()=>{}),resolve=vi.fn(async()=>({account,missionId:"mission",fingerprint:intent.binding.fingerprint,caption:"Tea",sponsorIds:["44444"],approved:true as const}));
 const policy={enabled:true,runId:"pilot-1",allowedCreators:[intent.owner.creatorId],allowedMissionIds:["mission"],stopRequested:false};
 const publisher={createImageContainer:vi.fn(async()=>({containerId:"33333"})),getContainerStatus:vi.fn(async()=>({state:"ready"})),publishContainer:vi.fn(async()=>({mediaId:"55555"})),getPublishedMedia:vi.fn(async()=>({mediaId:"55555",accountSubject:account.accountSubject,permalink:"https://www.instagram.com/p/example/",sampleOnly:true as const,provenance:"fixture" as const}))};
 const record=vi.fn(async()=>{}),open=vi.fn(async()=>({leaseId:"lease",expiresAt:"2030-01-01T00:15:00.000Z",assetSha256:"a".repeat(64),provenance:"fixture" as const})),close=vi.fn(async()=>{});
 const dependencies={jobs:{claim,checkpoint},resolve,policy:()=>policy,publisher,lease:{open,close},record,now:()=>new Date("2030-01-01T00:00:00Z")};const worker=new PilotWorker(dependencies);
 return {worker,claim,checkpoint,resolve,policy,publisher,record,open,close,dependencies};
}
it("checkpoints before calls and persists one fixture outcome",async()=>{
 const s=setup();expect(await s.worker.runOne({workerId:"a"})).toBe("processed");
 expect(s.checkpoint.mock.calls.map(c=>(c[0] as {stage:string}).stage)).toEqual(["before_create","container_known","before_publish","media_known","receipt_known"]);
 expect(s.publisher.publishContainer).toHaveBeenCalledOnce();expect(s.record).toHaveBeenCalledWith(expect.objectContaining({state:"published",sampleOnly:true}));expect(s.close).toHaveBeenCalledOnce();
});
it.each(["before_create","before_publish"] as const)("holds ambiguous restart %s without writes",async stage=>{
 const s=setup(stage);expect(await s.worker.runOne({workerId:"b"})).toBe("held_unknown");expect(s.publisher.createImageContainer).not.toHaveBeenCalled();expect(s.publisher.publishContainer).not.toHaveBeenCalled();
});
it("stops when revoked while container status awaits",async()=>{
 const s=setup();s.publisher.getContainerStatus.mockImplementationOnce(async()=>{s.policy.stopRequested=true;return {state:"ready"};});
 expect(await s.worker.runOne({workerId:"a"})).toBe("held_unknown");expect(s.publisher.publishContainer).not.toHaveBeenCalled();
});
it("does not retry after ambiguous publish or failed receipt persistence",async()=>{
 const s=setup();s.publisher.publishContainer.mockRejectedValueOnce(new Error('provider secret'));expect(await s.worker.runOne({workerId:"a"})).toBe("held_unknown");expect(s.publisher.publishContainer).toHaveBeenCalledOnce();
 const t=setup();t.record.mockRejectedValueOnce(new Error('DB stopped'));expect(await t.worker.runOne({workerId:"a"})).toBe("held_unknown");expect(t.publisher.publishContainer).toHaveBeenCalledOnce();
});
it("does not start for a nonallowlisted mission",async()=>{
 const s=setup();s.policy.allowedMissionIds=[];expect(await s.worker.runOne({workerId:"a"})).toBe("blocked");expect(s.open).not.toHaveBeenCalled();expect(s.publisher.createImageContainer).not.toHaveBeenCalled();
});
it("rejects an approved projection whose caption does not match the stored hash",async()=>{
 const s=setup();const original=await s.resolve();s.resolve.mockResolvedValue({...original,caption:"Changed"});expect(await s.worker.runOne({workerId:"a"})).toBe("blocked");expect(s.open).not.toHaveBeenCalled();
});
it("rejects a malformed lease expiry before create",async()=>{
 const s=setup();s.open.mockResolvedValueOnce({leaseId:"lease",expiresAt:"invalid",assetSha256:"a".repeat(64),provenance:"fixture"});
 expect(await s.worker.runOne({workerId:"a"})).toBe("blocked");expect(s.publisher.createImageContainer).not.toHaveBeenCalled();expect(s.close).toHaveBeenCalledOnce();
});
it.each(["generation","sponsor","run"])("rechecks %s after container readiness",async change=>{
 const s=setup(),original=await s.resolve();
 s.publisher.getContainerStatus.mockImplementationOnce(async()=>{
  if(change==="generation")s.resolve.mockResolvedValue({...original,account:{...account,grantGeneration:2}});
  if(change==="sponsor")s.resolve.mockResolvedValue({...original,sponsorIds:["77777"]});
  if(change==="run")s.policy.runId="different-run";
  return {state:"ready"};
 });
 expect(await s.worker.runOne({workerId:"a"})).toBe("held_unknown");expect(s.publisher.publishContainer).not.toHaveBeenCalled();
});
it("rejects a receipt for another account without persisting success",async()=>{
 const s=setup();s.publisher.getPublishedMedia.mockResolvedValueOnce({mediaId:"55555",accountSubject:"99999",permalink:"https://www.instagram.com/p/example/",sampleOnly:true,provenance:"fixture"});
 expect(await s.worker.runOne({workerId:"a"})).toBe("held_unknown");expect(s.record).not.toHaveBeenCalled();
});
it("keeps accepted publication evidence when local stop occurs in flight",async()=>{
 const s=setup();s.publisher.publishContainer.mockImplementationOnce(async()=>{s.policy.stopRequested=true;return {mediaId:"55555"};});
 expect(await s.worker.runOne({workerId:"a"})).toBe("processed");expect(s.record).toHaveBeenCalledOnce();
});
it("does not report fully processed when lease cleanup fails",async()=>{
 const s=setup();s.close.mockRejectedValueOnce(new Error("storage diagnostic"));
 expect(await s.worker.runOne({workerId:"a"})).toBe("held_unknown");expect(s.record).toHaveBeenCalledOnce();
});
it("does not expose database diagnostics when claim fails",async()=>{
 const s=setup();s.claim.mockRejectedValueOnce(new Error("connection credential diagnostic"));
 await expect(s.worker.runOne({workerId:"a"})).resolves.toBe("blocked");expect(s.resolve).not.toHaveBeenCalled();
});

it("rejects a mismatched initial approved mission product before any media lease",async()=>{
 const s=setup(),job=await s.claim();
 s.claim.mockResolvedValueOnce({...job!,intent:{...job!.intent,binding:{...job!.intent.binding,missionBasis:{kind:"active_mission_fixture",product:"facebook_login",appId:"99999",submissionId:"mission",workItemId:id,approvedVersionId:id,instructionRevision:1,disclosureSha256:"d".repeat(64)}}}});
 expect(await s.worker.runOne({workerId:"a"})).toBe("blocked");expect(s.open).not.toHaveBeenCalled();
});

it("checkpoints a known media id before a receipt read can fail",async()=>{const s=setup();s.publisher.getPublishedMedia.mockRejectedValueOnce(new Error("temporary"));expect(await s.worker.runOne({workerId:"a"})).toBe("held_unknown");expect(s.checkpoint).toHaveBeenCalledWith(expect.objectContaining({stage:"media_known",mediaId:"55555"}));});

it("recovers a persisted media id using reads only",async()=>{const s=setup("media_known"),job=await s.claim();s.claim.mockResolvedValueOnce({...job!,mediaId:"55555"});expect(await s.worker.runOne({workerId:"recovery"})).toBe("processed");expect(s.publisher.createImageContainer).not.toHaveBeenCalled();expect(s.publisher.publishContainer).not.toHaveBeenCalled();expect(s.publisher.getPublishedMedia).toHaveBeenCalledOnce();expect(s.record).toHaveBeenCalledOnce();});
it('requires explicit provider mode and keeps native receipt provenance through checkpoints',async()=>{
 const s=setup(),job=(await s.claim())!,projection=await s.resolve();
 const missionBasis={kind:'active_mission_provider' as const,product:'facebook_login' as const,appId:account.appId,submissionId:'mission',workItemId:id,approvedVersionId:id,instructionRevision:1,disclosureSha256:'d'.repeat(64)};
 const providerJob={...job,intent:{...job.intent,sampleOnly:false,binding:{...job.intent.binding,missionBasis}}};
 const deps={...s.dependencies,jobs:{claim:async()=>providerJob,checkpoint:s.checkpoint},resolve:async()=>({...projection,missionBasis}),publisher:{...s.publisher,getPublishedMedia:async()=>({mediaId:'55555',accountSubject:account.accountSubject,permalink:'https://www.instagram.com/p/example/',sampleOnly:false as const,provenance:'provider' as const})},lease:{open:async()=>({leaseId:'lease',expiresAt:'2030-01-01T00:15:00.000Z',assetSha256:'a'.repeat(64),provenance:'provider' as const,publicUrl:'https://media.example.invalid/pilot/approved.jpg'}),close:s.close}};
 expect(await new PilotWorker(deps).runOne({workerId:'default'})).toBe('blocked');
 expect(await new PilotWorker(deps,'provider').runOne({workerId:'native'})).toBe('processed');
 expect(s.publisher.createImageContainer).toHaveBeenCalledWith(expect.objectContaining({mediaHandle:'https://media.example.invalid/pilot/approved.jpg'}));
 expect(s.record).toHaveBeenCalledWith(expect.objectContaining({sampleOnly:false,receipt:expect.objectContaining({provenance:'provider'})}));
});
