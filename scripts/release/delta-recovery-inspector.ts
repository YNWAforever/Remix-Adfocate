import { createHash } from "node:crypto";
import { canonicalDeltaJson, digestDeltaProofPayload } from "./delta-evidence";
import { buildDeltaSemanticFingerprint, parseDeltaSemanticCollection } from "./delta-fingerprint";
import { buildDeltaRecoveryDataFingerprint } from "./delta-recovery-data";
import { parseSinglePsqlJson, type FramedPsqlSession } from "./delta-psql-session";
import type { PairedRecoveryContext, PairedRecoveryInspection, PairedRecoverySource } from "./delta-recovery";

export const PAIRED_RECOVERY_BEGIN_SQL = "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s'; SET LOCAL idle_in_transaction_session_timeout='120s'; SET LOCAL timezone='UTC'; SET LOCAL row_security=off;";
const EXPORT_SQL = `SELECT pg_catalog.jsonb_build_object('snapshot',pg_catalog.pg_export_snapshot(),'backendPid',pg_catalog.pg_backend_pid(),
 'database',pg_catalog.current_database(),'role',current_user,'sessionRole',session_user,'version',pg_catalog.current_setting('server_version_num'),
 'isolation',pg_catalog.current_setting('transaction_isolation'),'readOnly',pg_catalog.current_setting('transaction_read_only'),
 'observedAt',pg_catalog.clock_timestamp());`;
const sha = (value: string) => createHash("sha256").update(value.replace(/\r\n?/g, "\n")).digest("hex");
function stop(): never { throw new Error("Paired read-only snapshot unavailable"); }
export interface PairedSnapshotTools {
  readonly schema: (snapshot: string) => Promise<string>;
  readonly archive: (snapshot: string) => Promise<Buffer>;
  readonly roles: () => Promise<Buffer>;
  /** Separate newly begun RO backend: never import the exporter's older snapshot. */
  readonly freshGlobalCollection: () => Promise<unknown>;
}
export function pairedRecoveryGlobalHash(value: unknown) {
  return digestDeltaProofPayload(parseDeltaSemanticCollection(value).components.filter(component => ["roles-and-memberships", "database-role-settings"].includes(component.category))
    .slice().sort((a, b) => a.category < b.category ? -1 : 1));
}
export interface PairedSnapshotOptions {
  readonly session: FramedPsqlSession;
  readonly closeSession: () => Promise<void>;
  readonly context: PairedRecoveryContext;
  readonly semanticSql: string;
  readonly dataSql: string;
  readonly tools: PairedSnapshotTools;
  readonly targetBindingHash: string;
}
/** The session remains in one RO RR transaction until close. The tools import its one actual snapshot. */
export async function openPairedReadOnlySnapshot(options: PairedSnapshotOptions): Promise<PairedRecoverySource> {
  const context = JSON.parse(canonicalDeltaJson(options.context)) as PairedRecoveryContext;
  const { session, closeSession, semanticSql, dataSql, targetBindingHash } = options;
  const tools = Object.freeze({ schema: options.tools.schema, archive: options.tools.archive, roles: options.tools.roles, freshGlobalCollection: options.tools.freshGlobalCollection });
  let closed = false, busy = false;
  try {
    if (sha(semanticSql) !== context.collectorSha256 || sha(dataSql) !== context.dataCollectorSha256 || !/^[a-f0-9]{64}$/.test(targetBindingHash)) stop();
    await session.query(PAIRED_RECOVERY_BEGIN_SQL);
    const exported: unknown = parseSinglePsqlJson(await session.query(EXPORT_SQL));
    if (!exported || typeof exported !== "object" || Array.isArray(exported)) stop();
    const row = exported as Record<string, unknown>;
    if (typeof row.snapshot !== "string" || !/^[A-Fa-f0-9-]{1,100}$/.test(row.snapshot) || !Number.isSafeInteger(row.backendPid)
      || Number(row.backendPid) < 1 || row.database !== "postgres" || row.role !== "postgres" || row.sessionRole !== "postgres"
      || row.version !== "170006" || row.isolation !== "repeatable read" || row.readOnly !== "on" || typeof row.observedAt !== "string"
      || !Number.isFinite(Date.parse(row.observedAt))) stop();
    const snapshotId = row.snapshot, observedAt = new Date(Date.parse(row.observedAt)).toISOString();
    const snapshotBindingHash = digestDeltaProofPayload({ schemaVersion: 1, kind: "paired-read-only-snapshot", snapshot: snapshotId,
      backendPid: row.backendPid, observedAt, targetBindingHash });
    async function operation<T>(body: () => Promise<T>): Promise<T> {
      if (closed || busy) stop(); busy = true;
      try { await session.query("SELECT 1;"); return await body(); }
      finally { busy = false; }
    }
    return {
      inspect: () => operation(async (): Promise<PairedRecoveryInspection> => {
        const first = parseDeltaSemanticCollection(parseSinglePsqlJson(await session.query(semanticSql)));
        const freshBefore = pairedRecoveryGlobalHash(await tools.freshGlobalCollection());
        if (freshBefore !== pairedRecoveryGlobalHash(first)) stop();
        const schema = await tools.schema(snapshotId);
        const data = buildDeltaRecoveryDataFingerprint(parseSinglePsqlJson(await session.query(dataSql)), { scopeDigest: context.scopeDigest, collectorSha256: context.dataCollectorSha256 });
        const second = parseDeltaSemanticCollection(parseSinglePsqlJson(await session.query(semanticSql)));
        const freshAfter = pairedRecoveryGlobalHash(await tools.freshGlobalCollection());
        if (canonicalDeltaJson(first) !== canonicalDeltaJson(second) || freshBefore !== freshAfter || freshAfter !== pairedRecoveryGlobalHash(second)) stop();
        const fingerprint = buildDeltaSemanticFingerprint(schema, first, { scopeDigest: context.scopeDigest, collectorSha256: context.collectorSha256,
          canonicalizerSha256: context.canonicalizerSha256, targetBindingHash, snapshotBindingHash, observedAt, expiresAt: context.expiresAt,
          environment: { serverVersionNum: "170006", dumpVersion: "17.11", extensionProfileHash: first.extensionProfileHash, databaseName: "postgres" } });
        return { fingerprint, globalStateHash: freshAfter, data: { algorithm: "pg17-portable-data-v1", collectorSha256: context.dataCollectorSha256, normalizerSha256: context.dataNormalizerSha256,
          rootSha256: data.rootSha256, tableCount: data.tableCount, rowCount: data.rowCount, sequenceCount: data.sequenceCount } };
      }),
      dumpArchive: () => operation(() => tools.archive(snapshotId)),
      dumpRolesWithoutCredentials: () => operation(() => tools.roles()),
      close: async () => {
        if (closed) return;
        if (busy) stop();
        try { await session.query("ROLLBACK;"); } finally { await closeSession(); closed = true; }
      },
    };
  } catch {
    try { await session.query("ROLLBACK;"); } catch { /* No write operation is available. */ }
    await closeSession(); return stop();
  }
}
