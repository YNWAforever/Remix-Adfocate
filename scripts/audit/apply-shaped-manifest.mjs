import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import { verifiedTarget } from "./local-targets.mjs";
const target = verifiedTarget("shaped");
const manifest = JSON.parse(readFileSync("supabase/release-manifest.json", "utf8"));
const oldHistory = JSON.parse(target.sql("select coalesce(jsonb_agg(jsonb_build_object('version',version,'name',name) order by version),'[]') from supabase_migrations.schema_migrations;"));
const observed = JSON.parse(readFileSync("docs/verification/schema-observed.json", "utf8"));
if (JSON.stringify(oldHistory) !== JSON.stringify(observed.snapshot.history)) throw new Error("shaped history is not the observed history; refusing expansion");
// Minimal synthetic historical row is created before the new evidence trigger exists.
const workspaceId=randomUUID(), creatorId=randomUUID(), missionId=randomUUID(), submissionId=randomUUID();
target.sql(`begin;
insert into auth.users(id,email) values ('${creatorId}','synthetic-${creatorId}@example.test');
insert into public.workspaces(id,slug,name) values ('${workspaceId}','historical-${workspaceId}','Synthetic historical workspace');
insert into public.creators(id,workspace_id,display_name) values ('${creatorId}','${workspaceId}','Synthetic historical creator');
insert into public.missions(id,workspace_id,slug,title,mission_type,access_type) values ('${missionId}','${workspaceId}','historical-${missionId}','Synthetic historical mission','ugc','open');
insert into public.mission_submissions(id,workspace_id,mission_id,creator_id,status,content_urls) values ('${submissionId}','${workspaceId}','${missionId}','${creatorId}','submitted',array['legacy-invalid']);
commit;`);
const before=JSON.parse(target.sql(`select to_jsonb(s) from public.mission_submissions s where id='${submissionId}';`));
const results=[];
for (const migration of manifest.migrations) {
  if (!/^\d{14}$/.test(migration.version) || !migration.path.startsWith("supabase/migrations/")) throw new Error("unreviewed manifest path/version");
  const source=readFileSync(migration.path,"utf8");
  const digest=createHash("sha256").update(source.replaceAll("\r\n","\n")).digest("hex");
  if (digest !== migration.sha256) throw new Error(`manifest hash mismatch: ${migration.path}`);
  const sql=source.replace(/^begin;\s*$/gmi,"").replace(/^commit;\s*$/gmi,"");
  target.sql(`begin;\n${sql}\ninsert into supabase_migrations.schema_migrations(version,name) values ('${migration.version}','${migration.name}');\ncommit;`);
  results.push({path:migration.path,sha256:digest,result:"applied-transactionally"});
}
const after=JSON.parse(target.sql(`select to_jsonb(s) from public.mission_submissions s where id='${submissionId}';`));
if (after.content_urls[0] !== before.content_urls[0] || after.status !== before.status) throw new Error("legacy row changed during expansion");
const pending=manifest.migrations.filter((migration)=>!target.sql(`select 1 from supabase_migrations.schema_migrations where version='${migration.version}';`)).map((migration)=>migration.path);
if (pending.length) throw new Error("manifest history replay has pending work");
target.sql("notify pgrst, 'reload schema';");
writeFileSync("docs/verification/shaped-replay.json",JSON.stringify({target:target.identity,oldHistoryPreserved:oldHistory,
  migrationHistoryRepair:"none; no old local migration marked applied; only actually executed reviewed manifest rows added",
  fixture:{workspaceId,creatorId,missionId,submissionId},legacyRowPreserved:true,newColumns:["evidence_revision"],
  migrations:results,pendingOnSecondPass:pending,limitation:"Provider schemas supplied by local Supabase; catalog-shaped rehearsal is not a provider database clone."},null,2)+"\n");
