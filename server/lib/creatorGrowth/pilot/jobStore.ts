import type {PublishOwner,PublishIntent,PublishRepository} from "../publishRepo.js";
export type JobStage="queued"|"before_create"|"container_known"|"before_publish"|"media_known"|"receipt_known";
export interface JobSql{query(text:string,args:readonly unknown[]):Promise<Record<string,unknown>[]>}
export type JobClaim={intent:PublishIntent;fence:number;stage:JobStage;containerId:string|null;mediaId:string|null};
type Checkpoint={intentId:string;workerId:string;fence:number;stage:Exclude<JobStage,"queued">;containerId?:string;mediaId?:string};
const id=(s:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(s);
const worker=(s:string)=>/^[a-zA-Z0-9_-]{1,128}$/.test(s);
const fail=():never=>{throw new Error("PILOT_JOB_DENIED");};
/** Trusted server SQL port only. No connection string, client, default transport or scheduler. */
export class SqlPilotJobStore{
 constructor(private readonly sql:JobSql,private readonly repo:Pick<PublishRepository,"getOwned">,private readonly now:()=>Date,private readonly mode:"fixture"|"provider"="fixture"){}
 async enqueue(owner:PublishOwner,intentId:string):Promise<void>{
  if(!id(intentId))fail();const intent=await this.repo.getOwned(owner,intentId);
  if(intent.id!==intentId||intent.owner.creatorId!==owner.creatorId||intent.owner.workspaceId!==owner.workspaceId||intent.state!=="creator_approved"||intent.stoppedAt||(intent.sampleOnly!==(this.mode==="fixture")||(this.mode==="provider"&&intent.binding.missionBasis?.kind!=="active_mission_provider")))fail();
  await this.sql.query("insert into private.controlled_pilot_jobs(intent_id,workspace_id,creator_id) values($1,$2,$3) on conflict(intent_id) do nothing",[intentId,owner.workspaceId,owner.creatorId]);
 }
 async claim(input:{workerId:string;now:string;leaseUntil:string;recoveryOnly?:boolean}):Promise<JobClaim|null>{
  const current=this.now().getTime(),until=Date.parse(input.leaseUntil);
  if(!worker(input.workerId)||(!Number.isFinite(current)||!Number.isFinite(Date.parse(input.now))||Date.parse(input.now)>current||current-Date.parse(input.now)>5000)||!Number.isFinite(until)||until<=current||until>current+60000)fail();
  const rows=await this.sql.query(`with candidate as (
   select j.intent_id from private.controlled_pilot_jobs j join private.creator_publish_intents i on i.id=j.intent_id and i.workspace_id=j.workspace_id and i.creator_id=j.creator_id
   where i.sample_only=$5::boolean and ($5::boolean or i.binding->'missionBasis'->>'kind'='active_mission_provider') and ($4::boolean=false or j.stage='media_known') and j.stage<>'receipt_known' and (j.lease_until is null or j.lease_until<=$1::timestamptz)
   and (j.stage not in ('media_known','container_known') or (j.read_attempts<5 and (j.next_read_at is null or j.next_read_at<=$1::timestamptz)))
   and (i.stopped_at is null or j.stage='media_known') and i.state not in ('published','failed','cancelled','invalidated')
   order by j.intent_id for update of j skip locked limit 1
  ) update private.controlled_pilot_jobs j set worker_id=$2,lease_until=$3::timestamptz,fence=j.fence+1,read_attempts=j.read_attempts+case when j.stage in ('media_known','container_known') then 1 else 0 end,next_read_at=case when j.stage in ('media_known','container_known') then $1::timestamptz+interval '60 seconds' else j.next_read_at end
  from candidate c where j.intent_id=c.intent_id returning j.*`,[input.now,input.workerId,input.leaseUntil,input.recoveryOnly===true,this.mode==="fixture"]);
  if(!rows.length)return null;const r=rows[0];
  if(typeof r.intent_id!=="string"||typeof r.workspace_id!=="string"||typeof r.creator_id!=="string"||!Number.isSafeInteger(r.fence)||!['queued','before_create','container_known','before_publish','media_known','receipt_known'].includes(String(r.stage)))fail();
  const intent=await this.repo.getOwned({workspaceId:r.workspace_id as string,creatorId:r.creator_id as string},r.intent_id as string);
  if(intent.id!==r.intent_id||(intent.stoppedAt&&r.stage!=="media_known")||(intent.sampleOnly!==(this.mode==="fixture")||(this.mode==="provider"&&intent.binding.missionBasis?.kind!=="active_mission_provider")))fail();
  return {intent,fence:r.fence as number,stage:r.stage as JobStage,containerId:r.container_id as string|null,mediaId:r.media_id as string|null};
 }
 async abandoned(owner:PublishOwner,intentId:string):Promise<boolean>{
  const rows=await this.sql.query("select intent_id from private.controlled_pilot_jobs where intent_id=$1 and workspace_id=$2 and creator_id=$3 and stage in ('before_create','container_known','before_publish') and lease_until<=$4::timestamptz",[intentId,owner.workspaceId,owner.creatorId,this.now().toISOString()]);return rows.length===1;
 }
 /** Monotonic evidence only: an expired/stopped worker cannot publish again.
  * The original repository must first retain this exact target-bound response. */
 async captureAccepted(owner:PublishOwner,intentId:string,containerId:string,mediaId:string):Promise<void>{
  if(![owner.workspaceId,owner.creatorId,intentId].every(id)||![containerId,mediaId].every(v=>/^[1-9][0-9]{0,63}$/.test(v)))fail();
   const rows=await this.sql.query(`update private.controlled_pilot_jobs j set stage='media_known',media_id=$5,read_attempts=1,next_read_at=$6::timestamptz+interval '60 seconds'
   where j.intent_id=$1 and j.workspace_id=$2 and j.creator_id=$3 and j.stage='before_publish' and j.container_id=$4
   and exists(select 1 from private.creator_publish_intents i where i.id=j.intent_id and i.workspace_id=j.workspace_id and i.creator_id=j.creator_id
    and i.sample_only=$7::boolean and i.publish_claim_request_id is not null and i.publish_claim_container_id=$4
    and i.late_receipt->>'mediaId'=$5 and i.late_receipt->>'containerId'=$4) returning j.intent_id`,[intentId,owner.workspaceId,owner.creatorId,containerId,mediaId,this.now().toISOString(),this.mode==='fixture']);
  if(rows.length!==1)fail();
 }
 async checkpoint(input:Checkpoint):Promise<void>{
  if(!id(input.intentId)||!worker(input.workerId)||!Number.isSafeInteger(input.fence)||input.fence<1)fail();
  const before={before_create:"queued",container_known:"before_create",before_publish:"container_known",media_known:"before_publish",receipt_known:"media_known"} as const;
  if(!(input.stage in before)||[input.containerId,input.mediaId].some(v=>v!==undefined&&!/^[1-9][0-9]{0,63}$/.test(v)))fail();
  if(input.stage!=="before_create"&&!input.containerId||(input.stage==="media_known"||input.stage==="receipt_known")&&!input.mediaId)fail();
  const rows=await this.sql.query(`update private.controlled_pilot_jobs set stage=$4,container_id=coalesce(container_id,$5),media_id=coalesce(media_id,$6),
   read_attempts=case when $9::boolean=false and $4 in ('container_known','media_known') then 1 else read_attempts end,
   next_read_at=case when $9::boolean=false and $4 in ('container_known','media_known') then $7::timestamptz+interval '60 seconds' else next_read_at end
   where intent_id=$1 and worker_id=$2 and fence=$3 and lease_until>$7::timestamptz and stage=$8
   and (container_id is null or container_id=$5) and (media_id is null or media_id=$6)
   and exists(select 1 from private.creator_publish_intents i where i.id=intent_id and i.sample_only=$9::boolean and ($9::boolean or i.binding->'missionBasis'->>'kind'='active_mission_provider') and i.stopped_at is null and i.state not in ('failed','cancelled','invalidated')) returning intent_id`,
   [input.intentId,input.workerId,input.fence,input.stage,input.containerId??null,input.mediaId??null,this.now().toISOString(),before[input.stage],this.mode==="fixture"]);
  if(rows.length!==1)fail();
 }
}
