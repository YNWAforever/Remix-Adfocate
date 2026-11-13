import { createHash } from "node:crypto";
import { canonicalDeltaJson, digestDeltaProofPayload, digestDeltaSemanticFingerprint } from "./delta-evidence";
import { DELTA_RELEASE_PROJECT, type DeltaSemanticFingerprint } from "./delta-release-contracts";

export const PAIRED_RECOVERY_ARTIFACTS = ["database.dump", "roles.sql", "toc.list"] as const;
export type PairedRecoveryArtifactName = typeof PAIRED_RECOVERY_ARTIFACTS[number];
export interface PairedRecoveryArtifact { readonly name: PairedRecoveryArtifactName; readonly bytes: number; readonly sha256: string }
export interface PairedRecoveryDataSummary {
  readonly algorithm: "pg17-portable-data-v1";
  readonly collectorSha256: string;
  readonly normalizerSha256: string;
  readonly rootSha256: string;
  readonly tableCount: number;
  readonly rowCount: number;
  readonly sequenceCount: number;
}
export interface PairedRecoveryInspection {
  readonly fingerprint: DeltaSemanticFingerprint;
  readonly data: PairedRecoveryDataSummary;
  readonly globalStateHash: string;
}
export interface PairedRecoveryContext {
  readonly schemaVersion: 1;
  readonly projectRef: typeof DELTA_RELEASE_PROJECT;
  readonly sourceCommit: string;
  readonly scopeDigest: string;
  readonly targetBindingHash: string;
  readonly beforeRoot: string;
  readonly collectorSha256: string;
  readonly canonicalizerSha256: string;
  readonly dataCollectorSha256: string;
  readonly dataNormalizerSha256: string;
  readonly extensionProfileHash: string;
  readonly toolProfileHash: string;
  readonly changeControlReferenceHash: string;
  readonly expiresAt: string;
  readonly maximumCaptureMs: number;
  readonly maximumRestoreMs: number;
  readonly maximumArchiveBytes: number;
}
/** Implementations expose fixed operations only; no SQL or endpoint is supplied by this controller. */
export interface PairedRecoverySource {
  inspect(): Promise<PairedRecoveryInspection>;
  dumpArchive(): Promise<Buffer>;
  dumpRolesWithoutCredentials(): Promise<Buffer>;
  close(): Promise<void>;
}
export interface PairedRecoveryOwnedTarget {
  /** Must run only in the factory's inspected owned isolated namespace. */
  restore(archive: Buffer, roles: Buffer): Promise<void>;
  inspect(): Promise<PairedRecoveryInspection>;
  close(): Promise<void>;
}
export interface PairedRecoveryPrivateStore {
  /** Consumes and clears the provided buffer, including on failure. */
  write(name: PairedRecoveryArtifactName, bytes: Buffer): Promise<PairedRecoveryArtifact>;
  /** Caller owns and clears returned private buffers. */
  read(name: PairedRecoveryArtifactName): Promise<Buffer>;
  /** Writes a final, private manifest exclusively; returns an opaque reference, never a path. */
  seal(manifest: unknown): Promise<{ readonly reference: string; readonly manifestSha256: string }>;
}
export interface PairedRecoveryDependencies {
  readonly now: () => Date;
  readonly openSource: () => Promise<PairedRecoverySource>;
  readonly createOwnedTarget: () => Promise<PairedRecoveryOwnedTarget>;
  readonly inventoryArchive: (privateArchive: Buffer) => Promise<Buffer>;
  readonly store: PairedRecoveryPrivateStore;
}
export type PairedRecoveryStage = "context" | "source-open" | "source-before" | "archive" | "roles" | "inventory" | "private-write"
  | "source-after" | "source-close" | "target-create" | "private-read" | "restore" | "restored-inspection" | "target-cleanup" | "private-seal";
export class PairedRecoveryFailure extends Error {
  constructor(readonly stage: PairedRecoveryStage, readonly outcome: {
    readonly sourceCleanupConfirmed: boolean; readonly targetCleanupConfirmed: boolean; readonly targetRestoreAttempted: boolean;
    readonly containmentRequired: boolean;
  }) { super(`Paired recovery held: ${stage}`); this.name = "PairedRecoveryFailure"; }
}
export interface PairedRecoveryObservation {
  readonly schemaVersion: 1;
  readonly kind: "paired-snapshot-recovery-observation";
  readonly status: "HOLD";
  readonly validReleaseEvidence: false;
  readonly projectRef: typeof DELTA_RELEASE_PROJECT;
  readonly sourceCommit: string;
  readonly scopeDigest: string;
  readonly targetBindingHash: string;
  readonly sourceSnapshotBindingHash: string;
  readonly sourceBefore: PairedRecoveryInspection;
  readonly restoredBefore: PairedRecoveryInspection;
  readonly artifacts: readonly PairedRecoveryArtifact[];
  readonly reference: string;
  readonly manifestSha256: string;
  readonly captureStartedAt: string;
  readonly captureFinishedAt: string;
  readonly restoreStartedAt: string;
  readonly restoreFinishedAt: string;
  readonly measuredRestoreMilliseconds: number;
  readonly expiresAt: string;
  readonly snapshotConsistency: "exported-database-snapshot-with-global-state-recheck";
  readonly globalStateBeforeHash: string;
  readonly globalStateAfterHash: string;
  readonly toolProfileHash: string;
  readonly changeControlReferenceHash: string;
  readonly sourceCleanupConfirmed: true;
  readonly ownedContainerCleanup: "confirmed";
  readonly coverage: readonly { readonly category: string; readonly result: "verified" | "not-covered" }[];
  readonly contentDigest: string;
}
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const reject = () => { throw new Error("paired recovery binding rejected"); };
function digest(value: unknown, length = 64): asserts value is string {
  if (typeof value !== "string" || !new RegExp(`^[a-f0-9]{${length}}$`).test(value) || /^(.)\1+$/.test(value)) reject();
}
function integer(value: unknown, maximum: number, minimum = 0): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) reject();
}
function stamp(value: string) {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value))) reject();
  return Date.parse(value);
}
function snapshot<T>(value: T): T { return JSON.parse(canonicalDeltaJson(value)) as T; }
function contextShape(value: PairedRecoveryContext, now: number) {
  if (!Number.isSafeInteger(now) || now < 0) reject();
  const keys = ["schemaVersion", "projectRef", "sourceCommit", "scopeDigest", "targetBindingHash", "beforeRoot", "collectorSha256", "canonicalizerSha256",
    "dataCollectorSha256", "dataNormalizerSha256", "extensionProfileHash", "toolProfileHash", "changeControlReferenceHash", "expiresAt", "maximumCaptureMs", "maximumRestoreMs", "maximumArchiveBytes"];
  if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key)) || value.schemaVersion !== 1 || value.projectRef !== DELTA_RELEASE_PROJECT) reject();
  digest(value.sourceCommit, 40);
  for (const key of ["scopeDigest", "targetBindingHash", "beforeRoot", "collectorSha256", "canonicalizerSha256", "dataCollectorSha256", "dataNormalizerSha256", "extensionProfileHash", "toolProfileHash", "changeControlReferenceHash"] as const) digest(value[key]);
  integer(value.maximumCaptureMs, 600_000, 1); integer(value.maximumRestoreMs, 600_000, 1); integer(value.maximumArchiveBytes, 64 * 1024 * 1024, 1);
  const expiry = stamp(value.expiresAt); if (expiry <= now || expiry - now > 900_000) reject();
}
export function bindPairedRecoveryContext(value: unknown, now: Date): PairedRecoveryContext {
  const context = snapshot(value) as PairedRecoveryContext; contextShape(context, now.getTime()); return context;
}
function inspectShape(value: PairedRecoveryInspection, context: PairedRecoveryContext, expectedTarget: string, observedAfter: number, now: number) {
  const fp = value.fingerprint;
  if (Object.keys(value).sort().join() !== "data,fingerprint,globalStateHash" || fp.rootSha256 !== digestDeltaSemanticFingerprint(fp)) reject();
  digest(value.globalStateHash);
  if (value.globalStateHash !== digestDeltaProofPayload(fp.components.filter(component => ["roles-and-memberships", "database-role-settings"].includes(component.category))
    .slice().sort((a, b) => a.category < b.category ? -1 : 1))) reject();
  if (fp.components.find(component => component.category === "migration-history")?.objectCount !== 17) reject();
  for (const key of ["scopeDigest", "collectorSha256", "canonicalizerSha256"] as const) if (fp[key] !== context[key]) reject();
  if (fp.targetBindingHash !== expectedTarget || fp.rootSha256 !== context.beforeRoot || fp.environment.extensionProfileHash !== context.extensionProfileHash
    || Date.parse(fp.observedAt) < observedAfter || Date.parse(fp.observedAt) > now || Date.parse(fp.expiresAt) <= now || Date.parse(fp.expiresAt) > stamp(context.expiresAt)) reject();
  const data = value.data;
  if (Object.keys(data).sort().join() !== "algorithm,collectorSha256,normalizerSha256,rootSha256,rowCount,sequenceCount,tableCount"
    || data.algorithm !== "pg17-portable-data-v1" || data.collectorSha256 !== context.dataCollectorSha256 || data.normalizerSha256 !== context.dataNormalizerSha256) reject();
  digest(data.rootSha256); integer(data.tableCount, 10_000); integer(data.rowCount, Number.MAX_SAFE_INTEGER); integer(data.sequenceCount, 10_000);
}
function globalState(inspection: PairedRecoveryInspection) { return inspection.globalStateHash; }
function sameInspection(before: PairedRecoveryInspection, after: PairedRecoveryInspection) {
  if (before.fingerprint.rootSha256 !== after.fingerprint.rootSha256 || canonicalDeltaJson(before.data) !== canonicalDeltaJson(after.data)) reject();
}
function privateArtifact(name: PairedRecoveryArtifactName, bytes: Buffer, maximum: number): PairedRecoveryArtifact {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > maximum) reject();
  if (name === "database.dump" && bytes.subarray(0, 5).toString("ascii") !== "PGDMP") reject();
  return { name, bytes: bytes.length, sha256: hash(bytes) };
}

/** A factual preparation observation. It grants no recovery acceptance, RPO, release approval or pilot authority. */
export async function capturePairedRecovery(input: PairedRecoveryContext, deps: PairedRecoveryDependencies): Promise<PairedRecoveryObservation> {
  let stage: PairedRecoveryStage = "context", source: PairedRecoverySource | undefined, target: PairedRecoveryOwnedTarget | undefined;
  let sourceClosed = true, targetClosed = true, targetRestoreAttempted = false;
  const privateBuffers = new Set<Buffer>();
  try {
    const context = snapshot(input), started = deps.now().getTime(); contextShape(context, started);
    let lastClock = started;
    const time = () => { const current = deps.now().getTime(); if (!Number.isSafeInteger(current) || current < lastClock || current >= stamp(context.expiresAt)) reject(); lastClock = current; return current; };
    const captureStartedAt = new Date(started).toISOString();
    stage = "source-open"; sourceClosed = false; source = await deps.openSource();
    stage = "source-before"; const before = snapshot(await source.inspect()); inspectShape(before, context, context.targetBindingHash, started, time());
    const globalBefore = globalState(before), artifacts: PairedRecoveryArtifact[] = [];
    stage = "archive"; const archive = await source.dumpArchive(); privateBuffers.add(archive);
    const archiveMeta = privateArtifact("database.dump", archive, context.maximumArchiveBytes);
    stage = "roles"; const roles = await source.dumpRolesWithoutCredentials(); privateBuffers.add(roles);
    const rolesMeta = privateArtifact("roles.sql", roles, 4 * 1024 * 1024);
    stage = "inventory"; const inventoryInput = Buffer.from(archive); privateBuffers.add(inventoryInput);
    let toc: Buffer;
    try { toc = await deps.inventoryArchive(inventoryInput); } finally { inventoryInput.fill(0); privateBuffers.delete(inventoryInput); }
    privateBuffers.add(toc); const tocMeta = privateArtifact("toc.list", toc, 4 * 1024 * 1024);
    stage = "private-write";
    for (const [bytes, meta] of [[archive, archiveMeta], [roles, rolesMeta], [toc, tocMeta]] as const) {
      let stored: PairedRecoveryArtifact;
      try { stored = await deps.store.write(meta.name, bytes); } finally { bytes.fill(0); privateBuffers.delete(bytes); }
      if (canonicalDeltaJson(stored) !== canonicalDeltaJson(meta)) reject(); artifacts.push(meta);
    }
    stage = "source-after"; const rechecked = snapshot(await source.inspect());
    inspectShape(rechecked, context, context.targetBindingHash, started, time());
    if (rechecked.fingerprint.snapshotBindingHash !== before.fingerprint.snapshotBindingHash) reject();
    sameInspection(before, rechecked); const globalAfter = globalState(rechecked);
    if (globalBefore !== globalAfter || time() - started > context.maximumCaptureMs) reject();
    stage = "source-close"; await source.close(); sourceClosed = true;
    const captureFinish = time(); if (captureFinish - started > context.maximumCaptureMs) reject();
    const captureFinishedAt = new Date(captureFinish).toISOString();
    stage = "target-create"; const restoreStart = time(), restoreStartedAt = new Date(restoreStart).toISOString(); targetClosed = false;
    target = await deps.createOwnedTarget();
    stage = "private-read"; const restoredArchive = await deps.store.read("database.dump"); privateBuffers.add(restoredArchive);
    const restoredRoles = await deps.store.read("roles.sql"); privateBuffers.add(restoredRoles);
    if (canonicalDeltaJson(privateArtifact("database.dump", restoredArchive, context.maximumArchiveBytes)) !== canonicalDeltaJson(archiveMeta)
      || canonicalDeltaJson(privateArtifact("roles.sql", restoredRoles, 4 * 1024 * 1024)) !== canonicalDeltaJson(rolesMeta)) reject();
    stage = "restore"; targetRestoreAttempted = true;
    try { await target.restore(restoredArchive, restoredRoles); } finally { restoredArchive.fill(0); restoredRoles.fill(0); privateBuffers.delete(restoredArchive); privateBuffers.delete(restoredRoles); }
    stage = "restored-inspection"; const restored = snapshot(await target.inspect());
    digest(restored.fingerprint.targetBindingHash);
    if (restored.fingerprint.targetBindingHash === context.targetBindingHash || restored.fingerprint.snapshotBindingHash === before.fingerprint.snapshotBindingHash) reject();
    inspectShape(restored, context, restored.fingerprint.targetBindingHash, restoreStart, time()); sameInspection(before, restored);
    const restoreFinish = time(); if (restoreFinish - restoreStart > context.maximumRestoreMs) reject();
    stage = "target-cleanup"; await target.close(); targetClosed = true;
    const observation = { schemaVersion: 1 as const, kind: "paired-snapshot-recovery-observation" as const, status: "HOLD" as const, validReleaseEvidence: false as const,
      projectRef: DELTA_RELEASE_PROJECT, sourceCommit: context.sourceCommit, scopeDigest: context.scopeDigest, targetBindingHash: context.targetBindingHash,
      sourceSnapshotBindingHash: before.fingerprint.snapshotBindingHash, sourceBefore: before, restoredBefore: restored, artifacts,
      captureStartedAt, captureFinishedAt, restoreStartedAt, restoreFinishedAt: new Date(restoreFinish).toISOString(), measuredRestoreMilliseconds: restoreFinish - restoreStart,
      expiresAt: context.expiresAt, snapshotConsistency: "exported-database-snapshot-with-global-state-recheck" as const,
      globalStateBeforeHash: globalBefore, globalStateAfterHash: globalAfter, toolProfileHash: context.toolProfileHash,
      changeControlReferenceHash: context.changeControlReferenceHash, sourceCleanupConfirmed: true as const, ownedContainerCleanup: "confirmed" as const,
      coverage: [
        ...["database-schema", "database-rows", "role-definitions-without-passwords", "storage-configuration"].map(category => ({ category, result: "verified" as const })),
        ...["storage-object-bytes", "role-passwords", "platform-encryption-keys", "wal-pitr", "extension-binaries"].map(category => ({ category, result: "not-covered" as const })),
      ] };
    stage = "private-seal"; time(); const manifest = snapshot(observation), sealed = await deps.store.seal(manifest);
    if (typeof sealed.reference !== "string" || !/^private-recovery:[a-f0-9-]{36}$/.test(sealed.reference) || sealed.manifestSha256 !== digestDeltaProofPayload(manifest)) reject();
    time(); const result = { ...observation, ...sealed }; return { ...result, contentDigest: digestDeltaProofPayload(result) };
  } catch {
    if (source && !sourceClosed) { try { await source.close(); sourceClosed = true; } catch { /* retain truthful cleanup uncertainty */ } }
    if (target && !targetClosed) { try { await target.close(); targetClosed = true; } catch { /* retain truthful cleanup uncertainty */ } }
    throw new PairedRecoveryFailure(stage, { sourceCleanupConfirmed: sourceClosed, targetCleanupConfirmed: targetClosed, targetRestoreAttempted,
      containmentRequired: !sourceClosed || !targetClosed });
  } finally { for (const buffer of privateBuffers) buffer.fill(0); }
}
