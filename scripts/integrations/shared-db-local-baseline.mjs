// In-process PostgreSQL projection of observed metadata. Never imports a remote client.
// Auth/Storage are explicit local substitutes; pgvector is not installed here.
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
export const quote = s => '"'+s.replaceAll('"','""')+'"';
const ident = (s,n) => `${quote(s)}.${quote(n)}`;
const literal = s => "'"+s.replaceAll("'","''")+"'";
export async function localBaseline(folder) {
  const {catalog} = JSON.parse(await readFile(`${folder}/observed-catalog.json`,'utf8'));
  const defs = JSON.parse(await readFile(`${folder}/observed-definitions.json`,'utf8'));
  const privileges = JSON.parse(await readFile(`${folder}/observed-privileges.json`,'utf8'));
  const db = await PGlite.create('memory://', {extensions:{pgcrypto}});
  try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema private; create schema storage;
    create extension pgcrypto;
    create table auth.users(id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    grant usage on schema public,auth to anon,authenticated,service_role;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner uuid,owner_id text,metadata jsonb,created_at timestamptz default now());
    create function storage.foldername(text) returns text[] language sql immutable as $$select (string_to_array($1,'/'))[1:array_length(string_to_array($1,'/'),1)-1]$$;
    create function storage.filename(text) returns text language sql immutable as $$select (string_to_array($1,'/'))[array_length(string_to_array($1,'/'),1)]$$;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;`);
  for (const table of catalog.tables.filter(t=>t.relkind==='r')) {
    const cols=catalog.columns.filter(c=>c.schema===table.schema&&c.table===table.name).map(c=>{
      const type=c.type.startsWith('vector')?'text':c.type;
      const expression=c.generated?` generated always as (${c.default}) stored`:c.default?' default '+c.default:'';
      return `${quote(c.name)} ${type}${expression}${c.not_null?' not null':''}`;
    });
    await db.exec(`create table ${ident(table.schema,table.name)} (${cols.join(',')});`);
  }
  // SQL-language bodies can reference functions created later in the captured catalog.
  await db.exec('set check_function_bodies = off;');
  for (const fn of defs.functions.filter(f=>f.name!=='match_kb_chunks'&&f.name!=='rls_auto_enable')) await db.exec(fn.definition);
  await db.exec('set check_function_bodies = on;');
  // Reconstruct effective schema/function API grants, not masked owner names.
  for(const schema of catalog.schemas)for(const role of ['','anon','authenticated','service_role']) {
    const principal=role||'PUBLIC';
    const grant=(schema.acl??'').match(new RegExp(`(?:[,{])${role}=([^/]*)/`))?.[1]??'';
    await db.exec(`revoke all on schema ${quote(schema.name)} from ${principal};`);
    const rights=[['U','usage'],['C','create']].filter(([letter])=>grant.includes(letter)).map(([,right])=>right);
    if(rights.length)await db.exec(`grant ${rights.join(',')} on schema ${quote(schema.name)} to ${principal};`);
  }
  for(const fn of catalog.functions.filter(f=>f.name!=='match_kb_chunks'&&f.name!=='rls_auto_enable'))for(const role of ['','anon','authenticated','service_role']) {
    const principal=role||'PUBLIC',signature=`${ident(fn.schema,fn.name)}(${fn.identity_args})`;
    const grant=fn.acl===null?(role===''?'X':''):(fn.acl??'').match(new RegExp(`(?:[,{])${role}=([^/]*)/`))?.[1]??'';
    await db.exec(`revoke all on function ${signature} from ${principal};`);
    if(grant.includes('X'))await db.exec(`grant execute on function ${signature} to ${principal};`);
  }
  // Preserve key/constraint names so later ALTER/DROP statements target the observed objects.
  for (const kind of ['p','u','c','f']) for (const c of catalog.constraints.filter(c=>c.type===kind)) {
    await db.exec(`alter table ${ident(c.schema,c.table)} add constraint ${quote(c.name)} ${c.definition};`);
  }
  const constraints=new Set(catalog.constraints.map(c=>`${c.schema}.${c.name}`));
  for (const idx of catalog.indexes.filter(i=>!constraints.has(`${i.schema}.${i.name}`)&&!i.definition.includes(' USING hnsw '))) await db.exec(idx.definition);
  for (const table of catalog.tables.filter(t=>t.relkind==='r')) {
    if(table.rls) await db.exec(`alter table ${ident(table.schema,table.name)} enable row level security;`);
    if(table.force_rls) await db.exec(`alter table ${ident(table.schema,table.name)} force row level security;`);
    for (const role of ['anon','authenticated','service_role']) {
      const grant=(table.acl??'').match(new RegExp(`(?:[,{])${role}=([^/]*)/`))?.[1]??'';
      const rights=[['a','insert'],['r','select'],['w','update'],['d','delete'],['D','truncate'],['x','references'],['t','trigger'],['m','maintain']].filter(([letter])=>grant.includes(letter)).map(([,right])=>right);
      await db.exec(`revoke all on ${ident(table.schema,table.name)} from ${role};${rights.length?`grant ${rights.join(',')} on ${ident(table.schema,table.name)} to ${role};`:''}`);
    }
  }
  for(const col of privileges.columns) for(const role of ['anon','authenticated','service_role']) {
    const grant=(col.acl??'').match(new RegExp(`(?:[,{])${role}=([^/]*)/`))?.[1]??'';
    const rights=[['a','insert'],['r','select'],['w','update'],['x','references']].filter(([letter])=>grant.includes(letter)).map(([,right])=>right);
    if(rights.length)await db.exec(`grant ${rights.map(right=>`${right}(${quote(col.column)})`).join(',')} on ${ident(col.schema,col.table)} to ${role};`);
  }
  for (const p of catalog.policies) await db.exec(`create policy ${quote(p.policyname)} on ${ident(p.schemaname,p.tablename)} as ${p.permissive} for ${p.cmd} to ${p.roles.map(r=>r==='public'?'public':quote(r)).join(',')}${p.qual?' using ('+p.qual+')':''}${p.with_check?' with check ('+p.with_check+')':''};`);
  for (const t of defs.triggers) await db.exec(t.definition);
  return {db,limitations:['in-process PGlite, not hosted PostgreSQL/Auth/RLS runtime acceptance','Auth claims and Storage schema/functions are local substitutes','kb_chunks.embedding uses text; vector index and match_kb_chunks are excluded','platform event triggers and owner/grantor identities are not reconstructed','no customer data copied; existing application tables start empty']};
  } catch (error) { await db.close(); throw error; }
}
