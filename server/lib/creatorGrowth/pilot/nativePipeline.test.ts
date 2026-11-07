// @vitest-environment node
import {expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createNativePilotWorker} from './nativePipeline.js';
import {MemoryPublishDatabase,MemoryPublishRepository} from '../publishRepo.js';
import {bindProviderMission} from './missionBinding.js';
import {createMockMissionPilot} from './missionService.js';
import type {JobStage} from './jobStore.js';
it.each(['success','lost','wrong_owner','receipt_lost'])('persists %s through original intent transitions and never republishes',async scenario=>{
 let time=Date.parse('2030-01-01T00:00:00Z');
 const s=createMockMissionPilot().snapshot(),actor={...s.owner,sessionHash:'a'.repeat(64)},now=()=>new Date(time);
 const b=bindProviderMission(actor,{...s,sampleOnly:false,provenance:'provider'}),db=new MemoryPublishDatabase(now);db.setOwner(actor,'active');db.setSource({owner:s.owner,binding:b,available:true,sampleOnly:false,grantExpiresAt:'2099-01-01T00:00:00Z',assetExpiresAt:'2099-01-01T00:00:00Z'});
 const repo=new MemoryPublishRepository({database:db,enabled:true,now}),p=await repo.issuePreview(actor,b),intent=await repo.reserve(actor,{approvalId:p.approvalId,nonce:p.nonce,binding:b,requestId:randomUUID()});
 let stage:JobStage='queued',containerId:string|null=null,mediaId:string|null=null;
 const publish=vi.fn(async()=>{if(scenario==='lost')throw new Error('response lost');return {mediaId:'55555'};});
 let firstObserved:string|undefined;
 const persistReceipt=vi.fn(async()=>{const i=await repo.getOwned(actor,intent.id);if(firstObserved)expect(i.lateReceipt.observedAt).toBe(firstObserved);else firstObserved=i.lateReceipt.observedAt;if(scenario==='receipt_lost'&&persistReceipt.mock.calls.length===1)throw new Error('lost response after snapshot commit');});
 const worker=createNativePilotWorker({repo,now,persistReceipt,jobs:{claim:async()=>{const i=await repo.getOwned(actor,intent.id);return i.state==='published'?null:{intent:i,fence:1,stage,containerId,mediaId};},checkpoint:async c=>{stage=c.stage;containerId=c.containerId??containerId;mediaId=c.mediaId??mediaId;}},resolve:async()=>({missionBasis:b.missionBasis,account:s.account,missionId:s.submissionId,fingerprint:b.fingerprint,caption:s.caption,sponsorIds:s.sponsorIds,approved:true}),policy:()=>({enabled:true,runId:'offline',allowedCreators:[actor.creatorId],allowedMissionIds:[s.submissionId],stopRequested:false}),publisher:{createImageContainer:async()=>({containerId:'33333'}),getContainerStatus:async()=>({state:'ready'}),publishContainer:publish,getPublishedMedia:async()=>({mediaId:'55555',accountSubject:scenario==='wrong_owner'?'99999':s.account.accountSubject,permalink:'https://www.instagram.com/p/example/',sampleOnly:false,provenance:'provider'})},lease:{open:async()=>({leaseId:'offline',expiresAt:'2030-01-01T00:15:00Z',assetSha256:b.imageSha256,provenance:'provider',publicUrl:'https://media.example.invalid/pilot/test.jpg'}),close:async()=>{}}});
 expect(await worker.runOne({workerId:'a'})).toBe(scenario==='success'?'processed':'held_unknown');expect((await repo.getOwned(actor,intent.id)).state).toBe(scenario==='success'?'published':'outcome_unknown');
 expect(persistReceipt).toHaveBeenCalledTimes(['success','receipt_lost'].includes(scenario)?1:0);
 time+=61000;await worker.runOne({workerId:'b'});expect(publish).toHaveBeenCalledTimes(1);if(scenario==='receipt_lost'){expect((await repo.getOwned(actor,intent.id)).state).toBe('published');expect(persistReceipt).toHaveBeenCalledTimes(2);}
});


