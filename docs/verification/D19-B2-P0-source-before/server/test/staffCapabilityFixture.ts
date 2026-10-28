import { appendFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { createAuditFixture } from "./auditWorkflowFixture.js";
export async function createStaffCapabilityFixture(task:"D18"|"D19"="D18"){
 if(!["D18","D19"].includes(task))throw new Error("Unsupported fixture evidence namespace");
 // @ts-expect-error Native ESM identity verifier has no declaration file.
 const {verifiedTarget}=await import("../../scripts/audit/local-targets.mjs");
 const target=verifiedTarget("empty"); // Precedes SDK import, all clients, credentials and setup.
 const base=await (await import("./auditWorkflowFixture.js")).createAuditFixture();
 if(!isDeepStrictEqual(target.identity,base.target.identity))throw new Error(`${task} target drift`);
 const {createClient}=await import("@supabase/supabase-js");
 type Actor=Awaited<ReturnType<typeof createAuditFixture>>["operator"];
 const roles:Record<string,Actor>={admin:base.operator};
 const ids=[...base.creators.map(c=>c.id),base.operator.id,base.noMembership.id],bootstrapRequests:string[]=[];
 let extra:Record<string,unknown>={};
 function save(stage:string){
  const value={runId:base.runId,target:target.identity,workspaceId:base.workspaceId,otherWorkspaceId:base.otherWorkspaceId,slug:base.slug,creators:base.creators,noMembership:base.noMembership,roles,authIds:ids,bootstrapRequests,...extra};
  const json=JSON.stringify(value,(k,v)=>k==="client"?undefined:v);
  writeFileSync(`.codex-tmp/${task}-fixture-${base.runId}.private.json`,json);writeFileSync(`.codex-tmp/${task}-fixture.private.json`,json);
  appendFileSync(`docs/verification/${task}-fixtures.jsonl`,JSON.stringify({runId:base.runId,stage,target:target.identity,workspaceIds:[base.workspaceId,base.otherWorkspaceId],authIds:ids,bootstrapRequests,cleanup:"retained exact owned IDs; no reset/delete"})+"\n");
 }
 async function actor(name:string,workspace:string|null=base.workspaceId){
  const email=`${task.toLowerCase()}-${name}-${base.runId}@example.test`,password=`Owned-${randomUUID()}!`;
  const created=base.must(await base.service.auth.admin.createUser({email,password,email_confirm:true}));
  const id=created.user!.id;ids.push(id);save("auth-created");
  base.must(await base.service.from("staff_users").insert({user_id:id,email,active:true}));
  if(workspace)base.must(await base.service.from("brand_users").insert({user_id:id,workspace_id:workspace,email,active:true,role:name==="noRole"?"owner":"member"}));
  const client=createClient(target.env.SUPABASE_URL,target.env.SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false,storageKey:`${task.toLowerCase()}-${id}`}});
  const signed=base.must(await client.auth.signInWithPassword({email,password}));
  roles[name]={id,email,password,jwt:signed.session!.access_token,session:signed.session!,client};save("actor-signed-in");return roles[name];
 }
 function bootstrap(user:string,workspace:string|null,role:string){
  if(![base.operator.id,user,...(workspace?[workspace]:[])].every(v=>/^[a-f0-9-]{36}$/.test(v))||!["workspace_admin","operator","reviewer","finance_viewer","content_editor"].includes(role))throw new Error("invalid exact bootstrap fixture IDs");
  const request=randomUUID();bootstrapRequests.push(request);save("bootstrap-planned");
  target.sql(`select private.bootstrap_staff_access('${base.operator.id}',${workspace?`'${workspace}'`:'null'},'${user}','${role}',true,0,'${request}','Explicit owned ${task} fixture setup','synthetic-owned-${task}-owner-attestation');`);save("bootstrap-saved");
 }
 save("base-created");
 if(task==="D19"){
  const budgetId=randomUUID(),giftId=randomUUID();
  extra={...extra,financialFixture:{budgetId,giftId,initialBudget:9000,enforced:true,initialStock:3}};save("funded-fixture-planned");
  // Budget writes intentionally remain owner-only; never widen service/browser grants for a fixture.
  target.sql(`begin;insert into public.workspace_budgets(id,workspace_id,balance,enforced) values ('${budgetId}','${base.workspaceId}',9000,true);insert into public.redemption_gifts(id,workspace_id,name,points_cost,stock_qty,stock_remaining,gift_type,status) values ('${giftId}','${base.workspaceId}','Owned D19 neutrality inventory',1000,3,3,'digital','available');commit;`);
  save("funded-fixture-created");
 }
 bootstrap(base.operator.id,base.workspaceId,"workspace_admin");
 for(const role of ["operator","reviewer","finance_viewer"]){const user=await actor(role);bootstrap(user.id,base.workspaceId,role);}
 const editor=await actor("content_editor",null);bootstrap(editor.id,null,"content_editor");
 const revocable=await actor("revocable");bootstrap(revocable.id,base.workspaceId,"operator");
 await actor("noRole");const foreign=await actor("foreign",base.otherWorkspaceId);bootstrap(foreign.id,base.otherWorkspaceId,"workspace_admin");
 save("ready");
 return {base,roles,saveLegacy:(legacy:Record<string,unknown>)=>{extra={...extra,legacy};save("legacy-saved");},saveResource:(resource:Record<string,unknown>)=>{extra={...extra,resource};save("resource-saved");},saveCore:(core:Record<string,unknown>)=>{extra={...extra,core};save("core-saved");},save};
}
