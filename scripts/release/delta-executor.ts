import { createHash } from "node:crypto";
import type { DeltaExpectedContext, DeltaReleaseEvidence, DeltaSemanticFingerprint } from "./delta-release-contracts";
import { DELTA_BASELINE_HISTORY_SHA256, DELTA_SOURCE_SHA256 } from "./delta-release-contracts";
import { canonicalDeltaJson, digestDeltaEvidence, digestDeltaPlan, digestDeltaProofPayload, digestDeltaSemanticFingerprint, parseDeltaEvidence, verifyDeltaEvidence } from "./delta-evidence";
import { assertDeltaInvariantTransition, normalizeDeltaInvariant, type DeltaTransactionInvariant } from "./delta-fingerprint";
import { digestDeltaExecutionProgram, type CompiledDeltaProgram } from "./delta-program";
import type { DeltaProvenanceReport } from "./delta-provenance";

export interface DeltaObservedState {
  readonly targetBindingHash: string;
  readonly fingerprint: DeltaSemanticFingerprint;
  readonly migrationRows: 17 | 18;
  readonly baselineHistorySha256: string;
  readonly deltaSourceSha256: null | string;
}
export interface DeltaResolvedProofs {
  readonly reportSetHash: string;
  readonly sourceCiReportHash: string;
  readonly deploymentCommit: string;
  readonly targetBindingHash: string;
}
/** One exclusive backend session; adapters must not reconnect between these operations. */
export interface DeltaTransaction {
  readonly inspectExportedSnapshot: () => Promise<DeltaObservedState>;
  readonly captureInvariant: () => Promise<DeltaTransactionInvariant>;
  readonly applyFixedProgram: () => Promise<void>;
  readonly commitWithExpiryGuard: () => Promise<void>;
  readonly rollback: () => Promise<void>;
  readonly close: () => Promise<void>;
}
export interface DeltaExecuteInput {
  readonly evidence: unknown;
  readonly committedBundleBytes: Buffer;
  readonly evidenceDigest: string;
  readonly context: DeltaExpectedContext;
  readonly apply: boolean;
  readonly approval: string;
}
export interface DeltaExecuteDeps {
  readonly now: () => Date;
  readonly compile: () => Promise<CompiledDeltaProgram>;
  readonly verifyProvenance: (evidence: DeltaReleaseEvidence) => Promise<DeltaProvenanceReport>;
  /** Resolve actual canonical committed payloads and authenticate external providers/owner acceptance. */
  readonly verifyProofs: (evidence: DeltaReleaseEvidence, provenance: DeltaProvenanceReport) => Promise<DeltaResolvedProofs>;
  readonly inspect: () => Promise<DeltaObservedState>;
  readonly begin: (program: CompiledDeltaProgram, bindings: {
    readonly expiresAt: string; readonly evidenceDigest: string; readonly programSha256: string; readonly scopeDigest: string;
  }) => Promise<DeltaTransaction>;
}
export interface DeltaExecutionReport {
  readonly schemaVersion: 1;
  readonly kind: "protected-delta-execution-receipt";
  readonly status: "verified-dry-run" | "applied" | "already-applied";
  readonly sourceCommit: string;
  readonly evidenceCommit: string;
  readonly evidenceDigest: string;
  readonly executionProgramSha256: string;
  readonly phaseBefore: "before" | "after";
  readonly observedBeforeRoot: string;
  readonly observedAfterRoot: string | null;
  readonly sqlExecutionAttempted: boolean;
  readonly commitConfirmed: boolean;
  readonly deltaChanged: boolean;
  readonly migrationRowsAfter: 17 | 18;
  readonly checkedAt: string;
}
export class DeltaExecutionFailure extends Error {
  constructor(readonly code: string, readonly outcome: {
    readonly sqlExecutionAttempted: boolean; readonly commitAttempted: boolean; readonly commitConfirmed: boolean;
    readonly rollbackAcknowledged: boolean; readonly containmentRequired: boolean;
  }) { super(`protected delta execution failed: ${code}`); this.name = "DeltaExecutionFailure"; }
}
function reject(reason: string): never { throw new Error(`protected delta execution rejected: ${reason}`); }
function cloneJson<T>(value: T): T { return JSON.parse(canonicalDeltaJson(value)) as T; }
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}

export function deltaGateReportSetHash(evidence: DeltaReleaseEvidence) {
  return digestDeltaProofPayload([...evidence.gates].map(({ gate, reportSha256 }) => ({ gate, reportSha256 })).sort((a, b) => a.gate < b.gate ? -1 : a.gate > b.gate ? 1 : 0));
}
export function classifyDeltaState(state: DeltaObservedState, context: DeltaExpectedContext, now: Date, inspectionStartedAt: Date): "before" | "after" {
  if (digestDeltaSemanticFingerprint(state.fingerprint) !== state.fingerprint.rootSha256) reject("actual fingerprint root");
  const observed = Date.parse(state.fingerprint.observedAt), expires = Date.parse(state.fingerprint.expiresAt);
  if (!Number.isFinite(now.valueOf()) || !Number.isFinite(inspectionStartedAt.valueOf()) || observed < inspectionStartedAt.valueOf()
    || observed > now.valueOf() || expires <= now.valueOf() || now.valueOf() - observed > context.maximumProofAgeMs) reject("actual observation freshness");
  if (state.targetBindingHash !== context.targetBindingHash || state.fingerprint.targetBindingHash !== context.targetBindingHash
    || state.fingerprint.scopeDigest !== context.scopeDigest || state.fingerprint.collectorSha256 !== context.collectorSha256
    || state.fingerprint.canonicalizerSha256 !== context.canonicalizerSha256 || state.baselineHistorySha256 !== DELTA_BASELINE_HISTORY_SHA256) reject("actual target or baseline binding");
  if (state.fingerprint.rootSha256 === context.beforeRoot && state.migrationRows === 17 && state.deltaSourceSha256 === null) return "before";
  if (state.fingerprint.rootSha256 === context.afterRoot && state.migrationRows === 18 && state.deltaSourceSha256 === DELTA_SOURCE_SHA256) return "after";
  return reject("actual live state is neither approved before nor approved after");
}

/** Conservative database-side deadline includes age/RPO cutoffs, not merely the bundle's displayed expiry. */
export function deltaEffectiveExpiry(e: DeltaReleaseEvidence, context: DeltaExpectedContext) {
  const observations = [e.equivalence, ...[e.equivalence.sourceBefore, e.equivalence.reviewedReferenceBefore, e.equivalence.restoredBefore,
    e.equivalence.emptyAfter, e.equivalence.shapedAfter, e.equivalence.replayAfter], ...e.gates];
  const times = [Date.parse(e.core.expiresAt), Date.parse(e.core.createdAt) + context.maximumEvidenceAgeMs,
    Date.parse(e.recovery.expiresAt), Date.parse(e.recovery.captureStartedAt) + Math.min(e.recovery.rpoSeconds, context.maximumRpoSeconds) * 1000,
    Date.parse(e.recovery.captureStartedAt) + context.maximumProofAgeMs,
    ...observations.flatMap(proof => [Date.parse(proof.expiresAt), Date.parse(proof.observedAt) + context.maximumProofAgeMs])];
  if (times.some(time => !Number.isFinite(time))) reject("invalid effective expiry");
  return new Date(Math.min(...times)).toISOString();
}

/** The stock raw-source executor is never called by this explicit profile. */
export async function executeBundledDelta(input: DeltaExecuteInput, deps: DeltaExecuteDeps): Promise<DeltaExecutionReport> {
  // Snapshot every caller-owned value before the first await; dry-run cannot become apply mid-flight.
  const apply = input.apply, approval = input.approval, approvedDigest = input.evidenceDigest;
  if (!Buffer.isBuffer(input.committedBundleBytes) || input.committedBundleBytes.length === 0 || input.committedBundleBytes.length > 8 * 1024 * 1024) reject("committed bundle buffer bound");
  const bundleBytes = Buffer.from(input.committedBundleBytes);
  const parsed = parseDeltaEvidence(cloneJson(input.evidence));
  if (!parsed.evidence) reject("invalid tagged evidence");
  const evidence = freeze(parsed.evidence!);
  const context = freeze(cloneJson(input.context));
  if (bundleBytes.length === 0 || bundleBytes.length > 8 * 1024 * 1024) reject("bundle byte bound");
  let raw: unknown;
  try { raw = JSON.parse(bundleBytes.toString("utf8")); } catch { reject("committed bundle encoding"); }
  if (canonicalDeltaJson(raw) !== canonicalDeltaJson(evidence)) reject("parsed evidence differs from committed artifact");
  const digest = digestDeltaEvidence(evidence);
  if (approvedDigest !== digest) reject("approved outer bundle digest");
  if (apply !== true && apply !== false) reject("explicit apply flag required");
  if (apply && approval !== `APPROVE ${context.projectRef} ${digest}`) reject("exact production approval phrase");
  let lastClock = Number.NEGATIVE_INFINITY;
  const clock = () => {
    const value = deps.now().valueOf();
    if (!Number.isFinite(value) || value < lastClock) reject("trusted clock moved backwards");
    lastClock = value;
    return new Date(value);
  };
  const check = () => {
    const now = clock();
    if (verifyDeltaEvidence(evidence, context, now).length) reject("evidence or proof freshness/binding");
    return now;
  };
  check();
  const authenticate = async () => {
    const provenance = freeze(cloneJson(await deps.verifyProvenance(evidence)));
    if (provenance.sourceCommit !== context.sourceCommit || !/^[a-f0-9]{40}$/.test(provenance.evidenceCommit) || provenance.evidenceCommit === context.sourceCommit
      || provenance.artifactSha256 !== createHash("sha256").update(bundleBytes).digest("hex") || !/^[1-9]\d*$/.test(provenance.approvedByGitHubActorId)
      || !Array.isArray(provenance.permittedDeploymentCommits) || provenance.permittedDeploymentCommits.length !== 2
      || new Set(provenance.permittedDeploymentCommits).size !== 2
      || canonicalDeltaJson([...provenance.permittedDeploymentCommits].sort()) !== canonicalDeltaJson([context.sourceCommit, provenance.evidenceCommit].sort())) reject("actual artifact provenance");
    const proofs = await deps.verifyProofs(evidence, provenance);
    if (proofs.reportSetHash !== deltaGateReportSetHash(evidence) || proofs.sourceCiReportHash !== provenance.sourceCiReportHash
      || proofs.sourceCiReportHash !== evidence.gates.find(gate => gate.gate === "source-ci")!.reportSha256
      || proofs.targetBindingHash !== context.targetBindingHash || !provenance.permittedDeploymentCommits.includes(proofs.deploymentCommit)) reject("resolved provider proof binding");
    return provenance;
  };
  const provenance = await authenticate();
  const compile = async () => {
    const program = freeze(cloneJson(await deps.compile()));
    if (digestDeltaPlan(program.plan) !== context.planDigest || program.planDigest !== context.planDigest
      || program.executionProgramSha256 !== context.executionProgramSha256 || program.plan.delta.executionProgramSha256 !== program.executionProgramSha256
      || digestDeltaExecutionProgram({ ...program, scopeDigest: program.plan.scopeDigest }) !== program.executionProgramSha256) reject("re-derived execution program");
    if (program.requiredCapabilities.length !== context.requiredCapabilityCount || new Set(program.requiredCapabilities).size !== program.requiredCapabilities.length
      || digestDeltaProofPayload([...program.requiredCapabilities].sort()) !== context.requiredCapabilitiesHash) reject("re-derived capability coverage");
    return program;
  };
  let program = await compile();
  const beforeInspectionStarted = check();
  const before = await deps.inspect();
  const phase = classifyDeltaState(before, context, check(), beforeInspectionStarted);
  if (!apply) return { schemaVersion: 1, kind: "protected-delta-execution-receipt", status: "verified-dry-run",
    sourceCommit: provenance.sourceCommit, evidenceCommit: provenance.evidenceCommit, evidenceDigest: digest,
    executionProgramSha256: program.executionProgramSha256, phaseBefore: phase, observedBeforeRoot: before.fingerprint.rootSha256,
    observedAfterRoot: null, sqlExecutionAttempted: false, commitConfirmed: false, deltaChanged: false,
    migrationRowsAfter: before.migrationRows, checkedAt: check().toISOString() };

  let transaction: DeltaTransaction | undefined;
  let sqlExecutionAttempted = false, commitAttempted = false, commitConfirmed = false, rollbackAcknowledged = false, postconditionsVerified = false;
  let stage = "begin";
  try {
    program = await compile();
    stage = "reauthorize-before-transaction";
    const currentAuthority = await authenticate();
    if (currentAuthority.sourceCommit !== provenance.sourceCommit || currentAuthority.evidenceCommit !== provenance.evidenceCommit
      || currentAuthority.approvedByGitHubActorId !== provenance.approvedByGitHubActorId || currentAuthority.protectedRunId !== provenance.protectedRunId
      || currentAuthority.protectedRunAttempt !== provenance.protectedRunAttempt || currentAuthority.sourceCiReportHash !== provenance.sourceCiReportHash) reject("release authority changed during inspection");
    check();
    stage = "begin";
    transaction = await deps.begin(program, { expiresAt: deltaEffectiveExpiry(evidence, context), evidenceDigest: digest,
      programSha256: program.executionProgramSha256, scopeDigest: context.scopeDigest });
    stage = "transaction-before-state";
    const lockedInspectionStarted = check();
    const locked = await transaction.inspectExportedSnapshot();
    if (classifyDeltaState(locked, context, check(), lockedInspectionStarted) !== phase || locked.fingerprint.rootSha256 !== before.fingerprint.rootSha256) reject("state changed between inspection and transaction");
    const invariantBefore = normalizeDeltaInvariant(await transaction.captureInvariant());
    if (invariantBefore.migrationRows !== (phase === "before" ? 17 : 18)) reject("transaction history binding");
    stage = "immediately-before-write";
    check();
    stage = "fixed-delta";
    sqlExecutionAttempted = true;
    await transaction.applyFixedProgram();
    stage = "transaction-postconditions";
    const invariantAfter = normalizeDeltaInvariant(await transaction.captureInvariant());
    assertDeltaInvariantTransition(invariantBefore, invariantAfter, phase === "before" ? "first" : "replay");
    postconditionsVerified = true;
    stage = "immediately-before-commit";
    check();
    commitAttempted = true;
    await transaction.commitWithExpiryGuard();
    commitConfirmed = true;
    await transaction.close();
    transaction = undefined;
    stage = "fresh-postcommit-state";
    const postInspectionStarted = clock();
    const after = await deps.inspect();
    if (classifyDeltaState(after, context, clock(), postInspectionStarted) !== "after") reject("observed postcommit fingerprint");
    return { schemaVersion: 1, kind: "protected-delta-execution-receipt", status: phase === "before" ? "applied" : "already-applied",
      sourceCommit: provenance.sourceCommit, evidenceCommit: provenance.evidenceCommit, evidenceDigest: digest,
      executionProgramSha256: program.executionProgramSha256, phaseBefore: phase, observedBeforeRoot: locked.fingerprint.rootSha256,
      observedAfterRoot: after.fingerprint.rootSha256, sqlExecutionAttempted, commitConfirmed, deltaChanged: phase === "before",
      migrationRowsAfter: 18, checkedAt: clock().toISOString() };
  } catch {
    if (transaction && !commitAttempted) { try { await transaction.rollback(); rollbackAcknowledged = true; } catch { /* outcome remains unverified */ } }
    throw new DeltaExecutionFailure(stage, { sqlExecutionAttempted, commitAttempted, commitConfirmed, rollbackAcknowledged,
      // ROLLBACK cannot undo sequence advances or external effects. A failed
      // post-write invariant is containment work even with a rollback ACK.
      containmentRequired: commitAttempted || commitConfirmed || (sqlExecutionAttempted && (!rollbackAcknowledged || !postconditionsVerified)) });
  } finally {
    if (transaction) { try { await transaction.close(); } catch { /* closing cannot turn an attempt into a verified receipt */ } }
  }
}
