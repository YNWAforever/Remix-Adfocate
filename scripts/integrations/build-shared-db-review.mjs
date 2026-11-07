// PREPARATION ONLY: reads source files and writes review artifacts. No remote client.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256, statements, classify, executablePrefix, flattenMigration } from './shared-db-sql.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const output = resolve(root, 'docs/review/kocmax-stage-4d/d1/shared-database');
const manifest = JSON.parse(await readFile(resolve(root, 'supabase/release-manifest.json'), 'utf8'));
const observed = JSON.parse(await readFile(resolve(output, 'observed-catalog.json'), 'utf8'));
const inventory = [];
await mkdir(resolve(output, 'sql'), { recursive: true });
for (const entry of manifest.migrations) {
  const path = resolve(root, entry.path);
  if (!relative(root, path).replaceAll('\\', '/').startsWith('supabase/migrations/')) throw new Error('OUTSIDE_MIGRATION_ROOT');
  const bytes = await readFile(path), sql = bytes.toString('utf8').replace(/\r\n?/g, '\n');
  // Match the repository's canonicalSqlText convention; retain the physical hash too.
  if (sha256(sql) !== entry.sha256) throw new Error(`SOURCE_HASH_MISMATCH:${entry.version}`);
  const parts = statements(sql).map((text, i) => ({ id: `${entry.version}:S${String(i + 1).padStart(3, '0')}`, kind: classify(text), sha256: sha256(text), sql: text.trim() }));
  const body = flattenMigration(sql);
  inventory.push({ version:entry.version, name:entry.name, path:entry.path, sha256:entry.sha256, physicalSha256:sha256(bytes), bodySha256:sha256(body), dependsOn:entry.dependsOn,
    existingRelations: [...new Set([...sql.matchAll(/(?:alter\s+table(?:\s+if\s+exists)?|references)\s+(public|private)\.([a-z_0-9]+)/gi)].map(m=>`${m[1]}.${m[2]}`))].filter(name=>observed.catalog.tables.some(t=>`${t.schema}.${t.name}`===name)),
    statements:parts });
  await writeFile(resolve(output, 'sql', `${entry.version}-${entry.name}.sql`), body);
}
await writeFile(resolve(output, 'statement-inventory.json'), JSON.stringify({ status:'REVIEW_ONLY_NOT_APPLIED', sourceManifest:'supabase/release-manifest.json', migrations:inventory }, null, 2)+'\n');
const risky=inventory.flatMap(m=>m.statements.filter(s=>s.kind==='top-level-data-or-call-review-required'||s.kind==='do-block-review-required').map(s=>({version:m.version,id:s.id,kind:s.kind,preview:executablePrefix(s.sql).slice(0,600)})));
await writeFile(resolve(output, 'top-level-effects.json'),JSON.stringify(risky,null,2)+'\n');
const analysis=await readFile(resolve(output,'dependency-analysis.json'),'utf8').then(JSON.parse).catch(e=>{if(e.code!=='ENOENT')throw e;return null;});
if(analysis) {
  // Preserve the canonical helper/API surface as requested; optional helpers are installed, never invoked.
  const versions=manifest.migrations.map(m=>m.version);
  const repairs=analysis.minimalDependencyClosure.baselineRepairs;
  const selected={status:'PROPOSED_REVIEW_ONLY_NOT_APPLIED',versions,selectionReason:'Full canonical source envelope preserves optional helper/RPC capabilities; definitions are not rollout actions. Reduced54 analysis retained as evidence only.',reducedAnalysisSelectionSha256:analysis.minimalDependencyClosure.selectionSha256,
    baselineRepairs:repairs,derivations:['LF line endings per release manifest','Remove only outer transaction boundaries','Immediately revoke inherited API/PUBLIC grants on newly created tables, then retain source explicit grants'],normalizations:[]};
  await mkdir(resolve(output,'derived-sql'),{recursive:true});
  for(const v of versions) {
    const m=inventory.find(m=>m.version===v); if(!m)throw new Error('UNKNOWN_SELECTED_VERSION');
    const body=flattenMigration(m.statements.map(s=>s.sql).join('\n'));
    const derived=statements(body).map(part=>{
      const match=executablePrefix(part).match(/^create\s+table\s+(?:if\s+not\s+exists\s+)?(public|private)\.([a-z_0-9]+)\s*\(/i);
      if(!match)return part;
      const table=`${match[1]}.${match[2]}`;
      if(observed.catalog.tables.some(t=>`${t.schema}.${t.name}`===table)) throw new Error('NEW_TABLE_COLLIDES_WITH_OBSERVED:'+table);
      selected.normalizations.push({version:v,table});
      return part+`\n-- Shared-target overlay: discard inherited broad grants on this NEW table only.\nREVOKE ALL ON TABLE ${table} FROM PUBLIC, anon, authenticated, service_role;\n`;
    }).join('');
    await writeFile(resolve(output,'derived-sql',`${v}-${m.name}.sql`),derived+'\n');
  }
  const repair=repairs[0];
  const baselineSql=(await readFile(resolve(root,repair.path),'utf8')).replace(/\r\n?/g,'\n');
  if(sha256(baselineSql)!==analysis.migrations.find(m=>m.version===repair.version)?.sha256)throw new Error('BASELINE_REPAIR_SOURCE_DRIFT');
  const selectedStatement=statements(baselineSql).find(s=>/^create\s+or\s+replace\s+function\s+public\.apply_mission\s*\(/i.test(executablePrefix(s)));
  if(!selectedStatement)throw new Error('MISSING_BASELINE_REPAIR');
  await writeFile(resolve(output,'11-apply-mission-repair.sql'),`-- Only the reviewed final baseline routine. Existing signature/ACL/owner retained by CREATE OR REPLACE.\n${selectedStatement.trim()}\n`);
  // The original forward envelope removes authenticated private-schema USAGE.
  // Keep the retained invoker trigger working without adding grants or definer rights.
  const definitions=JSON.parse(await readFile(resolve(output,'observed-definitions.json'),'utf8'));
  const trigger=definitions.functions.find(f=>f.schema==='private'&&f.name==='enforce_creator_portfolio_highlight_limit');
  const helper=definitions.functions.find(f=>f.schema==='private'&&f.name==='uuid_lock_key');
  const expression=helper?.definition.match(/AS \$function\$\s*select\s+([\s\S]*?);\s*\$function\$;?\s*$/i)?.[1];
  if(!trigger||!expression)throw new Error('PORTFOLIO_COMPAT_SOURCE_UNRECOGNIZED');
  let preservedTrigger=trigger.definition;
  for(const column of ['workspace_id','creator_id']) {
    const call=`private.uuid_lock_key(new.${column})`;
    if(!preservedTrigger.includes(call))throw new Error('PORTFOLIO_COMPAT_CALL_SITE_DRIFT');
    preservedTrigger=preservedTrigger.replace(call,`(${expression.replace(/\bvalue\b/g,`new.${column}`)})`);
  }
  const triggerMd5=observed.catalog.functions.find(f=>f.schema==='private'&&f.name===trigger.name)?.definition_md5;
  const helperMd5=observed.catalog.functions.find(f=>f.schema==='private'&&f.name===helper.name)?.definition_md5;
  if(!triggerMd5||!helperMd5)throw new Error('PORTFOLIO_COMPAT_HASH_MISSING');
  preservedTrigger=preservedTrigger.trim().replace(/;?$/,';');
  await writeFile(resolve(output,'13-portfolio-compatibility.sql'),`-- Prepared compatibility overlay, not applied. Same owner/ACL/invoker/search_path.\n-- Inline the EXACT captured immutable UUID lock expression at its two call sites.\n-- No private-schema grant or SECURITY DEFINER elevation; lock keys/count limit unchanged.\nDO $portfolio_guard$ BEGIN\n IF md5(pg_get_functiondef('private.enforce_creator_portfolio_highlight_limit()'::regprocedure)) IS DISTINCT FROM '${triggerMd5}'\n OR md5(pg_get_functiondef('private.uuid_lock_key(uuid)'::regprocedure)) IS DISTINCT FROM '${helperMd5}'\n THEN RAISE EXCEPTION 'PORTFOLIO_COMPAT_SOURCE_DRIFT_STOP'; END IF;\nEND $portfolio_guard$;\n${preservedTrigger.trim()}\n`);
  await writeFile(resolve(output,'selected-migrations.json'),JSON.stringify(selected,null,2)+'\n');
}
console.log(JSON.stringify({migrations:inventory.length,statements:inventory.reduce((n,m)=>n+m.statements.length,0),effectReviews:risky.length,output:relative(root,output)}));
