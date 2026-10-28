import process from "node:process";
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { verifiedTarget } from "./local-targets.mjs";
import { integrationFiles, publicationProofPreflightFile } from "../run-integration-tests.mjs";
const selected=process.argv.slice(2);
if(selected.some((file)=>![...integrationFiles,publicationProofPreflightFile].includes(file)))throw new Error("only reviewed integration files may be selected");
// This retained target is never pristine. Refuse the broad/default suite and the
// entire global-job file before even inspecting a target or creating fixtures.
// BLOCKED cases belong only to the separately authorized pristine campaign runner.
if(!selected.length||selected.includes("server/test/campaigns-s2.test.ts"))throw new Error("BLOCKED_GLOBAL_RPC_REQUIRES_PRISTINE_DB: global campaign jobs require the pristine runner; select explicit non-global integration files");
const root=process.cwd();
const target=verifiedTarget("empty"),workspaceId="00000000-0000-0000-0000-0000000000aa";
const receiptPath=resolve(root,"docs/verification/legacy-fixture-ownership.json");
let receipt;
if(target.sql(`select 1 from public.workspaces where id='${workspaceId}';`)){
  if(!existsSync(receiptPath))throw new Error("existing legacy workspace has no current-run ownership receipt");
  receipt=JSON.parse(readFileSync(receiptPath,"utf8"));
  if(receipt.target.databaseContainerId!==target.identity.databaseContainerId||receipt.target.runId!==target.identity.runId)throw new Error("legacy fixture receipt belongs to another run/target");
}else{
  if(existsSync(receiptPath))throw new Error("existing legacy ownership receipt requires reconciliation; refusing to reseed");
  if(Number(target.sql("select count(*) from public.missions where slug in ('koc-trial-serum','ugc-cafe','clip-skincare','ugc-pet','koc-trial-mask','ugc-travel');")))throw new Error("legacy seed slug collision; refusing broad updates");
  const seed=readFileSync(resolve(root,"supabase/seed.sql"),"utf8");
  if(/\b(delete\s+from|truncate|drop\s+table)\b/i.test(seed))throw new Error("destructive seed refused");
  target.sql(`begin;\n${seed}\ncommit;`);
  const missions=JSON.parse(target.sql(`select jsonb_agg(id order by id) from public.missions where workspace_id='${workspaceId}';`));
  const gifts=JSON.parse(target.sql(`select jsonb_agg(id order by id) from public.redemption_gifts where workspace_id='${workspaceId}';`));
  receipt={target:target.identity,workspaceIds:[workspaceId],missionIds:missions,giftIds:gifts,
    seedSha256:createHash("sha256").update(seed.replaceAll("\r\n","\n")).digest("hex"),cleanup:"baseline retained; helper-created rows cleaned only by exact creation IDs"};
  writeFileSync(receiptPath,JSON.stringify(receipt,null,2)+"\n",{flag:"wx"});
}
const exactIds=values=>Array.isArray(values)&&values.every(id=>typeof id==="string"&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id))&&new Set(values).size===values.length;
if(![receipt.workspaceIds,receipt.missionIds,receipt.giftIds].every(exactIds)||receipt.workspaceIds.length!==1||receipt.workspaceIds[0]!==workspaceId)throw new Error("legacy ownership receipt requires exact workspace, mission and gift IDs");
const scope={runId:target.identity.runId,workspaceIds:[workspaceId]};
const namespace=randomUUID(),ownedPath=resolve(root,`.codex-tmp/legacy-owned-${namespace}.private.json`),journalPath=resolve(root,`.codex-tmp/legacy-owned-${namespace}.private.jsonl`);
mkdirSync(resolve(root,".codex-tmp"),{recursive:true});
writeFileSync(ownedPath,JSON.stringify({tables:{workspaces:{key:"id",ids:receipt.workspaceIds},missions:{key:"id",ids:receipt.missionIds},redemption_gifts:{key:"id",ids:receipt.giftIds}}})+"\n",{flag:"wx",mode:0o600});
writeFileSync(journalPath,"",{flag:"wx",mode:0o600});
const command=["node_modules/vitest/vitest.mjs","run","--no-file-parallelism",...selected];
const result=spawnSync(process.execPath,command,{cwd:root,stdio:"inherit",env:{...process.env,...target.env,RUN_INTEGRATION:"1",INTEGRATION_RUNNER:"1",
  INTEGRATION_FIXTURE_NAMESPACE:namespace,INTEGRATION_MUTATION_OWNERSHIP:"1",INTEGRATION_CAPABILITY_FIXTURES:"1",
  INTEGRATION_OWNED_IDS_PATH:ownedPath,INTEGRATION_OWNED_JOURNAL:journalPath,INTEGRATION_PRISTINE_TARGET_JSON:"",
  INTEGRATION_FIXTURE_SCOPE_JSON:JSON.stringify(scope),RUN_AUDIT_INTEGRATION:"0",OPENAI_API_KEY:"",OPENROUTER_API_KEY:"",ANTHROPIC_API_KEY:"",RAPIDAPI_KEY:"",
  NODE_OPTIONS:`--import=${pathToFileURL(resolve(root,"scripts/audit/deny-external-fetch.mjs")).href}`}});
process.exit(result.status??1);
