// @vitest-environment node
import {randomUUID} from "node:crypto";
import {expect,it} from "vitest";
import {MemoryPublishDatabase,MemoryPublishRepository,type PublishActor} from "../publishRepo.js";
import {bindApprovedMission,type ApprovedMissionSnapshot} from "./missionBinding.js";
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const actor:PublishActor={workspaceId:id(1),creatorId:id(11),sessionHash:"a".repeat(64)};
export function snapshot():ApprovedMissionSnapshot{return {owner:{workspaceId:id(1),creatorId:id(11)},submissionId:id(21),workItemId:id(31),approvedVersionId:id(41),versionNumber:2,instructionRevision:3,state:"approved_to_publish",caption:"Tea #合作",asset:{id:id(51),versionId:id(41),sha256:"b".repeat(64),mime:"image/jpeg",validated:true,rights:"shareable"},requiredDisclosures:["#合作"],sponsorIds:["44444"],labelVerified:true,account:{product:"facebook_login",appId:"11111",accountSubject:"22222",connectionId:id(61),grantGeneration:1},sampleOnly:true};}
it("binds exact approved version, product, app, caption, image and disclosures",()=>{
 const s=snapshot(),b=bindApprovedMission(actor,s);
 expect(b.missionBasis).toMatchObject({product:"facebook_login",appId:"11111",approvedVersionId:s.approvedVersionId,instructionRevision:3});
 for(const changed of [{...s,instructionRevision:4},{...s,sponsorIds:["55555"]},{...s,account:{...s.account,appId:"99999"}}])expect(bindApprovedMission(actor,changed).fingerprint).not.toBe(b.fingerprint);
});
it("rejects unapproved, private, crossowner and nonfixture sources",()=>{
 const s=snapshot();for(const patch of [{state:"in_review"},{sampleOnly:false},{labelVerified:false},{owner:{...s.owner,creatorId:id(12)}},{asset:{...s.asset,rights:"private"}},{caption:"Missing disclosure"}])expect(()=>bindApprovedMission(actor,{...s,...patch} as ApprovedMissionSnapshot)).toThrow();
});
it("reserves one intent across two previews and reconstructed repositories",async()=>{
 const now=()=>new Date("2030-01-01Z"),db=new MemoryPublishDatabase(now),s=snapshot(),binding=bindApprovedMission(actor,s);
 db.setOwner(s.owner,"active");db.setSource({owner:s.owner,binding,available:true,grantExpiresAt:"2099-01-01T00:00:00.000Z",assetExpiresAt:"2099-01-01T00:00:00.000Z",sampleOnly:true});
 const a=new MemoryPublishRepository({enabled:true,database:db,now}),b=new MemoryPublishRepository({enabled:true,database:db,now});
 const p=await a.issuePreview(actor,binding),q=await b.issuePreview(actor,binding);
 const i=await a.reserve(actor,{approvalId:p.approvalId,nonce:p.nonce,binding,requestId:randomUUID()}),j=await b.reserve(actor,{approvalId:q.approvalId,nonce:q.nonce,binding,requestId:randomUUID()});
 expect(j.id).toBe(i.id);
 const next=bindApprovedMission(actor,{...s,instructionRevision:4});db.setSource({owner:s.owner,binding:next,available:true,grantExpiresAt:"2099-01-01T00:00:00.000Z",assetExpiresAt:"2099-01-01T00:00:00.000Z",sampleOnly:true});
 await expect(a.issuePreview(actor,binding)).rejects.toThrow();expect((await a.getOwned(actor,i.id)).state).toBe("invalidated");
});

it("rejects retargeting the same approved version to another app",async()=>{
 const now=()=>new Date("2030-01-01Z"),db=new MemoryPublishDatabase(now),s=snapshot(),b=bindApprovedMission(actor,s),r=new MemoryPublishRepository({enabled:true,database:db,now});db.setOwner(s.owner,"active");
 const set=(binding:typeof b)=>db.setSource({owner:s.owner,binding,available:true,grantExpiresAt:"2099-01-01T00:00:00.000Z",assetExpiresAt:"2099-01-01T00:00:00.000Z",sampleOnly:true});set(b);const p=await r.issuePreview(actor,b);await r.reserve(actor,{approvalId:p.approvalId,nonce:p.nonce,binding:b,requestId:randomUUID()});const next=bindApprovedMission(actor,{...s,account:{...s.account,appId:"77777"}});set(next);const q=await r.issuePreview(actor,next);await expect(r.reserve(actor,{approvalId:q.approvalId,nonce:q.nonce,binding:next,requestId:randomUUID()})).rejects.toThrow();
});
