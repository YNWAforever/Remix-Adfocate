import process from "node:process";
import { spawnSync } from "node:child_process";
import { verifiedTarget } from "./local-targets.mjs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {mkdirSync,writeFileSync} from "node:fs";
import {dirname} from "node:path";
import {captureB2Inventory} from "./b2-fixture-inventory.mjs";
const target=verifiedTarget();
const selected=process.argv[2];
if(target.context&&selected!==(target.context.phase==="role"?"staff":target.context.phase==="core"?"pilot":null))throw new Error("B2 integration command/phase mismatch");
if(selected && !["mission-list","authoring","identity","public-claims","academy","quality","staff","pilot"].includes(selected))throw new Error("unsupported audit integration scope");
const file=selected==="pilot"?"server/test/audit-workflow-roundtrip.test.ts":selected==="staff"?"server/test/audit-staff-capabilities.test.ts":selected==="quality"?"server/test/audit-quality.test.ts":selected==="mission-list"?"server/test/audit-mission-list-contract.test.ts":selected==="authoring"?"server/test/audit-mission-authoring-contract.test.ts":selected==="identity"?"server/test/audit-identity-contract.test.ts":selected==="public-claims"?"server/test/audit-public-claims-contract.test.ts":selected==="academy"?"server/test/audit-academy-progress.test.ts":"server/test/audit-workflow-roundtrip.test.ts";
const output=target.context?.privatePath("vitest-results.private.json");
const result=spawnSync(process.execPath,["node_modules/vitest/vitest.mjs","run","--maxWorkers=1","--minWorkers=1",file,...(output?["--reporter=json",`--outputFile=${output}`]:[])],{
  env:{...process.env,...target.env,...(target.context?{ADFOCATE_ACCEPTANCE_TASK:"D19"}:{}),RUN_INTEGRATION:"0",RUN_AUDIT_INTEGRATION:"1",OPENAI_API_KEY:"",OPENROUTER_API_KEY:"",ANTHROPIC_API_KEY:"",
    NODE_OPTIONS:`--import=${pathToFileURL(resolve("scripts/audit/deny-external-fetch.mjs")).href}`},stdio:"inherit"});
let status=result.status??1;
if(target.context){try{captureB2Inventory(verifiedTarget());}catch{status=1;process.stderr.write("B2 inventory/identity/journal gate failed; retain exact records and do not reseed.\n");}const path=target.context.publicPath("phase-result.json");mkdirSync(dirname(path),{recursive:true});writeFileSync(path,JSON.stringify({lineage:target.context.lineage,target:target.identity,exitCode:status,signal:result.signal??null,source:file,at:new Date().toISOString()},null,2)+"\n");}
process.exit(status);
