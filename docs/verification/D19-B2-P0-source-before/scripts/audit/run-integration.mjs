import process from "node:process";
import { spawnSync } from "node:child_process";
import { verifiedTarget } from "./local-targets.mjs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const target=verifiedTarget("empty");
const selected=process.argv[2];
if(selected && !["mission-list","authoring","identity","public-claims","academy","quality","staff","pilot"].includes(selected))throw new Error("unsupported audit integration scope");
const file=selected==="pilot"?"server/test/audit-workflow-roundtrip.test.ts":selected==="staff"?"server/test/audit-staff-capabilities.test.ts":selected==="quality"?"server/test/audit-quality.test.ts":selected==="mission-list"?"server/test/audit-mission-list-contract.test.ts":selected==="authoring"?"server/test/audit-mission-authoring-contract.test.ts":selected==="identity"?"server/test/audit-identity-contract.test.ts":selected==="public-claims"?"server/test/audit-public-claims-contract.test.ts":selected==="academy"?"server/test/audit-academy-progress.test.ts":"server/test/audit-workflow-roundtrip.test.ts";
const result=spawnSync(process.execPath,["node_modules/vitest/vitest.mjs","run","--maxWorkers=1","--minWorkers=1",file],{
  env:{...process.env,...target.env,RUN_INTEGRATION:"0",RUN_AUDIT_INTEGRATION:"1",OPENAI_API_KEY:"",OPENROUTER_API_KEY:"",ANTHROPIC_API_KEY:"",
    NODE_OPTIONS:`--import=${pathToFileURL(resolve("scripts/audit/deny-external-fetch.mjs")).href}`},stdio:"inherit"});
process.exit(result.status??1);
