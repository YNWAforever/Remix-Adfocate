// Read-only catalog comparison; this does not mark migrations applied or repair history.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import process from "node:process";
import { verifiedTarget } from "./local-targets.mjs";
const read=(name)=>JSON.parse(readFileSync(`docs/verification/schema-${name}.json`,"utf8"));
const sources=Object.fromEntries(["observed","details","reconstruction","acl","generated"].map((name)=>[name,read(name)]));
const before={observed:sources.observed.snapshot,details:sources.details.details,
  reconstruction:sources.reconstruction.snapshot,acl:sources.acl.snapshot,generated:sources.generated.columns};
const catalogs={};
for(const kind of ["empty","shaped"]){
  const target=verifiedTarget(kind);
  const snapshot=Object.fromEntries(Object.entries(sources).map(([name,source])=>[name,JSON.parse(target.sql(source.query))]));
  catalogs[kind]=snapshot;
  writeFileSync(`docs/verification/schema-${kind}-catalog.json`,JSON.stringify(snapshot,null,2)+"\n");
}
const hash=(value)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
const comparable=(row,fields)=>Object.fromEntries(fields.map((field)=>[field,row[field]??null]));
const objects=[];
function compare(kind,oldRows,newRows,key,fields){
  const oldMap=new Map((oldRows??[]).map((row)=>[key(row),row]));
  const newMap=new Map((newRows??[]).map((row)=>[key(row),row]));
  for(const id of [...new Set([...oldMap.keys(),...newMap.keys()])].sort()){
    const old=oldMap.get(id),next=newMap.get(id);
    const oldValue=old&&comparable(old,fields),newValue=next&&comparable(next,fields);
    objects.push({kind,object:id,status:!old?"missing":!next?"history-only":hash(oldValue)===hash(newValue)?"present-compatible":"present-different",
      productionPresent:Boolean(old),candidatePresent:Boolean(next),production:oldValue??null,candidate:newValue??null});
  }
}
const after=catalogs.shaped;
compare("table",before.observed.tables,after.observed.tables,(r)=>`${r.schema}.${r.name}`,["rls"]);
compare("column",before.details.columns,after.details.columns,(r)=>`public.${r.table}.${r.column}`,["type","nullable","default"]);
compare("rpc",before.observed.rpcs,after.observed.rpcs,(r)=>`${r.schema}.${r.name}(${r.args})`,["securityDefiner","searchPath","definitionHash","grants"]);
compare("constraint",before.details.constraints,after.details.constraints,(r)=>`${r.table}.${r.name}`,["kind","definition"]);
compare("grant",before.observed.grants,after.observed.grants,(r)=>`public.${r.table}:${r.role}:${r.privilege}`,["privilege"]);
compare("rls-policy",before.observed.policies,after.observed.policies,(r)=>`public.${r.table}.${r.name}`,["roles","command","using","check"]);
compare("migration-history",before.observed.history,after.observed.history,(r)=>r.version,["name"]);
const normalizedFunctions=[];
for(const old of before.reconstruction.functions){
  const next=after.reconstruction.functions.find((r)=>r.schema===old.schema&&r.name===old.name&&r.identityArguments===old.identityArguments);
  const normalize=(value)=>String(value??"").replaceAll("\r\n","\n").trim();
  normalizedFunctions.push({object:`${old.schema}.${old.name}(${old.identityArguments})`,
    status:!next?"history-only":normalize(old.definition)===normalize(next.definition)?"present-compatible":"present-different",
    productionDefinitionHash:hash(normalize(old.definition)),candidateDefinitionHash:next?hash(normalize(next.definition)):null});
}
const summary=Object.fromEntries([...new Set(objects.map((r)=>r.kind))].map((kind)=>[kind,
  Object.fromEntries(["present-compatible","present-different","missing","history-only"].map((status)=>[status,objects.filter((r)=>r.kind===kind&&r.status===status).length]))]));
writeFileSync("docs/verification/schema-diff.json",JSON.stringify({comparedAt:new Date().toISOString(),
  sourceIdentity:sources.observed.identity,productionObservationAt:sources.observed.observedAtUtc,
  candidate:"catalog-shaped disposable target after reviewed forward manifest",direction:"production observed -> local candidate",
  statusMeaning:{missing:"Absent in observed production; present in local candidate",historyOnly:"Observed source object absent in candidate, or history intentionally retained without replay"},
  productionWrites:false,migrationHistoryRepair:"none",providerSchemaClone:false,summary,normalizedFunctions,objects},null,2)+"\n");
process.stdout.write(JSON.stringify({summary,normalizedFunctionDifferences:normalizedFunctions.filter((r)=>r.status!=="present-compatible").map((r)=>r.object)})+"\n");
