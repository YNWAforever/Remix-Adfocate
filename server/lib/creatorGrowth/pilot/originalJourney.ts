import {randomUUID} from "node:crypto";
import type {PublishIntent} from "../publishRepo.js";
import type {PGlite} from "@electric-sql/pglite";
import {bindApprovedMission,type ApprovedMissionSnapshot} from "./missionBinding.js";
export const pilotStaff={reviewer:"00000000-0000-4000-8000-000000000041",operator:"00000000-0000-4000-8000-000000000042",workspace_admin:"00000000-0000-4000-8000-000000000043",brand_member:"00000000-0000-4000-8000-000000000044"};
/** Seed only the isolated full-schema fixture, then use original public commands. */
export async function seedOriginalPilotJourney(db:PGlite,s:ApprovedMissionSnapshot,options:{fromUpload?:boolean}={}){
 const w=s.owner.workspaceId,c=s.owner.creatorId,m="00000000-0000-4000-8000-000000001921";
 await db.query("insert into public.workspaces(id,slug,name) values($1,'local-controlled-pilot','Local mock only')",[w]);
 for(const user of [c,...Object.values(pilotStaff)])await db.query("insert into auth.users(id,email) values($1,$2)",[user,user+"@example.test"]);
 await db.query("insert into public.creators(id,workspace_id) values($1,$2)",[c,w]);
 await db.query("insert into public.point_balances(creator_id,workspace_id,balance) values($1,$2,0) on conflict do nothing",[c,w]);
 for(const [role,user] of Object.entries(pilotStaff)){await db.query("insert into public.brand_users(user_id,workspace_id,email,role,active) values($1,$2,$3,'member',true)",[user,w,user+"@example.test"]);if(role!=="brand_member"){await db.query("insert into public.staff_users(user_id,email,active) values($1,$2,true)",[user,user+"@example.test"]);await db.query("insert into public.staff_workspace_roles(user_id,workspace_id,role,granted_by) values($1,$2,$3,$1)",[user,w,role]);}}
 await db.query("insert into public.missions(id,workspace_id,slug,title,mission_type,status,points_reward,cash_reward,creator_workflow_mode) values($1,$2,'local-tea','Synthetic tea task','ugc','active',400,0,'active_workspace')",[m,w]);
 await db.query("insert into public.mission_deliverable_templates(workspace_id,mission_id,title,platform,position,required,publication_instructions,required_disclosures,expected_account) values($1,$2,'JPEG','instagram',0,true,'Local fixture only',$3::jsonb,'@kocmax_demo_only')",[w,m,JSON.stringify(s.requiredDisclosures)]);
 await db.query("insert into public.mission_submissions(id,mission_id,creator_id,workspace_id,status) values($1,$2,$3,$4,'joined')",[s.submissionId,m,c,w]);
 await db.query("select public.create_mission_workflow($1)",[s.submissionId]);
 const flow=(await db.query<{id:string}>("select id from public.mission_workflows where mission_submission_id=$1",[s.submissionId])).rows[0];
 await db.query("insert into public.mission_reward_contracts(workspace_id,mission_workflow_id,mission_submission_id,mission_id,points_amount,cash_amount,currency,xp_amount,source) values($1,$2,$3,$4,400,0,'HKD',0,'join')",[w,flow.id,s.submissionId,m]);
 const item=(await db.query<{id:string}>("select id from public.mission_work_items where mission_workflow_id=$1",[flow.id])).rows[0];
 if(options.fromUpload){
  await db.query("update public.mission_working_drafts set caption_text=$2 where mission_work_item_id=$1",[item.id,s.caption]);
  const asset=(await db.query<{id:string;storage_object_path:string}>("select * from public.create_active_mission_asset($1,$2,$3,$4,'offline.jpg','image/jpeg',100,'jpg',600)",[s.submissionId,c,w,item.id])).rows[0];
  await db.query("insert into storage.objects(bucket_id,name,metadata) values('mission-draft-assets',$1,$2::jsonb)",[asset.storage_object_path,JSON.stringify({mimetype:'image/jpeg',size:100})]);
  await db.query("select public.finalize_active_mission_asset($1,$2,$3,$4,$5,$6)",[s.submissionId,c,w,item.id,asset.id,s.asset.sha256]);
  const draft=(await db.query<{revision:number}>("select revision from public.mission_working_drafts where mission_work_item_id=$1",[item.id])).rows[0];
  const result=(await db.query<{result:{version:{id:string;version_number:number}}}>("select public.submit_active_mission_draft($1,$2,$3,$4,$5,'offline-upload') result",[s.submissionId,c,w,item.id,draft.revision])).rows[0].result;
  await db.query("select public.start_mission_review($1,$2,$3,$4,'submitted')",[flow.id,item.id,pilotStaff.reviewer,w]);
  await db.query("select public.approve_mission_version($1,$2,$3,$4,$5,'under_review')",[flow.id,item.id,result.version.id,pilotStaff.reviewer,w]);
  const instructions=(await db.query<{revision:number}>("select revision from public.mission_publication_instructions where mission_work_item_id=$1",[item.id])).rows[0];
  return {...s,workItemId:item.id,approvedVersionId:result.version.id,versionNumber:result.version.version_number,instructionRevision:instructions.revision,asset:{...s.asset,id:asset.id,versionId:result.version.id}};
 }
 // Starting fixture is an already submitted immutable version; upload/finalization is outside this pilot.
 await db.query("insert into public.mission_draft_versions(id,workspace_id,mission_work_item_id,version_number,caption_snapshot,submitted_by,content_checksum) values($1,$2,$3,3,$4,$5,$6)",[s.approvedVersionId,w,item.id,s.caption,c,s.asset.sha256]);
 await db.query("insert into public.mission_draft_assets(id,workspace_id,mission_workflow_id,mission_work_item_id,creator_id,storage_object_path,original_filename,mime_type,byte_size,checksum,upload_state,file_extension,mission_draft_version_id) values($1,$2,$3,$4,$5,$6,'fixture.jpg','image/jpeg',100,$7,'ready','jpg',$8)",[s.asset.id,w,flow.id,item.id,c,c+'/'+flow.id+'/'+item.id+'/'+s.asset.id+'.jpg',s.asset.sha256,s.approvedVersionId]);
 await db.query("update public.mission_work_items set state='submitted',current_submitted_version_id=$2 where id=$1",[item.id,s.approvedVersionId]);
 await db.query("insert into public.mission_review_rounds(workspace_id,mission_work_item_id,mission_draft_version_id,round_number,state) values($1,$2,$3,1,'open')",[w,item.id,s.approvedVersionId]);
 const version={id:s.approvedVersionId,version_number:3};
 await db.query("select public.start_mission_review($1,$2,$3,$4,'submitted')",[flow.id,item.id,pilotStaff.reviewer,w]);
 await db.query("select public.approve_mission_version($1,$2,$3,$4,$5,'under_review')",[flow.id,item.id,version.id,pilotStaff.reviewer,w]);
 const instructions=(await db.query<{revision:number}>("select revision from public.mission_publication_instructions where mission_work_item_id=$1",[item.id])).rows[0];
 return {...s,workItemId:item.id,approvedVersionId:version.id,versionNumber:version.version_number,instructionRevision:instructions.revision,asset:{...s.asset,versionId:version.id}};
}

export class OriginalPilotJourney{
 constructor(private db:PGlite,private source:ApprovedMissionSnapshot,private published:()=>Promise<PublishIntent|null>){}
 async read(){const s=this.source;const item=(await this.db.query<{state:string;revision:number;workflow_id:string;workflow_state:string;workflow_revision:number;attempt_id:string|null}>("select i.state,p.revision,w.id workflow_id,w.state workflow_state,w.revision workflow_revision,i.current_proof_attempt_id attempt_id from public.mission_work_items i join public.mission_workflows w on w.id=i.mission_workflow_id join public.mission_publication_instructions p on p.mission_work_item_id=i.id where i.id=$1 and i.workspace_id=$2",[s.workItemId,s.owner.workspaceId])).rows[0];const pending=(await this.db.query<{id:string;status:string}>("select id,status from public.mission_pending_rewards where mission_submission_id=$1 and workspace_id=$2 order by created_at desc limit 1",[s.submissionId,s.owner.workspaceId])).rows[0]??null;const ledger=(await this.db.query<{count:number;points:number}>("select count(*)::int count,coalesce(sum(delta),0)::int points from public.point_transactions where creator_id=$1 and workspace_id=$2 and source_ref like 'mission_reward:%'",[s.owner.creatorId,s.owner.workspaceId])).rows[0];return {sampleOnly:true as const,submissionId:s.submissionId,approvedVersionId:s.approvedVersionId,item,pending,ledger};}
 async act(role:string,action:"proof"|"review"|"completion"|"settlement",confirmed:boolean){
  const allowed={proof:"creator",review:"reviewer",completion:"operator",settlement:"workspace_admin"};if(allowed[action]!==role||confirmed!==true)throw new Error("PILOT_JOURNEY_DENIED");
  const s=this.source,w=s.owner.workspaceId,state=await this.read();
  const checked=async(q:string,args:unknown[])=>{const result=await this.db.query<{result:Record<string,unknown>}>(q,args);if(result.rows[0]?.result?.code)throw new Error("PILOT_JOURNEY_STALE");return result;};
  if(action==="proof"){
   const intent=await this.published();const expected=bindApprovedMission({...s.owner,sessionHash:"a".repeat(64)},s);if(!intent||intent.owner?.workspaceId!==s.owner.workspaceId||intent.owner?.creatorId!==s.owner.creatorId||intent.binding.fingerprint!==expected.fingerprint||intent.state!=="published"||intent.sampleOnly!==true||intent.receipt.sampleOnly!==true||!intent.receipt.mediaId||intent.binding.missionBasis?.approvedVersionId!==s.approvedVersionId||intent.binding.missionBasis?.submissionId!==s.submissionId)throw new Error("PILOT_RECEIPT_REQUIRED");
   await checked("select public.submit_mission_publication_proof($1,$2,$3,$4,'approved_to_publish',$5,$6,$7::jsonb,'{}'::uuid[]) result",[s.submissionId,s.owner.creatorId,w,s.workItemId,s.instructionRevision,intent.id,JSON.stringify({primary_url:"https://www.instagram.com/p/FIXTURE_ONLY/",additional_urls:[],metadata_status:"unavailable",metadata_snapshot:{sampleOnly:true,mediaId:intent.receipt.mediaId},metadata_error_category:"provider_unavailable"})]);
  }else if(action==="review"){
   if(!state.item.attempt_id)throw new Error("PILOT_PROOF_REQUIRED");
   if(state.item.state==="proof_submitted")await checked("select public.start_publication_proof_review($1,$2,$3,$4,$5,$6,$7,$8) result",[w,state.item.workflow_id,s.workItemId,state.item.attempt_id,state.item.state,state.item.revision,pilotStaff.reviewer,randomUUID()]);
   const current=await this.read();await checked("select public.verify_publication_proof($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10) result",[w,current.item.workflow_id,s.workItemId,current.item.attempt_id,current.item.state,current.item.revision,pilotStaff.reviewer,randomUUID(),JSON.stringify({publicly_accessible:true,platform_matches:true,account_matches:true,content_matches_approved_version:true,timing_acceptable:true,disclosures_present:true}),"SYNTHETIC OFFLINE REVIEW ONLY"]);
  }else if(action==="completion")await checked("select public.approve_mission_completion($1,$2,$3,$4,$5,$6) result",[w,state.item.workflow_id,pilotStaff.operator,state.item.workflow_state,state.item.workflow_revision,randomUUID()]);
  else {if(!state.pending)throw new Error("PILOT_PENDING_REQUIRED");await checked("select public.settle_mission_reward_handoff($1,$2,$3,$4) result",[w,state.pending.id,pilotStaff.workspace_admin,state.pending.id]);}
  return this.read();
 }
}
