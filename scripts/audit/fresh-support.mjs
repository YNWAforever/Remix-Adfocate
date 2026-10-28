// Fresh exact-ID mode of the existing support launcher. No migration, reset or old fixture authority.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {isDeepStrictEqual} from 'node:util';
import process from 'node:process';
import {verifiedTarget} from './local-targets.mjs';
import {integrationFiles,publicationProofPreflightFile} from '../run-integration-tests.mjs';
const target=verifiedTarget('shaped'); // Before keys used by any SDK/client, setup or test import.
const proof=JSON.parse(readFileSync('docs/verification/D19-support-current-identity.json','utf8'));
if(!proof.passed||!isDeepStrictEqual(proof.targets.shaped.identity,target.identity))throw new Error('Fresh support target attestation missing/drifted');
const requested=process.argv.slice(3);if(requested.some(f=>!integrationFiles.includes(f)))throw new Error('Unreviewed support file');
const namespace=randomUUID(),workspaceId=randomUUID(),slug=`d19-support-${namespace}`;
const folder=`docs/verification/D19-support-current-runtime/${namespace}`;mkdirSync(folder,{recursive:true});
const out=(name,value)=>writeFileSync(`${folder}/${name}`,JSON.stringify(value,null,2)+'\n');
const known=['koc-trial-serum','ugc-cafe','clip-skincare','ugc-pet','koc-trial-mask','ugc-travel'];
const seedMissions=known.map(sourceSlug=>({id:randomUUID(),sourceSlug,slug:`${sourceSlug}-${namespace}`}));
const counts=JSON.parse(target.sql("begin read only;select jsonb_object_agg(kind,n)from(select kind,count(*)n from public.academy_content where status='published'group by kind)s;commit;"));
if(!isDeepStrictEqual(counts,{guide_doc:8,track:9,playbook:6,resource:8}))throw new Error('Existing immutable shared Academy seed shape differs; no overwrite permitted');
if(target.sql(`begin read only;select count(*)from public.workspaces where id='${workspaceId}'or slug='${slug}';commit;`)!=='0')throw new Error('Fresh workspace collision');
out('fixture.json',{namespace,target:target.identity,workspaceId,slug,seedMissions,existingPublishedAcademyReadOnly:counts,ownedIdAuthority:'Only this newly-created workspace/mission IDs plus successful inserts journalled by the existing owned fixture transport; no historical IDs loaded',cleanup:'Only current exact IDs; immutable workflow/access actors retained',provider:'disabled; external HTTP denied',stage:'planned'});
target.sql(`begin;insert into public.workspaces(id,slug,name)values('${workspaceId}','${slug}','Owned fresh support fixture');${seedMissions.map(m=>`insert into public.missions(id,workspace_id,slug,title,mission_type,access_type,points_reward,cash_reward,quota,filled,status,required_level,category,deadline)select '${m.id}','${workspaceId}','${m.slug}','Owned support baseline',mission_type,access_type,points_reward,cash_reward,quota,0,status,required_level,category,null from public.missions where slug='${m.sourceSlug}';`).join('\n')}commit;`);
const actual=JSON.parse(target.sql(`begin read only;select jsonb_agg(id order by id)from public.missions where workspace_id='${workspaceId}';commit;`));
if(!isDeepStrictEqual(actual,[...seedMissions.map(m=>m.id)].sort()))throw new Error('Fresh baseline creation incomplete; retain planned IDs');
const ownedPath=resolve(`.codex-tmp/D19-support-current-owned-${namespace}.json`),journal=resolve(`${folder}/owned-ids.jsonl`);
writeFileSync(ownedPath,JSON.stringify({tables:{workspaces:{key:'id',ids:[workspaceId]},missions:{key:'id',ids:actual}}})+'\n');writeFileSync(journal,'');
const scope={workspaceId,slug,namespace,createdThisRun:true};
const env={...process.env,...target.env,INTEGRATION_FIXTURE_NAMESPACE:namespace,INTEGRATION_FRESH_WORKSPACE_JSON:JSON.stringify(scope),INTEGRATION_FIXTURE_SCOPE_JSON:JSON.stringify({runId:target.identity.runId,workspaceIds:[workspaceId]}),INTEGRATION_OWNED_IDS_PATH:ownedPath,INTEGRATION_OWNED_JOURNAL:journal,INTEGRATION_MUTATION_OWNERSHIP:'1',INTEGRATION_CAPABILITY_FIXTURES:'1',INTEGRATION_RETAIN_FIXTURES:'0',RUN_INTEGRATION:'1',INTEGRATION_RUNNER:'1',RUN_AUDIT_INTEGRATION:'0',ADFOCATE_ACCEPTANCE_TASK:'D19',BOOTSTRAP_WORKSPACE_SLUGS:slug,VITE_DEFAULT_WORKSPACE:slug,OPENAI_API_KEY:'',OPENROUTER_API_KEY:'',ANTHROPIC_API_KEY:'',RAPIDAPI_KEY:'',NODE_OPTIONS:`--import=${pathToFileURL(resolve('scripts/audit/deny-external-fetch.mjs')).href}`};
const results=[];
out('blocked-cases.json',{status:'BLOCKED_GLOBAL_RPC_REQUIRES_PRISTINE_DB',tests:['close_due_campaigns closes past-deadline active only, idempotent','snapshot_campaign_leaderboards captures active-campaign ranks'],reason:'Zero-argument global mutators cannot be bounded to this run on the existing retained fixture targets; original tests and SQL are unchanged, these are not passes'});
for(const [stage,files]of [['proof',[publicationProofPreflightFile]],['support',requested.length?requested:integrationFiles]]){
 const args=['node_modules/vitest/vitest.mjs','run','--no-file-parallelism','--maxWorkers=1','--minWorkers=1','--reporter=dot','--reporter=json',`--outputFile=.codex-tmp/D19-support-current-${namespace}-${stage}.private.json`,...(stage==='support'?['--testNamePattern','^(?!.*(?:close_due_campaigns|snapshot_campaign_leaderboards)).*$']:[]),...files];
 const result=spawnSync(process.execPath,args,{env,stdio:'inherit'});results.push({stage,files,command:[process.execPath,...args],exit:result.status??1});if(result.status!==0)break;
}
const checked=verifiedTarget('shaped');if(!isDeepStrictEqual(checked.identity,target.identity))throw new Error('Fresh support postflight target drift');
out('result.json',{namespace,target:checked.identity,workspaceId,slug,results,providerEnabled:false,productionQueried:false,productionWritten:false,historicalFixtureIdsLoaded:0,newFixtureIdsOnly:true,stage:'tests-finished'});
writeFileSync('.codex-tmp/D19-support-current-last-run.json',JSON.stringify({namespace,folder,workspaceId,slug,results})+'\n');
process.exitCode=results.some(r=>r.exit!==0)?1:0;
