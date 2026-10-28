import {readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {isDeepStrictEqual as equal} from 'node:util';
import process from 'node:process';
import {verifiedTarget} from './local-targets.mjs';
import {neutralitySnapshot,legacyRewardAnchors,assertBrowserPendingNeutrality} from './neutrality-snapshot.mjs';
import {captureB2Inventory} from './b2-fixture-inventory.mjs';
const target=verifiedTarget();
const context=target.context;
if(context&&context.phase!=='browser')throw new Error('B2 browser runner phase mismatch');
const env={...process.env,...target.env,NODE_ENV:'production',ADFOCATE_BROWSER_SCOPE:'D19',ADFOCATE_ACCEPTANCE_TASK:'D19',RUN_INTEGRATION:'0',RUN_AUDIT_INTEGRATION:'0',OPENAI_API_KEY:'',OPENROUTER_API_KEY:'',ANTHROPIC_API_KEY:'',NODE_OPTIONS:`--import=${pathToFileURL(resolve('scripts/audit/deny-external-fetch.mjs')).href}`};
const run=(args,extra={})=>spawnSync(process.execPath,args,{env:{...env,...extra},stdio:'inherit'}).status??1;
if(!process.argv.includes('--resume')){const prepared=run(['node_modules/vite-node/vite-node.mjs','scripts/audit/prepare-pilot-browser.ts']);if(prepared)process.exit(prepared);}
const fx=context?context.readPrivate('browser-fixture.private.json'):JSON.parse(readFileSync('.codex-tmp/D19-browser-fixture.private.json','utf8'));if(!equal(fx.target,target.identity))throw new Error('D19 browser target mismatch');
Object.assign(env,{VITE_SUPABASE_URL:target.env.SUPABASE_URL,VITE_SUPABASE_ANON_KEY:target.env.SUPABASE_ANON_KEY,VITE_DEFAULT_WORKSPACE:fx.slug,VITE_ENABLE_WHATSAPP:'false',VITE_ENABLE_GOOGLE:'false'});
const build=run(['node_modules/vite/bin/vite.js','build','--mode','production']);if(build)process.exit(build);
const summaries=[];let status=0;
for(const phase of ['journey','roles']){
 status=run(['node_modules/@playwright/test/cli.js','test',phase==='journey'?'e2e/creator-operator-mission.spec.ts':'e2e/staff-access.spec.ts','--config=playwright.pilot.config.ts'],{ADFOCATE_BROWSER_PHASE:phase});
 const raw=JSON.parse(readFileSync(context?.privatePath(`browser-${phase}-results.private.json`)??`.codex-tmp/D19-browser-${phase}-results.private.json`,'utf8')),tests=[];
 const visit=s=>{for(const spec of s.specs??[])tests.push({title:spec.title,ok:spec.ok,results:spec.tests.flatMap(t=>t.results.map(r=>({status:r.status,duration:r.duration})))});for(const child of s.suites??[])visit(child);};for(const s of raw.suites)visit(s);
 summaries.push({phase,tests,stats:raw.stats});if(status)break;
}
const live=verifiedTarget();if(!equal(live.identity,target.identity))throw new Error('D19 browser target drift before financial readback');
const after=neutralitySnapshot(live,fx.creator.id,fx.workspaceId,{complete:Boolean(context)});
let neutrality={passed:false,reason:'D19_PENDING_REWARD_EVIDENCE_INCOMPLETE'};
try{
 const saved=context?context.readPrivate('browser-fixture.private.json'):JSON.parse(readFileSync('.codex-tmp/D19-browser-fixture.private.json','utf8'));
 const expected={...(context?{lineage:context.lineage}:{}),runId:fx.runId,target:live.identity,creatorId:fx.creator.id,workspaceId:fx.workspaceId,submissionId:saved.core?.submissionId,workflowId:saved.core?.workflowId,requireCompleteRows:Boolean(context)};
 const before=JSON.parse(readFileSync(context?.publicPath('browser-before-handoff.json')??'docs/verification/D19-browser-before-handoff.json','utf8'));
 const current={...expected,snapshot:after,legacyAnchors:legacyRewardAnchors(live,fx.workspaceId)};
 neutrality={...assertBrowserPendingNeutrality(before,current,expected),reason:null};
 writeFileSync(context?.publicPath('browser-neutrality.json')??'docs/verification/D19-browser-neutrality.json',JSON.stringify({...(context?{lineage:context.lineage}:{}),runId:fx.runId,target:live.identity,before,after:current,neutrality},null,2)+'\n');
}catch(error){status=1;neutrality={passed:false,reason:['D19_PENDING_REWARD_FRAME_MISMATCH','D19_PENDING_REWARD_NEUTRALITY_CHANGED'].includes(error.code)?error.code:'D19_PENDING_REWARD_EVIDENCE_INCOMPLETE'};process.stderr.write('D19 browser pending neutrality gate failed; retain evidence and HOLD.\n');}
if(context){try{captureB2Inventory(live);}catch{status=1;process.stderr.write('B2 browser inventory/identity/journal gate failed; no reseed.\n');}writeFileSync(context.publicPath('phase-result.json'),JSON.stringify({lineage:context.lineage,target:live.identity,exitCode:status,at:new Date().toISOString()},null,2)+'\n');}
writeFileSync(context?.publicPath('browser-after.json')??'docs/verification/D19-browser-after.json',JSON.stringify({...(context?{lineage:context.lineage}:{}),runId:fx.runId,target:live.identity,after,neutrality},null,2)+'\n');
writeFileSync(context?.publicPath('browser-summary.json')??'docs/verification/D19-browser-summary.json',JSON.stringify({...(context?{lineage:context.lineage}:{}),runId:fx.runId,target:target.identity,summaries,passed:summaries.flatMap(s=>s.tests).filter(t=>t.ok).length,status,neutrality,scope:'Real local browser→API→Auth/RLS/DB legacy and active workflow; external proof metadata unavailable; access503 is an explicit transport mock. No production or paid provider.'},null,2)+'\n');
process.exit(status);
