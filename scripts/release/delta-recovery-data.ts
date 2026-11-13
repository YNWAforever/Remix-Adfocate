import { createHash } from "node:crypto";

// Pure processing only. The caller authenticates the database, exported snapshot,
// collector bytes and source/restore route. A digest cannot authenticate itself.
export const DELTA_RECOVERY_DATA_ALGORITHM = "pg17-portable-data-v1" as const;
export const DELTA_RECOVERY_DATA_LIMITS = Object.freeze({ collectionBytes: 8 * 1024 * 1024,
  relations: 10_000, columns: 1_600, rowsPerTable: 1_000_000, rows: 10_000_000, cellBytes: 1024 * 1024 });
const HASH = /^[a-f0-9]{64}$/;
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort(compare).map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
};
const sha = (value: unknown) => createHash("sha256").update(canonical(value), "utf8").digest("hex");
function fail(code: string): never { throw new Error(`Delta recovery data rejected: ${code}`); }
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("object shape");
  const row = value as Record<string, unknown>;
  if (![Object.prototype, null].includes(Object.getPrototypeOf(row)) || Object.keys(row).length !== keys.length
    || keys.some(key => !Object.hasOwn(row, key))) fail("object shape");
  return row;
}
function integer(value: unknown, maximum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > maximum) fail("count bound");
  return Number(value);
}
function hash(value: unknown): string { if (typeof value !== "string" || !HASH.test(value)) fail("hash shape"); return value; }

export interface DeltaRecoveryDataRelation {
  readonly identitySha256: string;
  readonly kind: "r" | "p" | "m" | "S";
  readonly columnCount: number;
  readonly columnsSha256: string;
  /** Table rows only; sequence entries have zero rows and hash their state. */
  readonly rowCount: number;
  readonly dataSha256: string;
}
export interface DeltaRecoveryDataCollection {
  readonly schemaVersion: 1;
  readonly kind: "delta-recovery-data";
  readonly algorithm: typeof DELTA_RECOVERY_DATA_ALGORITHM;
  readonly databaseName: "postgres";
  readonly serverVersionNum: string;
  readonly isolationLevel: "repeatable read";
  readonly transactionReadOnly: true;
  readonly fullCoverage: true;
  readonly sequenceStateNonMvcc: true;
  readonly inventoryCount: number;
  readonly tableCount: number;
  readonly sequenceCount: number;
  readonly rowCount: number;
  readonly relations: readonly DeltaRecoveryDataRelation[];
  readonly unsupported: readonly [];
}
export interface DeltaRecoveryDataBindings { readonly scopeDigest: string; readonly collectorSha256: string }
export interface DeltaRecoveryDataFingerprint extends DeltaRecoveryDataBindings {
  readonly schemaVersion: 1;
  readonly kind: "delta-recovery-data-fingerprint";
  readonly algorithm: typeof DELTA_RECOVERY_DATA_ALGORITHM;
  readonly rootSha256: string;
  readonly tableCount: number;
  readonly rowCount: number;
  readonly sequenceCount: number;
  readonly fullCoverage: true;
  readonly sequenceStateNonMvcc: true;
}

/** Reject partial coverage. Errors never include source identifiers or values. */
export function normalizeDeltaRecoveryData(raw: unknown): DeltaRecoveryDataCollection {
  // Bound before canonical processing; circular/non-JSON inputs are rejected with
  // a fixed message, never an exception containing private source content.
  let serialized: string | undefined;
  try { serialized = JSON.stringify(raw); } catch { fail("serialization"); }
  if (!serialized || Buffer.byteLength(serialized, "utf8") > DELTA_RECOVERY_DATA_LIMITS.collectionBytes) fail("collection bound");
  const row = object(raw, ["schemaVersion", "kind", "algorithm", "databaseName", "serverVersionNum", "isolationLevel", "transactionReadOnly",
    "fullCoverage", "sequenceStateNonMvcc", "inventoryCount", "tableCount", "sequenceCount", "rowCount", "relations", "unsupported"]);
  if (row.schemaVersion !== 1 || row.kind !== "delta-recovery-data" || row.algorithm !== DELTA_RECOVERY_DATA_ALGORITHM
    || row.databaseName !== "postgres" || typeof row.serverVersionNum !== "string" || !/^17\d{4}$/.test(row.serverVersionNum)
    || row.isolationLevel !== "repeatable read" || row.transactionReadOnly !== true || row.fullCoverage !== true
    || row.sequenceStateNonMvcc !== true || !Array.isArray(row.unsupported) || row.unsupported.length !== 0) fail("incomplete coverage or context");
  const inventoryCount = integer(row.inventoryCount, DELTA_RECOVERY_DATA_LIMITS.relations);
  const tableCount = integer(row.tableCount, DELTA_RECOVERY_DATA_LIMITS.relations);
  const sequenceCount = integer(row.sequenceCount, DELTA_RECOVERY_DATA_LIMITS.relations);
  const rowCount = integer(row.rowCount, DELTA_RECOVERY_DATA_LIMITS.rows);
  if (!Array.isArray(row.relations) || row.relations.length !== inventoryCount || inventoryCount !== tableCount + sequenceCount) fail("inventory coverage");
  const identities = new Set<string>();
  let tables = 0, sequences = 0, rows = 0;
  const relations = row.relations.map(value => {
    const relation = object(value, ["identitySha256", "kind", "columnCount", "columnsSha256", "rowCount", "dataSha256"]);
    const identitySha256 = hash(relation.identitySha256);
    if (identities.has(identitySha256)) fail("duplicate relation");
    identities.add(identitySha256);
    const kind = relation.kind;
    if (kind !== "r" && kind !== "p" && kind !== "m" && kind !== "S") fail("relation kind");
    const columns = integer(relation.columnCount, DELTA_RECOVERY_DATA_LIMITS.columns);
    const count = integer(relation.rowCount, DELTA_RECOVERY_DATA_LIMITS.rowsPerTable);
    if (kind === "S") { sequences++; if (columns !== 0 || count !== 0) fail("sequence shape"); }
    else { tables++; rows += count; if (kind === "p" && count !== 0) fail("partition root rows"); }
    return Object.freeze({ identitySha256, kind, columnCount: columns, columnsSha256: hash(relation.columnsSha256), rowCount: count, dataSha256: hash(relation.dataSha256) });
  }).sort((a, b) => compare(a.identitySha256, b.identitySha256));
  if (tables !== tableCount || sequences !== sequenceCount || rows !== rowCount) fail("count coverage");
  return Object.freeze({ schemaVersion: 1, kind: "delta-recovery-data", algorithm: DELTA_RECOVERY_DATA_ALGORITHM,
    databaseName: "postgres", serverVersionNum: row.serverVersionNum, isolationLevel: "repeatable read", transactionReadOnly: true,
    fullCoverage: true, sequenceStateNonMvcc: true, inventoryCount, tableCount, sequenceCount, rowCount,
    relations: Object.freeze(relations), unsupported: Object.freeze([]) as readonly [] });
}

/** Bind portable content to the exact collector and reviewed recovery scope. */
export function buildDeltaRecoveryDataFingerprint(raw: unknown, bindings: DeltaRecoveryDataBindings): DeltaRecoveryDataFingerprint {
  const collection = normalizeDeltaRecoveryData(raw);
  const source = object(bindings, ["scopeDigest", "collectorSha256"]);
  const scopeDigest = hash(source.scopeDigest), collectorSha256 = hash(source.collectorSha256);
  const content = { schemaVersion: 1, algorithm: DELTA_RECOVERY_DATA_ALGORITHM, scopeDigest, collectorSha256,
    fullCoverage: true, sequenceStateNonMvcc: true, tableCount: collection.tableCount, rowCount: collection.rowCount,
    sequenceCount: collection.sequenceCount, relations: collection.relations };
  return Object.freeze({ schemaVersion: 1, kind: "delta-recovery-data-fingerprint", algorithm: DELTA_RECOVERY_DATA_ALGORITHM,
    scopeDigest, collectorSha256, rootSha256: sha(content), tableCount: collection.tableCount, rowCount: collection.rowCount,
    sequenceCount: collection.sequenceCount, fullCoverage: true, sequenceStateNonMvcc: true });
}
function fingerprint(raw: unknown): DeltaRecoveryDataFingerprint {
  const row = object(raw, ["schemaVersion", "kind", "algorithm", "scopeDigest", "collectorSha256", "rootSha256", "tableCount", "rowCount", "sequenceCount", "fullCoverage", "sequenceStateNonMvcc"]);
  if (row.schemaVersion !== 1 || row.kind !== "delta-recovery-data-fingerprint" || row.algorithm !== DELTA_RECOVERY_DATA_ALGORITHM
    || row.fullCoverage !== true || row.sequenceStateNonMvcc !== true) fail("fingerprint shape");
  const tableCount = integer(row.tableCount, DELTA_RECOVERY_DATA_LIMITS.relations), sequenceCount = integer(row.sequenceCount, DELTA_RECOVERY_DATA_LIMITS.relations);
  if (tableCount + sequenceCount > DELTA_RECOVERY_DATA_LIMITS.relations) fail("fingerprint bound");
  return { schemaVersion: 1, kind: "delta-recovery-data-fingerprint", algorithm: DELTA_RECOVERY_DATA_ALGORITHM,
    scopeDigest: hash(row.scopeDigest), collectorSha256: hash(row.collectorSha256), rootSha256: hash(row.rootSha256),
    tableCount, rowCount: integer(row.rowCount, DELTA_RECOVERY_DATA_LIMITS.rows), sequenceCount, fullCoverage: true, sequenceStateNonMvcc: true };
}
/** Equality of actual authenticated captures; it is not source authentication. */
export function assertDeltaRecoveryDataEqual(source: DeltaRecoveryDataFingerprint, restored: DeltaRecoveryDataFingerprint): void {
  if (canonical(fingerprint(source)) !== canonical(fingerprint(restored))) fail("restored data mismatch");
}
