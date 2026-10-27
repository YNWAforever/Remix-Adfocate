// Catalog reconstruction, not a production dump. Contains no production rows or identities.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { verifiedTarget } from "./local-targets.mjs";
const read = (file) => JSON.parse(readFileSync(`docs/verification/${file}.json`, "utf8"));
const observed = read("schema-observed").snapshot;
const details = read("schema-details").details;
const reconstruction = read("schema-reconstruction").snapshot;
const acl = read("schema-acl").snapshot;
const generated = read("schema-generated").columns;
const quote = (identifier) => '"' + identifier.replaceAll('"', '""') + '"';
const qualified = (schema, name) => `${quote(schema)}.${quote(name)}`;
const tableName = (value) => value.includes(".") ? value : `public.${value}`;
const statements = ["begin; set local check_function_bodies=off; create schema if not exists private;"];
for (const extension of reconstruction.extensions) {
  statements.push(`create extension if not exists ${quote(extension.name)} with schema ${quote(extension.schema)};`);
}
for (const table of observed.tables) {
  const columns = reconstruction.columns.filter((column) => column.schema === table.schema && column.table === table.name);
  if (!columns.length) throw new Error(`missing reconstructed columns: ${table.name}`);
  statements.push(`create table ${qualified(table.schema, table.name)} (${columns.map((column) => {
    const expression = generated.find((item) => item.schema === table.schema && item.table === table.name && item.column === column.column);
    return `${quote(column.column)} ${column.type}${expression?.generated === "s" ? ` generated always as (${expression.expression}) stored` : column.default == null ? "" : ` default ${column.default}`}${column.nullable ? "" : " not null"}`;
  }).join(",\n")});`);
}
for (const fn of reconstruction.functions) statements.push(fn.definition + ";");
for (const constraint of [...details.constraints.filter((item) => item.kind !== "f"), ...details.constraints.filter((item) => item.kind === "f")]) {
  statements.push(`alter table ${tableName(constraint.table)} add constraint ${quote(constraint.name)} ${constraint.definition};`);
}
const constraintNames = new Set(details.constraints.map((item) => item.name));
for (const index of details.indexes) if (!constraintNames.has(index.name)) statements.push(index.definition + ";");
for (const trigger of details.triggers) statements.push(trigger.definition + ";");
for (const table of observed.tables) {
  statements.push(`revoke all on ${qualified(table.schema, table.name)} from public,anon,authenticated,service_role;`);
  if (table.rls) statements.push(`alter table ${qualified(table.schema, table.name)} enable row level security;`);
}
for (const grant of observed.grants) statements.push(`grant ${grant.privilege} on public.${quote(grant.table)} to ${quote(grant.role)};`);
// Includes column-only privileges which are not represented by table ACLs.
for (const grant of acl.columnGrants) statements.push(`grant ${grant.privilege} (${quote(grant.column)}) on public.${quote(grant.table)} to ${quote(grant.role)};`);
for (const fn of reconstruction.functions) statements.push(`revoke all on function ${qualified(fn.schema, fn.name)}(${fn.identityArguments}) from public,anon,authenticated,service_role;`);
for (const grant of acl.functionGrants) statements.push(`grant execute on function ${qualified(grant.schema, grant.name)}(${grant.args}) to ${grant.role === "PUBLIC" ? "PUBLIC" : quote(grant.role)};`);
for (const grant of acl.schemaGrants) statements.push(`grant ${grant.privilege} on schema ${quote(grant.schema)} to ${grant.role === "PUBLIC" ? "PUBLIC" : quote(grant.role)};`);
for (const policy of reconstruction.policies) statements.push(`create policy ${quote(policy.policyname)} on ${qualified(policy.schemaname, policy.tablename)} as ${policy.permissive} for ${policy.cmd} to ${policy.roles.map((role) => role === "public" ? "PUBLIC" : quote(role)).join(",")}${policy.qual ? ` using (${policy.qual})` : ""}${policy.with_check ? ` with check (${policy.with_check})` : ""};`);
statements.push("create schema if not exists supabase_migrations; create table if not exists supabase_migrations.schema_migrations(version text primary key,statements text[],name text);");
for (const row of observed.history) statements.push(`insert into supabase_migrations.schema_migrations(version,name) values ('${row.version}','${row.name.replaceAll("'","''")}');`);
statements.push("commit; notify pgrst, 'reload schema';");
const source = statements.join("\n");
writeFileSync(".codex-tmp/shaped-catalog.sql", source);
const target = verifiedTarget("shaped");
if (Number(target.sql("select count(*) from pg_tables where schemaname='public';")) !== 0) throw new Error("shaped target is not empty; reconstruction refuses overwrite");
target.sql(source);
const fingerprint = target.sql(read("schema-observed").query);
writeFileSync("docs/verification/shaped-before.json", JSON.stringify({ target: target.identity,
  construction: "observed schema catalogs only; no production rows; migration history copied only into this disposable target",
  sourceHash: createHash("sha256").update(source).digest("hex"), snapshot: JSON.parse(fingerprint).schema_snapshot ?? JSON.parse(fingerprint),
  limitations: ["Provider-owned schemas and roles are supplied by the local Supabase stack, not copied from production.",
    "No original statements/checksums or business rows were supplied; history identity does not certify old local files compatible."] }, null, 2) + "\n");
