import { verifiedTarget } from "./local-targets.mjs";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import process from "node:process";
import { URL } from "node:url";
import { log } from "node:console";

// Read-only local inspection. This does not assign owners or grant release approval.
const output = "docs/verification/D17-R2-advisors.json";
const prior = JSON.parse(readFileSync("docs/verification/D19-schema-after.json", "utf8"));
const advisorCatalog = JSON.parse(readFileSync("docs/verification/D17-advisor-catalog.json", "utf8"));
const results = [];
for (const kind of ["empty", "shaped"]) {
  const target = verifiedTarget(kind); // Before reading credentials or opening a DB connection.
  const lines = readFileSync(`.codex-tmp/${kind}-start.private.log`, "utf8").split(/\r?\n/);
  const keys = JSON.parse(lines.filter(line => line.startsWith('{"DB_URL"')).at(-1));
  const db = new URL(keys.DB_URL);
  if (db.hostname !== "127.0.0.1" || db.port !== (kind === "empty" ? "56422" : "56522") || keys.API_URL !== target.env.SUPABASE_URL) throw new Error("Local advisor target binding mismatch");
  const ports = JSON.parse(execFileSync("docker", ["inspect", "--format", "{{json .NetworkSettings.Ports}}", target.identity.databaseContainerId], { encoding: "utf8", timeout: 10000 }));
  if (!(ports?.["5432/tcp"] ?? []).some(binding => binding.HostIp === "127.0.0.1" && binding.HostPort === db.port)) throw new Error("Local database host/port/container mapping mismatch");
  db.searchParams.set("sslmode", "disable");
  const schemaBefore = JSON.parse(target.sql(`begin read only; ${prior.query} commit;`));
  const catalog = JSON.parse(target.sql(`begin read only; ${advisorCatalog.query} commit;`));
  const run = spawnSync(process.execPath, ["node_modules/supabase/dist/supabase.js", "db", "advisors", "--db-url", db.href, "--type", "all", "--level", "info", "--fail-on", "none", "--output-format", "json"], { encoding: "utf8", timeout: 60000 });
  const stdout = (run.stdout ?? "").replaceAll(db.href, "[owned-local-db-url]").replaceAll(keys.DB_URL, "[owned-local-db-url]");
  const stderr = (run.stderr ?? "").replaceAll(db.href, "[owned-local-db-url]").replaceAll(keys.DB_URL, "[owned-local-db-url]");
  writeFileSync(`.codex-tmp/D17-R2-advisors-${kind}.private.log`, stdout + "\n" + stderr);
  if (run.status !== 0) throw new Error(`Local advisors failed for ${kind}; private log retained`);
  const notices = JSON.parse(stdout.trim()).results;
  if (!Array.isArray(notices)) throw new Error("Unexpected local advisor response");
  const checked = verifiedTarget(kind);
  if (!isDeepStrictEqual(target.identity, checked.identity)) throw new Error("Local target drift");
  const schemaAfter = JSON.parse(checked.sql(`begin read only; ${prior.query} commit;`));
  if (!isDeepStrictEqual(schemaBefore, schemaAfter)) throw new Error("Schema/history changed during read-only advisors");
  results.push({ target: kind, identity: checked.identity, databasePortBinding: { containerId: target.identity.databaseContainerId, hostIp: "127.0.0.1", hostPort: db.port, containerPort: 5432 }, status: run.status, notices, catalog, schemaBefore, schemaAfter,
    catalogHistoryUnchangedDuringInspection: true, schemaMatchesD19: isDeepStrictEqual(schemaAfter, prior.targets[kind].observed),
    historyRows: schemaAfter.history.length, snapshotSha256: createHash("sha256").update(JSON.stringify(notices)).digest("hex") });
  log(JSON.stringify({ target: kind, notices: notices.length, schemaMatchesD19: results.at(-1).schemaMatchesD19 }));
}
writeFileSync(output, JSON.stringify({ at: new Date().toISOString(), productionQueried: false, hostedAdvisors: "NOT_RUN", ownerAcceptance: "BLOCKED_NAMED_OWNER_NOT_PROVIDED", changesApplied: false,
  priorCatalog: "D19-schema-after.json", results, limitations: "Local statistics are workload dependent. Notice disappearance is not remediation. No index/policy/function/grant/membership change or owner attestation is implied." }, null, 2) + "\n");
