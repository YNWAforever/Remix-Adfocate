// Local assembly only. Application is a separate, explicitly authorized tool action.
// This script has no remote client, connection URL, token or database execution path.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {sha256,statements,executablePrefix} from './shared-db-sql.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const folder=resolve(root,'docs/review/kocmax-stage-4d/d1/shared-database');
const execution=resolve(folder,'execution');
await mkdir(execution,{recursive:true});
const read=name=>readFile(resolve(folder,name),'utf8');
const frozen=await read('packet-manifest.json'),packet=JSON.parse(frozen);
const expected='c879b204d9b2928c6426b641262096fff23ef1a1b49b33a8f2003afd5ee9dbff';
if(packet.payloadSha256!==expected||packet.targetProject!=='mhkoayftiuojxlrkollf')throw Error('NOT_USER_REVIEWED_PACKET');
if(execFileSync('git',['branch','--show-current'],{cwd:root,encoding:'utf8'}).trim()!==packet.branch)throw Error('WRONG_BRANCH');
for(const [file,hash] of Object.entries(packet.files))if(sha256(await read(file))!==hash)throw Error('REVIEW_FILE_DRIFT:'+file);
for(const source of packet.sourceMigrations)if(sha256(await readFile(resolve(root,source.path)))!==source.physicalSha256)throw Error('ORIGINAL_SOURCE_DRIFT:'+source.path);
if(sha256(await readFile(resolve(root,'supabase/release-manifest.json')))!==packet.originalManifestSha256)throw Error('MANIFEST_DRIFT');
const reviewed=await read('10-forward-proposed.sql');
const payload=reviewed.split('-- BEGIN REVIEWED PAYLOAD\n')[1]?.split('-- END REVIEWED PAYLOAD')[0];
if(!payload||sha256(payload)!==expected)throw Error('PAYLOAD_DRIFT');
const prefix=reviewed.slice(0,reviewed.indexOf('-- BEGIN REVIEWED PAYLOAD'));
const guards=statements(prefix).filter(s=>/^do\b/i.test(executablePrefix(s))).join('\n');
if((guards.match(/DO \$/g)||[]).length!==4)throw Error('REVIEW_GUARDS_CHANGED');
const {catalog}=JSON.parse(await read('observed-catalog.json'));
const quoted=value=>'"'+value.replaceAll('"','""')+'"';
const tableQueries=catalog.tables.filter(t=>t.relkind==='r').map(t=>{
 const columns=catalog.columns.filter(c=>c.schema===t.schema&&c.table===t.name).sort((a,b)=>a.position-b.position).map(c=>quoted(c.name)).join(',');
 return `SELECT '${t.schema}.${t.name}'::text AS relation, count(*)::bigint AS row_count,md5(coalesce(string_agg(row_hash,',' ORDER BY row_hash COLLATE "C"),'')) AS content_md5 FROM (SELECT md5(row_to_json(r)::text) AS row_hash FROM (SELECT ${columns} FROM ${quoted(t.schema)}.${quoted(t.name)}) r) rows`;
});
const dataQuery=`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY relation),'[]'::jsonb) FROM (\n${tableQueries.join('\nUNION ALL\n')}\n) t`;
await writeFile(resolve(execution,'existing-data-fingerprint.sql'),`-- Read-only opaque checksums of original columns only; no customer rows returned.\nBEGIN READ ONLY;\nSET LOCAL statement_timeout='15s';\n${dataQuery};\nROLLBACK;\n`);
const sql=`-- APPROVED APPLICATION ARTIFACT. User approved applying the reviewed SQL on 2026-10-31.
-- Exact target: existing Remix-Adfocate mhkoayftiuojxlrkollf; no deployment/providers.
-- Reviewed payload sha256: ${expected}
-- Apply as ONE named migration. Do not split or retry without reconciling actual state.
-- This file supplies an explicit atomic boundary. History recording is verified separately.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';
SET LOCAL idle_in_transaction_session_timeout='60s';
SELECT set_config('kocmax.shared_db_review_reference','${packet.reviewReference}',true);
SELECT set_config('kocmax.shared_db_review_payload','${expected}',true);
${guards}
DO $data_before$ DECLARE snapshot jsonb; BEGIN
 ${dataQuery.replace('SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY relation),\'[]\'::jsonb)','SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY relation),\'[]\'::jsonb) INTO snapshot')};
 PERFORM set_config('kocmax.original_rows_md5',md5(snapshot::text),true);
END $data_before$;
-- BEGIN REVIEWED PAYLOAD
${payload}-- END REVIEWED PAYLOAD
DO $data_after$ DECLARE snapshot jsonb; BEGIN
 ${dataQuery.replace('SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY relation),\'[]\'::jsonb)','SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY relation),\'[]\'::jsonb) INTO snapshot')};
 IF md5(snapshot::text) IS DISTINCT FROM current_setting('kocmax.original_rows_md5',true) THEN
   RAISE EXCEPTION 'EXISTING_APPLICATION_DATA_CHANGED_ABORT';
 END IF;
END $data_after$;
COMMIT;
`;
await writeFile(resolve(execution,'approved-apply.sql'),sql);
await writeFile(resolve(execution,'application-manifest.json'),JSON.stringify({status:'APPROVED_NOT_YET_APPLIED',targetProject:packet.targetProject,branch:packet.branch,head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),userApproval:'Good, approve the reviewed SQL changes. Apply them to the existing Remix-Adfocate database on the same branch, preserve all functions and fixes, and verify mobile and desktop. Don’t deploy or create real connections yet.',reviewedPacketManifestSha256:sha256(frozen),reviewedPayloadSha256:expected,applySqlSha256:sha256(sql),migrationName:'kocmax_studio_shared_review_c879b204',originalDataColumnsProtected:catalog.columns.length,originalTablesProtected:tableQueries.length,historyPolicy:'One new named migration; preserve 14 previous entries. Never claim the 62 raw source files were applied unmodified.',excluded:['deployment','real Instagram/Drive connections','persistent browser fixture','Auth account creation','pilot enablement','old history rewriting']},null,2)+'\n');
console.log(JSON.stringify({status:'APPROVED_NOT_YET_APPLIED',bytes:Buffer.byteLength(sql),payloadSha256:expected,applySqlSha256:sha256(sql),protectedTables:tableQueries.length}));
