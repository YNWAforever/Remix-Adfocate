import process from "node:process";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { verifiedTarget } from "./local-targets.mjs";
import { neutralitySnapshot } from "./neutrality-snapshot.mjs";

const target=verifiedTarget("empty");
const env={...process.env,...target.env,RUN_INTEGRATION:"0",RUN_AUDIT_INTEGRATION:"0",OPENAI_API_KEY:"",OPENROUTER_API_KEY:"",ANTHROPIC_API_KEY:"",
  NODE_OPTIONS:`--import=${pathToFileURL(resolve("scripts/audit/deny-external-fetch.mjs")).href}`};
const integration=spawnSync(process.execPath,["scripts/audit/run-integration.mjs","mission-list"],{env,stdio:"inherit"});
if(integration.status!==0)process.exit(integration.status??1);
const fixture=JSON.parse(readFileSync(".codex-tmp/D09-fixture.private.json","utf8"));
if(!isDeepStrictEqual(fixture.target,target.identity))throw new Error("D09 fixture target identity drift");
if(![fixture.workspaceId,fixture.creator.id,fixture.unverifiedCreator.id,...fixture.missions.map(x=>x.id)].every(x=>/^[a-f0-9-]{36}$/.test(x)))throw new Error("invalid exact fixture IDs");
Object.assign(env,{VITE_SUPABASE_URL:target.env.SUPABASE_URL,VITE_SUPABASE_ANON_KEY:target.env.SUPABASE_ANON_KEY,VITE_DEFAULT_WORKSPACE:fixture.slug,
  VITE_ENABLE_WHATSAPP:"false",VITE_ENABLE_GOOGLE:"false",ADFOCATE_BROWSER_SCOPE:"D09"});
const result=spawnSync(process.execPath,["node_modules/@playwright/test/cli.js","test","e2e/mission-discovery.spec.ts"],{env,stdio:"inherit"});
const raw=JSON.parse(readFileSync(".codex-tmp/browser-results.private.json","utf8"));
const tests=[];
function visit(suites){for(const suite of suites??[]){for(const spec of suite.specs??[])tests.push({title:spec.title,ok:spec.ok,
  results:spec.tests.flatMap(test=>test.results.map(run=>({status:run.status,duration:run.duration})))});visit(suite.suites);}}
visit(raw.suites);
let neutral=false;
if(result.status===0){
  const checked=verifiedTarget("empty");
  const before=JSON.parse(readFileSync("docs/verification/D09-browser-before.json","utf8"));
  if(before.runId!==fixture.runId)throw new Error("stale D09 browser snapshot");
  const after=neutralitySnapshot(checked,fixture.creator.id,fixture.workspaceId);
  neutral=isDeepStrictEqual(before.snapshot,after);
  writeFileSync("docs/verification/D09-browser-neutrality.json",JSON.stringify({runId:fixture.runId,before:before.snapshot,after,allEqual:neutral,
    note:"Existing legacy join grants 10 XP during fixture setup. The measured UI flow contains reads and rejected joins only; no XP normalization."},null,2)+"\n");
}
writeFileSync("docs/verification/D09-browser-summary.json",JSON.stringify({runId:fixture.runId,target:target.identity,tests,stats:raw.stats,
  auth:"real local Creator sign-in; two separate Creator contexts",browser:"installed Edge; emulated 360px and desktop",
  externalProviders:"external HTTP blocked; paid-provider credentials empty; no real notification or publication",
  faultInjection:"503 negative transport only; successful decision data comes from real Auth/API/PostgREST",neutrality:neutral,
  limitations:["No Safari/WebKit or physical-device acceptance.","No load/performance certification or paid-provider evaluation."]},null,2)+"\n");
process.exit(result.status===0&&neutral?0:result.status||1);
