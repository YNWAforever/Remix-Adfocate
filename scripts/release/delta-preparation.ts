import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { ACTIVE_ASSIGNMENT_DELTA_SOURCE_SHA256, buildDeltaPacket, type DeltaFunctionExpectation } from "./delta-packet";
import { parseHistorySnapshot } from "./history-audit";
import { currentReleaseCapabilities, digestManifest, parseReleaseManifest, validateManifest } from "./manifest";

export const PHASE3_PROJECT_REF = "mhkoayftiuojxlrkollf";
const DELTA_VERSION = "20261113090001";
const DELTA_NAME = "active_assignment_xp_neutrality";
const CAPTURE_MAX_AGE = 60 * 60_000;
const EXCLUDED = ["20261103215321", "20261104134202"];
const RETIRED = "constraint-removed:public.mission_submissions.mission_submissions_creator_workspace_fk";
const EXPECTED_ATTRIBUTES = { language: "plpgsql", kind: "f", returnsSet: false, resultTypeMatches: true,
  volatility: "v", strict: false, leakproof: false, parallel: "u" };
const EXTENSIONS = [
  { name: "pg_stat_statements", schema: "extensions", version: "1.11" },
  { name: "pgcrypto", schema: "extensions", version: "1.3" },
  { name: "plpgsql", schema: "pg_catalog", version: "1.0" },
  { name: "supabase_vault", schema: "vault", version: "0.3.1" },
  { name: "uuid-ossp", schema: "extensions", version: "1.1" },
  { name: "vector", schema: "public", version: "0.8.0" },
];
const FOREIGN_KEYS = new Map([
  ["mission_submissions_creator_id_fkey", ["mission_submissions", "FOREIGN KEY (creator_id) REFERENCES creators(id) ON DELETE CASCADE"]],
  ["mission_submissions_mission_workspace_fk", ["mission_submissions", "FOREIGN KEY (mission_id, workspace_id) REFERENCES missions(id, workspace_id) ON DELETE CASCADE"]],
  ["mission_submissions_workspace_id_fkey", ["mission_submissions", "FOREIGN KEY (workspace_id) REFERENCES workspaces(id)"]],
  ["mission_workflows_submission_workspace_fk", ["mission_workflows", "FOREIGN KEY (mission_submission_id, workspace_id) REFERENCES mission_submissions(id, workspace_id) ON DELETE CASCADE"]],
  ["mission_workflows_workspace_id_fkey", ["mission_workflows", "FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE"]],
]);
const sha = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");
const lf = (text: string) => text.replace(/\r\n?/g, "\n");
function fail(message: string): never { throw new Error(`Phase 3 preparation rejected: ${message}`); }
function object(value: unknown, keys: readonly string[], message: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(message);
  const result = value as Record<string, unknown>;
  if (Object.keys(result).length !== keys.length || keys.some(key => !Object.hasOwn(result, key))) fail(message);
  return result;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? fail("non-JSON value");
}
function predecessorBody(sql: string, name: string) {
  const escaped = name.replaceAll(".", "\\.");
  const pattern = new RegExp(`create or replace function ${escaped}\\([^)]*\\)[\\s\\S]*?\\bas\\s+\\$\\$([\\s\\S]*?)\\$\\$`, "gi");
  const matches = [...lf(sql).matchAll(pattern)];
  if (matches.length !== 1) fail("canonical predecessor function missing or ambiguous");
  return sha(matches[0]![1]!);
}

/** Strict sanitized capture checks. These assertions are operator evidence, not target authentication. */
export function validatePhase3Catalog(value: unknown, now: Date) {
  const root = object(value, ["projectRef", "connection", "history", "triggers", "functions", "extensions", "database", "observedAt", "currentRole", "foreignKeys", "sessionRole", "serverVersionNum", "transactionReadOnly"], "catalog fields");
  const connection = object(root.connection, ["verifiedServerCertificate", "endpoint", "usernameProjectRefBound"], "connection fields");
  if (root.projectRef !== PHASE3_PROJECT_REF || root.database !== "postgres" || root.currentRole !== "postgres"
    || root.sessionRole !== "postgres" || root.serverVersionNum !== "170006" || root.transactionReadOnly !== true
    || connection.verifiedServerCertificate !== true || connection.endpoint !== "session_pooler" || connection.usernameProjectRefBound !== true) fail("target, identity or read-only proof");
  if (typeof root.observedAt !== "string" || !/(Z|[+-]\d{2}:\d{2})$/.test(root.observedAt)) fail("capture time");
  const observed = Date.parse(root.observedAt);
  if (!Number.isFinite(now.getTime()) || !Number.isFinite(observed) || observed > now.getTime() || now.getTime() - observed > CAPTURE_MAX_AGE) fail("catalog capture is stale or in the future");
  if (canonical(root.extensions) !== canonical(EXTENSIONS)) fail("reviewed extension profile changed");
  if (!Array.isArray(root.foreignKeys) || root.foreignKeys.length !== FOREIGN_KEYS.size) fail("foreign-key inventory");
  const seen = new Set<string>();
  for (const value of root.foreignKeys) {
    const row = object(value, ["name", "type", "deferred", "relation", "validated", "deferrable", "definition"], "foreign-key fields");
    if (typeof row.name !== "string" || seen.has(row.name)) fail("foreign-key name");
    seen.add(row.name);
    const expected = FOREIGN_KEYS.get(row.name);
    const relation = typeof row.relation === "string" ? row.relation.replace(/^public\./, "") : "";
    const definition = typeof row.definition === "string" ? row.definition.replaceAll("public.", "") : "";
    if (!expected || row.type !== "f" || row.validated !== true || row.deferrable !== false || row.deferred !== false
      || relation !== expected[0] || definition !== expected[1]) fail("surviving foreign-key definition changed");
  }
  if (!Array.isArray(root.triggers) || root.triggers.length > 1000) fail("bounded trigger inventory");
  const riExpected = new Map([
    ["mission_submissions_mission_workspace_fk", new Set(["missions:pg_catalog.RI_FKey_cascade_del", "missions:pg_catalog.RI_FKey_noaction_upd", "mission_submissions:pg_catalog.RI_FKey_check_ins", "mission_submissions:pg_catalog.RI_FKey_check_upd"])],
    ["mission_workflows_submission_workspace_fk", new Set(["mission_submissions:pg_catalog.RI_FKey_cascade_del", "mission_submissions:pg_catalog.RI_FKey_noaction_upd", "mission_workflows:pg_catalog.RI_FKey_check_ins", "mission_workflows:pg_catalog.RI_FKey_check_upd"])],
  ]);
  const riCoverage = new Map<string, Set<string>>();
  const physicalTriggers = new Set<string>();
  for (const value of root.triggers) {
    const row = object(value, ["relation", "name", "enabled", "internal", "constraintName", "function", "definitionSha256"], "trigger fields");
    if (typeof row.name !== "string" || typeof row.function !== "string" || typeof row.definitionSha256 !== "string"
      || !/^[a-f0-9]{64}$/.test(row.definitionSha256) || typeof row.internal !== "boolean") fail("trigger metadata");
    if (row.internal && typeof row.constraintName === "string" && riExpected.has(row.constraintName)) {
      const relation = typeof row.relation === "string" ? row.relation.replace(/^public\./, "") : "";
      const tuple = `${relation}:${row.function}`;
      const physical = `${relation}:${row.name}`;
      const coverage = riCoverage.get(row.constraintName) ?? new Set<string>();
      if (!["O", "A"].includes(String(row.enabled)) || !riExpected.get(row.constraintName)!.has(tuple)
        || coverage.has(tuple) || physicalTriggers.has(physical)) fail("workspace referential-integrity trigger disabled, duplicated or replaced");
      coverage.add(tuple); physicalTriggers.add(physical); riCoverage.set(row.constraintName, coverage);
    }
  }
  if ([...riExpected.keys()].some(name => riCoverage.get(name)?.size !== 4)) fail("workspace referential-integrity trigger coverage");
  if (!Array.isArray(root.functions) || root.functions.length !== 2) fail("function inventory");
  const functions: DeltaFunctionExpectation[] = root.functions.map(value => {
    const row = object(value, ["signature", "bodySha256", "owner", "securityDefiner", "config", "execute", "attributes"], "function fields");
    const signature = row.signature;
    if (signature !== "private.join_mission(uuid)" && signature !== "public.accept_application(uuid)") fail("function signature");
    if (typeof row.bodySha256 !== "string" || !/^[a-f0-9]{64}$/.test(row.bodySha256) || row.owner !== "postgres" || row.securityDefiner !== true
      || canonical(row.config) !== canonical(["search_path=public"]) || canonical(row.attributes) !== canonical(EXPECTED_ATTRIBUTES)) fail("function definition attributes");
    const execute = object(row.execute, ["public", "anon", "authenticated", "service_role"], "function execute fields");
    const service = signature === "public.accept_application(uuid)";
    if (execute.public !== false || execute.anon !== false || execute.authenticated !== false || execute.service_role !== service) fail("function execute boundary");
    return { signature, bodySha256: row.bodySha256, owner: "postgres", securityDefiner: true, config: ["search_path=public"],
      execute: { public: false, anon: false, authenticated: false, service_role: service } };
  });
  if (new Set(functions.map(row => row.signature)).size !== 2) fail("duplicate function signature");
  return { history: root.history, functions, observedAt: root.observedAt, catalogExpiresAt: new Date(observed + CAPTURE_MAX_AGE).toISOString() };
}

export async function preparePhase3Delta(rootDir: string, catalogValue: unknown, now: Date) {
  const catalog = validatePhase3Catalog(catalogValue, now);
  const manifest = parseReleaseManifest(JSON.parse(await readFile(resolve(rootDir, "supabase/release-manifest.json"), "utf8")));
  if ((await validateManifest(manifest, rootDir)).length) fail("release manifest or migration source integrity");
  const historical = parseHistorySnapshot(JSON.parse(await readFile(resolve(rootDir, "docs/verification/2026-11-13-phase3-migration-history.snapshot.json"), "utf8")), PHASE3_PROJECT_REF);
  if (canonical(catalog.history) !== canonical(historical.history) || historical.history.length !== 17) fail("complete recorded baseline history changed");
  const receiptPath = "docs/review/kocmax-stage-4d/d1/shared-database/execution/application-manifest.json";
  const receipt = JSON.parse(await readFile(resolve(rootDir, receiptPath), "utf8")) as Record<string, unknown>;
  const selected = JSON.parse(await readFile(resolve(rootDir, "docs/review/kocmax-stage-4d/d1/shared-database/selected-migrations.json"), "utf8")) as { versions: string[] };
  const applied = lf(await readFile(resolve(rootDir, "docs/review/kocmax-stage-4d/d1/shared-database/execution/approved-apply.sql"), "utf8"));
  const packetRow = historical.history.find(row => row.version === receipt.appliedMigrationVersion);
  if (receipt.targetProject !== PHASE3_PROJECT_REF || receipt.appliedMigrationVersion !== "20261031201901"
    || receipt.migrationName !== "kocmax_studio_shared_review_c879b204" || receipt.applySqlSha256 !== sha(applied)
    || packetRow?.statementsSha256 !== receipt.applySqlSha256 || packetRow.name !== receipt.migrationName
    || selected.versions.length !== 62 || new Set(selected.versions).size !== 62) fail("approved combined-packet provenance");
  const expectedVersions = [...selected.versions, "20261101075946", "20261113090000", ...EXCLUDED, DELTA_VERSION].sort();
  if (canonical(manifest.migrations.map(row => row.version).sort()) !== canonical(expectedVersions)) fail("unreviewed manifest scope");
  const effective = currentReleaseCapabilities(manifest);
  if (!effective.includes(RETIRED) || effective.includes(RETIRED.replace("constraint-removed:", "constraint:"))) fail("retired creator/workspace constraint resolution");
  const sourcePath = `supabase/migrations/${DELTA_VERSION}_${DELTA_NAME}.sql`;
  const sourceSql = lf(await readFile(resolve(rootDir, sourcePath), "utf8"));
  const expectedBodies = new Map([
    ["private.join_mission(uuid)", predecessorBody(await readFile(resolve(rootDir, "supabase/migrations/20260805120000_review_hardening.sql"), "utf8"), "private.join_mission")],
    ["public.accept_application(uuid)", predecessorBody(await readFile(resolve(rootDir, "supabase/migrations/0010_applications.sql"), "utf8"), "public.accept_application")],
  ]);
  if (catalog.functions.some(row => row.bodySha256 !== expectedBodies.get(row.signature))) fail("current predecessor body differs from canonical source");
  const packet = buildDeltaPacket({ baselineHistory: historical.history, predecessors: catalog.functions,
    delta: { version: DELTA_VERSION, name: DELTA_NAME, sourceSql, sourceSha256: ACTIVE_ASSIGNMENT_DELTA_SOURCE_SHA256 } });
  const profileMigrations = manifest.migrations.filter(row => !EXCLUDED.includes(row.version));
  return { packet, report: {
    kind: "phase3-combined-baseline-delta-preparation", schemaVersion: 1, decision: "HOLD", validReleaseEvidence: false,
    targetProjectRef: PHASE3_PROJECT_REF, createdAt: now.toISOString(), observedAt: catalog.observedAt, catalogExpiresAt: catalog.catalogExpiresAt,
    manifestDigest: digestManifest(manifest), baselineHistorySha256: packet.baselineHistorySha256,
    baseline: { recordedRows: 17, combinedVersion: "20261031201901", sourceEnvelopeCount: 62, appliedSqlSha256: receipt.applySqlSha256 },
    delta: { version: DELTA_VERSION, name: DELTA_NAME, path: sourcePath, sourceSha256: packet.sourceSha256, packetSha256: packet.sqlSha256, productionApplied: false },
    excludedVersions: EXCLUDED, retiredConstraint: { name: RETIRED, removalVersion: "20260720193637", treatment: "Do not reinstate; cross-workspace legacy campaigns remain supported." },
    currentScopedCapabilityCount: currentReleaseCapabilities({ ...manifest, migrations: profileMigrations }).length,
    catalogSha256: sha(canonical(catalogValue)), automaticWrites: [],
    scopeLimits: ["Preparation only; no network, database client, approval phrase or apply mode.",
      "Connection fields are operator assertions, not SQL target attestation or release authorization.",
      "Packet guards cover exact migration history and the two changed functions; they do not replace complete schema/ACL/policy/storage preflight.",
      "Fresh private backup/restore and disposable delta/replay checks must be supplied separately.",
      "The protected live executor remains unchanged; this artifact cannot serve as its release evidence."] }, };
}

export async function runDeltaPreparationCli(args: readonly string[], rootDir: string, now = new Date()) {
  const options = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i], value = args[i + 1];
    if ((key !== "--catalog" && key !== "--output") || !value || options.has(key)) fail("usage: --catalog <sanitized.json> --output <new-directory>");
    options.set(key, value);
  }
  if (options.size !== 2) fail("catalog and new output directory required");
  const input = resolve(rootDir, options.get("--catalog")!);
  const bytes = await readFile(input);
  if (bytes.length > 2 * 1024 * 1024) fail("catalog file too large");
  const prepared = await preparePhase3Delta(rootDir, JSON.parse(bytes.toString("utf8")), now);
  const output = resolve(rootDir, options.get("--output")!);
  const [parent, migrations] = await Promise.all([realpath(dirname(output)), realpath(resolve(rootDir, "supabase/migrations"))]);
  const canonicalOutput = resolve(parent, basename(output));
  const within = relative(migrations, canonicalOutput);
  if (within === "" || (!within.startsWith(`..${sep}`) && !isAbsolute(within))) fail("output directory must be outside migrations");
  await mkdir(canonicalOutput); // Existing files/directories cannot be replaced.
  await writeFile(resolve(canonicalOutput, "guarded-delta.sql"), prepared.packet.sql, { encoding: "utf8", flag: "wx" });
  await writeFile(resolve(canonicalOutput, "preparation.json"), `${JSON.stringify(prepared.report, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  return prepared.report;
}

const direct = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (direct) {
  try {
    const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
    const report = await runDeltaPreparationCli(process.argv.slice(2), rootDir);
    process.stdout.write(`${JSON.stringify({ decision: report.decision, version: report.delta.version, productionApplied: false, validReleaseEvidence: false })}\n`);
  } catch {
    process.stderr.write("Phase 3 delta preparation failed; no database action was attempted.\n");
    process.exitCode = 1;
  }
}
