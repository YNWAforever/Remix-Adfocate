// Assemble review documents only. Never connects to or executes against a database.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { sha256, statements, executablePrefix } from './shared-db-sql.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const folder=resolve(root,'docs/review/kocmax-stage-4d/d1/shared-database');
const read=name=>readFile(resolve(folder,name),'utf8');
const selection=JSON.parse(await read('selected-migrations.json'));
const inventory=JSON.parse(await read('statement-inventory.json')).migrations;
const branch=execFileSync('git',['branch','--show-current'],{cwd:root,encoding:'utf8'}).trim();
const head=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
if(branch!=='codex/kocmax-studio-stages-1-2')throw new Error('WRONG_REVIEW_BRANCH');
const acl=await read('12-baseline-acl.sql'); // Required, never silently omitted.
const tables=selection.normalizations.map(n=>n.table);
if(new Set(tables).size!==55||selection.versions.length!==62)throw new Error('REVIEW_SELECTION_CHANGED');
const checks=[];
for(const name of ['00-preflight.sql','02-extended-preflight.sql']) {
  const guard=statements(await read(name)).filter(s=>/^do\b/i.test(executablePrefix(s)));
  if(guard.length!==1)throw new Error('EXPECTED_ONE_METADATA_GUARD:'+name);
  checks.push(...guard);
}
const dataSelect=statements(await read('01-data-preflight.sql')).find(s=>/^select\b/i.test(executablePrefix(s)));
if(!dataSelect)throw new Error('MISSING_DATA_PREFLIGHT');
checks.push(`DO $data_guard$
DECLARE failed text;
BEGIN
 SELECT string_agg(check_name, ', ' ORDER BY check_name) INTO failed
 FROM (${executablePrefix(dataSelect).trim().replace(/;$/,'')}) checks
 WHERE passed IS DISTINCT FROM true;
 IF failed IS NOT NULL THEN RAISE EXCEPTION 'DATA_PREFLIGHT_STOP: %',failed; END IF;
END
$data_guard$;`);
const post=`-- Transaction-local checks only; they do not replace real Auth/JWT or browser acceptance.
DO $postconditions$
DECLARE relation_name text; rows_present boolean;
BEGIN
 FOREACH relation_name IN ARRAY ARRAY[${tables.map(t=>"'"+t+"'").join(',')}] LOOP
   IF to_regclass(relation_name) IS NULL THEN RAISE EXCEPTION 'EXPECTED_RELATION_MISSING: %',relation_name; END IF;
   EXECUTE format('SELECT EXISTS(SELECT 1 FROM %s)',relation_name::regclass) INTO rows_present;
   IF rows_present THEN RAISE EXCEPTION 'SCHEMA_PREPARATION_CREATED_APPLICATION_ROWS: %',relation_name; END IF;
   IF relation_name LIKE 'public.%' AND NOT (SELECT relrowsecurity FROM pg_class WHERE oid=relation_name::regclass) THEN
     RAISE EXCEPTION 'NEW_PUBLIC_TABLE_REQUIRES_RLS: %',relation_name;
   END IF;
 END LOOP;
 IF (SELECT count(*) FROM storage.buckets WHERE id IN ('mission-draft-assets','mission-publication-proof-assets') AND public=false AND file_size_limit=20971520)<>2 THEN
   RAISE EXCEPTION 'PRIVATE_ASSET_BUCKET_CONTRACT_FAILED';
 END IF;
 IF has_table_privilege('anon','public.studio_sources','SELECT')
   OR has_table_privilege('authenticated','public.studio_sources','INSERT')
   OR has_table_privilege('authenticated','public.integration_connections','UPDATE')
   OR has_table_privilege('authenticated','private.integration_credentials','SELECT')
   OR has_table_privilege('service_role','private.integration_credentials','SELECT')
 THEN RAISE EXCEPTION 'PRIVATE_OR_INTEGRATION_DIRECT_ACCESS_FAILED'; END IF;
END
$postconditions$;
`;
await writeFile(resolve(folder,'20-postconditions.sql'),post);
const chunks=[{name:'11-apply-mission-repair.sql',sql:await read('11-apply-mission-repair.sql')}];
for(const version of selection.versions) {
 const m=inventory.find(m=>m.version===version);if(!m)throw new Error('UNKNOWN_SOURCE_VERSION');
 const name=`derived-sql/${version}-${m.name}.sql`;
 chunks.push({name,sql:await read(name)});
}
chunks.push({name:'12-baseline-acl.sql',sql:acl},{name:'13-portfolio-compatibility.sql',sql:await read('13-portfolio-compatibility.sql')},{name:'20-postconditions.sql',sql:post});
for(const chunk of chunks)for(const part of statements(chunk.sql)) {
 if(/^(?:begin|commit|rollback|start\s+transaction|savepoint|release)\b/i.test(executablePrefix(part)))throw new Error('NESTED_TRANSACTION:'+chunk.name);
}
const payload=chunks.map(c=>`-- SOURCE: ${c.name}; sha256=${sha256(c.sql)}\n${c.sql.trim()}\n`).join('\n');
const payloadHash=sha256(payload);
const sql=`-- REVIEW-ONLY PROPOSAL for existing Remix-Adfocate mhkoayftiuojxlrkollf.
-- Not applied. Do not run without separately approved shared-database rehearsal.
-- Default is ROLLBACK. A future commit requires a newly reviewed artifact, not an ad-hoc edit.
-- Dedicated connection; stop on the first error; never use the ordinary migration runner.
-- Approval-reference settings are accidental-execution interlocks, NOT authorization or target identity.
-- Verify control-plane project identity and packet hashes independently before any SQL.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';
SET LOCAL idle_in_transaction_session_timeout = '60s';
DO $approval_guard$
BEGIN
 IF current_setting('kocmax.shared_db_review_reference',true) IS DISTINCT FROM 'c817e8f0-3cf0-461c-9c57-5e0715d5bfc8'
   OR current_setting('kocmax.shared_db_review_payload',true) IS DISTINCT FROM '${payloadHash}'
 THEN RAISE EXCEPTION 'DB_CHANGE_NOT_APPROVED_FOR_THIS_REVIEW_ARTIFACT'; END IF;
END
$approval_guard$;
${checks.join('\n')}
-- BEGIN REVIEWED PAYLOAD
${payload}-- END REVIEWED PAYLOAD
-- No history rows are inserted or repaired. No rollout/settlement/pilot RPC is invoked.
ROLLBACK;
`;
await writeFile(resolve(folder,'10-forward-proposed.sql'),sql);
const files=['00-preflight.sql','01-data-preflight.sql','02-extended-preflight.sql','10-forward-proposed.sql',...chunks.map(c=>c.name),'30-fixture-transaction.sql','40-abort-open-transaction.sql','41-after-rollback.sql','fixtures-plan.json','provider-test-cases.json','rollback-plan.md','acl-review.md','selected-migrations.json','observed-catalog.json','observed-definitions.json','observed-storage.json','observed-privileges.json','catalog-fingerprint.json'];
const hashes={};for(const name of [...new Set(files)])hashes[name]=sha256(await read(name));
const rehearsalFiles={};
for(const name of ['build-shared-db-review.mjs','package-shared-db-review.mjs','rehearse-shared-db-packet.mjs','shared-db-local-baseline.mjs','shared-db-journey-checks.mjs','shared-db-sql.mjs','shared-db-sql.test.mjs']) {
 const path='scripts/integrations/'+name;rehearsalFiles[path]=sha256(await readFile(resolve(root,path)));
}
const packet={status:'PREPARED_ONLY_NOT_APPLIED',targetProject:'mhkoayftiuojxlrkollf',branch,head,defaultOutcome:'ROLLBACK',reviewReference:'c817e8f0-3cf0-461c-9c57-5e0715d5bfc8',payloadSha256:payloadHash,
 catalogMd5:'9c71b106abb2ec07304e10772a871f9b',extendedMetadataMd5:'ced6f4c3e4ff69e10b8870f6a51b4717',
 originalManifestSha256:sha256(await readFile(resolve(root,'supabase/release-manifest.json'))),
 sourceMigrations:inventory.map(m=>({version:m.version,path:m.path,canonicalSha256:m.sha256,physicalSha256:m.physicalSha256})),
 changes:{canonicalSourceFiles:62,newApplicationTables:tables.length,baselineRoutineRepair:'public.apply_mission(uuid)',baselineAcl:'12-baseline-acl.sql',portfolioCompatibility:'13-portfolio-compatibility.sql',assetBuckets:2},
 appliedToRemote:false,originalManifestChanged:false,historyWrites:false,realConnections:false,files:hashes,rehearsalFiles};
await writeFile(resolve(folder,'packet-manifest.json'),JSON.stringify(packet,null,2)+'\n');
console.log(JSON.stringify({status:packet.status,sources:62,tables:tables.length,payloadSha256:payloadHash,files:Object.keys(hashes).length}));
