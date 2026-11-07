// @vitest-environment node
import {expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createLivePilotComposition,type LivePilotSource} from './liveComposition.js';
import {MemoryPublishDatabase,MemoryPublishRepository,type PublishActor} from '../publishRepo.js';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor:PublishActor={workspaceId:id(1),creatorId:id(11),sessionHash:'a'.repeat(64)};
function fixture(){
 const now=()=>new Date('2026-11-06T00:00:00.000Z'),db=new MemoryPublishDatabase(now),repo=new MemoryPublishRepository({enabled:true,database:db,now});db.setOwner({workspaceId:actor.workspaceId,creatorId:actor.creatorId},'active');
 const source:{-readonly [K in keyof LivePilotSource]:LivePilotSource[K]}={owner:{workspaceId:actor.workspaceId,creatorId:actor.creatorId},submissionId:id(21),workItemId:id(31),approvedVersionId:id(41),versionNumber:1,instructionRevision:1,state:'approved_to_publish',caption:'Approved #合作',asset:{id:id(51),versionId:id(41),sha256:'b'.repeat(64),mime:'image/jpeg',validated:true,rights:'shareable'},requiredDisclosures:['#合作'],sponsorIds:['44444'],labelVerified:true,account:{product:'facebook_login',appId:'11111',accountSubject:'22222',connectionId:id(61),grantGeneration:1},sampleOnly:false,provenance:'provider',expiresAt:'2026-11-06T01:00:00.000Z'};
 let active=true;const enqueue=vi.fn(async()=>{});
 const composition=createLivePilotComposition({now,resolveActor:async()=>{if(!active)throw new Error('expired');return actor;},authorize:async()=>active,source:async()=>structuredClone(source),repo,enqueue});
 return {composition,source,db,repo,enqueue,setActive:(v:boolean)=>{active=v;},seed:(binding:Parameters<MemoryPublishDatabase['setSource']>[0]['binding'])=>db.setSource({owner:source.owner,binding,available:true,grantExpiresAt:source.expiresAt,assetExpiresAt:source.expiresAt,sampleOnly:false})};
}
it('binds provider source without relabelling a fixture and reserves once across previews',async()=>{
 const f=fixture();const b=await f.composition.resolve('verified-session',id(21),id(31));f.seed(b.binding);
 expect(b.binding.missionBasis?.kind).toBe('active_mission_provider');
 const p=await f.composition.preview('verified-session',id(21),id(31));
 const input={submissionId:id(21),workItemId:id(31),approvalId:p.approvalId,nonce:p.nonce,fingerprint:p.fingerprint,requestId:randomUUID(),confirmed:true};
 const i=await f.composition.approve('verified-session',input);expect(i.sampleOnly).toBe(false);expect(f.enqueue).toHaveBeenCalledTimes(1);
 const q=await f.composition.preview('verified-session',id(21),id(31));expect((await f.composition.approve('verified-session',{...input,approvalId:q.approvalId,nonce:q.nonce,requestId:randomUUID()})).id).toBe(i.id);
 await expect(f.repo.transition(sourceOwner(f.source),{intentId:i.id,expectedVersion:1,expectedState:'creator_approved',nextState:'container_preparing',fingerprint:b.binding.fingerprint,requestId:randomUUID(),receipt:{sampleOnly:true}})).rejects.toThrow();
});
const sourceOwner=(s:{-readonly [K in keyof LivePilotSource]:LivePilotSource[K]})=>s.owner;
it('hides status if the session expires while the repository read is pending',async()=>{
 const f=fixture(),b=await f.composition.resolve('s',id(21),id(31));f.seed(b.binding);const p=await f.composition.preview('s',id(21),id(31));
 const i=await f.composition.approve('s',{submissionId:id(21),workItemId:id(31),approvalId:p.approvalId,nonce:p.nonce,fingerprint:p.fingerprint,requestId:randomUUID(),confirmed:true});
 const read=f.repo.getOwned.bind(f.repo);vi.spyOn(f.repo,'getOwned').mockImplementation(async(...args)=>{const result=await read(...args);f.setActive(false);return result;});
 await expect(f.composition.status('s',i.id)).rejects.toThrow('PILOT_LIVE_DENIED');
});
it('rejects fixture, colleague, unapproved, expired and wrong-product sources',async()=>{
 for(const mutate of [(s:{-readonly [K in keyof LivePilotSource]:LivePilotSource[K]})=>{s.provenance='fixture' as never;},(s:{-readonly [K in keyof LivePilotSource]:LivePilotSource[K]})=>{s.sampleOnly=true as never;},(s:{-readonly [K in keyof LivePilotSource]:LivePilotSource[K]})=>{s.owner={...s.owner,creatorId:id(12)};},(s:{-readonly [K in keyof LivePilotSource]:LivePilotSource[K]})=>{s.state='in_review';},(s:{-readonly [K in keyof LivePilotSource]:LivePilotSource[K]})=>{s.expiresAt='2020-01-01T00:00:00Z';},(s:{-readonly [K in keyof LivePilotSource]:LivePilotSource[K]})=>{s.labelVerified=false;}]){
  const f=fixture();mutate(f.source);await expect(f.composition.resolve('session',id(21),id(31))).rejects.toThrow('PILOT_LIVE_DENIED');expect(f.enqueue).not.toHaveBeenCalled();
 }
});
it('revalidates exact preview and current session before reservation',async()=>{
 const f=fixture(),b=await f.composition.resolve('s',id(21),id(31));f.seed(b.binding);const p=await f.composition.preview('s',id(21),id(31));
 const input={submissionId:id(21),workItemId:id(31),approvalId:p.approvalId,nonce:p.nonce,fingerprint:p.fingerprint,requestId:randomUUID(),confirmed:true};
 f.source.caption='Changed #合作';await expect(f.composition.approve('s',input)).rejects.toThrow('PILOT_LIVE_DENIED');f.source.caption='Approved #合作';f.setActive(false);await expect(f.composition.approve('s',input)).rejects.toThrow('PILOT_LIVE_DENIED');expect(f.enqueue).not.toHaveBeenCalled();
});
