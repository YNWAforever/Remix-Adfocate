import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { verifiedTarget } from "./local-targets.mjs";
const manifest=JSON.parse(readFileSync("supabase/release-manifest.json","utf8"));
const targets=[];
for(const kind of ["empty","shaped"]){
  const target=verifiedTarget(kind),applied=[];
  for(const migration of manifest.migrations){
    if(!/^\d{14}$/.test(migration.version)||!migration.path.startsWith("supabase/migrations/"))throw new Error("invalid manifest path");
    if(target.sql(`select 1 from supabase_migrations.schema_migrations where version='${migration.version}';`))continue;
    const source=readFileSync(migration.path,"utf8");
    const digest=createHash("sha256").update(source.replaceAll("\r\n","\n")).digest("hex");
    if(digest!==migration.sha256)throw new Error("unreviewed pending migration digest");
    const sql=source.replace(/^begin;\s*$/gmi,"").replace(/^commit;\s*$/gmi,"");
    target.sql(`begin;\n${sql}\ninsert into supabase_migrations.schema_migrations(version,name) values('${migration.version}','${migration.name}');\ncommit;`);
    applied.push({path:migration.path,sha256:digest});
  }
  target.sql("notify pgrst, 'reload schema';");
  const pendingOnSecondPass=manifest.migrations.filter((migration)=>!target.sql(`select 1 from supabase_migrations.schema_migrations where version='${migration.version}';`)).map((migration)=>migration.path);
  targets.push({identity:target.identity,applied,pendingOnSecondPass});
}
writeFileSync("docs/verification/pending-forward-replay.json",JSON.stringify({targets,historyRepair:"none"},null,2)+"\n");
