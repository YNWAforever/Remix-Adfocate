import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openPairedReadOnlySnapshot, PAIRED_RECOVERY_BEGIN_SQL, type PairedSnapshotOptions } from "./delta-recovery-inspector";
import { buildDeltaSemanticFingerprint } from "./delta-fingerprint";
import { buildDeltaRecoveryDataFingerprint } from "./delta-recovery-data";
import type { FramedPsqlSession } from "./delta-psql-session";
import type { PairedRecoveryContext } from "./delta-recovery";
vi.mock("./delta-fingerprint", () => ({ parseDeltaSemanticCollection: (value: unknown) => value,
  buildDeltaSemanticFingerprint: vi.fn((_schema, _collection, binding) => ({ ...binding, rootSha256: "synthetic-semantic-root" })) }));
vi.mock("./delta-recovery-data", () => ({ buildDeltaRecoveryDataFingerprint: vi.fn(() => ({ rootSha256: "synthetic-data-root", tableCount: 104, rowCount: 487, sequenceCount: 3 })) }));
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const SEMANTIC = "SELECT 'fixture semantic collector';", DATA = "SELECT 'fixture data collector';";
function fixture() {
  const exported = { snapshot: "00000003-0000000A-1", backendPid: 51, database: "postgres", role: "postgres", sessionRole: "postgres", version: "170006", isolation: "repeatable read", readOnly: "on", observedAt: "2026-11-14T00:00:00.000Z" };
  const context: PairedRecoveryContext = { schemaVersion: 1, projectRef: "mhkoayftiuojxlrkollf", sourceCommit: sha("synthetic-code").slice(0, 40), scopeDigest: sha("scope"), targetBindingHash: sha("source"),
    beforeRoot: sha("before"), collectorSha256: sha(SEMANTIC), canonicalizerSha256: sha("canon"), dataCollectorSha256: sha(DATA), dataNormalizerSha256: sha("data-normalizer"),
    extensionProfileHash: sha("extensions"), toolProfileHash: sha("tools"), changeControlReferenceHash: sha("freeze"), expiresAt: "2026-11-14T00:10:00.000Z", maximumCaptureMs: 60000, maximumRestoreMs: 60000, maximumArchiveBytes: 1024 };
  const collection = () => ({ extensionProfileHash: context.extensionProfileHash, category: "synthetic-only", components: [
    { category: "roles-and-memberships", coverage: "complete", objectCount: 1, sha256: sha("roles") },
    { category: "database-role-settings", coverage: "complete", objectCount: 1, sha256: sha("settings") },
  ] });
  const query = vi.fn(async (sql: string): Promise<readonly string[]> => {
    if (sql.includes("pg_catalog.pg_export_snapshot()")) return [JSON.stringify(exported)];
    if (sql === SEMANTIC) return [JSON.stringify(collection())];
    if (sql === DATA) return [JSON.stringify({ kind: "synthetic-data-collection" })]; return [];
  });
  const session = { query, close: vi.fn(async () => {}), abort: vi.fn(async () => {}), closed: false, closePromise: Promise.resolve() } satisfies FramedPsqlSession;
  const options: PairedSnapshotOptions = { session, closeSession: vi.fn(async () => session.close()), context, semanticSql: SEMANTIC, dataSql: DATA, targetBindingHash: context.targetBindingHash,
    tools: { schema: vi.fn(async () => "synthetic schema"), archive: vi.fn(async () => Buffer.from("PGDMP synthetic-only")), roles: vi.fn(async () => Buffer.from("synthetic role definitions")), freshGlobalCollection: vi.fn(async () => collection()) } };
  return { exported, context, query, options, collection };
}
beforeEach(() => vi.clearAllMocks());
describe("fixed read-only paired snapshot protocol (all transport/collectors mocked)", () => {
  it("uses one actual exported snapshot for every schema and custom dump and binds portable data", async () => {
    const f = fixture(), source = await openPairedReadOnlySnapshot(f.options);
    const first = await source.inspect(), archive = await source.dumpArchive(), roles = await source.dumpRolesWithoutCredentials(), second = await source.inspect();
    expect(f.query.mock.calls[0]![0]).toBe(PAIRED_RECOVERY_BEGIN_SQL);
    expect(PAIRED_RECOVERY_BEGIN_SQL).toMatch(/REPEATABLE READ READ ONLY/); expect(PAIRED_RECOVERY_BEGIN_SQL).toContain("row_security=off");
    expect(f.query.mock.calls.filter(([sql]) => sql.includes("pg_catalog.pg_export_snapshot()"))).toHaveLength(1);
    expect(f.options.tools.schema).toHaveBeenNthCalledWith(1, f.exported.snapshot); expect(f.options.tools.schema).toHaveBeenNthCalledWith(2, f.exported.snapshot);
    expect(f.options.tools.archive).toHaveBeenCalledWith(f.exported.snapshot);
    expect(buildDeltaRecoveryDataFingerprint).toHaveBeenCalledWith({ kind: "synthetic-data-collection" }, { scopeDigest: f.context.scopeDigest, collectorSha256: f.context.dataCollectorSha256 });
    expect(first.fingerprint.snapshotBindingHash).toBe(second.fingerprint.snapshotBindingHash);
    expect(first.fingerprint.observedAt).toBe(f.exported.observedAt); expect(first.fingerprint.expiresAt).toBe(f.context.expiresAt);
    expect(first.data).toMatchObject({ normalizerSha256: f.context.dataNormalizerSha256, tableCount: 104, rowCount: 487, sequenceCount: 3 });
    archive.fill(0); roles.fill(0); await source.close();
    expect(f.query).toHaveBeenLastCalledWith("ROLLBACK;"); expect(f.options.closeSession).toHaveBeenCalledTimes(1);
    await source.close(); expect(f.options.closeSession).toHaveBeenCalledTimes(1);
    expect(f.query.mock.calls.map(([sql]) => sql).join("\n")).not.toMatch(/\b(?:COMMIT|INSERT|UPDATE|DELETE|ALTER|DROP)\b/);
  });
  it.each(["snapshot", "backendPid", "database", "role", "sessionRole", "version", "isolation", "readOnly", "observedAt"] as const)("refuses incorrect actual %s and closes the RO session", async key => {
    const f = fixture(); Object.assign(f.exported, { [key]: key === "backendPid" ? 0 : "invalid fixture value" });
    await expect(openPairedReadOnlySnapshot(f.options)).rejects.toThrow("Paired read-only snapshot unavailable"); expect(f.options.closeSession).toHaveBeenCalledTimes(1); expect(f.options.tools.schema).not.toHaveBeenCalled();
  });
  it.each(["semanticSql", "dataSql", "targetBindingHash"] as const)("refuses changed %s bytes/identity before BEGIN", async key => {
    const f = fixture(); Object.assign(f.options, { [key]: "modified fixture input" });
    await expect(openPairedReadOnlySnapshot(f.options)).rejects.toThrow(); expect(f.query).not.toHaveBeenCalledWith(PAIRED_RECOVERY_BEGIN_SQL); expect(f.options.closeSession).toHaveBeenCalled();
  });
  it("rejects global-state drift around the schema export", async () => {
    const f = fixture(); let semanticCalls = 0;
    f.query.mockImplementation(async sql => {
      if (sql.includes("pg_catalog.pg_export_snapshot()")) return [JSON.stringify(f.exported)];
      if (sql === SEMANTIC) return [JSON.stringify({ ...f.collection(), revision: semanticCalls++ })];
      if (sql === DATA) return [JSON.stringify({ kind: "synthetic-data-collection" })]; return [];
    });
    const source = await openPairedReadOnlySnapshot(f.options);
    await expect(source.inspect()).rejects.toThrow("Paired read-only snapshot unavailable"); expect(buildDeltaSemanticFingerprint).not.toHaveBeenCalled(); await source.close();
  });
  it("requires fresh global-role observations even when the exporter's RR catalog view is unchanged", async () => {
    const f = fixture(); let reads = 0;
    vi.mocked(f.options.tools.freshGlobalCollection).mockImplementation(async () => {
      const collection = f.collection(); if (reads++ > 0) collection.components[0]!.sha256 = sha("concurrent-role-change"); return collection;
    });
    const source = await openPairedReadOnlySnapshot(f.options);
    await expect(source.inspect()).rejects.toThrow("Paired read-only snapshot unavailable");
    expect(f.options.tools.freshGlobalCollection).toHaveBeenCalledTimes(2); expect(buildDeltaSemanticFingerprint).not.toHaveBeenCalled(); await source.close();
  });
  it("uses database observation time instead of restamping an old snapshot after export", async () => {
    const f = fixture(), source = await openPairedReadOnlySnapshot(f.options);
    const first = await source.inspect(); f.exported.observedAt = "2026-11-14T00:05:00.000Z";
    const after = await source.inspect(); expect(after.fingerprint.observedAt).toBe(first.fingerprint.observedAt); await source.close();
  });
  it("keeps operations serialized and refuses use after close", async () => {
    const f = fixture(), source = await openPairedReadOnlySnapshot(f.options);
    let resume!: (value: string) => void;
    vi.mocked(f.options.tools.schema).mockImplementation(() => new Promise(resolve => { resume = resolve; }));
    const inspecting = source.inspect(); await Promise.resolve(); await Promise.resolve();
    await expect(source.dumpArchive()).rejects.toThrow(); await expect(source.close()).rejects.toThrow();
    resume("synthetic schema"); await inspecting; await source.close(); await expect(source.inspect()).rejects.toThrow(); await expect(source.dumpRolesWithoutCredentials()).rejects.toThrow();
  });
  it("closes construction failures without returning transport diagnostics", async () => {
    const f = fixture(); f.query.mockRejectedValueOnce(new Error("private credential / source SQL / server stderr"));
    await expect(openPairedReadOnlySnapshot(f.options)).rejects.toThrow("Paired read-only snapshot unavailable"); expect(f.options.closeSession).toHaveBeenCalledTimes(1);
  });
});
