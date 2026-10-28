import {readFileSync,writeFileSync,existsSync} from "node:fs";
import {randomUUID} from "node:crypto";
import {performance} from "node:perf_hooks";
import {verifiedTarget} from "./local-targets.mjs";
const target=verifiedTarget("empty");
Object.assign(process.env,target.env,{OPENAI_API_KEY:"",OPENROUTER_API_KEY:"",ANTHROPIC_API_KEY:""});
const fx=JSON.parse(readFileSync(".codex-tmp/D17-fixture.private.json","utf8"));
if(JSON.stringify(target.identity)!==JSON.stringify(fx.target)||!/^[a-f0-9-]{36}$/.test(fx.workspaceId))throw new Error("quality target mismatch");
const {app}=(await import("../../server/app.js")).createApp();
const path=".codex-tmp/D17-scale-ids.private.json";
const planned=existsSync(path)?JSON.parse(readFileSync(path,"utf8")):{runId:fx.runId,workspaceId:fx.workspaceId,stages:{}};
if(planned.runId!==fx.runId||planned.workspaceId!==fx.workspaceId)throw new Error("stale scale fixture");
const measurements=[];
for(const total of [1000,10000]){
 const current=Number(target.sql(`select count(*) from public.creators where workspace_id='${fx.workspaceId}';`));
 if(current>total&&total===1000)continue;
 if(!planned.stages[total]){
  if(current>total)throw new Error("unexpected creator count");
  planned.stages[total]=Array.from({length:total-current},()=>randomUUID());
  writeFileSync(path,JSON.stringify(planned));
 }
 const ids=planned.stages[total];if(!ids.every((id:string)=>/^[a-f0-9-]{36}$/.test(id)))throw new Error("invalid exact fixture IDs");
 for(let offset=0;offset<ids.length;offset+=500){
  const chunk=ids.slice(offset,offset+500);
  target.sql(`begin;
   insert into auth.users(id,email) values ${chunk.map((id:string)=>`('${id}','${id}@example.invalid')`).join(",")} on conflict(id) do nothing;
   insert into public.creators(id,workspace_id,display_name,onboarding_completed) values ${chunk.map((id:string,index:number)=>`('${id}','${fx.workspaceId}','Synthetic D17 ${total} ${offset+index}',true)`).join(",")} on conflict(id) do nothing;
   commit;`);
 }
 if(Number(target.sql(`select count(*) from public.creators where workspace_id='${fx.workspaceId}';`))!==total)throw new Error("scale count mismatch");
 const raw=[];
 for(let i=0;i<100;i++){
  const started=performance.now();
  const r=await app.request(`/api/admin/creators/review?page=${i%2+1}&sort=last_activity`,{headers:{Authorization:`Bearer ${fx.operator.jwt}`,"X-Workspace-Slug":fx.slug}});
  const body=await r.json();raw.push(performance.now()-started);
  if(r.status!==200||body.total!==total||body.creators.length!==25)throw new Error(`queue contract ${r.status}, expected ${total}, observed ${body.total}`);
 }
 const sorted=[...raw].sort((a,b)=>a-b),p=(v:number)=>sorted[Math.ceil(raw.length*v)-1];
 const plan=JSON.parse(target.sql(`explain (analyze,buffers,format json) select public.list_creator_review_queue_page('${fx.workspaceId}','${fx.operator.id}',null,'',null,null,'last_activity',1);`));
 measurements.push({creators:total,requests:raw.length,rawMs:raw,p50Ms:p(.5),p95Ms:p(.95),maxMs:sorted.at(-1),plan,thresholdMs:800,belowSuggestedP95:p(.95)<800});
 writeFileSync("docs/verification/D17-api-performance.json",JSON.stringify({runId:fx.runId,target:target.identity,transport:"in-process Hono API + real HTTP Auth/PostgREST/database; no client network latency added",cache:"DB buffers not reset; first request and subsequent requests retained raw",network:"local loopback; no CPU/network throttling",measurements},null,2)+"\n");
 console.log(JSON.stringify({creators:total,requests:100,p50Ms:p(.5),p95Ms:p(.95)}));
}
writeFileSync("docs/verification/D17-scale-ids.json",JSON.stringify({...planned,note:"Exact synthetic Auth/profile IDs retained. No membership grants, cleanup, broad delete or reset."},null,2)+"\n");
