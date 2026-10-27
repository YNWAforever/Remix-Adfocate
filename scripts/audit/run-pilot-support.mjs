// Existing business integration on the second already-owned target. No reset or old-row cleanup.
import {readFileSync,writeFileSync,existsSync,appendFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import process from 'node:process';
import {verifiedTarget} from './local-targets.mjs';
import {integrationFiles,publicationProofPreflightFile} from '../run-integration-tests.mjs';
if(process.argv[2]==='--fresh'){
 await import('./fresh-support.mjs');
}else{
const target=verifiedTarget('shaped'),receipt='.codex-tmp/D19-support.private.json';
const tableNames=JSON.parse(target.sql("select jsonb_agg(tablename order by tablename) from pg_tables where schemaname='public';"));
if(!tableNames.every(n=>/^[a-z0-9_]+$/.test(n)))throw new Error('unexpected catalog identifier');
const snapshot=()=>JSON.parse(target.sql(`select jsonb_object_agg(name,rows) from (${tableNames.map(n=>`select '${n}' as name,coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb)as rows from public.${n} r`).join(' union all ')}) all_rows;`));
const canonical=v=>JSON.stringify(v),hash=v=>createHash('sha256').update(canonical(v)).digest('hex');
let fixture;
if(existsSync(receipt)){
 fixture=JSON.parse(readFileSync(receipt,'utf8'));
 if(JSON.stringify(fixture.identity)!==JSON.stringify(target.identity))throw new Error('D19 support resume target drift');
}else{
 const before=snapshot(),demo='00000000-0000-0000-0000-0000000000aa';
 if(before.workspaces.some(r=>r.id===demo)||before.academy_content.length||before.missions.some(r=>['koc-trial-serum','ugc-cafe','clip-skincare','ugc-pet','koc-trial-mask','ugc-travel'].includes(r.slug)))throw new Error('support fixture collision; no overwrite/reset permitted');
 const seed=readFileSync('supabase/seed.sql','utf8'),academy=readFileSync('supabase/migrations/0028_academy_content.sql','utf8').split('-- Guide docs seed (8 rows) -----')[1];
 if(!academy||/\b(delete\s+from|truncate|drop\s+table)\b/i.test(seed)||/^\s*(create|alter|grant|revoke|drop)\b/im.test(academy))throw new Error('non-data/destructive seed refused');
 fixture={runId:randomUUID(),identity:target.identity,before,workspaceIds:[demo],seedSha256:createHash('sha256').update(seed).digest('hex'),academyDmlSha256:createHash('sha256').update(academy).digest('hex')};
 writeFileSync(receipt,JSON.stringify(fixture)); // Persist recovery identity before the additive fixture transaction.
 target.sql(`begin;\n${seed}\n${academy}\ncommit;`);
 const seeded=snapshot(),tables={};
 for(const name of tableNames){const old=new Set(before[name].map(hash)),rows=seeded[name].filter(r=>!old.has(hash(r))),key=['id','user_id','creator_id','workspace_id'].find(k=>rows.some(r=>typeof r[k]==='string'));if(key)tables[name]={key,ids:rows.map(r=>r[key]).filter(v=>typeof v==='string')};}
 writeFileSync('.codex-tmp/D19-support-owned.json',JSON.stringify({tables}));
 writeFileSync('docs/verification/D19-support-fixture.json',JSON.stringify({runId:fixture.runId,target:target.identity,workspaceIds:fixture.workspaceIds,seedSha256:fixture.seedSha256,academyDmlSha256:fixture.academyDmlSha256,tables,originalTables:tableNames.map(name=>({name,rows:before[name].length,hashes:before[name].map(hash).sort()})),content:'Historical seed DML copied as disposable integration fixtures only. No DDL/history replay, no new lessons, no approved-curriculum acceptance; D15 blocker unchanged.',cleanup:'Only exact successful creation IDs, with parent ownership, may be changed; access/active-history actors retained.'},null,2)+'\n');
}
const attemptNamespace=randomUUID();
appendFileSync('docs/verification/D19-support-attempts.jsonl',JSON.stringify({at:new Date().toISOString(),namespace:attemptNamespace,seedRunId:fixture.runId,selected:process.argv.slice(2)})+'\n');
const env={...process.env,...target.env,INTEGRATION_FIXTURE_NAMESPACE:attemptNamespace,INTEGRATION_FIXTURE_SCOPE_JSON:JSON.stringify({runId:target.identity.runId,workspaceIds:fixture.workspaceIds}),INTEGRATION_OWNED_IDS_PATH:resolve('.codex-tmp/D19-support-owned.json'),INTEGRATION_OWNED_JOURNAL:resolve('docs/verification/D19-support-owned-ids.jsonl'),INTEGRATION_MUTATION_OWNERSHIP:'1',INTEGRATION_CAPABILITY_FIXTURES:'1',INTEGRATION_RETAIN_FIXTURES:'0',RUN_INTEGRATION:'1',INTEGRATION_RUNNER:'1',RUN_AUDIT_INTEGRATION:'0',ADFOCATE_ACCEPTANCE_TASK:'D19',OPENAI_API_KEY:'',OPENROUTER_API_KEY:'',ANTHROPIC_API_KEY:'',NODE_OPTIONS:`--import=${pathToFileURL(resolve('scripts/audit/deny-external-fetch.mjs')).href}`};
const selected=process.argv.slice(2);if(selected.some(n=>!integrationFiles.includes(n)))throw new Error('unreviewed integration file');
const exec=(files,name)=>spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','--no-file-parallelism','--maxWorkers=1','--minWorkers=1','--reporter=default','--reporter=json',`--outputFile=.codex-tmp/D19-${name}-results.private.json`,...files],{env,stdio:'inherit'}).status??1;
let status=exec([publicationProofPreflightFile],'support-preflight');
if(!status)status=exec(selected.length?selected:integrationFiles,'support');
const live=verifiedTarget('shaped'),changes=[];
for(const name of tableNames)for(const row of fixture.before[name]){
 const encoded=JSON.stringify(row).replaceAll("'","''");
 if(live.sql(`select exists(select 1 from public.${name} r where to_jsonb(r)='${encoded}'::jsonb);`)!=='t')changes.push({table:name,originalRowHash:hash(row)});
}
writeFileSync('docs/verification/D19-support-sentinel-check.json',JSON.stringify({runId:fixture.runId,target:live.identity,preExistingPublicRowsUnchanged:changes.length===0,changes,originalRows:Object.values(fixture.before).reduce((n,rows)=>n+rows.length,0),scope:'All pre-existing public base-table rows in shaped target; only hashes exported, not authored row content. Schema/Auth/Storage identity and original SQL are checked separately.'},null,2)+'\n');
process.exit(status||changes.length?1:0);
}
