import { createHash } from "node:crypto";
import { DELTA_EXPORT_COMPONENTS, type DeltaExportComponent, type DeltaSemanticFingerprint } from "./delta-release-contracts";
import { canonicalDeltaJson, digestDeltaProofPayload, digestDeltaSemanticFingerprint } from "./delta-evidence";

// Pure, bounded processing only. No files, subprocesses, database drivers or network.
// Adapters must obtain the complete export and both collectors under the reviewed
// snapshot/change-control protocol. A digest never authenticates its own source.
export const DELTA_DUMP_RESTRICT_KEY = "AdfocatePhase3CanonicalExportV1";
export const DELTA_FINGERPRINT_LIMITS = Object.freeze({ exportBytes: 32 * 1024 * 1024, collectionBytes: 1024 * 1024,
  statements: 10_000, objects: 1_000_000, catalogs: 128, tables: 10_000 });
const HASH = /^[a-f0-9]{64}$/;
const VERSION = "20261113090001";
const SOURCE = "846cf3b5afd94d38f398170308f8e62c1f90f4a9a96b516d41f185986878bae2";
const SIGNATURES = ["private.join_mission(uuid)", "public.accept_application(uuid)"] as const;
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
function fail(code: string): never { throw new Error(`Delta fingerprint rejected: ${code}`); }
function object(value: unknown, keys: readonly string[], code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  const row = value as Record<string, unknown>;
  if (Object.getPrototypeOf(row) !== Object.prototype && Object.getPrototypeOf(row) !== null) fail(code);
  if (Object.keys(row).length !== keys.length || keys.some(key => !Object.hasOwn(row, key))) fail(code);
  return row;
}
function text(value: unknown, pattern: RegExp, code: string): string {
  if (typeof value !== "string" || !pattern.test(value)) fail(code);
  return value;
}
function integer(value: unknown, maximum: number, code: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > maximum) fail(code);
  return Number(value);
}
function timestamp(value: unknown): number {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value)) fail("timestamp");
  const result = Date.parse(value);
  if (!Number.isFinite(result)) fail("timestamp");
  return result;
}
function bytes(value: unknown, maximum: number, code: string): string {
  if (typeof value !== "string" || value.includes("\0") || Buffer.byteLength(value, "utf8") > maximum) fail(code);
  return value;
}

export type DeltaFingerprintComponent = DeltaSemanticFingerprint["components"][number];

/** Complete PG17 dump, sorted as a statement MULTISET: duplicate DDL/ACL stays visible. */
export function canonicalizeDeltaSchemaExport(value: unknown): DeltaFingerprintComponent {
  // Preserve literal/body bytes, including CRLF: changing a newline inside a
  // quoted value or prosrc can change semantics. The pinned Linux dumper emits LF.
  const sql = bytes(value, DELTA_FINGERPRINT_LIMITS.exportBytes, "export size or encoding");
  if (!/^-- PostgreSQL database dump\s*$/m.test(sql) || !/^-- Dumped by pg_dump version 17\.11(?:\s|$)/m.test(sql)
    || !/^-- Dumped from database version 17\.6(?:\s|$)/m.test(sql)) fail("export envelope or tool version");
  const statements: string[] = [];
  const settings: Record<string, string> = {};
  const knownSettings = new Set(["statement_timeout", "lock_timeout", "idle_in_transaction_session_timeout", "transaction_timeout",
    "client_encoding", "standard_conforming_strings", "check_function_bodies", "xmloption", "client_min_messages", "row_security",
    "default_tablespace", "default_table_access_method"]);
  let current = "", i = 0, parentheses = 0, brackets = 0, pendingBegin = false;
  let restricted = false, unrestricted = false, connected = false, footer = false, hasDatabase = false;
  let restrictionBlocks = 0, connectionBoundaryClosed = false;
  const blocks: ("atomic" | "case")[] = [];
  const emit = () => {
    const statement = current.trim();
    if (statement) {
      if (!/^(?:CREATE\b|ALTER\b|COMMENT\b|SECURITY\s+LABEL\b|GRANT\b|REVOKE\b|SET\b|SELECT\s+pg_catalog\.set_config\s*\()/i.test(statement)) fail("unsupported schema-export statement");
      hasDatabase ||= /^CREATE DATABASE "postgres"(?:\s|$)/.test(statement);
      if (/^SET\b/i.test(statement)) {
        const set = /^SET\s+([a-z_]+)\s*=\s*([\s\S]+)$/i.exec(statement);
        if (!set || !knownSettings.has(set[1]!.toLowerCase())) fail("unreviewed dump setting");
        const name = set[1]!.toLowerCase(), value = set[2]!;
        if ((name === "standard_conforming_strings" && value.toLowerCase() !== "on")
          || (name === "client_encoding" && value.toUpperCase() !== "'UTF8'")) fail("unsupported string interpretation");
        settings[name] = value;
        statements.push(sha(canonicalDeltaJson({ kind: "setting", statement })));
      } else if (/^SELECT\b/i.test(statement)) {
        if (!/^SELECT pg_catalog\.set_config\('search_path', '', false\)$/i.test(statement)) fail("unreviewed dump configuration query");
        settings.search_path = "''";
        statements.push(sha(canonicalDeltaJson({ kind: "setting", statement })));
      } else {
        // Sorting raw statements loses which table inherited a tablespace/access
        // method. Bind each statement to its effective session context first.
        statements.push(sha(canonicalDeltaJson({ kind: "statement", statement, settings })));
      }
      if (statements.length > DELTA_FINGERPRINT_LIMITS.statements) fail("statement bound");
    }
    current = "";
    pendingBegin = false;
  };
  while (i < sql.length) {
    const char = sql[i]!;
    if (char === "\\") {
      if (current.trim() || blocks.length || parentheses || brackets || (i > 0 && sql[i - 1] !== "\n")) fail("unexpected psql command");
      const end = sql.indexOf("\n", i);
      const command = sql.slice(i, end < 0 ? sql.length : end).trim();
      if (command === `\\restrict ${DELTA_DUMP_RESTRICT_KEY}` && !restricted && !unrestricted && !footer
        && ((restrictionBlocks === 0 && !connected && !hasDatabase) || (restrictionBlocks === 1 && connectionBoundaryClosed && connected))) {
        restricted = true; restrictionBlocks++;
      }
      else if (command === `\\unrestrict ${DELTA_DUMP_RESTRICT_KEY}` && restricted && !unrestricted && footer) unrestricted = true;
      else if (command === `\\unrestrict ${DELTA_DUMP_RESTRICT_KEY}` && restricted && restrictionBlocks === 1 && hasDatabase && !connected && !footer && !connectionBoundaryClosed) {
        restricted = false; connectionBoundaryClosed = true;
      }
      else if (["\\connect postgres", '\\connect "postgres"'].includes(command) && !restricted && connectionBoundaryClosed
        && restrictionBlocks === 1 && hasDatabase && !connected && !footer && !unrestricted) {
        connected = true;
        for (const key of Object.keys(settings)) delete settings[key];
      }
      else fail("unreviewed psql command or sequence");
      i = end < 0 ? sql.length : end + 1;
      continue;
    }
    if (sql.startsWith("--", i) || sql.startsWith("/*", i)) {
      const start = i;
      if (sql.startsWith("--", i)) {
        const end = sql.indexOf("\n", i);
        i = end < 0 ? sql.length : end + 1;
      } else {
        let depth = 1;
        i += 2;
        while (i < sql.length && depth) {
          if (sql.startsWith("/*", i)) { depth++; i += 2; }
          else if (sql.startsWith("*/", i)) { depth--; i += 2; }
          else i++;
        }
        if (depth) fail("unterminated comment");
      }
      const comment = sql.slice(start, i);
      if (!current.trim() && !blocks.length) {
        if (/^-- PostgreSQL database dump complete\s*$/.test(comment.trim())) {
          if (footer || !restricted || !connected || !statements.length) fail("export completion sequence");
          footer = true;
        }
        // Only dump comments BETWEEN complete statements are removed. Comments
        // inside a statement, SQL-standard body, quoted string or dollar body stay.
      } else current += comment;
      continue;
    }
    if (!/\s/.test(char) && (!restricted || footer || unrestricted)) fail("SQL outside restricted complete export");
    if (char === "'" || char === '"') {
      const quote = char, start = i++;
      const escaped = quote === "'" && /[eE]/.test(sql[start - 1] ?? "") && !/[\p{L}\p{N}_$]/u.test(sql[start - 2] ?? "");
      let closed = false;
      while (i < sql.length) {
        if (escaped && sql[i] === "\\") { i += 2; continue; }
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) { i += 2; continue; }
          i++; closed = true; break;
        }
        i++;
      }
      if (!closed || i > sql.length) fail("unterminated quoted token");
      current += sql.slice(start, i);
      continue;
    }
    if (char === "$" && !/[\p{L}\p{N}_$]/u.test(sql[i - 1] ?? "")) {
      const tag = /^\$(?:[\p{L}_][\p{L}\p{N}_]*)?\$/u.exec(sql.slice(i))?.[0];
      if (tag) {
        const end = sql.indexOf(tag, i + tag.length);
        if (end < 0) fail("unterminated dollar body");
        current += sql.slice(i, end + tag.length);
        i = end + tag.length;
        continue;
      }
    }
    if (/[\p{L}_]/u.test(char)) {
      const word = /^[\p{L}_][\p{L}\p{N}_$]*/u.exec(sql.slice(i))![0];
      const upper = word.toUpperCase();
      if (upper === "ATOMIC" && pendingBegin) blocks.push("atomic");
      else if (upper === "CASE" && blocks.length) blocks.push("case");
      else if (upper === "END" && blocks.length) blocks.pop();
      pendingBegin = upper === "BEGIN";
      current += word; i += word.length; continue;
    }
    if (char === "(") parentheses++;
    if (char === ")" && --parentheses < 0) fail("unbalanced parentheses");
    if (char === "[") brackets++;
    if (char === "]" && --brackets < 0) fail("unbalanced brackets");
    if (char === ";" && !parentheses && !brackets && !blocks.length) emit();
    else current += char;
    i++;
  }
  if (current.trim() || parentheses || brackets || blocks.length || !restricted || !unrestricted || !connected || !footer
    || !hasDatabase || restrictionBlocks !== 2 || !connectionBoundaryClosed) fail("incomplete full schema export");
  statements.sort(compare);
  return { category: "schema-export", coverage: "complete", objectCount: statements.length,
    sha256: digestDeltaProofPayload({ algorithm: "pg17-schema-statement-multiset-v1", statements }) };
}

export interface DeltaRawSemanticCollection {
  readonly schemaVersion: 1;
  readonly kind: "delta-semantic-components";
  readonly serverVersionNum: "170006";
  readonly databaseName: "postgres";
  readonly transactionReadOnly: true;
  readonly isolationLevel: "repeatable read";
  readonly extensionProfileHash: string;
  readonly components: readonly DeltaFingerprintComponent[];
  readonly unsupported: readonly [];
}

/** Parse bounded metadata, never SQL/row contents; no caller-supplied completeness waiver. */
export function parseDeltaSemanticCollection(input: unknown): DeltaRawSemanticCollection {
  let value = input;
  if (typeof input === "string") {
    try { value = JSON.parse(bytes(input, DELTA_FINGERPRINT_LIMITS.collectionBytes, "collection bound")); }
    catch { fail("collection JSON"); }
  }
  const row = object(value, ["schemaVersion", "kind", "serverVersionNum", "databaseName", "transactionReadOnly", "isolationLevel", "extensionProfileHash", "components", "unsupported"], "collection fields");
  if (row.schemaVersion !== 1 || row.kind !== "delta-semantic-components" || row.serverVersionNum !== "170006" || row.databaseName !== "postgres"
    || row.transactionReadOnly !== true || row.isolationLevel !== "repeatable read" || !Array.isArray(row.unsupported) || row.unsupported.length) fail("collection incomplete or context");
  text(row.extensionProfileHash, HASH, "extension profile hash");
  const components = validateComponents(row.components, false);
  return { ...row, components } as unknown as DeltaRawSemanticCollection;
}
function validateComponents(value: unknown, schemaIncluded: boolean): DeltaFingerprintComponent[] {
  const required = DELTA_EXPORT_COMPONENTS.filter(category => schemaIncluded || category !== "schema-export");
  if (!Array.isArray(value) || value.length !== required.length) fail("complete component coverage");
  const seen = new Set<string>();
  const result = value.map(value => {
    const row = object(value, ["category", "coverage", "objectCount", "sha256"], "component fields");
    if (typeof row.category !== "string" || !required.includes(row.category as DeltaExportComponent) || seen.has(row.category) || row.coverage !== "complete") fail("component coverage");
    seen.add(row.category);
    return { category: row.category as DeltaExportComponent, coverage: "complete" as const,
      objectCount: integer(row.objectCount, DELTA_FINGERPRINT_LIMITS.objects, "component object bound"), sha256: text(row.sha256, HASH, "component digest") };
  });
  return result.sort((a, b) => compare(a.category, b.category));
}
export function deriveSemanticComponents(schemaExport: unknown, collection: unknown): readonly DeltaFingerprintComponent[] {
  const parsed = parseDeltaSemanticCollection(collection);
  return validateComponents([canonicalizeDeltaSchemaExport(schemaExport), ...parsed.components], true);
}
export type DeltaFingerprintBinding = Omit<DeltaSemanticFingerprint, "schemaVersion" | "algorithm" | "components" | "rootSha256">;
export function buildDeltaSemanticFingerprint(schemaExport: unknown, collection: unknown, binding: DeltaFingerprintBinding): DeltaSemanticFingerprint {
  const row = object(binding, ["scopeDigest", "collectorSha256", "canonicalizerSha256", "targetBindingHash", "snapshotBindingHash", "observedAt", "expiresAt", "environment"], "fingerprint binding fields");
  for (const key of ["scopeDigest", "collectorSha256", "canonicalizerSha256", "targetBindingHash", "snapshotBindingHash"]) text(row[key], HASH, "fingerprint binding hash");
  if (timestamp(row.expiresAt) <= timestamp(row.observedAt)) fail("fingerprint time order");
  const environment = object(row.environment, ["serverVersionNum", "dumpVersion", "extensionProfileHash", "databaseName"], "fingerprint environment");
  if (environment.serverVersionNum !== "170006" || environment.dumpVersion !== "17.11" || environment.databaseName !== "postgres") fail("fingerprint environment pins");
  text(environment.extensionProfileHash, HASH, "fingerprint extension profile");
  const parsed = parseDeltaSemanticCollection(collection);
  if (parsed.extensionProfileHash !== environment.extensionProfileHash) fail("collector environment mismatch");
  const payload = { schemaVersion: 1 as const, algorithm: "pg17-canonical-export-v1" as const, ...binding,
    components: deriveSemanticComponents(schemaExport, parsed) };
  return { ...payload, rootSha256: digestDeltaSemanticFingerprint(payload) };
}

export interface DeltaTransactionInvariant {
  readonly schemaVersion: 1;
  readonly algorithm: "pg17-same-database-invariant-v1";
  readonly databaseName: "postgres";
  readonly serverVersionNum: "170006";
  readonly isolationLevel: "repeatable read";
  readonly transactionId: string;
  readonly catalogSha256: string;
  readonly catalogCount: number;
  readonly dataSha256: string;
  readonly tableCount: number;
  readonly baselineHistoryDataSha256: string;
  readonly baselineHistoryTupleSha256: string;
  readonly migrationRows: 17 | 18;
  readonly deltaHistory: null | { readonly version: typeof VERSION; readonly name: "active_assignment_xp_neutrality";
    readonly statementCount: 1; readonly statementsSha256: typeof SOURCE; readonly xmin: string };
  readonly targets: readonly { readonly signature: typeof SIGNATURES[number]; readonly oid: string; readonly xmin: string;
    readonly bodySha256: string; readonly attributesAclSha256: string }[];
  readonly unsupported: readonly [];
}
export function normalizeDeltaInvariant(value: unknown): DeltaTransactionInvariant {
  if (typeof value === "string") { try { value = JSON.parse(bytes(value, DELTA_FINGERPRINT_LIMITS.collectionBytes, "invariant bound")); } catch { fail("invariant JSON"); } }
  const row = object(value, ["schemaVersion", "algorithm", "databaseName", "serverVersionNum", "isolationLevel", "transactionId", "catalogSha256", "catalogCount", "dataSha256", "tableCount", "baselineHistoryDataSha256", "baselineHistoryTupleSha256", "migrationRows", "deltaHistory", "targets", "unsupported"], "invariant fields");
  if (row.schemaVersion !== 1 || row.algorithm !== "pg17-same-database-invariant-v1" || row.databaseName !== "postgres" || row.serverVersionNum !== "170006"
    || row.isolationLevel !== "repeatable read" || !Array.isArray(row.unsupported) || row.unsupported.length || ![17, 18].includes(Number(row.migrationRows))
    || typeof row.migrationRows !== "number") fail("invariant context or completeness");
  text(row.transactionId, /^[1-9][0-9]*$/, "transaction identity");
  for (const key of ["catalogSha256", "dataSha256", "baselineHistoryDataSha256", "baselineHistoryTupleSha256"]) text(row[key], HASH, "invariant hash");
  integer(row.catalogCount, DELTA_FINGERPRINT_LIMITS.catalogs, "catalog bound");
  integer(row.tableCount, DELTA_FINGERPRINT_LIMITS.tables, "table bound");
  if (row.migrationRows === 17) { if (row.deltaHistory !== null) fail("unexpected delta row"); }
  else {
    const delta = object(row.deltaHistory, ["version", "name", "statementCount", "statementsSha256", "xmin"], "delta row fields");
    if (delta.version !== VERSION || delta.name !== "active_assignment_xp_neutrality" || delta.statementCount !== 1 || delta.statementsSha256 !== SOURCE) fail("delta history source");
    text(delta.xmin, /^[0-9]+$/, "delta history tuple");
  }
  if (!Array.isArray(row.targets) || row.targets.length !== 2) fail("target coverage");
  const targets = row.targets.map(value => {
    const target = object(value, ["signature", "oid", "xmin", "bodySha256", "attributesAclSha256"], "target fields");
    if (!SIGNATURES.includes(target.signature as typeof SIGNATURES[number])) fail("target signature");
    text(target.oid, /^[1-9][0-9]*$/, "target oid"); text(target.xmin, /^[0-9]+$/, "target tuple");
    text(target.bodySha256, HASH, "target body hash"); text(target.attributesAclSha256, HASH, "target attribute hash");
    return target as unknown as DeltaTransactionInvariant["targets"][number];
  }).sort((a, b) => compare(a.signature, b.signature));
  if (new Set(targets.map(target => target.signature)).size !== 2) fail("duplicate target");
  return { ...row, targets } as unknown as DeltaTransactionInvariant;
}

/** Same-cluster transaction check; it neither claims exported uncommitted DDL nor freezes other writers. */
export function assertDeltaInvariantTransition(beforeValue: unknown, afterValue: unknown, phase: "first" | "replay") {
  const before = normalizeDeltaInvariant(beforeValue), after = normalizeDeltaInvariant(afterValue);
  if (phase !== "first" && phase !== "replay") fail("transition phase");
  if (before.transactionId !== after.transactionId) fail("one transaction required");
  for (const key of ["catalogSha256", "catalogCount", "dataSha256", "tableCount", "baselineHistoryDataSha256", "baselineHistoryTupleSha256"] as const) {
    if (before[key] !== after[key]) fail("unapproved catalog, data or baseline history transition");
  }
  if (before.migrationRows !== (phase === "first" ? 17 : 18) || after.migrationRows !== 18) fail("migration transition");
  for (let i = 0; i < 2; i++) {
    const a = before.targets[i]!, b = after.targets[i]!;
    if (a.signature !== b.signature || a.oid !== b.oid || a.attributesAclSha256 !== b.attributesAclSha256) fail("target attribute or identity transition");
    if (phase === "first" ? (a.bodySha256 === b.bodySha256 || a.xmin === b.xmin) : (a.bodySha256 !== b.bodySha256 || a.xmin !== b.xmin)) fail("target body or replay tuple transition");
  }
  if (phase === "replay" && digestDeltaProofPayload(before.deltaHistory) !== digestDeltaProofPayload(after.deltaHistory)) fail("replay history tuple transition");
  return { algorithm: "pg17-same-database-invariant-v1" as const, unchangedCatalogReceiptHash: digestDeltaProofPayload({ catalogSha256: before.catalogSha256, catalogCount: before.catalogCount }),
    unchangedDataReceiptHash: digestDeltaProofPayload({ dataSha256: before.dataSha256, tableCount: before.tableCount }),
    targetAttributesAclReceiptHash: digestDeltaProofPayload(before.targets.map(({ signature, oid, attributesAclSha256 }) => ({ signature, oid, attributesAclSha256 }))),
    replayTupleReceiptHash: phase === "replay" ? digestDeltaProofPayload({ targets: before.targets, history: before.deltaHistory }) : null };
}
