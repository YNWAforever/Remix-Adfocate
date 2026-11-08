// @vitest-environment node
import {beforeAll,afterAll,expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import type {PGlite} from '@electric-sql/pglite';
import {openOriginalWorkflowFixture} from './helpers/controlled-pilot-original-workflow.js';
import {SqlNativeMediaStorage} from '../lib/creatorGrowth/pilot/sqlMediaStorage.js';
import {NativeMediaLeaseStore} from '../lib/creatorGrowth/pilot/nativeMediaLease.js';
import {SqlPilotReceiptStore} from '../lib/creatorGrowth/pilot/receiptStore.js';
import type {MissionProofHandoffResult} from '../lib/creatorGrowth/missionProofHandoff.js';
import {createNativePilotApplication} from '../lib/creatorGrowth/pilot/nativeApplication.js';
import {createCreatorPilotRoutes} from '../routes/creatorPilot.js';
import {publishActorFromVerifiedSession} from '../lib/creatorGrowth/publishSession.js';
import {Hono} from 'hono';
import type {Env} from '../app.js';
import {seedOriginalPilotJourney,OriginalPilotJourney} from '../lib/creatorGrowth/pilot/originalJourney.js';
import {createMockMissionPilot} from '../lib/creatorGrowth/pilot/missionService.js';
import {bindProviderMission} from '../lib/creatorGrowth/pilot/missionBinding.js';
import {SupabasePublishRepository} from '../lib/creatorGrowth/publishRepo.js';
import {randomUUID} from 'node:crypto';
import {SqlPilotJobStore} from '../lib/creatorGrowth/pilot/jobStore.js';
import {createNativePilotWorker} from '../lib/creatorGrowth/pilot/nativePipeline.js';
import {NativePilotHttpTransport} from '../lib/creatorGrowth/pilot/nativeHttpTransport.js';
import {NativePilotPublisher} from '../lib/creatorGrowth/pilot/nativePublisher.js';
let db:PGlite;
beforeAll(async()=>{db=await openOriginalWorkflowFixture();await db.exec(await readFile('docs/review/kocmax-controlled-pilot/asset-attachment-changes.sql','utf8'));await db.exec(await readFile('docs/review/kocmax-controlled-pilot/changes.sql','utf8'));await db.exec(await readFile('docs/review/kocmax-controlled-pilot/provider-changes.sql','utf8'));},60000);
afterAll(async()=>{await db?.close();});
async function exerciseProvider(scenario:'success'|'stop'|'processing',db:PGlite){
 const source=await seedOriginalPilotJourney(db,createMockMissionPilot().snapshot(),{fromUpload:true});
 const jwt=`x.${Buffer.from(JSON.stringify({sub:source.owner.creatorId,session_id:randomUUID()})).toString('base64url')}.x`;
 let clock=Date.parse('2026-11-06T00:00:00.000Z');const actor=publishActorFromVerifiedSession({...source.owner,verifiedJwt:jwt}),now=()=>new Date(clock);
 const b=bindProviderMission(actor,{...source,sampleOnly:false,provenance:'provider'});
 // Synthetic server attestation in memory only. Keep the real provenance trigger enabled.
 await db.query("insert into private.integration_pilot_grants(grant_key) values('offline-provider-test')");
 await db.query("insert into private.integration_pilot_bindings(connection_id,workspace_id,creator_id,generation,provider,environment_id,database_project_id,origin,provider_project_id,subject_hash,api_version,grant_key,activated) values($1,$2,$3,1,'instagram','offline','memory','https://example.invalid','11111',$4,'v99.0','offline-provider-test',true)",[b.connectionId,actor.workspaceId,actor.creatorId,'b'.repeat(64)]);
 await db.query("insert into public.integration_connections(id,workspace_id,creator_id,provider,generation,status,data) values($1,$2,$3,'instagram',1,'connected',$4::jsonb)",[b.connectionId,actor.workspaceId,actor.creatorId,JSON.stringify({subject:b.accountSubject,product:'facebook_login',appId:source.account.appId,sampleOnly:false,expiresAt:'2099-01-01T00:00:00Z',scopes:['instagram_basic','instagram_content_publish','pages_read_engagement']})]);
 await db.query("insert into private.controlled_pilot_provider_sources(workspace_id,creator_id,version_id,binding,available,expires_at,rights_confirmed,label_verified) values($1,$2,$3,$4::jsonb,true,'2099-01-01',true,true)",[actor.workspaceId,actor.creatorId,b.draftId,JSON.stringify(b)]);
 const repo=new SupabasePublishRepository({enabled:true,now,rpc:async(_name,a)=>(await db.query<{result:unknown}>('select public.creator_pilot_provider_command($1,$2,$3,$4::jsonb,$5::timestamptz) result',[a.p_workspace,a.p_creator,a.p_action,JSON.stringify(a.p_payload),a.p_now])).rows[0].result});
 await db.query('select private.creator_publish_authority($1,$2,$3::jsonb,$4::timestamptz)',[actor.workspaceId,actor.creatorId,JSON.stringify(b),now().toISOString()]);
 const p=await repo.issuePreview(actor,b),q=await repo.issuePreview(actor,b);
 await db.query("update private.integration_pilot_grants set state='pending' where grant_key='offline-provider-test'");
 await expect(repo.issuePreview(actor,b)).rejects.toThrow();
 await db.query("update private.integration_pilot_grants set state='active' where grant_key='offline-provider-test'");
 const i=await repo.reserve(actor,{approvalId:p.approvalId,nonce:p.nonce,binding:b,requestId:randomUUID()});const j=await repo.reserve(actor,{approvalId:q.approvalId,nonce:q.nonce,binding:b,requestId:randomUUID()});expect(j.id).toBe(i.id);expect(i.sampleOnly).toBe(false);
 await expect(repo.getOwned({...actor,creatorId:randomUUID()},i.id)).rejects.toThrow();
 const sql={query:async(text:string,args:readonly unknown[])=>(await db.query(text,[...args])).rows as Record<string,unknown>[]};
 const jobs=new SqlPilotJobStore(sql,repo,now,'provider');
 await jobs.enqueue(actor,i.id);await jobs.enqueue(actor,i.id);
 expect(await new SqlPilotJobStore(sql,repo,now).claim({workerId:'fixture',now:now().toISOString(),leaseUntil:'2026-11-06T00:00:30.000Z'})).toBeNull();
 let calls=0,publishes=0,statusReads=0;
 if(scenario==='success')for(const file of ['media-storage-changes.sql','receipt-storage-changes.sql','job-cleanup-changes.sql','provider-retention-changes.sql'])await db.exec(await readFile('docs/review/kocmax-controlled-pilot/'+file,'utf8'));
 const jpeg=new Uint8Array(await readFile('server/test/fixtures/controlled-pilot.jpg'));
 const media=new SqlNativeMediaStorage(sql,'https://media.example.invalid',now);
 const nativeLease=new NativeMediaLeaseStore({now,storage:media,authorize:async()=>{try{await db.query('select private.creator_publish_authority($1,$2,$3::jsonb,$4::timestamptz)',[actor.workspaceId,actor.creatorId,JSON.stringify(b),now().toISOString()]);return true;}catch{return false;}},load:async()=>({owner:source.owner,id:source.asset.id,bytes:jpeg,sha256:source.asset.sha256,mime:'image/jpeg',width:640,height:640,validated:true,rights:'shareable',sampleOnly:false})});
 const instructionsRow=(await db.query<Record<string,unknown>>('select * from public.mission_publication_instructions where mission_work_item_id=$1',[source.workItemId])).rows[0];
 const instructions={publicationInstructions:String(instructionsRow.publication_instructions),requiredDisclosures:[...source.requiredDisclosures],expectedAccount:String(instructionsRow.expected_account),proofEvidencePolicy:{},publishDueAt:String(instructionsRow.publication_due_at),frozenAt:new Date(instructionsRow.frozen_at as string).toISOString()};
 const receipts=new SqlPilotReceiptStore({sql,repo,now,authorize:async o=>o.workspaceId===actor.workspaceId&&o.creatorId===actor.creatorId,snapshot:async()=>({draft:{id:b.draftId,revision:b.draftRevision,owner:source.owner,caption:source.caption,accountSubject:b.accountSubject,imageSha256:b.imageSha256,rightsConfirmed:true,asset:{mime:'image/jpeg',byteSize:100,width:640,height:640,validated:true},disclosure:{sponsored:true,platformLabelRequired:true,brandTagRequired:false,captionText:'#合作'},mission:{kind:'active',submissionId:source.submissionId,workItemId:source.workItemId,approvedVersionId:source.approvedVersionId,instructionRevision:source.instructionRevision}},instructionSnapshot:instructions})});
 const transport=new NativePilotHttpTransport({version:'v99.0',account:source.account,authorize:async()=>true,token:async()=>'FAKE_TEST_TOKEN',mediaOrigin:'https://media.example.invalid',send:async (url,init)=>{calls++;if(scenario==='success'&&new URL(url).pathname.endsWith('/media')){const path=new URL((JSON.parse(String(init.body)) as {image_url:string}).image_url).pathname.slice(1);expect(await media.read(path)).toEqual(jpeg);}if(url.includes('status_code'))statusReads++;if(url.includes('media_publish')){publishes++;if(scenario==='stop')await db.query("update public.integration_connections set status='revoked' where id=$1",[b.connectionId]);}return new Response(JSON.stringify(url.includes('status_code')?{status_code:scenario==='processing'&&statusReads===1?'IN_PROGRESS':'FINISHED'}:url.includes('fields=id')?{id:'55555',owner:{id:source.account.accountSubject},permalink:'https://www.instagram.com/p/example/'}:{id:url.includes('media_publish')?'55555':'33333'}));}});
 const makeWorker=()=>createNativePilotWorker({jobs,repo,now,persistReceipt:scenario==='success'?async(intent,receipt)=>receipts.record(intent.owner,intent.id,receipt):undefined,policy:()=>({enabled:true,runId:'offline-native',allowedCreators:[actor.creatorId],allowedMissionIds:[source.submissionId],stopRequested:false}),resolve:async()=>({missionBasis:b.missionBasis,account:source.account,missionId:source.submissionId,fingerprint:b.fingerprint,caption:source.caption,sponsorIds:source.sponsorIds,approved:true}),publisher:new NativePilotPublisher(source.account,transport,async()=>true),lease:scenario==='success'?nativeLease:{open:async()=>({leaseId:'offline-lease',expiresAt:'2026-11-06T00:15:00.000Z',assetSha256:b.imageSha256,provenance:'provider',publicUrl:'https://media.example.invalid/pilot/approved.jpg'}),close:async()=>{}}});
 const first=await makeWorker().runOne({workerId:'native'});
 if(scenario==='processing'){expect(first).toBe('waiting');expect((await repo.getOwned(actor,i.id)).state).toBe('provider_processing');expect(await makeWorker().runOne({workerId:'too-early'})).toBe('idle');clock+=61000;expect(await makeWorker().runOne({workerId:'resumed'})).toBe('processed');expect(statusReads).toBe(2);}
 else expect(first).toBe(scenario==='stop'?'held_unknown':'processed');
 const result=await repo.getOwned(actor,i.id);expect(result.state).toBe(scenario==='stop'?'outcome_unknown':'published');expect(publishes).toBe(1);
 if(scenario==='stop'){expect(result.stoppedAt).toBeTruthy();expect(result.lateReceipt.mediaId).toBe('55555');expect((await db.query<{stage:string}>('select stage from private.controlled_pilot_jobs where intent_id=$1',[i.id])).rows[0].stage).toBe('media_known');clock+=61000;expect(await makeWorker().runOne({workerId:'read-recovery'})).toBe('held_unknown');expect(publishes).toBe(1);}
 else {const before=calls;expect(await makeWorker().runOne({workerId:'native-second'})).toBe('idle');expect(calls).toBe(before);}
 if(scenario==='stop'){
  expect((await db.query<{n:number}>('select read_attempts n from private.controlled_pilot_jobs where intent_id=$1',[i.id])).rows[0].n).toBe(2);
  for(let n=3;n<=5;n++){clock+=61000;expect(await makeWorker().runOne({workerId:'bounded-read-'+n})).toBe('held_unknown');}
  clock+=61000;const before=calls;expect(await makeWorker().runOne({workerId:'exhausted'})).toBe('idle');expect(calls).toBe(before);expect(publishes).toBe(1);
 }
 if(scenario==='success'){
  expect((await receipts.collection(actor,i.id)).visibility).toBe('private');
  const publication=async()=>({workItemId:source.workItemId,platform:'instagram',state:(await db.query<{state:'approved_to_publish'}>('select state from public.mission_work_items where id=$1',[source.workItemId])).rows[0].state,revision:source.instructionRevision,approvedVersionId:source.approvedVersionId,instructions,attempts:[],currentAttempt:null,acceptedAttempt:null});
  const native=createNativePilotApplication({live:{now,repo,resolveActor:async()=>actor,authorize:async()=>true,source:async()=>({...source,sampleOnly:false,provenance:'provider',expiresAt:'2099-01-01T00:00:00Z'}),enqueue:(o,id)=>jobs.enqueue(o,id)},receipts,proof:{resolveMission:async owner=>({kind:'active',owner,publication:await publication(),approvedCaption:source.caption,approvedAssetHashes:[b.imageSha256],expectedAccountSubject:b.accountSubject}),submitProof:async(owner,item,input)=>{
   const r=(await db.query<{result:{attempt:{id:string};code?:string}}>("select public.submit_mission_publication_proof($1,$2,$3,$4,$5,$6,$7,$8::jsonb,'{}'::uuid[]) result",[owner.submissionId,owner.creatorId,owner.workspaceId,item,input.expectedState,input.expectedRevision,input.idempotencyKey,JSON.stringify({primary_url:input.primaryUrl,additional_urls:[],metadata_status:'unavailable',metadata_snapshot:{},metadata_error_category:'provider_unavailable'})])).rows[0].result;
   if(r.code)throw new Error(r.code);return {attempt:{...r.attempt,primaryUrl:input.primaryUrl},publication:await publication()} as never;
  }}});
  const api=new Hono<Env>();api.use('*',async(c,next)=>{c.set('jwt',jwt);c.set('workspaceId',actor.workspaceId);c.set('userId',actor.creatorId);await next();});api.route('/pilot',createCreatorPilotRoutes(native.routes));
  const call=async(command:string,body:unknown)=>{const response=await api.request('/pilot/'+command,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});expect(response.status).toBe(200);return response.json();};
  expect(await call('collection',{intentId:i.id})).toMatchObject({visibility:'private',approvedVersionId:source.approvedVersionId});
  const proposal=await call('prepare-proof',{intentId:i.id}) as MissionProofHandoffResult;if(proposal.status!=='ready')throw new Error(JSON.stringify(proposal));
  const confirmation={proposalId:proposal.proposal.id,fingerprint:proposal.proposal.fingerprint,confirmed:true};
  expect((await call('confirm-proof',confirmation)).status).toBe('submitted');expect((await call('confirm-proof',confirmation)).status).toBe('blocked');
  const journey=new OriginalPilotJourney(db,source,async()=>result);expect((await journey.read()).ledger.count).toBe(0);
  await journey.act('reviewer','review',true);await journey.act('operator','completion',true);await journey.act('workspace_admin','settlement',true);await journey.act('workspace_admin','settlement',true);
  expect((await journey.read()).ledger).toEqual({count:1,points:400});
  await expect(db.exec(await readFile('docs/review/kocmax-controlled-pilot/receipt-storage-rollback.sql','utf8'))).rejects.toThrow('pilot_receipts_not_empty');await db.exec('rollback');
  expect((await db.query('select closed,jpeg from private.controlled_pilot_media where reservation_id=$1',[i.id])).rows[0]).toEqual({closed:true,jpeg:null});
  for(const action of ['retention','creator-delete']){
   await db.exec('begin');
   try{
    if(action==='retention'){await db.query("update private.creator_publish_intents set retention_until='2020-01-01' where id=$1",[i.id]);expect((await repo.cleanup(actor)).intentsDeleted).toBe(1);}
    else await db.query("update public.creators set status='deleted' where id=$1 and workspace_id=$2",[actor.creatorId,actor.workspaceId]);
    expect((await db.query('select snapshot,intent_id from private.controlled_pilot_receipts where reservation_id=$1',[i.id])).rows[0]).toEqual({snapshot:null,intent_id:null});
    expect((await db.query('select closed,jpeg,intent_id from private.controlled_pilot_media where reservation_id=$1',[i.id])).rows[0]).toEqual({closed:true,jpeg:null,intent_id:null});
   }finally{await db.exec('rollback');}
  }
 }
 await db.query("update public.mission_work_items set state='revision_requested' where id=$1",[source.workItemId]);
 await expect(repo.issuePreview(actor,b)).rejects.toThrow();
}
it('reserves a real-shaped approved source once and rechecks original mission state',()=>exerciseProvider('success',db),60000);
it.each(['stop','processing'] as const)('preserves durable native recovery for %s',async scenario=>{const isolated=await openOriginalWorkflowFixture();try{for(const file of ['asset-attachment-changes.sql','changes.sql','provider-changes.sql'])await isolated.exec(await readFile('docs/review/kocmax-controlled-pilot/'+file,'utf8'));await exerciseProvider(scenario,isolated);}finally{await isolated.close();}},60000);
it('has private production source authority with browser denial and existing RPC preserved',async()=>{
 const objects=await db.query<{name:string}>('select tablename name from pg_tables where schemaname=$1 and tablename like $2',['private','controlled_pilot_provider_%']);expect(objects.rows.map(r=>r.name)).toEqual(expect.arrayContaining(['controlled_pilot_provider_sources','controlled_pilot_provider_approvals','controlled_pilot_provider_revisions']));
 for(const role of ['anon','authenticated']){await db.exec(`set role ${role}`);try{await expect(db.query('select * from private.controlled_pilot_provider_sources')).rejects.toThrow();await expect(db.query("select public.creator_pilot_provider_command(null,null,'get','{}',now())")).rejects.toThrow();}finally{await db.exec('reset role');}}
 expect((await db.query<{exists:boolean}>("select to_regprocedure('public.creator_publish_command(uuid,uuid,text,jsonb,timestamptz)') is not null as exists")).rows[0].exists).toBe(true);
});
it('does not accept synthetic sources as provider binding',async()=>{
 const b={draftId:'00000000-0000-4000-8000-000000000041',draftRevision:1,assetId:'00000000-0000-4000-8000-000000000051',imageSha256:'a'.repeat(64),captionSha256:'b'.repeat(64),connectionId:'00000000-0000-4000-8000-000000000061',accountSubject:'22222',grantGeneration:1,fingerprint:'c'.repeat(64),missionBasis:{kind:'active_mission_fixture',product:'facebook_login',appId:'11111',submissionId:'00000000-0000-4000-8000-000000000021',workItemId:'00000000-0000-4000-8000-000000000031',approvedVersionId:'00000000-0000-4000-8000-000000000041',instructionRevision:1,disclosureSha256:'d'.repeat(64)}};
 expect((await db.query<{ok:boolean}>('select private.creator_publish_binding($1::jsonb) ok',[JSON.stringify(b)])).rows[0].ok).toBe(false);
 b.missionBasis.kind='active_mission_provider';expect((await db.query<{ok:boolean}>('select private.creator_publish_binding($1::jsonb) ok',[JSON.stringify(b)])).rows[0].ok).toBe(true);
});
it('refuses rollback of retained provider evidence without changing original functions',async()=>{
 await expect(db.exec(await readFile('docs/review/kocmax-controlled-pilot/provider-rollback.sql','utf8'))).rejects.toThrow('PILOT_ROLLBACK_NOT_EMPTY');
 await db.exec('rollback');
 expect((await db.query<{n:number}>('select count(*)::int n from private.controlled_pilot_provider_revisions')).rows[0].n).toBe(1);
});
it('restores an empty extension without cascading or removing original mission APIs',async()=>{
 const empty=await openOriginalWorkflowFixture();
 try{
  await empty.exec(await readFile('docs/review/kocmax-controlled-pilot/provider-changes.sql','utf8'));
  await empty.exec(await readFile('docs/review/kocmax-controlled-pilot/provider-rollback.sql','utf8'));
  expect((await empty.query<{ok:boolean}>("select to_regprocedure('private.creator_publish_binding(jsonb)') is not null and to_regprocedure('public.creator_publish_command(uuid,uuid,text,jsonb,timestamptz)') is not null and to_regclass('private.controlled_pilot_provider_sources') is null as ok")).rows[0].ok).toBe(true);
 }finally{await empty.close();}
},60000);






