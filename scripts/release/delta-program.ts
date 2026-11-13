import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
// @ts-expect-error Existing audited SQL lexer has no declaration file.
import { topLevelStatements } from "../audit/b2-bootstrap-profile.mjs";
import { buildDeltaPacket, type DeltaFunctionExpectation } from "./delta-packet";
import { parseHistorySnapshot } from "./history-audit";
import { currentReleaseCapabilities, digestManifest, parseReleaseManifest, validateManifest } from "./manifest";
import {
  DELTA_BASELINE_HISTORY_SHA256, DELTA_COMBINED_SQL_SHA256, DELTA_RELEASE_PROFILE, DELTA_RELEASE_PROJECT,
  DELTA_REVIEWED_PACKET_SHA256, DELTA_SOURCE_SHA256, type DeltaReleasePlan,
} from "./delta-release-contracts";

const VERSION = "20261113090001";
const NAME = "active_assignment_xp_neutrality";
export const DELTA_FINALIZE_CONSTRAINTS_SQL = "SET CONSTRAINTS ALL IMMEDIATE;";
const DEFERRED = ["20261103215321", "20261104134202"] as const;
const BASE = "docs/review/kocmax-stage-4d/d1/shared-database";
const sha = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");
const lf = (text: string) => text.replace(/\r\n?/g, "\n");
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
};
const digest = (value: unknown) => sha(canonical(value));
function rejected(reason: string): never { throw new Error(`protected delta program rejected: ${reason}`); }
const hash = (value: string) => { if (!/^[a-f0-9]{64}$/.test(value)) rejected("binding hash"); return value; };

export interface DeferredObject {
  readonly kind: "relation" | "function-name" | "trigger";
  readonly schema: string;
  readonly name: string;
  readonly relation?: string;
}
export interface DeltaProgramBindings {
  readonly sourceCommit: string;
  readonly targetBindingHash: string;
  readonly collectorSha256: string;
  readonly canonicalizerSha256: string;
  readonly invariantCollectorSha256: string;
  readonly deferredAbsenceHashes: Readonly<Record<typeof DEFERRED[number], string>>;
  readonly retiredConstraintAbsenceHash: string;
}
const PROGRAM_PROTOCOL = "single-exclusive-session-export-before-invariant-before-do-invariant-after-expiry-commit-export-after-v1";
export function digestDeltaExecutionProgram(input: { readonly scopeDigest: string; readonly sessionLockSql: string; readonly beginSql: string; readonly lockSql: string;
  readonly expiryGuardSql: string; readonly applyDoSql: string; readonly invariantSql: string }) {
  const { scopeDigest, sessionLockSql, beginSql, lockSql, expiryGuardSql, applyDoSql, invariantSql } = input;
  return digest({ schemaVersion: 1, protocol: PROGRAM_PROTOCOL, scopeDigest, sessionLockSql, beginSql, lockSql, expiryGuardSql, applyDoSql, invariantSql });
}
export interface CompiledDeltaProgram {
  readonly plan: DeltaReleasePlan;
  readonly planDigest: string;
  readonly requiredCapabilities: readonly string[];
  readonly deferredObjects: Readonly<Record<typeof DEFERRED[number], readonly DeferredObject[]>>;
  readonly sessionLockSql: string;
  readonly beginSql: string;
  readonly lockSql: string;
  readonly expiryGuardSql: string;
  readonly applyDoSql: string;
  readonly invariantSql: string;
  readonly executionProgramSha256: string;
}

function predecessorBody(sql: string, name: string) {
  const regex = new RegExp(`create or replace function ${name.replaceAll(".", "\\.")}\\([^)]*\\)[\\s\\S]*?\\bas\\s+\\$\\$([\\s\\S]*?)\\$\\$`, "gi");
  const matches = [...lf(sql).matchAll(regex)];
  if (matches.length !== 1) rejected("canonical predecessor is ambiguous");
  return sha(matches[0]![1]!);
}

/** Closed grammar for the two pinned deferred sources; no generic optional-source inference. */
export function deferredSchemaObjects(sql: string): readonly DeferredObject[] {
  const objects: DeferredObject[] = [];
  for (const statement of topLevelStatements(lf(sql)) as string[]) {
    if (!/^create\b/i.test(statement)) continue;
    let match = /^create\s+table\s+([a-z_]+)\.([a-z_]+)\s*\(/i.exec(statement);
    if (match) { objects.push({ kind: "relation", schema: match[1]!, name: match[2]! }); continue; }
    match = /^create\s+function\s+([a-z_]+)\.([a-z_]+)\s*\(/i.exec(statement);
    if (match) { objects.push({ kind: "function-name", schema: match[1]!, name: match[2]! }); continue; }
    match = /^create\s+(?:unique\s+)?index\s+([a-z_]+)\s+on\s+([a-z_]+)\.([a-z_]+)\b/i.exec(statement);
    if (match) { objects.push({ kind: "relation", schema: match[2]!, name: match[1]! }); continue; }
    match = /^create\s+trigger\s+([a-z_]+)\b[\s\S]*?\bon\s+([a-z_]+)\.([a-z_]+)\b/i.exec(statement);
    if (match) { objects.push({ kind: "trigger", schema: match[2]!, name: match[1]!, relation: match[3]! }); continue; }
    rejected("unknown deferred CREATE statement");
  }
  const unique = new Map(objects.map(object => [canonical(object), object]));
  if (!unique.size || unique.size !== objects.length) rejected("deferred object inventory is empty or duplicated");
  return [...unique].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([, object]) => object);
}

export const DELTA_EXPIRY_GUARD_SQL = `DO $adfocate_expiry$
DECLARE v jsonb;
BEGIN
  v := pg_catalog.current_setting('adfocate.release_bindings')::pg_catalog.jsonb;
  IF v->>'profile' IS DISTINCT FROM 'phase3-combined62-xp-v1'
    OR v->>'projectRef' IS DISTINCT FROM 'mhkoayftiuojxlrkollf'
    OR current_user <> 'postgres' OR session_user <> 'postgres'
    OR pg_catalog.current_database() <> 'postgres'
    OR pg_catalog.current_setting('transaction_isolation') <> 'repeatable read'
    OR pg_catalog.current_setting('transaction_read_only') <> 'off'
    OR v->>'expiresAt' IS NULL
    OR v->>'evidenceDigest' IS NULL OR v->>'evidenceDigest' !~ '^[a-f0-9]{64}$'
    OR v->>'programSha256' IS NULL OR v->>'programSha256' !~ '^[a-f0-9]{64}$'
    /* protected_scope_binding */
    OR (v->>'expiresAt')::pg_catalog.timestamptz <= pg_catalog.clock_timestamp() THEN
    RAISE EXCEPTION 'PROTECTED_DELTA_CONTEXT_OR_EXPIRY';
  END IF;
END;
$adfocate_expiry$;`;

/** Re-derive all source pins offline. This does not capture or claim fresh live state. */
export async function compileDeltaProgram(rootDir: string, bindings: DeltaProgramBindings): Promise<CompiledDeltaProgram> {
  if (!/^[a-f0-9]{40}$/.test(bindings.sourceCommit)) rejected("source commit");
  [bindings.targetBindingHash, bindings.collectorSha256, bindings.canonicalizerSha256, bindings.invariantCollectorSha256,
    bindings.retiredConstraintAbsenceHash, ...DEFERRED.map(version => bindings.deferredAbsenceHashes[version])].forEach(hash);
  const read = async (path: string) => lf(await readFile(resolve(rootDir, path), "utf8"));
  const manifest = parseReleaseManifest(JSON.parse(await read("supabase/release-manifest.json")));
  if ((await validateManifest(manifest, rootDir)).length) rejected("complete repository source integrity");
  const historical = parseHistorySnapshot(JSON.parse(await read("docs/verification/2026-11-13-phase3-migration-history.snapshot.json")), DELTA_RELEASE_PROJECT);
  const selected = JSON.parse(await read(`${BASE}/selected-migrations.json`)) as { versions: string[] };
  const receipt = JSON.parse(await read(`${BASE}/execution/application-manifest.json`)) as Record<string, unknown>;
  const applied = await read(`${BASE}/execution/approved-apply.sql`);
  const combined = historical.history.find(row => row.version === "20261031201901");
  if (historical.history.length !== 17 || selected.versions.length !== 62 || new Set(selected.versions).size !== 62
    || receipt.targetProject !== DELTA_RELEASE_PROJECT || receipt.appliedMigrationVersion !== "20261031201901"
    || receipt.migrationName !== "kocmax_studio_shared_review_c879b204" || receipt.applySqlSha256 !== DELTA_COMBINED_SQL_SHA256
    || sha(applied) !== DELTA_COMBINED_SQL_SHA256 || combined?.name !== receipt.migrationName || combined.statementsSha256 !== DELTA_COMBINED_SQL_SHA256) rejected("approved combined baseline provenance");
  const versions = [...selected.versions, "20261101075946", "20261113090000", ...DEFERRED, VERSION].sort();
  if (canonical(versions) !== canonical(manifest.migrations.map(m => m.version).sort())) rejected("closed 67-source scope");
  const selectedManifest = { ...manifest, migrations: manifest.migrations.filter(m => !(DEFERRED as readonly string[]).includes(m.version)) };
  const capabilities = currentReleaseCapabilities(selectedManifest).sort();
  if (!capabilities.includes("constraint-removed:public.mission_submissions.mission_submissions_creator_workspace_fk")
    || capabilities.includes("constraint:public.mission_submissions.mission_submissions_creator_workspace_fk")) rejected("retired relationship constraint");
  const expected: DeltaFunctionExpectation[] = [
    { signature: "private.join_mission(uuid)", bodySha256: predecessorBody(await read("supabase/migrations/20260805120000_review_hardening.sql"), "private.join_mission"), owner: "postgres", securityDefiner: true, config: ["search_path=public"], execute: { public: false, anon: false, authenticated: false, service_role: false } },
    { signature: "public.accept_application(uuid)", bodySha256: predecessorBody(await read("supabase/migrations/0010_applications.sql"), "public.accept_application"), owner: "postgres", securityDefiner: true, config: ["search_path=public"], execute: { public: false, anon: false, authenticated: false, service_role: true } },
  ];
  const delta = manifest.migrations.find(m => m.version === VERSION)!;
  if (delta.sha256 !== DELTA_SOURCE_SHA256) rejected("XP source pin");
  const packet = buildDeltaPacket({ baselineHistory: historical.history, predecessors: expected,
    delta: { version: VERSION, name: NAME, sourceSql: await read(delta.path), sourceSha256: DELTA_SOURCE_SHA256 } });
  if (packet.sqlSha256 !== DELTA_REVIEWED_PACKET_SHA256 || packet.baselineHistorySha256 !== DELTA_BASELINE_HISTORY_SHA256) rejected("reviewed packet re-derivation");
  const frozen = await read("docs/verification/phase3-delta-proposals/20261113-xp-neutrality/guarded-delta.sql");
  if (sha(frozen) !== DELTA_REVIEWED_PACKET_SHA256) rejected("frozen packet changed");
  const statements = topLevelStatements(packet.sql) as string[];
  if (statements.length !== 6 || statements[0] !== "BEGIN" || statements[5] !== "COMMIT" || !/^DO \$/i.test(statements[4]!)) rejected("single packet transaction structure");
  const invariantSql = await read("scripts/release/delta-invariant-capture.sql");
  if (sha(invariantSql) !== bindings.invariantCollectorSha256
    || sha(await read("scripts/release/delta-semantic-capture.sql")) !== bindings.collectorSha256
    || sha(await read("scripts/release/delta-fingerprint.ts")) !== bindings.canonicalizerSha256) rejected("collector implementation bytes");
  const deferredObjects = Object.fromEntries(await Promise.all(DEFERRED.map(async version => {
    const migration = manifest.migrations.find(m => m.version === version)!;
    return [version, deferredSchemaObjects(await read(migration.path))];
  }))) as unknown as CompiledDeltaProgram["deferredObjects"];
  const deferred = DEFERRED.map(version => ({ version, sourceSha256: manifest.migrations.find(m => m.version === version)!.sha256,
    absenceProofHash: bindings.deferredAbsenceHashes[version] }));
  const retired = manifest.migrations.find(m => m.version === "20260720193637")!;
  const sourceScope = { profile: DELTA_RELEASE_PROFILE, project: DELTA_RELEASE_PROJECT, manifest: digestManifest(manifest),
    baselineHistory: DELTA_BASELINE_HISTORY_SHA256, combined: DELTA_COMBINED_SQL_SHA256, delta: DELTA_SOURCE_SHA256,
    reviewedPacket: DELTA_REVIEWED_PACKET_SHA256, deferred: deferred.map(({ version, sourceSha256 }) => ({ version, sourceSha256 })),
    deferredObjects, retiredSource: retired.sha256, capabilities, collector: bindings.collectorSha256,
    canonicalizer: bindings.canonicalizerSha256, invariant: bindings.invariantCollectorSha256 };
  const scopeDigest = digest(sourceScope);
  // Exact extraction, not an outer BEGIN around the old packet's internal COMMIT.
  const marker = "\n  execute $delta_ddl_0_0$";
  const body = statements[4]!;
  if (body.split(marker).length !== 2) rejected("unique first-write boundary");
  const inBodyClock = `\n  if (pg_catalog.current_setting('adfocate.release_bindings')::pg_catalog.jsonb->>'expiresAt')::pg_catalog.timestamptz <= pg_catalog.clock_timestamp() then\n    raise exception 'PROTECTED_DELTA_EXPIRED_BEFORE_DDL';\n  end if;`;
  // Deferred ledger triggers must finish while row/catalog invariants can still
  // reject and roll back their effects. Keep all constraints immediate to COMMIT.
  const applyDoSql = `${body.replace(marker, `${inBodyClock}${marker}`)};\n${DELTA_FINALIZE_CONSTRAINTS_SQL}`;
  // Acquire the cooperating-migration lock before RR establishes a snapshot.
  // A SELECT pg_advisory_xact_lock inside RR could otherwise wait with a stale snapshot.
  const sessionLockSql = "SET lock_timeout='5s'; SET statement_timeout='30s'; SET idle_session_timeout='60s'; SELECT pg_catalog.pg_advisory_lock(pg_catalog.hashtextextended('adfocate:guarded-forward-migration',0));";
  const beginSql = "BEGIN ISOLATION LEVEL REPEATABLE READ READ WRITE; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s'; SET LOCAL idle_in_transaction_session_timeout='60s'; SET LOCAL search_path=pg_catalog; SET LOCAL timezone='UTC';";
  const lockSql = "SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('adfocate:guarded-forward-migration',0)); LOCK TABLE supabase_migrations.schema_migrations IN SHARE ROW EXCLUSIVE MODE;";
  const expiryGuardSql = DELTA_EXPIRY_GUARD_SQL.replace("/* protected_scope_binding */", `OR v->>'scopeDigest' IS DISTINCT FROM '${scopeDigest}'`);
  const executionProgramSha256 = digestDeltaExecutionProgram({ scopeDigest, sessionLockSql, beginSql, lockSql, expiryGuardSql, applyDoSql, invariantSql });
  const plan: DeltaReleasePlan = { schemaVersion: 1, kind: "combined-baseline-xp-delta-plan", profile: DELTA_RELEASE_PROFILE,
    targetProjectRef: DELTA_RELEASE_PROJECT, sourceCommit: bindings.sourceCommit, manifestDigest: digestManifest(manifest), scopeDigest,
    baseline: { recordedRows: 17, historySha256: DELTA_BASELINE_HISTORY_SHA256, combinedVersion: "20261031201901", combinedName: "kocmax_studio_shared_review_c879b204", appliedSqlSha256: DELTA_COMBINED_SQL_SHA256, sourceEnvelopeCount: 62, successors: ["20261101075946", "20261113090000"] },
    delta: { version: VERSION, name: NAME, sourceSha256: DELTA_SOURCE_SHA256, reviewedPacketSha256: DELTA_REVIEWED_PACKET_SHA256, executionProgramSha256 },
    deferred, retiredConstraint: { removalVersion: "20260720193637", sourceSha256: retired.sha256, absenceProofHash: bindings.retiredConstraintAbsenceHash },
    requiredCapabilitiesHash: digest(capabilities), requiredCapabilityCount: capabilities.length, targetBindingHash: bindings.targetBindingHash,
    collectorSha256: bindings.collectorSha256, canonicalizerSha256: bindings.canonicalizerSha256, invariantCollectorSha256: bindings.invariantCollectorSha256 };
  return { plan, planDigest: digest(plan), requiredCapabilities: capabilities, deferredObjects, sessionLockSql, beginSql, lockSql,
    expiryGuardSql, applyDoSql, invariantSql, executionProgramSha256 };
}

export function bindDeltaExecutionContext(input: { expiresAt: string; evidenceDigest: string; programSha256: string; scopeDigest: string }) {
  const time = Date.parse(input.expiresAt);
  if (!Number.isFinite(time) || !/(Z|[+-]\d{2}:\d{2})$/.test(input.expiresAt)) rejected("expiry binding");
  [input.evidenceDigest, input.programSha256, input.scopeDigest].forEach(hash);
  const json = JSON.stringify({ profile: DELTA_RELEASE_PROFILE, projectRef: DELTA_RELEASE_PROJECT, ...input });
  let index = 0;
  while (json.includes(`$adfocate_context_${index}$`)) index++;
  const tag = `$adfocate_context_${index}$`;
  return `SELECT pg_catalog.set_config('adfocate.release_bindings', ${tag}${json}${tag}, true);`;
}
