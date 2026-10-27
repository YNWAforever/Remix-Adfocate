// Actual catalog/ACL checks on owned disposable targets, including storage metadata.
// This supplements the release foundation; it is not its protected CLI preflight report.
import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";
import { verifiedTarget } from "./local-targets.mjs";
import { currentReleaseCapabilities } from "../release/manifest.ts";
const manifest=JSON.parse(readFileSync("supabase/release-manifest.json","utf8"));
const capabilities=currentReleaseCapabilities(manifest);
const quote=(value)=>`'${value.replaceAll("'","''")}'`;
function predicate(capability){
  const [kind,value]=capability.split(":"),parts=value.split("."),[schema,table,name]=parts;
  const relation=`${schema}.${table}`;
  if(!/^[a-z0-9_.(),\x5b\x5d-]+$/i.test(value))throw new Error("unreviewed capability token");
  if(kind==="table")return `to_regclass(${quote(relation)}) is not null`;
  if(kind==="column")return `exists(select 1 from information_schema.columns where table_schema=${quote(schema)} and table_name=${quote(table)} and column_name=${quote(name)})`;
  if(kind==="constraint"||kind==="constraint-removed")return `${kind.endsWith("removed")?"not ":""}exists(select 1 from pg_constraint where conrelid=to_regclass(${quote(relation)}) and conname=${quote(name)})`;
  if(kind==="function")return `exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=${quote(schema)} and p.proname=${quote(table)})`;
  if(kind==="grant-removed") return `not coalesce((${predicate(capability.replace("grant-removed:","grant:"))}),false)`;
  if(kind==="grant"){
    const [role,objectSchema,object]=parts,match=/^([a-z0-9_]+)\((.*)\)$/.exec(object);
    if(!match)throw new Error("unknown grant capability");
    const target=`${objectSchema}.${match[1]}`,privilege=match[2];
    if(["all","select","insert","update","delete","truncate"].includes(privilege)){
      const privileges=privilege==="all"?["SELECT","INSERT","UPDATE","DELETE","TRUNCATE","REFERENCES","TRIGGER"]:[privilege.toUpperCase()];
      return `to_regclass(${quote(target)}) is not null and ${privileges.map((p)=>`has_table_privilege(${quote(role)},${quote(target)},${quote(p)})`).join(" and ")}`;
    }
    return `to_regprocedure(${quote(`${target}(${privilege})`)}) is not null and has_function_privilege(${quote(role)},to_regprocedure(${quote(`${target}(${privilege})`)}),'EXECUTE')`;
  }
  if(kind==="index")return `exists(select 1 from pg_indexes where schemaname=${quote(schema)} and tablename=${quote(table)} and indexname=${quote(name)})`;
  if(kind==="rls")return `exists(select 1 from pg_class where oid=to_regclass(${quote(relation)}) and relrowsecurity)`;
  if(kind==="policy"||kind==="storage-policy")return `exists(select 1 from pg_policies where schemaname=${quote(schema)} and tablename=${quote(table)} and policyname=${quote(name)})`;
  if(kind==="storage-bucket")return `exists(select 1 from storage.buckets where id=${quote(name)})`;
  if(kind==="trigger")return `exists(select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname=${quote(schema)} and t.tgname=${quote(name??table)} ${name?`and c.relname=${quote(table)}`:""})`;
  throw new Error(`unhandled capability ${kind}`);
}
const results=[];
for(const kind of ["empty","shaped"]){
  const target=verifiedTarget(kind);
  const rows=JSON.parse(target.sql(`select jsonb_agg(jsonb_build_object('name',name,'present',coalesce(present,false)) order by name) from (values ${capabilities.map((name)=>`(${quote(name)},(${predicate(name)}))`).join(",")}) observed(name,present);`));
  results.push({kind,target:target.identity,checks:rows,passed:rows.filter((row)=>row.present).length,total:rows.length,missing:rows.filter((row)=>!row.present)});
}
writeFileSync("docs/verification/disposable-capabilities.json",JSON.stringify({checkedAt:new Date().toISOString(),method:"read-only catalog and ACL predicates; no CLI history repair",results},null,2)+"\n");
for(const result of results)process.stdout.write(JSON.stringify({kind:result.kind,passed:result.passed,total:result.total,missing:result.missing})+"\n");
if(results.some((result)=>result.missing.length))process.exitCode=1;
