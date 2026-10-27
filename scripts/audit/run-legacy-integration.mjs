import process from "node:process";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { verifiedTarget } from "./local-targets.mjs";
import { integrationFiles, publicationProofPreflightFile } from "../run-integration-tests.mjs";
const target=verifiedTarget("empty"),workspaceId="00000000-0000-0000-0000-0000000000aa";
const receiptPath="docs/verification/legacy-fixture-ownership.json";
if(target.sql(`select 1 from public.workspaces where id='${workspaceId}';`)){
  if(!existsSync(receiptPath))throw new Error("existing legacy workspace has no current-run ownership receipt");
  const receipt=JSON.parse(readFileSync(receiptPath,"utf8"));
  if(receipt.target.databaseContainerId!==target.identity.databaseContainerId||receipt.target.runId!==target.identity.runId)throw new Error("legacy fixture receipt belongs to another run/target");
}else{
  if(Number(target.sql("select count(*) from public.missions where slug in ('koc-trial-serum','ugc-cafe','clip-skincare','ugc-pet','koc-trial-mask','ugc-travel');")))throw new Error("legacy seed slug collision; refusing broad updates");
  const seed=readFileSync("supabase/seed.sql","utf8");
  if(/\b(delete\s+from|truncate|drop\s+table)\b/i.test(seed))throw new Error("destructive seed refused");
  target.sql(`begin;\n${seed}\ncommit;`);
  const missions=JSON.parse(target.sql(`select jsonb_agg(id order by id) from public.missions where workspace_id='${workspaceId}';`));
  const gifts=JSON.parse(target.sql(`select jsonb_agg(id order by id) from public.redemption_gifts where workspace_id='${workspaceId}';`));
  writeFileSync(receiptPath,JSON.stringify({target:target.identity,workspaceIds:[workspaceId],missionIds:missions,giftIds:gifts,
    seedSha256:createHash("sha256").update(seed.replaceAll("\r\n","\n")).digest("hex"),cleanup:"baseline retained; helper-created rows cleaned only by exact creation IDs"},null,2)+"\n");
}
const scope={runId:target.identity.runId,workspaceIds:[workspaceId]};
const selected=process.argv.slice(2);
if(selected.some((file)=>![...integrationFiles,publicationProofPreflightFile].includes(file)))throw new Error("only reviewed integration files may be selected");
const command=selected.length ? ["node_modules/vitest/vitest.mjs","run","--no-file-parallelism",...selected] : ["scripts/run-integration-tests.mjs"];
const result=spawnSync(process.execPath,command,{stdio:"inherit",env:{...process.env,...target.env,RUN_INTEGRATION:"1",INTEGRATION_RUNNER:"1",
  INTEGRATION_FIXTURE_NAMESPACE:randomUUID(),
  INTEGRATION_FIXTURE_SCOPE_JSON:JSON.stringify(scope),RUN_AUDIT_INTEGRATION:"0",OPENAI_API_KEY:"",OPENROUTER_API_KEY:"",ANTHROPIC_API_KEY:""}});
process.exit(result.status??1);
