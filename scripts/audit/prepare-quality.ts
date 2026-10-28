import { readFileSync,writeFileSync,existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { verifiedTarget } from "./local-targets.mjs";
const target=verifiedTarget("empty");
for(const kind of ["empty","shaped"]){
 const t=verifiedTarget(kind),old=JSON.parse(readFileSync("docs/verification/D15-schema-after.json","utf8"));
 const observed=JSON.parse(t.sql(old.query));
 const path=`docs/verification/D17-schema-before-${kind}.json`;
 if(!existsSync(path))writeFileSync(path,JSON.stringify({identity:t.identity,observed,productionQueried:false},null,2)+"\n");
}
Object.assign(process.env,target.env,{RUN_INTEGRATION:"0",OPENAI_API_KEY:"",OPENROUTER_API_KEY:"",ANTHROPIC_API_KEY:""});
if(existsSync(".codex-tmp/D17-fixture.private.json"))throw new Error("D17 fixture already exists; refusing duplicate setup");
const {createAuditFixture}=await import("../../server/test/auditWorkflowFixture");
const fx=await createAuditFixture();
const fixture={runId:fx.runId,target:target.identity,workspaceId:fx.workspaceId,otherWorkspaceId:fx.otherWorkspaceId,slug:fx.slug,creator:fx.creators[0],other:fx.creators[1],operator:fx.operator,noMembership:fx.noMembership};
writeFileSync(".codex-tmp/D17-fixture.private.json",JSON.stringify(fixture,(k,v)=>k==="client"?undefined:v));
fx.must(await fx.service.from("creators").update({display_name:"D17 "+"香港長姓名".repeat(45)}).eq("id",fx.creators[0].id).eq("workspace_id",fx.workspaceId));
const pointIds=[randomUUID(),randomUUID(),randomUUID()],cashIds=[randomUUID(),randomUUID()];
fx.must(await fx.service.from("point_transactions").insert([
 {id:pointIds[0],creator_id:fx.creators[1].id,workspace_id:fx.workspaceId,type:"earn",delta:25,balance_after:75,created_at:"2026-10-20T00:00:00Z"},
 {id:pointIds[1],creator_id:fx.creators[1].id,workspace_id:fx.workspaceId,type:"adjust",delta:-8,balance_after:67,created_at:"2026-10-20T00:10:00Z"},
 {id:pointIds[2],creator_id:fx.creators[1].id,workspace_id:fx.workspaceId,type:"redeem",delta:-4,balance_after:63,created_at:"2026-10-20T00:20:00Z"},
]));
fx.must(await fx.service.from("earnings_transactions").insert([
 {id:cashIds[0],creator_id:fx.creators[1].id,workspace_id:fx.workspaceId,type:"earn",amount:125,balance_after:125,created_at:"2026-10-20T00:00:00Z"},
 {id:cashIds[1],creator_id:fx.creators[1].id,workspace_id:fx.workspaceId,type:"adjust",amount:-12.5,balance_after:112.5,created_at:"2026-10-20T00:10:00Z"},
]));
fx.must(await fx.service.from("point_balances").update({balance:63}).eq("creator_id",fx.creators[1].id).eq("workspace_id",fx.workspaceId));
fx.must(await fx.service.from("earnings_balances").update({available:112.5}).eq("creator_id",fx.creators[1].id).eq("workspace_id",fx.workspaceId));
const active=await fx.mission("active_workspace",false,10);
const {app}= (await import("../../server/app.js")).createApp();
const join=await app.request(`/api/missions/${active.slug}/join`,{method:"POST",headers:{Authorization:`Bearer ${fx.creators[0].jwt}`,"X-Workspace-Slug":fx.slug,"Content-Type":"application/json"},body:"{}"});
if(join.status!==200&&join.status!==201)throw new Error(`owned join fixture failed ${join.status}`);
const before=await Promise.all(fx.creators.map(c=>fx.neutrality(c.id)));
writeFileSync(".codex-tmp/D17-fixture.private.json",JSON.stringify({...fixture,active},(k,v)=>k==="client"?undefined:v));
writeFileSync("docs/verification/D17-fixture-setup.json",JSON.stringify({runId:fx.runId,target:target.identity,workspaceIds:[fx.workspaceId,fx.otherWorkspaceId],authIds:[...fx.creators.map(c=>c.id),fx.operator.id,fx.noMembership.id],missionIds:[active.id],pointIds,cashIds,before,
 note:"Explicit historical accounting fixtures only, seeded before the measured neutrality baseline. No real credit, payout, payment or notification. All exact IDs retained."},null,2)+"\n");
console.log(JSON.stringify({runId:fx.runId,workspaceId:fx.workspaceId,fixturePrepared:true}));
