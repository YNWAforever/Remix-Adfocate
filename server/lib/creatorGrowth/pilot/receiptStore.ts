import {createHash} from 'node:crypto';
import type {PublishOwner,PublishRepository,PublishIntent} from '../publishRepo.js';
import type {PublishedMissionProofSource} from '../missionProofHandoff.js';
import type {JobSql} from './jobStore.js';
type Snapshot=Pick<PublishedMissionProofSource,'draft'|'instructionSnapshot'>;
type Receipt={mediaId:string;accountSubject:string;permalink:string;sampleOnly:boolean;provenance:'provider'|'fixture'};
type Dependencies={sql:JobSql;repo:Pick<PublishRepository,'getOwned'>;now:()=>Date;authorize:(owner:PublishOwner)=>Promise<boolean>;snapshot:(intent:PublishIntent)=>Promise<Snapshot>};
const denied=():never=>{throw new Error('PILOT_RECEIPT_DENIED');};
const sha=(text:string)=>createHash('sha256').update(text).digest('hex');
const same=(a:PublishOwner,b:PublishOwner)=>a.workspaceId===b.workspaceId&&a.creatorId===b.creatorId;
/** Server-only: snapshot reads the exact original approved version/instructions;
 * authorize rechecks creator membership. Neither port accepts browser snapshots.
 * This stores no token, signed image URL, private brief or alternate reward. */
export class SqlPilotReceiptStore {
 constructor(private readonly deps:Dependencies){}
 private async owned(owner:PublishOwner,id:string,pending=false){
  if(!await this.deps.authorize(owner))denied();const i=await this.deps.repo.getOwned(owner,id);
  if(i.id!==id||!same(i.owner,owner)||i.sampleOnly!==false||i.binding.missionBasis?.kind!=='active_mission_provider'||!(pending?['publish_requested','outcome_unknown','published']:['published']).includes(i.state)||i.stoppedAt||(i.state==='published'?i.receipt:i.lateReceipt).sampleOnly!==false||!await this.deps.authorize(owner))denied();return i;
 }
 async record(owner:PublishOwner,intentId:string,receipt:Receipt){
  try{
   const i=await this.owned(owner,intentId,true),b=i.binding,m=b.missionBasis!;
   if(receipt.sampleOnly!==false||receipt.provenance!=='provider'||receipt.accountSubject!==b.accountSubject||receipt.mediaId!==(i.state==='published'?i.receipt:i.lateReceipt).mediaId||!/^[1-9][0-9]{0,63}$/.test(receipt.mediaId)||!/^https:\/\/www\.instagram\.com\/p\/[a-zA-Z0-9_-]+\/$/.test(receipt.permalink))denied();
   const s=structuredClone(await this.deps.snapshot(i)),d=s.draft,ins=s.instructionSnapshot;
   if(!same(d.owner,owner)||d.id!==b.draftId||d.revision!==b.draftRevision||d.imageSha256!==b.imageSha256||sha(d.caption)!==b.captionSha256||d.accountSubject!==b.accountSubject||!d.rightsConfirmed||!d.asset.validated||d.asset.mime!=='image/jpeg'||d.mission?.kind!=='active'||!ins||!ins.frozenAt||!ins.requiredDisclosures.every(t=>d.caption.includes(t))||d.mission.submissionId!==m.submissionId||d.mission.workItemId!==m.workItemId||d.mission.approvedVersionId!==m.approvedVersionId||d.mission.instructionRevision!==m.instructionRevision)denied();
   const now=this.deps.now();if(!Number.isFinite(+now)||!Number.isFinite(Date.parse(i.retentionUntil))||Date.parse(i.retentionUntil)<=+now)denied();
   // Stable provider observation time comes from the original transition, not retries.
   const publishedAt=i.lateReceipt?.observedAt??i.receipt.observedAt;if(!publishedAt||!Number.isFinite(Date.parse(publishedAt))||Date.parse(publishedAt)>+now)denied();
   const payload={draft:d,instructionSnapshot:ins,nativeReceipt:{kind:'facebook_login',verified:true,sampleOnly:false,intentId,fingerprint:b.fingerprint,accountSubject:b.accountSubject,mediaId:receipt.mediaId,permalink:receipt.permalink,publishedAt,approvedMission:{submissionId:m.submissionId,workItemId:m.workItemId,approvedVersionId:m.approvedVersionId,instructionRevision:m.instructionRevision}}};
   const json=JSON.stringify(payload);if(Buffer.byteLength(json)>60000)denied();await this.owned(owner,intentId,true);
   await this.deps.sql.query('insert into private.controlled_pilot_receipts(reservation_id,intent_id,workspace_id,creator_id,snapshot,snapshot_hash,retained_until) values($1,$1,$2,$3,$4::jsonb,$5,$6) on conflict(reservation_id) do nothing',[intentId,owner.workspaceId,owner.creatorId,json,sha(json),i.retentionUntil]);
   const rows=await this.deps.sql.query('select snapshot_hash from private.controlled_pilot_receipts where intent_id=$1 and workspace_id=$2 and creator_id=$3 and snapshot is not null',[intentId,owner.workspaceId,owner.creatorId]);if(rows[0]?.snapshot_hash!==sha(json))denied();
  }catch{return denied();}
 }
 async resolvePublished(owner:PublishOwner,intentId:string):Promise<PublishedMissionProofSource>{
  try{
   const intent=await this.owned(owner,intentId),now=this.deps.now();if(!Number.isFinite(+now))denied();
   const rows=await this.deps.sql.query('select snapshot from private.controlled_pilot_receipts where intent_id=$1 and workspace_id=$2 and creator_id=$3 and retained_until>$4::timestamptz and snapshot is not null',[intentId,owner.workspaceId,owner.creatorId,now.toISOString()]);
   if(!rows[0]?.snapshot)denied();const s=rows[0].snapshot as Omit<PublishedMissionProofSource,'intent'>;
   await this.owned(owner,intentId);return {intent,draft:structuredClone(s.draft),instructionSnapshot:structuredClone(s.instructionSnapshot),nativeReceipt:structuredClone(s.nativeReceipt)};
  }catch{return denied();}
 }
 async collection(owner:PublishOwner,intentId:string){
  const s=await this.resolvePublished(owner,intentId);return {intentId,visibility:'private' as const,caption:s.draft.caption,imageSha256:s.draft.imageSha256,approvedVersionId:s.draft.mission!.approvedVersionId,source:{submissionId:s.draft.mission!.submissionId,workItemId:s.draft.mission!.workItemId},receipt:s.nativeReceipt,approvalReusable:false as const};
 }
 async redactExpired(){const now=this.deps.now();if(!Number.isFinite(+now))denied();return (await this.deps.sql.query('update private.controlled_pilot_receipts set snapshot=null where retained_until<=$1::timestamptz and snapshot is not null returning intent_id',[now.toISOString()])).length;}
}


