import {createHash,randomUUID} from "node:crypto";
import type {PublishOwner} from "../publishRepo.js";
export type NativeMediaLease=Readonly<{leaseId:string;expiresAt:string;assetSha256:string;provenance:"provider";publicUrl:string}>;
export type ApprovedNativeAsset={owner:PublishOwner;id:string;bytes:Uint8Array;sha256:string;mime:"image/jpeg";width:number;height:number;validated:true;rights:"shareable";sampleOnly:false};
type Input={owner:PublishOwner;intentId:string;approvedAssetId:string;sha256:string;ttlSeconds:900};
type Record={input:Input;lease:NativeMediaLease;closed:boolean};
export interface NativeLeaseStorage{readonly provenance:"provider";put(path:string,bytes:Uint8Array,expiresAt:string):Promise<void>;purge(path:string):Promise<void>;verifyAbsent(path:string):Promise<boolean>;purgeIntent(owner:PublishOwner,intentId:string):Promise<boolean>;reserveIntent(owner:PublishOwner,intentId:string,path:string,expiresAt:string):Promise<boolean>;publicOrigin:string}
const uuid=(v:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const key=(o:PublishOwner,id:string)=>`${o.workspaceId}/${o.creatorId}/${id}`;
const denied=():never=>{throw new Error("PILOT_MEDIA_DENIED");};
/** Explicit native storage port. reserveIntent persists a unique reservation. purgeIntent must durably fence future reservations and in-flight puts before verifying origin/cache absence. put enforces that fence and expiry at origin. No default backend, public route or real connection. */
export class NativeMediaLeaseStore{
 private readonly records=new Map<string,Record>();
 private readonly pending=new Set<string>();
 private readonly cancelled=new Set<string>();
 constructor(private readonly deps:{now:()=>Date;authorize:(input:Input)=>Promise<boolean>;load:(owner:PublishOwner,assetId:string)=>Promise<ApprovedNativeAsset>;storage:NativeLeaseStorage}){
  if(deps.storage.provenance!=="provider")denied();
  const origin=new URL(deps.storage.publicOrigin);if(origin.protocol!=="https:"||origin.username||origin.password||origin.port||origin.pathname!=="/"||origin.search||origin.hash)denied();
 }
 async open(input:Input):Promise<NativeMediaLease>{
  if(!input?.owner||![input.owner.workspaceId,input.owner.creatorId,input.intentId,input.approvedAssetId].every(uuid)||!/^[a-f0-9]{64}$/.test(input.sha256)||input.ttlSeconds!==900)denied();
  const k=key(input.owner,input.intentId);if(this.cancelled.has(k)||this.pending.has(k)||this.records.has(k))denied();this.pending.add(k);
  const snapshot=structuredClone(input);
  try{
   const start=this.deps.now().getTime();if(!Number.isFinite(start)||!await this.deps.authorize(snapshot))denied();
   const a=await this.deps.load(snapshot.owner,snapshot.approvedAssetId);
   if(this.cancelled.has(k)||!a||a.owner?.workspaceId!==snapshot.owner.workspaceId||a.owner?.creatorId!==snapshot.owner.creatorId||a.id!==snapshot.approvedAssetId||a.sampleOnly!==false||a.rights!=="shareable"||a.validated!==true||a.mime!=="image/jpeg"
    ||!Number.isSafeInteger(a.width)||a.width<1||!Number.isSafeInteger(a.height)||a.height<1||!(a.bytes instanceof Uint8Array)||!a.bytes.length||a.bytes.length>20*1024*1024||a.sha256!==snapshot.sha256||createHash('sha256').update(a.bytes).digest('hex')!==snapshot.sha256)denied();
   const leaseId=randomUUID(),path=`pilot/${k}/${leaseId}.jpg`;
   const bytes=a.bytes.slice(),lease={publicUrl:new URL(path,this.deps.storage.publicOrigin).href,leaseId,expiresAt:new Date(start+900000).toISOString(),assetSha256:snapshot.sha256,provenance:"provider" as const};
   if(!await this.deps.authorize(snapshot)||this.cancelled.has(k)||!Number.isFinite(this.deps.now().getTime())||this.deps.now().getTime()>=Date.parse(lease.expiresAt))denied();
   const r={input:snapshot,lease,closed:false};this.records.set(k,r);
   try{
    if(!await this.deps.storage.reserveIntent(snapshot.owner,snapshot.intentId,path,lease.expiresAt)||this.cancelled.has(k)||r.closed)denied();
    await this.deps.storage.put(path,bytes,lease.expiresAt);
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
  if(!owner||![owner.workspaceId,owner.creatorId,intentId].every(uuid))denied();
  const k=key(owner,intentId);this.cancelled.add(k);const r=this.records.get(k);if(r)r.closed=true;
  try{if(!await this.deps.storage.purgeIntent(owner,intentId))throw new Error();if(r){const path=`pilot/${k}/${r.lease.leaseId}.jpg`;if(!await this.deps.storage.verifyAbsent(path))throw new Error();}this.records.delete(k);}catch{throw new Error("PILOT_MEDIA_PURGE_PENDING");}
 }
}
