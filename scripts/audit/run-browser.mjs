import process from "node:process";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { verifiedTarget } from "./local-targets.mjs";
import { neutralitySnapshot } from "./neutrality-snapshot.mjs";
const target=verifiedTarget("empty");
const navigation = process.argv[2] === "navigation";
if (process.argv[2] && !navigation) throw new Error("unsupported browser scope");
const prefix = navigation ? "D08-" : "";
const env={...process.env,...target.env,RUN_INTEGRATION:"0",RUN_AUDIT_INTEGRATION:"0",OPENAI_API_KEY:"",ANTHROPIC_API_KEY:"",OPENROUTER_API_KEY:""};
const prepared=spawnSync(process.execPath,["node_modules/vite-node/vite-node.mjs","scripts/audit/prepare-browser.ts"],{env,stdio:"inherit"});
if(prepared.status!==0) process.exit(prepared.status??1);
const fixture=JSON.parse(readFileSync(".codex-tmp/browser-fixture.private.json","utf8"));
if (navigation) env.ADFOCATE_BROWSER_SCOPE = "D08";
Object.assign(env,{VITE_SUPABASE_URL:target.env.SUPABASE_URL,VITE_SUPABASE_ANON_KEY:target.env.SUPABASE_ANON_KEY,
  VITE_DEFAULT_WORKSPACE:fixture.slug,VITE_ENABLE_WHATSAPP:"false",VITE_ENABLE_GOOGLE:"false",
  NODE_OPTIONS:`--import=${pathToFileURL(resolve("scripts/audit/deny-external-fetch.mjs")).href}`});
const files = navigation ? ["e2e/creator-operator-mission.spec.ts", "e2e/creator-navigation.spec.ts"] : ["e2e/creator-operator-mission.spec.ts"];
const result=spawnSync(process.execPath,["node_modules/@playwright/test/cli.js","test",...files],{env,stdio:"inherit"});
let neutral = false;
if(result.status===0){
  const checked=verifiedTarget("empty"),id=fixture.creator.id,workspace=fixture.workspaceId;
  if(![id,workspace].every((value)=>/^[a-f0-9-]{36}$/.test(value)))throw new Error("invalid exact fixture ID");
  const after=neutralitySnapshot(checked,id,workspace);
  const before=JSON.parse(readFileSync(`docs/verification/${prefix}browser-before-handoff.json`,"utf8"));
  if(before.runId!==fixture.runId)throw new Error("stale before-handoff snapshot");
  neutral=isDeepStrictEqual(after,before.snapshot);
  writeFileSync(`docs/verification/${prefix}browser-neutrality.json`,JSON.stringify({runId:fixture.runId,before:before.snapshot,after,allEqual:neutral,initialSeedSnapshot:fixture.beforeSnapshot,note:"Existing welcome XP occurs at sign-in, before the measured handoff; XP is compared without normalization."},null,2)+"\n");
}
const raw=JSON.parse(readFileSync(".codex-tmp/browser-results.private.json","utf8"));
const tests=[];
function visit(suites){for(const suite of suites??[]){for(const spec of suite.specs??[]){tests.push({title:spec.title,ok:spec.ok,
  results:spec.tests.flatMap((test)=>test.results.map((run)=>({status:run.status,duration:run.duration})))});}visit(suite.suites);}}
visit(raw.suites);
writeFileSync(`docs/verification/${prefix}browser-summary.json`,JSON.stringify({target:target.identity,runId:fixture.runId,
  auth:"Creator real local password sign-in; operator reuses setup's real Auth session",browser:"installed Microsoft Edge; desktop emulation only",tests,stats:raw.stats,
  externalProviders:"external HTTP disabled; proof metadata unavailable; no social publication",flow:"Creator UI + operator UI review/revision/proof/completion; read-only API and SQL persistence assertions",
  limitations:["No Safari/WebKit or physical mobile acceptance.","Synthetic publication URLs and manual checklist decisions; external social publication and metadata retrieval disabled."]},null,2)+"\n");
process.exit(result.status===0 && neutral?0:result.status||1);
