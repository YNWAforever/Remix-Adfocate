import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { digestDeltaProofPayload, digestDeltaSemanticFingerprint } from "./delta-evidence";
import { makeDeltaReleaseFixture, deltaFixtureHash as h, DELTA_FIXTURE_NOW } from "./delta-release.fixture";
import { capturePairedRecovery, PairedRecoveryFailure, type PairedRecoveryArtifactName, type PairedRecoveryContext, type PairedRecoveryInspection } from "./delta-recovery";

// Synthetic adapters only; no database, filesystem, provider, owner acceptance or native proof.
function fixture() {
  const { evidence } = makeDeltaReleaseFixture();
  let clock = DELTA_FIXTURE_NOW.getTime();
  const expiresAt = new Date(clock + 600_000).toISOString(), sourceFp = evidence.equivalence.sourceBefore;
  const context: PairedRecoveryContext = { schemaVersion: 1, projectRef: "mhkoayftiuojxlrkollf", sourceCommit: h("recovery-code").slice(0, 40),
    scopeDigest: sourceFp.scopeDigest, targetBindingHash: sourceFp.targetBindingHash, beforeRoot: sourceFp.rootSha256,
    collectorSha256: sourceFp.collectorSha256, canonicalizerSha256: sourceFp.canonicalizerSha256, dataCollectorSha256: h("data-collector"),
    dataNormalizerSha256: h("data-normalizer"), extensionProfileHash: sourceFp.environment.extensionProfileHash, toolProfileHash: h("tools"),
    changeControlReferenceHash: h("freeze"), expiresAt, maximumCaptureMs: 60_000, maximumRestoreMs: 60_000, maximumArchiveBytes: 1024 * 1024 };
  const data = { algorithm: "pg17-portable-data-v1" as const, collectorSha256: context.dataCollectorSha256, normalizerSha256: context.dataNormalizerSha256,
    rootSha256: h("full-portable-rows-and-sequences"), tableCount: 104, rowCount: 487, sequenceCount: 3 };
  const globalStateHash = digestDeltaProofPayload(sourceFp.components.filter(component => ["roles-and-memberships", "database-role-settings"].includes(component.category)).slice().sort((a, b) => a.category < b.category ? -1 : 1));
  const before: PairedRecoveryInspection = { fingerprint: { ...sourceFp, observedAt: new Date(clock + 5).toISOString(), expiresAt }, data, globalStateHash };
  const source = { inspect: vi.fn(async () => structuredClone(before)), dumpArchive: vi.fn(async () => Buffer.from("PGDMP synthetic private rows")),
    dumpRolesWithoutCredentials: vi.fn(async () => Buffer.from("synthetic role definitions without credentials")), close: vi.fn(async () => {}) };
  const target = { restore: vi.fn<(archive: Buffer, roles: Buffer) => Promise<void>>().mockResolvedValue(undefined), inspect: vi.fn(async () => ({ fingerprint: { ...before.fingerprint, targetBindingHash: h("owned-target"),
    snapshotBindingHash: h("owned-target-snapshot"), observedAt: new Date(clock).toISOString() }, data: { ...data }, globalStateHash })), close: vi.fn(async () => {}) };
  const buffers = new Map<PairedRecoveryArtifactName, Buffer>();
  const store = { write: vi.fn(async (name: PairedRecoveryArtifactName, bytes: Buffer) => {
    const copy = Buffer.from(bytes); buffers.set(name, copy); bytes.fill(0);
    return { name, bytes: copy.length, sha256: createHash("sha256").update(copy).digest("hex") };
  }), read: vi.fn(async (name: PairedRecoveryArtifactName) => Buffer.from(buffers.get(name)!)),
  seal: vi.fn(async (manifest: unknown) => ({ reference: "private-recovery:01234567-89ab-4cde-8f01-23456789abcd", manifestSha256: digestDeltaProofPayload(manifest) })) };
  const deps = { now: () => new Date(clock += 5), openSource: vi.fn(async () => source), createOwnedTarget: vi.fn(async () => target),
    inventoryArchive: vi.fn(async (input: Buffer) => { input.fill(0); return Buffer.from("synthetic full archive inventory"); }), store };
  return { context, deps, source, target, before, data, buffers, advance: (ms: number) => { clock += ms; } };
}
async function failure(f: ReturnType<typeof fixture>) {
  const result = await capturePairedRecovery(f.context, f.deps).catch(error => error as unknown);
  expect(result).toBeInstanceOf(PairedRecoveryFailure); return result as PairedRecoveryFailure;
}

describe("paired snapshot recovery observations, never release acceptance", () => {
  it("binds the three exact private artifacts, source snapshot, complete restore and cleanup while retaining HOLD", async () => {
    const f = fixture(), result = await capturePairedRecovery(f.context, f.deps);
    expect(result).toMatchObject({ status: "HOLD", validReleaseEvidence: false, ownedContainerCleanup: "confirmed", sourceCleanupConfirmed: true,
      snapshotConsistency: "exported-database-snapshot-with-global-state-recheck", sourceSnapshotBindingHash: f.before.fingerprint.snapshotBindingHash });
    expect(result.artifacts.map(a => a.name)).toEqual(["database.dump", "roles.sql", "toc.list"]);
    expect(result.coverage.filter(c => c.result === "verified")).toHaveLength(4);
    expect(result.coverage.filter(c => c.result === "not-covered")).toHaveLength(5);
    expect(result).not.toHaveProperty("acceptedBy"); expect(result).not.toHaveProperty("rpoSeconds");
    expect(result.globalStateBeforeHash).toBe(result.globalStateAfterHash);
    expect(result.contentDigest).toBe(digestDeltaProofPayload(Object.fromEntries(Object.entries(result).filter(([key]) => key !== "contentDigest"))));
    expect(f.source.inspect).toHaveBeenCalledTimes(2); expect(f.target.restore).toHaveBeenCalledTimes(1);
    expect(f.source.close.mock.invocationCallOrder[0]).toBeLessThan(f.deps.createOwnedTarget.mock.invocationCallOrder[0]!);
    expect(f.target.close.mock.invocationCallOrder[0]).toBeLessThan(f.deps.store.seal.mock.invocationCallOrder[0]!);
    expect(JSON.stringify(result)).not.toContain("synthetic private rows");
    expect(f.deps.store.write.mock.calls.every(([, bytes]) => bytes.every(byte => byte === 0))).toBe(true);
    expect(f.target.restore.mock.calls[0]!.every(bytes => bytes.every(byte => byte === 0))).toBe(true);
  });
  it.each(["sourceCommit", "scopeDigest", "targetBindingHash", "beforeRoot", "collectorSha256", "canonicalizerSha256", "dataCollectorSha256", "dataNormalizerSha256", "extensionProfileHash", "toolProfileHash", "changeControlReferenceHash"] as const)("rejects unbound context %s before any source access", async key => {
    const f = fixture(); Object.assign(f.context, { [key]: "0".repeat(key === "sourceCommit" ? 40 : 64) });
    expect((await failure(f)).stage).toBe("context"); expect(f.deps.openSource).not.toHaveBeenCalled();
  });
  it.each(["maximumCaptureMs", "maximumRestoreMs", "maximumArchiveBytes"] as const)("rejects missing/oversized %s", async key => {
    const f = fixture(); Object.assign(f.context, { [key]: Number.MAX_SAFE_INTEGER }); expect((await failure(f)).stage).toBe("context");
  });
  it("rejects arbitrary context overrides", async () => {
    const f = fixture(); Object.assign(f.context, { sql: "private SQL payload" }); expect((await failure(f)).stage).toBe("context");
  });
  it("snapshots mutable caller context before opening source", async () => {
    const f = fixture(); f.deps.openSource.mockImplementation(async () => { Object.assign(f.context, { beforeRoot: h("changed") }); return f.source; });
    expect((await capturePairedRecovery(f.context, f.deps)).sourceBefore.fingerprint.rootSha256).toBe(f.before.fingerprint.rootSha256);
  });
  it.each(["schema", "data", "snapshot", "counts", "collector"] as const)("rejects %s drift on the source recheck before creating a target", async kind => {
    const f = fixture(); f.source.inspect.mockImplementationOnce(async () => structuredClone(f.before)).mockImplementationOnce(async () => {
      const next = structuredClone(f.before);
      if (kind === "schema") Object.assign(next.fingerprint, { rootSha256: h("drift") });
      if (kind === "snapshot") Object.assign(next.fingerprint, { snapshotBindingHash: h("new-snapshot") });
      if (kind === "data") Object.assign(next.data, { rootSha256: h("sequence-or-row-change") });
      if (kind === "counts") Object.assign(next.data, { rowCount: 488 });
      if (kind === "collector") Object.assign(next.data, { collectorSha256: h("wrong-collector") });
      return next;
    });
    expect((await failure(f)).stage).toBe("source-after"); expect(f.deps.createOwnedTarget).not.toHaveBeenCalled(); expect(f.deps.store.seal).not.toHaveBeenCalled(); expect(f.source.close).toHaveBeenCalled();
  });
  it.each(["data", "target", "snapshot", "time"] as const)("rejects restored %s mismatch and confirms owned cleanup", async kind => {
    const f = fixture(); f.target.inspect.mockImplementation(async () => {
      const fp = { ...f.before.fingerprint, targetBindingHash: h("restored"), snapshotBindingHash: h("restored-snapshot"), observedAt: f.deps.now().toISOString() };
      const data = { ...f.data }; if (kind === "data") data.rootSha256 = h("changed-data");
      if (kind === "target") fp.targetBindingHash = f.context.targetBindingHash;
      if (kind === "snapshot") fp.snapshotBindingHash = f.before.fingerprint.snapshotBindingHash;
      if (kind === "time") fp.observedAt = DELTA_FIXTURE_NOW.toISOString();
      return { fingerprint: fp, data, globalStateHash: f.before.globalStateHash };
    });
    expect(await failure(f)).toMatchObject({ stage: "restored-inspection", outcome: { targetRestoreAttempted: true, targetCleanupConfirmed: true } }); expect(f.deps.store.seal).not.toHaveBeenCalled();
  });
  it.each([0, 18])("refuses %i history members even if caller's beforeRoot is rebound", async count => {
    const f = fixture(), fp = f.before.fingerprint;
    Object.assign(fp, { components: fp.components.map(component => component.category === "migration-history" ? { ...component, objectCount: count } : component) });
    Object.assign(fp, { rootSha256: digestDeltaSemanticFingerprint(fp) }); Object.assign(f.context, { beforeRoot: fp.rootSha256 });
    expect((await failure(f)).stage).toBe("source-before"); expect(f.source.dumpArchive).not.toHaveBeenCalled();
  });
  it("requires a fresh global digest rather than accepting only the old RR catalog digest", async () => {
    const f = fixture(); Object.assign(f.before, { globalStateHash: h("different-fresh-global-state") });
    expect((await failure(f)).stage).toBe("source-before"); expect(f.source.dumpArchive).not.toHaveBeenCalled();
  });
  it.each(["header", "empty", "oversized"])("rejects %s custom archive before storing", async kind => {
    const f = fixture(); f.source.dumpArchive.mockResolvedValue(kind === "header" ? Buffer.from("SQL, not a custom archive") : kind === "empty" ? Buffer.alloc(0) : Buffer.alloc(f.context.maximumArchiveBytes + 1));
    expect((await failure(f)).stage).toBe("archive"); expect(f.deps.store.write).not.toHaveBeenCalled();
  });
  it("clears private capture buffers if inventory fails, retaining only a sanitized error", async () => {
    const f = fixture(), secret = Buffer.from("PGDMP sensitive fixture row"), roleBytes = Buffer.from("private fixture role");
    f.source.dumpArchive.mockResolvedValue(secret); f.source.dumpRolesWithoutCredentials.mockResolvedValue(roleBytes);
    f.deps.inventoryArchive.mockRejectedValue(new Error("private fixture stderr/SQL/credential"));
    const error = await failure(f); expect(error.stage).toBe("inventory"); expect(secret.every(b => b === 0)).toBe(true); expect(roleBytes.every(b => b === 0)).toBe(true);
    expect(JSON.stringify(error)).not.toMatch(/credential|stderr|fixture row/);
  });
  it("rehashes private artifacts before restore and refuses tampering", async () => {
    const f = fixture(); f.deps.store.read.mockImplementation(async name => name === "database.dump" ? Buffer.from("PGDMP changed private archive") : Buffer.from(f.buffers.get(name)!));
    expect((await failure(f)).stage).toBe("private-read"); expect(f.target.restore).not.toHaveBeenCalled(); expect(f.target.close).toHaveBeenCalled();
  });
  it("refuses store metadata mismatches before declaring capture", async () => {
    const f = fixture(); f.deps.store.write.mockResolvedValue({ name: "database.dump", bytes: 1, sha256: h("wrong") });
    expect((await failure(f)).stage).toBe("private-write"); expect(f.deps.createOwnedTarget).not.toHaveBeenCalled();
  });
  it("retains failed restore state and performs owned cleanup", async () => {
    const f = fixture(); f.target.restore.mockRejectedValue(new Error("private pg_restore stderr"));
    expect(await failure(f)).toMatchObject({ stage: "restore", outcome: { targetRestoreAttempted: true, targetCleanupConfirmed: true, containmentRequired: false } }); expect(f.deps.store.seal).not.toHaveBeenCalled();
  });
  it("retains containment when target cleanup remains unknown", async () => {
    const f = fixture(); f.target.close.mockRejectedValue(new Error("unknown owned namespace"));
    expect(await failure(f)).toMatchObject({ stage: "target-cleanup", outcome: { targetCleanupConfirmed: false, containmentRequired: true } }); expect(f.deps.store.seal).not.toHaveBeenCalled();
  });
  it("retains source uncertainty and never starts restore if RO close is unacknowledged", async () => {
    const f = fixture(); f.source.close.mockRejectedValue(new Error("unknown RO session"));
    expect(await failure(f)).toMatchObject({ stage: "source-close", outcome: { sourceCleanupConfirmed: false, containmentRequired: true } }); expect(f.deps.createOwnedTarget).not.toHaveBeenCalled();
  });
  it.each(["capture", "restore", "expiry", "backward"])("refuses violated %s timing without publishing an observation", async kind => {
    const f = fixture();
    if (kind === "capture") f.source.dumpArchive.mockImplementation(async () => { f.advance(60_001); return Buffer.from("PGDMP fixture"); });
    if (kind === "restore") f.target.restore.mockImplementation(async () => { f.advance(60_001); });
    if (kind === "expiry") f.target.restore.mockImplementation(async () => { f.advance(600_001); });
    if (kind === "backward") f.source.dumpArchive.mockImplementation(async () => { f.advance(-50); return Buffer.from("PGDMP fixture"); });
    await failure(f); expect(f.deps.store.seal).not.toHaveBeenCalled();
  });
  it("refuses a manifest hash or opaque reference mismatch even after complete restore", async () => {
    const f = fixture(); f.deps.store.seal.mockResolvedValue({ reference: "C:/private/path/never-a-reference", manifestSha256: h("wrong") });
    expect((await failure(f)).stage).toBe("private-seal");
  });
});
