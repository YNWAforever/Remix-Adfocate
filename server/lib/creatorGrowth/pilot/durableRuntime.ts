import {PilotPrivateWorkspace} from "./privateWorkspace.js";
import {openLocalPilotDatabase} from "./localDatabase.js";
import {createHash} from "node:crypto";
import {OriginalPilotJourney,seedOriginalPilotJourney} from "./originalJourney.js";
import type {ApprovedMissionSnapshot} from "./missionBinding.js";
import {resolve,relative,isAbsolute} from "node:path";
import {SupabasePublishRepository} from "../publishRepo.js";
import {SqlPilotJobStore} from "./jobStore.js";
import {createMockMissionPilot,type PilotLocalMeta} from "./missionService.js";
import {initializePilotFixture} from "./localFixtureDatabase.js";
const ws="00000000-0000-4000-8000-000000000001",creator="00000000-0000-4000-8000-000000000011";
/** Explicit filesystem PGlite fixture, not a remote database adapter. */
export async function openDurablePilot(directory:string,now=()=>new Date()){
 const root=resolve(".superpowers"),path=resolve(directory),rel=relative(root,path);if(!rel||rel.startsWith("..")||isAbsolute(rel)||directory.includes("://"))throw new Error("LOCAL_PILOT_PATH_REQUIRED");
 const {db,close}=await openLocalPilotDatabase(path);
 try{
  // A damaged local fixture must fail closed instead of freezing Vite or a request.
  await db.exec("set statement_timeout='5s';set lock_timeout='2s';");
  const exists=(await db.query<{name:string|null}>("select to_regclass('private.controlled_pilot_local_meta') name")).rows[0].name;
  if(!exists){await db.exec("begin;");await initializePilotFixture(db,true);await db.exec("create table private.controlled_pilot_local_meta(id integer primary key check(id=1),value jsonb not null,snapshot jsonb not null);revoke all on private.controlled_pilot_local_meta from public,anon,authenticated,service_role;");const snapshot=await seedOriginalPilotJourney(db,createMockMissionPilot().snapshot());await db.query("insert into private.controlled_pilot_local_meta values(1,$1::jsonb,$2::jsonb)",[JSON.stringify({scenario:"ok",stopped:false,counts:{create:0,publish:0,reads:0,proof:0,reward:0}}),JSON.stringify(snapshot)]);await db.exec("commit;");}
  const snapshot=(await db.query<{snapshot:ApprovedMissionSnapshot}>("select snapshot from private.controlled_pilot_local_meta where id=1")).rows[0].snapshot;
  const initial=(await db.query<{value:PilotLocalMeta}>("select value from private.controlled_pilot_local_meta where id=1")).rows[0].value;
  const repo=new SupabasePublishRepository({enabled:true,now,rpc:async(_name,args)=>(await db.query<{result:unknown}>("select public.creator_pilot_fixture_command($1,$2,$3,$4::jsonb,$5::timestamptz) result",[args.p_workspace,args.p_creator,args.p_action,JSON.stringify(args.p_payload),args.p_now])).rows[0].result});
  await db.exec("insert into private.controlled_pilot_jobs(intent_id,workspace_id,creator_id) select id,workspace_id,creator_id from private.creator_publish_intents where state='creator_approved' and stopped_at is null and sample_only=true on conflict(intent_id) do nothing;");
  const jobs=new SqlPilotJobStore({query:async(q,args)=>(await db.query(q,[...args])).rows as Record<string,unknown>[]},repo,now);
  const privateWorkspace=await PilotPrivateWorkspace.open(db,snapshot,async()=>{const row=(await db.query<{id:string}>("select id from private.creator_publish_intents where workspace_id=$1 and creator_id=$2 order by created_at desc,id desc limit 1",[ws,creator])).rows[0];return row?repo.getOwned(snapshot.owner,row.id):null;},now);
  const pilot=createMockMissionPilot({now,originalSnapshot:snapshot,grant:a=>privateWorkspace.requireGrant(a),persistence:{repo,jobs,initial,
   setSource:async(binding,available)=>{
    const row=(await db.query<{state:string;version_id:string;caption:string;checksum:string;revision:number;disclosures:string[]}>("select i.state,i.approved_version_id version_id,v.caption_snapshot caption,a.checksum,p.revision,p.required_disclosures disclosures from public.mission_work_items i join public.mission_workflows f on f.id=i.mission_workflow_id join public.mission_submissions s on s.id=f.mission_submission_id join public.mission_draft_versions v on v.id=i.approved_version_id join public.mission_draft_assets a on a.mission_draft_version_id=v.id and a.mission_work_item_id=i.id join public.mission_publication_instructions p on p.mission_work_item_id=i.id where i.id=$1 and i.workspace_id=$2 and s.creator_id=$3 and s.id=$4 and a.id=$5 and a.upload_state='ready' and a.deleted_at is null",[snapshot.workItemId,ws,creator,snapshot.submissionId,binding.assetId])).rows[0];
    const digest=(text:string)=>createHash("sha256").update(text).digest("hex");
    if(available&&(!row||row.state!=="approved_to_publish"||row.version_id!==binding.draftId||row.revision!==binding.missionBasis?.instructionRevision||digest(row.caption)!==binding.captionSha256||row.checksum!==binding.imageSha256||digest(JSON.stringify([row.disclosures,snapshot.sponsorIds]))!==binding.missionBasis?.disclosureSha256)){
     await db.query("update private.controlled_pilot_fixture_sources set available=false where workspace_id=$1 and creator_id=$2",[ws,creator]);throw new Error("PILOT_ORIGINAL_VERSION_STALE");
    }
    await db.query("insert into private.controlled_pilot_fixture_sources(workspace_id,creator_id,version_id,binding,available) values($1,$2,$3,$4::jsonb,$5) on conflict(workspace_id,creator_id,version_id) do update set binding=excluded.binding,available=excluded.available",[ws,creator,binding.draftId,JSON.stringify(binding),available]);},
   current:async()=>(await db.query<{id:string}>("select id from private.creator_publish_intents where workspace_id=$1 and creator_id=$2 order by created_at desc,id desc limit 1",[ws,creator])).rows[0]?.id??null,
   saveMeta:async(meta)=>{await db.query("update private.controlled_pilot_local_meta set value=$1::jsonb where id=1",[JSON.stringify(meta)]);}
  }});
  const journey=new OriginalPilotJourney(db,snapshot,async()=>{const current=await pilot.current({...snapshot.owner,sessionHash:"a".repeat(64)});return current?repo.getOwned(snapshot.owner,current.id):null;});
  return {pilot,journey,privateWorkspace,localDatabase:db,close};
 }catch(error){try{await db.exec("rollback;");}catch{/* Closing the local database still releases an aborted initialization. */}await close();throw error;}
}
