import {createHash,randomUUID} from "node:crypto";
import type {PublishOwner} from "../publishRepo.js";
export type PilotMediaLease=Readonly<{leaseId:string;expiresAt:string;assetSha256:string;provenance:"fixture"}>;
export type ApprovedPilotAsset={owner:PublishOwner;id:string;bytes:Uint8Array;sha256:string;mime:"image/jpeg";width:number;height:number;validated:true;rights:"shareable";sampleOnly:true};
type Input={owner:PublishOwner;intentId:string;approvedAssetId:string;sha256:string;ttlSeconds:900};
type Record={input:Input;lease:PilotMediaLease;closed:boolean};
export interface PilotLeaseStorage{readonly provenance:"fixture";put(path:string,bytes:Uint8Array,expiresAt:string):Promise<void>;purge(path:string):Promise<void>}
const uuid=(v:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const key=(o:PublishOwner,id:string)=>`${o.workspaceId}/${o.creatorId}/${id}`;
const denied=():never=>{throw new Error("PILOT_MEDIA_DENIED");};
/** Fixture storage only; no public server, bucket change, URL or external call. */
export class PilotMediaLeaseStore{
 private readonly records=new Map<string,Record>();
 private readonly pending=new Set<string>();
 constructor(private readonly deps:{now:()=>Date;authorize:(input:Input)=>Promise<boolean>;load:(owner:PublishOwner,assetId:string)=>Promise<ApprovedPilotAsset>;storage:PilotLeaseStorage}){
  if(deps.storage.provenance!=="fixture")denied();
 }
 async open(input:Input):Promise<PilotMediaLease>{
  if(!input?.owner||![input.owner.workspaceId,input.owner.creatorId,input.intentId,input.approvedAssetId].every(uuid)||!/^[a-f0-9]{64}$/.test(input.sha256)||input.ttlSeconds!==900)denied();
  const k=key(input.owner,input.intentId);if(this.pending.has(k)||this.records.has(k))denied();this.pending.add(k);
  const snapshot=structuredClone(input);
  try{
   const start=this.deps.now().getTime();if(!Number.isFinite(start)||!await this.deps.authorize(snapshot))denied();
   const a=await this.deps.load(snapshot.owner,snapshot.approvedAssetId);
   if(!a||a.owner?.workspaceId!==snapshot.owner.workspaceId||a.owner?.creatorId!==snapshot.owner.creatorId||a.id!==snapshot.approvedAssetId||a.sampleOnly!==true||a.rights!=="shareable"||a.validated!==true||a.mime!=="image/jpeg"
    ||!Number.isSafeInteger(a.width)||a.width<1||!Number.isSafeInteger(a.height)||a.height<1||!(a.bytes instanceof Uint8Array)||!a.bytes.length||a.bytes.length>20*1024*1024||a.sha256!==snapshot.sha256||createHash('sha256').update(a.bytes).digest('hex')!==snapshot.sha256)denied();
   const bytes=a.bytes.slice(),lease={leaseId:randomUUID(),expiresAt:new Date(start+900000).toISOString(),assetSha256:snapshot.sha256,provenance:"fixture" as const};
   if(!await this.deps.authorize(snapshot)||!Number.isFinite(this.deps.now().getTime())||this.deps.now().getTime()>=Date.parse(lease.expiresAt))denied();
   const r={input:snapshot,lease,closed:false};this.records.set(k,r);
   try{
    await this.deps.storage.put(`${k}/${lease.leaseId}.jpg`,bytes,lease.expiresAt);
    const authorized=await this.deps.authorize(snapshot);
    if(!authorized||r.closed||this.records.get(k)!==r||!Number.isFinite(this.deps.now().getTime())||this.deps.now().getTime()>=Date.parse(lease.expiresAt))denied();
    r.closed=false;return {...lease};
   }catch{if(!this.records.has(k))this.records.set(k,r);await this.close(snapshot.owner,snapshot.intentId);return denied();}
  }catch(error){if(error instanceof Error&&error.message==="PILOT_MEDIA_PURGE_PENDING")throw error;return denied();}finally{this.pending.delete(k);}
 }
 async isUsable(owner:PublishOwner,intentId:string):Promise<boolean>{
  const r=this.records.get(key(owner,intentId));if(!r||r.closed||this.pending.has(key(owner,intentId))||!Number.isFinite(this.deps.now().getTime())||this.deps.now().getTime()>=Date.parse(r.lease.expiresAt))return false;
  try{const authorized=await this.deps.authorize(structuredClone(r.input));const now=this.deps.now().getTime();return authorized===true&&!r.closed&&this.records.get(key(owner,intentId))===r&&Number.isFinite(now)&&now<Date.parse(r.lease.expiresAt);}catch{return false;}
 }
 async close(owner:PublishOwner,intentId:string):Promise<void>{
  const k=key(owner,intentId),r=this.records.get(k);if(!r)return;r.closed=true;
  try{await this.deps.storage.purge(`${k}/${r.lease.leaseId}.jpg`);this.records.delete(k);}catch{throw new Error("PILOT_MEDIA_PURGE_PENDING");}
 }
}
