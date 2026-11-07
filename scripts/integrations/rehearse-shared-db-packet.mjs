// Offline rehearsal only: memory:// is hardcoded; no URL/environment/remote client.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { localBaseline } from './shared-db-local-baseline.mjs';
import { sha256 } from './shared-db-sql.mjs';
import { checkExistingJourneys } from './shared-db-journey-checks.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const folder=resolve(root,'docs/review/kocmax-stage-4d/d1/shared-database');
const read=name=>readFile(resolve(folder,name),'utf8');
const packet=JSON.parse(await read('packet-manifest.json'));
for(const [file,expected] of Object.entries(packet.files))if(sha256(await read(file))!==expected)throw new Error('PACKET_FILE_DRIFT:'+file);
for(const [file,expected] of Object.entries(packet.rehearsalFiles))if(sha256(await readFile(resolve(root,file)))!==expected)throw new Error('REHEARSAL_SOURCE_DRIFT:'+file);
for(const entry of packet.sourceMigrations) {
 const raw=await readFile(resolve(root,entry.path));
 if(sha256(raw)!==entry.physicalSha256||sha256(raw.toString('utf8').replace(/\r\n?/g,'\n'))!==entry.canonicalSha256)throw new Error('ORIGINAL_MIGRATION_CHANGED:'+entry.path);
}
if(sha256(await readFile(resolve(root,'supabase/release-manifest.json')))!==packet.originalManifestSha256)throw new Error('ORIGINAL_RELEASE_MANIFEST_CHANGED');
const fullSql=await read('10-forward-proposed.sql');
const payload=fullSql.split('-- BEGIN REVIEWED PAYLOAD\n')[1]?.split('-- END REVIEWED PAYLOAD')[0];
if(!payload||sha256(payload)!==packet.payloadSha256)throw new Error('PAYLOAD_HASH_MISMATCH');
const beforeGuard=await read('00-preflight.sql');
const projectionQuery=beforeGuard.slice(beforeGuard.indexOf('WITH t AS ('),beforeGuard.indexOf('INTO actual;')+'INTO actual;'.length)
 .replace('SELECT md5(jsonb_build_object(','SELECT jsonb_build_object(').replace(')::text) INTO actual;',') AS catalog;');
const report={mode:'LOCAL_IN_PROCESS_ONLY',selection:'exact-packaged-payload',payloadSha256:packet.payloadSha256,sourceFilesVerified:packet.sourceMigrations.length,
 checks:[],limitations:[],result:'NOT_RUN'};
const realFetch=globalThis.fetch;
let networkAttempts=0;
globalThis.fetch=async()=>{networkAttempts++;throw new Error('NETWORK_FORBIDDEN_IN_LOCAL_REVIEW');};
let db;
const catalog=async()=> (await db.query(projectionQuery)).rows[0].catalog;
try {
 const baseline=await localBaseline(folder); db=baseline.db;report.limitations=baseline.limitations;
 report.limitations.push('target metadata/owner/version guards cannot pass against a local projection; only the exact payload after these guards is rehearsed',
  'no browser, real JWT, HTTP API, two-connection races, Storage upload, provider or reward-settlement acceptance');
 const before=await catalog(), beforeHash=sha256(JSON.stringify(before));
 // The full file must reject execution without explicit artifact-reference interlocks.
 try {await db.exec(fullSql);throw new Error('UNAPPROVED_PACKET_ACCEPTED');}
 catch(e){await db.exec('rollback;');if(!e.message.includes('DB_CHANGE_NOT_APPROVED_FOR_THIS_REVIEW_ARTIFACT'))throw e;}
 if(sha256(JSON.stringify(await catalog()))!==beforeHash)throw new Error('UNAPPROVED_PACKET_CHANGED_SCHEMA');
 report.checks.push('full packet rejects missing review reference before mutation');
 // Execute the exact payload, then deliberately abort after every DDL statement.
 try {await db.exec(`begin;\n${payload}\nDO $$ BEGIN RAISE EXCEPTION 'INJECTED_REHEARSAL_FAILURE'; END $$;`);throw new Error('FAULT_NOT_INJECTED');}
 catch(e){await db.exec('rollback;');if(!e.message.includes('INJECTED_REHEARSAL_FAILURE'))throw e;}
 if(sha256(JSON.stringify(await catalog()))!==beforeHash)throw new Error('DDL_ROLLBACK_DID_NOT_RESTORE_PROJECTED_CATALOG');
 report.checks.push('injected final failure rolls back all projected DDL/functions/grants');
 // This commit is exclusively inside disposable memory, with no connection URL support.
 await db.exec(`begin;\n${payload}\ncommit;`);
 report.checks.push('exact 62-source payload, baseline routine repair, ACL overlay and final SQL assertions pass');
 const after=await catalog();
 const beforeNames=new Set(before.tables.map(t=>`${t.schema}.${t.name}`));
 const afterNames=new Set(after.tables.map(t=>`${t.schema}.${t.name}`));
 for(const name of beforeNames)if(!afterNames.has(name))throw new Error('EXISTING_RELATION_REMOVED:'+name);
 const newTables=after.tables.filter(t=>['r','p'].includes(t.relkind)&&!beforeNames.has(`${t.schema}.${t.name}`)).map(t=>`${t.schema}.${t.name}`);
 if(newTables.length!==55){report.newTablesObserved=newTables;throw new Error('UNEXPECTED_NEW_TABLE_COUNT:'+newTables.length);}
 const existingChanges=before.tables.map(t=>{
  const key=`${t.schema}.${t.name}`,now=after.tables.find(a=>a.schema===t.schema&&a.name===t.name);
  const priorCols=before.columns.filter(c=>c.schema===t.schema&&c.table===t.name);
  const nextCols=after.columns.filter(c=>c.schema===t.schema&&c.table===t.name);
  return {table:key,aclChanged:t.acl!==now.acl,rlsBefore:t.rls,rlsAfter:now.rls,addedColumns:nextCols.filter(c=>!priorCols.some(p=>p.name===c.name)).map(c=>({name:c.name,type:c.type,default:c.default}))};
 }).filter(t=>t.aclChanged||t.addedColumns.length||t.rlsBefore!==t.rlsAfter);
 await writeFile(resolve(folder,'projected-schema-diff.json'),JSON.stringify({mode:'LOCAL_EMPTY_PROJECTION_NOT_LIVE_SCHEMA',payloadSha256:packet.payloadSha256,before:{tables:before.tables.filter(t=>['r','p'].includes(t.relkind)).length,columns:before.columns.length,functions:before.functions.length,policies:before.policies.length},after:{tables:after.tables.filter(t=>['r','p'].includes(t.relkind)).length,columns:after.columns.length,functions:after.functions.length,policies:after.policies.length,sequences:after.tables.filter(t=>t.relkind==='S').map(t=>`${t.schema}.${t.name}`)},newTables,existingChanges},null,2)+'\n');
 report.checks.push('all 39 existing application tables preserved; 55 new empty tables');
 const actors=['b2205cc1-972c-44aa-93d4-6b5d620a7401','b2205cc1-972c-44aa-93d4-6b5d620a7402','b2205cc1-972c-44aa-93d4-6b5d620a7403','b2205cc1-972c-44aa-93d4-6b5d620a7404'];
 for(const id of actors)await db.query('insert into auth.users(id) values($1)',[id]); // local Auth substitute only
 const names=['creator_a','creator_peer','creator_b','operator_a'];
 for(let i=0;i<names.length;i++)await db.query('select set_config($1,$2,false)',['kocmax.fixture_'+names[i],actors[i]]);
 await db.query("select set_config('kocmax.fixture_approval','LOCAL_MEMORY_TEST_ONLY',false)");
 const fixture=await read('30-fixture-transaction.sql');
 await db.exec(fixture);
 const residue=await db.query("select count(*)::int as n from public.workspaces where id in ('b2205cc1-972c-44aa-93d4-6b5d620a7301','b2205cc1-972c-44aa-93d4-6b5d620a7302')");
 if(residue.rows[0].n!==0)throw new Error('FIXTURE_ROLLBACK_RESIDUE');
 report.checks.push('private unverified brief; owner/peer/cross-workspace/anonymous policies; no financial/XP/badge award; fixture rolled back');
 // Interleave extra local regression cases before the fixture's final rollback.
 // The deliverable fixture stays unchanged and always rolls back when used alone.
 await db.exec(fixture.replace(/ROLLBACK;\s*$/i,''));
 report.existingJourneys=await checkExistingJourneys(db,actors);
 await db.exec('rollback;');
 if((await db.query("select count(*)::int n from public.workspaces where id='b2205cc1-972c-44aa-93d4-6b5d620a7301'")).rows[0].n!==0)throw new Error('EXTENDED_FIXTURE_RESIDUE');
 report.checks.push('extended existing-journey local fixture also rolled back');
 await db.query("select set_config('kocmax.fixture_approval','',false)");
 try {await db.exec(fixture);throw new Error('MISSING_APPROVAL_WAS_ACCEPTED');}
 catch(e){await db.exec('rollback;');if(!e.message.includes('EXPLICIT_FIXTURE_APPROVAL'))throw e;}
 report.checks.push('fixture missing approval rejected before writes');
 await db.query("select set_config('kocmax.fixture_approval','LOCAL_MEMORY_TEST_ONLY',false)");
 await db.exec("insert into public.workspaces(id,slug,name) values('b2205cc1-972c-44aa-93d4-6b5d620a7301','preexisting-local-collision','must survive rejected fixture');");
 try {await db.exec(fixture);throw new Error('COLLISION_WAS_ACCEPTED');}
 catch(e){await db.exec('rollback;');if(!e.message.includes('FIXTURE_ID_COLLISION'))throw e;}
 const preserved=await db.query("select name from public.workspaces where id='b2205cc1-972c-44aa-93d4-6b5d620a7301'");
 if(preserved.rows[0]?.name!=='must survive rejected fixture')throw new Error('COLLISION_ROW_CHANGED');
 report.checks.push('existing fixture ID collision rejected without upsert or deletion');
 report.result='LOCAL_DDL_AND_FIXTURE_PASSED';
}catch(e){report.result='FAILED';report.error={message:e.message,code:e.code,detail:e.detail,where:e.where,queryPreview:e.query?.slice(0,500)};process.exitCode=1;if(db)await db.exec('rollback;').catch(()=>{});}
finally{if(db)await db.close();report.networkAttempts=networkAttempts;report.recordedAtUtc=new Date().toISOString();report.packetManifestSha256=sha256(await read('packet-manifest.json'));globalThis.fetch=realFetch;await writeFile(resolve(folder,'local-rehearsal.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({result:report.result,checks:report.checks.length,sources:report.sourceFilesVerified,error:report.error}));}
