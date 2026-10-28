import { appendFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { createAuditFixture } from "./auditWorkflowFixture.js";
// @ts-expect-error Native local evidence helper.
import {durableJson} from "../../scripts/audit/fixture-journal.mjs";
export async function createStaffCapabilityFixture(task:"D18"|"D19"="D18"){
 if(!["D18","D19"].includes(task))throw new Error("Unsupported fixture evidence namespace");
 // @ts-expect-error Native ESM identity verifier has no declaration file.
 const {verifiedTarget}=await import("../../scripts/audit/local-targets.mjs");
 const target=verifiedTarget(); // Precedes SDK import, all clients, credentials and setup.
 const base=await (await import("./auditWorkflowFixture.js")).createAuditFixture();
 if(!isDeepStrictEqual(target.identity,base.target.identity))throw new Error(`${task} target drift`);
 const {createClient}=await import("@supabase/supabase-js");
 const context=target.context,journal=base.journal;
 type Actor=Awaited<ReturnType<typeof createAuditFixture>>["operator"];
 const roles:Record<string,Actor>={admin:base.operator};
 const ids=[...base.creators.map(c=>c.id),base.operator.id,base.noMembership.id,...(base.historical?[base.historical.creatorId]:[])],bootstrapRequests:string[]=[];
 let extra:Record<string,unknown>={};
 function save(stage:string){
  const value={...(context?{lineage:context.lineage}:{}),runId:base.runId,target:target.identity,workspaceId:base.workspaceId,otherWorkspaceId:base.otherWorkspaceId,slug:base.slug,creators:base.creators,noMembership:base.noMembership,roles,authIds:ids,bootstrapRequests,...extra};
  const json=JSON.stringify(value,(k,v)=>k==="client"?undefined:v);
  if(context)durableJson(context.privatePath("staff-fixture.private.json"),value);
  else{writeFileSync(`.codex-tmp/${task}-fixture-${base.runId}.private.json`,json);writeFileSync(`.codex-tmp/${task}-fixture.private.json`,json);}
  appendFileSync(context?.publicPath("fixtures.jsonl")??`docs/verification/${task}-fixtures.jsonl`,JSON.stringify({...(context?{lineage:context.lineage}:{}),runId:base.runId,stage,target:target.identity,workspaceIds:[base.workspaceId,base.otherWorkspaceId],authIds:ids,bootstrapRequests,cleanup:"retained exact owned IDs; no reset/delete"})+"\n");
 }
 async function actor(name:string,workspace:string|null=base.workspaceId){
  const email=`${task.toLowerCase()}-${name}-${base.runId}@example.test`,password=`Owned-${randomUUID()}!`;
  base.correlation.push({name,email,password,state:"intent"});base.saveCorrelation();
  let id="";const create=async()=>{const created=base.must(await base.service.auth.admin.createUser({email,password,email_confirm:true}));id=created.user!.id;return{auth_users:[id]};};
  if(journal)await journal.perform(`staff-auth:${name}`,{auth_users:1},create);else await create();
  ids.push(id);save("auth-created");
  await base.insert("staff_users",{user_id:id,email,active:true});
  if(workspace)await base.insert("brand_users",{user_id:id,workspace_id:workspace,email,active:true,role:name==="noRole"?"owner":"member"});
  const client=createClient(target.env.SUPABASE_URL,target.env.SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false,storageKey:`${task.toLowerCase()}-${id}`}});
  const signed=base.must(await client.auth.signInWithPassword({email,password}));
  roles[name]={id,email,password,jwt:signed.session!.access_token,session:signed.session!,client};save("actor-signed-in");return roles[name];
 }
 function bootstrap(user:string,workspace:string|null,role:string){
  if(![base.operator.id,user,...(workspace?[workspace]:[])].every(v=>/^[a-f0-9-]{36}$/.test(v))||!["workspace_admin","operator","reviewer","finance_viewer","content_editor"].includes(role))throw new Error("invalid exact bootstrap fixture IDs");
  const request=randomUUID();bootstrapRequests.push(request);save("bootstrap-planned");
  const apply=()=>{target.sql(`select private.bootstrap_staff_access('${base.operator.id}',${workspace?`'${workspace}'`:'null'},'${user}','${role}',true,0,'${request}','Explicit owned ${task} fixture setup','synthetic-owned-${task}-owner-attestation');`);const audit=JSON.parse(target.sql(`begin read only;select coalesce(jsonb_agg(id),'[]'::jsonb)from public.staff_access_audit where request_id='${request}';commit;`));return{[workspace?"staff_workspace_roles":"staff_platform_roles"]:[user],staff_access_commands:[request],staff_access_audit:audit};};
  if(journal)journal.performSync(`bootstrap:${role}`,{[workspace?"staff_workspace_roles":"staff_platform_roles"]:1,staff_access_commands:1,staff_access_audit:1},apply);else apply();save("bootstrap-saved");
 }
 save("base-created");
 if(task==="D19"){
  const budgetId=context?.plan.plannedBudgetId??randomUUID(),giftId=context?.plan.plannedGiftId??randomUUID();
  extra={...extra,financialFixture:{budgetId,giftId,initialBudget:9000,enforced:true,initialStock:3}};save("funded-fixture-planned");
  // Budget writes intentionally remain owner-only; never widen service/browser grants for a fixture.
  const fund=()=>{target.sql(`begin;insert into public.workspace_budgets(id,workspace_id,balance,enforced) values ('${budgetId}','${base.workspaceId}',9000,true);insert into public.redemption_gifts(id,workspace_id,name,points_cost,stock_qty,stock_remaining,gift_type,status) values ('${giftId}','${base.workspaceId}','Owned D19 neutrality inventory',1000,3,3,'digital','available');commit;`);return{workspace_budgets:[budgetId],redemption_gifts:[giftId]};};
  if(journal)journal.performSync("funded-baseline",{workspace_budgets:1,redemption_gifts:1},fund,{workspace_budgets:[budgetId],redemption_gifts:[giftId]});else fund();
  save("funded-fixture-created");
 }
 bootstrap(base.operator.id,base.workspaceId,"workspace_admin");
 for(const role of ["operator","reviewer","finance_viewer"]){const user=await actor(role);bootstrap(user.id,base.workspaceId,role);}
 const editor=await actor("content_editor",null);bootstrap(editor.id,null,"content_editor");
 const revocable=await actor("revocable");bootstrap(revocable.id,base.workspaceId,"operator");
 await actor("noRole");const foreign=await actor("foreign",base.otherWorkspaceId);bootstrap(foreign.id,base.otherWorkspaceId,"workspace_admin");
 save("ready");
 return {base,roles,saveLegacy:(legacy:Record<string,unknown>)=>{if(journal)journal.observe({mission_submissions:[legacy.submissionId]});extra={...extra,legacy};save("legacy-saved");},saveResource:(resource:Record<string,unknown>)=>{if(journal)journal.observe({academy_content:[resource.id]});extra={...extra,resource};save("resource-saved");},saveCore:(core:Record<string,unknown>)=>{if(journal)journal.observe({mission_workflows:[core.workflowId],mission_submissions:[core.submissionId],mission_work_items:[core.itemId],mission_pending_rewards:[core.pendingRewardId??core.cancelledPendingRewardId]});extra={...extra,core};save("core-saved");},save};
}
