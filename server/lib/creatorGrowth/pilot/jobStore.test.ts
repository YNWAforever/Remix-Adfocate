// @vitest-environment node
import {readFile} from "node:fs/promises";
import {beforeAll,afterAll,beforeEach,expect,it,vi} from "vitest";
import {createHash} from "node:crypto";
import {PilotWorker} from "./worker.js";
import {FacebookLoginPilotAdapter} from "./facebookLoginAdapter.js";
import type {PilotTransport} from "./protocol.js";
import type {PGlite} from "@electric-sql/pglite";
import {fixture,ws,actor,colleague} from "../../../test/helpers/integrations-fixture.js";
import {SqlPilotJobStore,type JobSql} from "./jobStore.js";
let db:PGlite;const id="00000000-0000-4000-8000-000000000091";
const owner={workspaceId:ws,creatorId:actor};let now=new Date("2030-01-01T00:00:00Z");
const binding={draftId:"00000000-0000-4000-8000-000000000081",draftRevision:1,assetId:"00000000-0000-4000-8000-000000000071",imageSha256:"a".repeat(64),captionSha256:"b".repeat(64),connectionId:"00000000-0000-4000-8000-000000000051",accountSubject:"123456789",grantGeneration:1,fingerprint:"c".repeat(64)};
const sql:JobSql={query:async(text,args)=>(await db.query(text,[...args])).rows as Record<string,unknown>[]};
const repo={getOwned:async(o:typeof owner,intentId:string)=>{
 if(o.creatorId!==actor||o.workspaceId!==ws||intentId!==id)throw new Error("PUBLISH_DENIED");
 return {id,owner,binding,requestId:id,state:"creator_approved" as const,version:1,receipt:{},lateReceipt:{},sampleOnly:true,stoppedAt:null,createdAt:now.toISOString(),updatedAt:now.toISOString(),retentionUntil:"2099-01-01T00:00:00.000Z"};
}};
beforeAll(async()=>{
 ({db}=await fixture());
 await db.exec("create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner_id uuid); alter table storage.objects enable row level security;");
 for(const file of ["supabase/migrations/20261103215321_kocmax_creator_growth_private.sql","supabase/migrations/20261104134202_kocmax_publish_intents.sql","docs/review/kocmax-controlled-pilot/changes.sql"])await db.exec(await readFile(file,"utf8"));
},30000);
afterAll(async()=>{await db?.close();});
beforeEach(async()=>{
 await db.exec("delete from private.controlled_pilot_jobs; delete from private.creator_publish_intents;");now=new Date("2030-01-01T00:00:00Z");
 await db.query("insert into private.creator_publish_intents(id,workspace_id,creator_id,binding,request_id,state,version,sample_only,created_at,updated_at,retention_until) values($1,$2,$3,$4::jsonb,$1,'creator_approved',1,true,$5,$5,'2099-01-01')",[id,ws,actor,JSON.stringify(binding),now.toISOString()]);
});
it("persists claims across store instances and fences expired workers",async()=>{
 const a=new SqlPilotJobStore(sql,repo,()=>now),b=new SqlPilotJobStore(sql,repo,()=>now);await a.enqueue(owner,id);
 const first=await a.claim({workerId:"a",now:now.toISOString(),leaseUntil:new Date(+now+30000).toISOString()});expect(first?.fence).toBe(1);
 expect(await b.claim({workerId:"b",now:now.toISOString(),leaseUntil:new Date(+now+30000).toISOString()})).toBeNull();
 now=new Date(+now+31000);const second=await b.claim({workerId:"b",now:now.toISOString(),leaseUntil:new Date(+now+30000).toISOString()});expect(second?.fence).toBe(2);
 await expect(a.checkpoint({intentId:id,workerId:"a",fence:1,stage:"before_create"})).rejects.toThrow();
 await b.checkpoint({intentId:id,workerId:"b",fence:2,stage:"before_create"});
 expect((await db.query("select stage from private.controlled_pilot_jobs")).rows[0]).toEqual({stage:"before_create"});
});
it("preserves ambiguous publish checkpoint without allowing backward transitions",async()=>{
 const s=new SqlPilotJobStore(sql,repo,()=>now);await s.enqueue(owner,id);const claim=await s.claim({workerId:"a",now:now.toISOString(),leaseUntil:new Date(+now+30000).toISOString()});
 for(const stage of ["before_create","container_known","before_publish"] as const)await s.checkpoint({intentId:id,workerId:"a",fence:claim!.fence,stage,...(stage!=="before_create"?{containerId:"12345"}:{})});
 await expect(s.checkpoint({intentId:id,workerId:"a",fence:claim!.fence,stage:"container_known",containerId:"12345"})).rejects.toThrow();
 now=new Date(+now+31000);expect((await new SqlPilotJobStore(sql,repo,()=>now).claim({workerId:"b",now:now.toISOString(),leaseUntil:new Date(+now+30000).toISOString()}))?.stage).toBe("before_publish");
});
it("enforces composite owner FK and no browser roles",async()=>{
 await expect(db.query("insert into private.controlled_pilot_jobs(intent_id,workspace_id,creator_id) values($1,$2,$3)",[id,ws,colleague])).rejects.toThrow();
 for(const role of ["anon","authenticated"]){
  await db.exec(`set role ${role}`);try{await expect(db.query("select * from private.controlled_pilot_jobs")).rejects.toThrow();}finally{await db.exec("reset role");}
 }
});
it("never replays an accepted-but-lost publish after reconstructing the worker and adapter",async()=>{
 const account={product:"facebook_login" as const,appId:"11111",accountSubject:binding.accountSubject,connectionId:binding.connectionId,grantGeneration:1};
 const request=vi.fn<PilotTransport["request"]>(async({operation})=>{
  if(operation==="create")return {id:"33333"};
  if(operation==="status")return {status_code:"FINISHED"};
  throw new Error("accepted response lost");
 });
 const source={getOwned:async(o:typeof owner,i:string)=>{const intent=await repo.getOwned(o,i);return {...intent,binding:{...intent.binding,captionSha256:createHash("sha256").update("Tea").digest("hex")}};}};
 const make=()=>new PilotWorker({
  jobs:new SqlPilotJobStore(sql,source,()=>now),
  resolve:async()=>({account,missionId:"mission",fingerprint:binding.fingerprint,caption:"Tea",sponsorIds:["44444"],approved:true}),
  policy:()=>({enabled:true,runId:"crash-test",allowedCreators:[actor],allowedMissionIds:["mission"],stopRequested:false}),
  publisher:new FacebookLoginPilotAdapter(account,{version:"v99.0",host:"graph.facebook.com",scopes:["instagram_basic","instagram_content_publish","pages_read_engagement"],identityEvidence:"fixture:identity",labelEvidence:"fixture:label",revokeEvidence:"fixture:revoke",status:"verified",provenance:"fixture"},{provenance:"fixture",request}),
  lease:{open:async()=>({leaseId:"fixture",expiresAt:new Date(+now+900000).toISOString(),assetSha256:binding.imageSha256,provenance:"fixture"}),close:async()=>{}},
  record:async()=>{throw new Error("must not infer receipt");},now:()=>now
 });
 await new SqlPilotJobStore(sql,source,()=>now).enqueue(owner,id);
 expect(await make().runOne({workerId:"first"})).toBe("held_unknown");
 expect((await db.query("select stage from private.controlled_pilot_jobs")).rows).toEqual([{stage:"before_publish"}]);
 now=new Date(+now+61000);
 expect(await make().runOne({workerId:"restarted"})).toBe("held_unknown");
 expect(request.mock.calls.filter(([input])=>input.operation==="publish")).toHaveLength(1);
});
it("refuses rollback with any job and only removes empty pilot objects",async()=>{
 const rollback=await readFile("docs/review/kocmax-controlled-pilot/rollback.sql","utf8");
 await new SqlPilotJobStore(sql,repo,()=>now).enqueue(owner,id);
 await expect(db.exec(rollback)).rejects.toThrow("PILOT_ROLLBACK_REQUIRES_EMPTY_JOBS");
 await db.exec("rollback");
 expect((await db.query("select count(*)::int as count from private.controlled_pilot_jobs")).rows).toEqual([{count:1}]);
 await db.exec("delete from private.controlled_pilot_jobs");
 try{
  await db.exec(rollback);
  expect((await db.query("select to_regclass('private.controlled_pilot_jobs') as object")).rows).toEqual([{object:null}]);
  expect((await db.query("select count(*)::int as count from private.creator_publish_intents")).rows).toEqual([{count:1}]);
 }finally{await db.exec(await readFile("docs/review/kocmax-controlled-pilot/changes.sql","utf8"));}
});

it("accepts one millisecond of elapsed time without trusting future or stale claims",async()=>{const q=vi.fn(async()=>[]);const s=new SqlPilotJobStore({query:q},repo,()=>new Date(+now+1));await expect(s.claim({workerId:"a",now:now.toISOString(),leaseUntil:new Date(+now+60000).toISOString()})).resolves.toBeNull();expect(q).toHaveBeenCalledOnce();await expect(s.claim({workerId:"a",now:new Date(+now+1000).toISOString(),leaseUntil:new Date(+now+60000).toISOString()})).rejects.toThrow();});

it("retains known media id and read budget across reconstructed stores",async()=>{
 const s=new SqlPilotJobStore(sql,repo,()=>now);await s.enqueue(owner,id);const first=await s.claim({workerId:"a",now:now.toISOString(),leaseUntil:new Date(+now+60000).toISOString()});
 for(const stage of ["before_create","container_known","before_publish","media_known"] as const)await s.checkpoint({intentId:id,workerId:"a",fence:first!.fence,stage,...(stage!=="before_create"?{containerId:"33333"}:{}),...(stage==="media_known"?{mediaId:"55555"}:{})});
 for(let n=0;n<5;n++){now=new Date(+now+61000);const c=await new SqlPilotJobStore(sql,repo,()=>now).claim({workerId:"recovery",now:now.toISOString(),leaseUntil:new Date(+now+60000).toISOString()});expect(c?.mediaId).toBe("55555");}
 now=new Date(+now+61000);expect(await new SqlPilotJobStore(sql,repo,()=>now).claim({workerId:"exhausted",now:now.toISOString(),leaseUntil:new Date(+now+60000).toISOString()})).toBeNull();expect((await db.query("select read_attempts from private.controlled_pilot_jobs")).rows).toEqual([{read_attempts:5}]);
});

it("classifies only expired owner-scoped ambiguous checkpoints without claiming writes",async()=>{
 const s=new SqlPilotJobStore(sql,repo,()=>now);await s.enqueue(owner,id);const c=await s.claim({workerId:"a",now:now.toISOString(),leaseUntil:new Date(+now+30000).toISOString()});
 for(const stage of ["before_create","container_known","before_publish"] as const)await s.checkpoint({intentId:id,workerId:"a",fence:c!.fence,stage,...(stage!=="before_create"?{containerId:"12345"}:{})});
 expect(await s.abandoned(owner,id)).toBe(false);now=new Date(+now+31000);expect(await s.abandoned(owner,id)).toBe(true);expect(await s.abandoned({...owner,creatorId:colleague},id)).toBe(false);
 expect(await s.claim({workerId:"reader",now:now.toISOString(),leaseUntil:new Date(+now+30000).toISOString(),recoveryOnly:true})).toBeNull();
});
