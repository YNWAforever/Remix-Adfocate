// @vitest-environment node
import {readFile} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import {afterAll,beforeAll,expect,it} from "vitest";
import type {PGlite} from "@electric-sql/pglite";
import {fixture,ws,actor,colleague} from "./helpers/integrations-fixture.js";
import {SupabasePublishRepository,type PublishRpc} from "../lib/creatorGrowth/publishRepo.js";
import {createMockMissionPilot} from "../lib/creatorGrowth/pilot/missionService.js";
import {bindApprovedMission} from "../lib/creatorGrowth/pilot/missionBinding.js";
let db:PGlite;const owner={workspaceId:ws,creatorId:actor},session={...owner,sessionHash:"a".repeat(64)},binding=bindApprovedMission(session,createMockMissionPilot().snapshot());
const call:PublishRpc=async(_name,args)=>(await db.query<{result:unknown}>("select public.creator_pilot_fixture_command($1,$2,$3,$4::jsonb,$5::timestamptz) result",[args.p_workspace,args.p_creator,args.p_action,JSON.stringify(args.p_payload),args.p_now])).rows[0].result;
const repo=()=>new SupabasePublishRepository({enabled:true,rpc:call,now:()=>new Date("2030-01-01T00:00:00Z")});
beforeAll(async()=>{({db}=await fixture());await db.exec("create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner_id uuid); alter table storage.objects enable row level security;");
 for(const path of ["supabase/migrations/20261103215321_kocmax_creator_growth_private.sql","supabase/migrations/20261104134202_kocmax_publish_intents.sql","server/test/helpers/controlled-pilot-binding-fixture.sql"])await db.exec(await readFile(path,"utf8"));
 await db.query("insert into private.controlled_pilot_fixture_sources(workspace_id,creator_id,version_id,binding) values($1,$2,$3,$4::jsonb)",[ws,actor,binding.draftId,JSON.stringify(binding)]);
},30000);afterAll(async()=>{await db?.close();});
it("uses the original durable intent and one reservation for two previews without growth-draft rows",async()=>{
 const a=repo(),b=repo(),p=await a.issuePreview(session,binding),q=await b.issuePreview(session,binding);
 const first=await a.reserve(session,{approvalId:p.approvalId,nonce:p.nonce,binding,requestId:randomUUID()}),second=await b.reserve(session,{approvalId:q.approvalId,nonce:q.nonce,binding,requestId:randomUUID()});
 expect(first.id).toBe(second.id);expect((await repo().getOwned(owner,first.id)).binding.missionBasis).toEqual(binding.missionBasis);
 expect((await db.query("select count(*)::int n from private.creator_growth_drafts")).rows).toEqual([{n:0}]);
 await expect(repo().getOwned({...owner,creatorId:colleague},first.id)).rejects.toThrow();
 let current=first;
 for(const [nextState,receipt] of [["container_preparing",{}],["provider_processing",{containerId:"33333",status:"ready",sampleOnly:true}],["publish_requested",{}],["published",{mediaId:"55555",status:"published",sampleOnly:true}]] as const){
  current=(await repo().transition(owner,{intentId:current.id,expectedState:current.state,expectedVersion:current.version,nextState,receipt,fingerprint:binding.fingerprint,requestId:randomUUID()})).intent;
 }
 expect((await repo().getOwned(owner,current.id)).state).toBe("published");
});
it("rejects retargeting a reserved approved version to another app",async()=>{
 const next={...binding,missionBasis:{...binding.missionBasis!,appId:"77777"},fingerprint:"d".repeat(64)};
 await db.query("update private.controlled_pilot_fixture_sources set binding=$1::jsonb where creator_id=$2",[JSON.stringify(next),actor]);
 const p=await repo().issuePreview(session,next);await expect(repo().reserve(session,{approvalId:p.approvalId,nonce:p.nonce,binding:next,requestId:randomUUID()})).rejects.toThrow();
 await db.query("update private.controlled_pilot_fixture_sources set binding=$1::jsonb where creator_id=$2",[JSON.stringify(binding),actor]);
 expect((await db.query("select count(*)::int n from private.controlled_pilot_fixture_revisions")).rows).toEqual([{n:1}]);
});
it("requires owned current binding and session-bound one-use preview",async()=>{
 const r=repo(),p=await r.issuePreview(session,binding),input={approvalId:p.approvalId,nonce:p.nonce,binding,requestId:randomUUID()};
 await expect(r.reserve({...session,sessionHash:"b".repeat(64)},input)).rejects.toThrow();
 await db.query("update private.controlled_pilot_fixture_sources set available=false where creator_id=$1",[actor]);
 await expect(r.reserve(session,input)).rejects.toThrow();
 for(const role of ["anon","authenticated"]){await db.exec(`set role ${role}`);try{await expect(db.query("select * from private.controlled_pilot_fixture_sources")).rejects.toThrow();}finally{await db.exec("reset role");}}
});
