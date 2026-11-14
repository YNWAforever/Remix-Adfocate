import { createHash } from "node:crypto";
import { canonicalDeltaJson, digestDeltaProofPayload, digestDeltaSemanticFingerprint, parseDeltaEvidence } from "./delta-evidence";
import { DELTA_EXPORT_COMPONENTS, DELTA_RELEASE_PROJECT, DELTA_REQUIRED_GATES, type DeltaRequiredGate, type DeltaSemanticFingerprint } from "./delta-release-contracts";
import { PROVIDER_CASE_NAMES, validateProviderObservation, type ProviderObservation } from "./delta-provider-observation";
import type { PairedRecoveryInspection, PairedRecoveryObservation } from "./delta-recovery";

/** Pure byte validation only. The preparer authenticates provenance; the adapter checks subject ancestry. Hashes do not authenticate a producer. */
export interface CapturedPublicArtifact { readonly path: string; readonly bytes: Uint8Array; readonly sha256: string; readonly contentDigest: string }
export interface CapturedPublicSource { readonly path: string; readonly bytes: Uint8Array; readonly sha256: string }
export interface Phase3SourceCi {
  readonly repository: "YNWAforever/Remix-Adfocate"; readonly workflow: "CI"; readonly branch: string;
  readonly runId: string; readonly sourceCommit: string; readonly event: "push" | "pull_request" | "workflow_dispatch";
  readonly url: string; readonly conclusion: "success" | "failure" | "cancelled" | "timed_out";
  readonly jobs: readonly { readonly name: "build-test" | "integration" | "provider-acceptance"; readonly sourceCommit: string; readonly conclusion: "success" | "failure" | "cancelled" | "timed_out" | "skipped" }[];
}
export interface Phase3ReviewPacketInput {
  /** The tested provider subject M, not the later review packet commit E. */
  readonly sourceCommit: string; readonly preparedAt: string;
  readonly provider: CapturedPublicArtifact; readonly pairedRecovery: CapturedPublicArtifact; readonly sourceCi: CapturedPublicArtifact;
  readonly currentSources: readonly CapturedPublicSource[];
}
export const PHASE3_PROVIDER_SOURCE_PATHS = Object.freeze(["delta-provider-contracts.ts", "delta-provider-stack.ts", "delta-provider-network.ts", "delta-provider-runtime.ts", "delta-provider-cli.ts", "delta-provider-runner.mjs", "delta-provider-observation.ts", "delta-provider-auth.ts", "delta-provider-journey.ts", "delta-provider-journey-fixtures.ts", "delta-provider-storage.ts", "delta-child-process.ts", "delta-private-artifacts.ts", "delta-private-artifacts.ps1", "delta-psql-session.ts"].map(name => `scripts/release/${name}`));
export const PHASE3_PAIRED_SOURCE_PATHS = Object.freeze(["delta-recovery.ts", "delta-recovery-inspector.ts", "delta-recovery-native.ts", "delta-recovery-data.ts", "delta-recovery-data.sql", "delta-private-binary.ts", "delta-private-artifacts.ts", "delta-private-artifacts.ps1", "delta-semantic-capture.sql", "delta-fingerprint.ts"].map(name => `scripts/release/${name}`));
export const PHASE3_PAIRED_RECEIPT_PATH = "docs/verification/phase3-paired-recovery/native-20261114-fault-confirmed.json";
export const PHASE3_PAIRED_RECEIPT_DIGEST = "8da85170bf9500b326f5794e0afef6acc7a6ae4f80873869e7e24fa557994d76";
export const PHASE3_REVIEW_SOURCE_PATHS = Object.freeze([...new Set([...PHASE3_PROVIDER_SOURCE_PATHS, ...PHASE3_PAIRED_SOURCE_PATHS])].sort());
export interface Phase3ReviewGate { readonly gate: DeltaRequiredGate; readonly status: "HOLD"; readonly accepted: false; readonly observations: readonly string[]; readonly missing: readonly string[] }
export interface Phase3ReviewPacket {
  readonly schemaVersion: 1; readonly kind: "phase3-review-packet"; readonly status: "HOLD"; readonly accepted: false;
  readonly ownerAccepted: false; readonly validReleaseEvidence: false; readonly productionEquivalent: false;
  readonly engineeringStatus: "complete" | "incomplete"; readonly sourceCommit: string; readonly preparedAt: string;
  readonly inputs: { readonly provider: ArtifactBinding; readonly pairedRecovery: ArtifactBinding; readonly sourceCi: ArtifactBinding };
  readonly currentCodeHashes: Readonly<Record<string, string>>;
  readonly provider: { readonly complete: boolean; readonly validatedPassedCases: number; readonly cleanupConfirmed: boolean; readonly notCovered: readonly string[] };
  readonly recovery: { readonly nativeCases: 9; readonly semanticComponents: 7; readonly portableDataEqual: true; readonly cleanupConfirmed: true; readonly fixtureRestoreMilliseconds: number; readonly sourceLedgerSynthetic: true; readonly sourceCommitSynthetic: true; readonly productionFreshnessAccepted: false };
  readonly sourceCi: Phase3SourceCi & { readonly complete: boolean };
  readonly ownerInputs: { readonly rpoSeconds: null; readonly rtoSeconds: null; readonly freeze: null; readonly roles: null; readonly reportSet: null; readonly outerApproval: null };
  readonly gates: readonly Phase3ReviewGate[]; readonly limitations: readonly string[]; readonly protectedV2ParserRejected: true; readonly contentDigest: string;
}
export interface ArtifactBinding { readonly path: string; readonly sha256: string; readonly contentDigest: string; readonly byteLength: number }
type FailureCode = "input-shape" | "artifact-path" | "artifact-bytes" | "artifact-digest" | "source-binding" | "provider-binding" | "paired-shape" | "paired-markers" | "paired-cases" | "paired-fault-prerequisite" | "paired-digest" | "paired-semantic" | "paired-data" | "paired-cleanup" | "paired-time" | "ci-shape" | "ci-binding" | "protected-parser" | "review-rejected";
export class Phase3ReviewPacketFailure extends Error { constructor(readonly code: FailureCode) { super("Phase 3 review packet rejected"); this.name = "Phase3ReviewPacketFailure"; } }
const SHA = /^[a-f0-9]{64}$/, COMMIT = /^[a-f0-9]{40}$/, JOBS = ["build-test", "integration", "provider-acceptance"];
function check(value: unknown, code: FailureCode): asserts value { if (!value) throw new Phase3ReviewPacketFailure(code); }
function object(value: unknown, keys: readonly string[], code: FailureCode): Record<string, unknown> {
  check(value && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)), code);
  const row = value as Record<string, unknown>; check(!Object.getOwnPropertySymbols(row).length && Object.keys(row).length === keys.length && keys.every(key => Object.hasOwn(row, key)), code); return row;
}
function equal(left: unknown, right: unknown, code: FailureCode) { check(canonicalDeltaJson(left) === canonicalDeltaJson(right), code); }
function timestamp(value: unknown, code: FailureCode): number { check(typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value, code); return Date.parse(value); }
function integer(value: unknown, maximum: number, code: FailureCode, minimum = 0) { check(Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum, code); }
function hash(value: unknown, code: FailureCode) { check(typeof value === "string" && SHA.test(value), code); }
function verifyRoot(value: Record<string, unknown>, code: FailureCode) { const { contentDigest, ...payload } = value; hash(contentDigest, code); check(contentDigest === digestDeltaProofPayload(payload), code); }
function bytes(value: unknown, maximum: number): Uint8Array { check(value instanceof Uint8Array && value.byteLength > 0 && value.byteLength <= maximum, "artifact-bytes"); return value; }
function byteHash(value: Uint8Array) { return createHash("sha256").update(value).digest("hex"); }
function artifact(value: CapturedPublicArtifact, role: "provider" | "pairedRecovery" | "sourceCi") {
  object(value, ["path", "bytes", "sha256", "contentDigest"], "input-shape");
  check(typeof value.path === "string" && (role === "pairedRecovery" ? value.path === PHASE3_PAIRED_RECEIPT_PATH : role === "provider"
    ? /^docs\/verification\/phase3-provider-rehearsal\/owned-[a-f0-9]{12}-[a-f0-9-]{36}\.json$/.test(value.path)
    : /^docs\/verification\/phase3-release-review\/[a-zA-Z0-9_-]+\.json$/.test(value.path)), "artifact-path");
  const raw = bytes(value.bytes, 1024 * 1024); hash(value.sha256, "artifact-digest"); hash(value.contentDigest, "artifact-digest"); check(byteHash(raw) === value.sha256, "artifact-digest");
  const decoded = new TextDecoder("utf-8", { fatal: true }).decode(raw); const report = JSON.parse(decoded) as Record<string, unknown>;
  check(report && typeof report === "object" && !Array.isArray(report), "input-shape");
  if (role === "sourceCi") check(digestDeltaProofPayload(report) === value.contentDigest, "artifact-digest");
  else { verifyRoot(report, "artifact-digest"); check(report.contentDigest === value.contentDigest, "artifact-digest"); }
  return { report, binding: { path: value.path, sha256: value.sha256, contentDigest: value.contentDigest, byteLength: raw.byteLength } };
}
function sources(input: readonly CapturedPublicSource[]): Record<string, string> {
  check(Array.isArray(input) && input.length === PHASE3_REVIEW_SOURCE_PATHS.length, "source-binding");
  let total = 0; const result: Record<string, string> = {};
  for (const captured of input) { object(captured, ["path", "bytes", "sha256"], "source-binding"); check(PHASE3_REVIEW_SOURCE_PATHS.includes(captured.path) && !Object.hasOwn(result, captured.path), "source-binding");
    const raw = bytes(captured.bytes, 2 * 1024 * 1024); total += raw.byteLength; check(total <= 16 * 1024 * 1024, "artifact-bytes"); hash(captured.sha256, "source-binding"); check(byteHash(raw) === captured.sha256, "source-binding"); result[captured.path] = captured.sha256;
  }
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)));
}
function sourceMap(value: unknown, paths: readonly string[], current: Record<string, string>) { object(value, paths, "source-binding"); for (const path of paths) check((value as Record<string, unknown>)[path] === current[path], "source-binding"); }
function ci(value: unknown, sourceCommit: string): Phase3SourceCi & { complete: boolean } {
  const row = object(value, ["repository", "workflow", "branch", "runId", "sourceCommit", "event", "url", "conclusion", "jobs"], "ci-shape") as unknown as Phase3SourceCi;
  check(row.repository === "YNWAforever/Remix-Adfocate" && row.workflow === "CI" && typeof row.runId === "string" && /^[1-9][0-9]{0,19}$/.test(row.runId)
    && row.url === `https://github.com/${row.repository}/actions/runs/${row.runId}` && row.sourceCommit === sourceCommit, "ci-binding");
  check(["push", "pull_request", "workflow_dispatch"].includes(row.event) && typeof row.branch === "string" && /^[a-zA-Z0-9_./-]{1,150}$/.test(row.branch)
    && ["success", "failure", "cancelled", "timed_out"].includes(row.conclusion), "ci-shape");
  check(Array.isArray(row.jobs) && row.jobs.length === 3 && new Set(row.jobs.map(job => job.name)).size === 3, "ci-shape");
  for (const job of row.jobs) { object(job, ["name", "sourceCommit", "conclusion"], "ci-shape"); check(JOBS.includes(job.name) && job.sourceCommit === sourceCommit && ["success", "failure", "cancelled", "timed_out", "skipped"].includes(job.conclusion), "ci-binding"); }
  return { ...row, jobs: row.jobs.map(job => ({ ...job })), complete: row.event === "push" && row.branch === "main" && row.conclusion === "success" && row.jobs.every(job => job.conclusion === "success") };
}
const ROOT_PAIRED_KEYS = ["schemaVersion", "kind", "status", "validReleaseEvidence", "productionEquivalent", "sourceLedgerSynthetic", "sourceCommitSynthetic", "providerAuthTested", "databaseRoleFixtureSuperuser", "startedAt", "finishedAt", "serverVersionNum", "dumpVersion", "serverImage", "toolImage", "sourceRowValuesPublic", "archiveContentsPublic", "ownedSourceAndTargetsCleanup", "codeInputs", "inputHashesUnchanged", "physicalEnumOidsDiffer", "cases", "pairedObservation", "storageObjectBytesCovered", "rolePasswordsCovered", "platformEncryptionKeysCovered", "walPitrCovered", "extensionBinariesRecoveredFromArchive", "contentDigest"];
const PAIRED_KEYS = ["schemaVersion", "kind", "status", "validReleaseEvidence", "projectRef", "sourceCommit", "scopeDigest", "targetBindingHash", "sourceSnapshotBindingHash", "sourceBefore", "restoredBefore", "artifacts", "captureStartedAt", "captureFinishedAt", "restoreStartedAt", "restoreFinishedAt", "measuredRestoreMilliseconds", "expiresAt", "snapshotConsistency", "globalStateBeforeHash", "globalStateAfterHash", "toolProfileHash", "changeControlReferenceHash", "sourceCleanupConfirmed", "ownedContainerCleanup", "coverage", "reference", "manifestSha256", "contentDigest"];
const FAULT_CASES = [{ name: "none", result: "ACTUAL_PRIVATE_ARCHIVE_RESTORED_EQUAL" }, { name: "restored-row", stage: "restored-inspection" }, { name: "restored-sequence", stage: "restored-inspection" }, { name: "restored-role", stage: "restored-inspection" }, { name: "restored-schema", stage: "restored-inspection" }, { name: "archive-tamper", stage: "private-read" }, { name: "restore-error", stage: "restore" }, { name: "source-sequence", stage: "source-after" }, { name: "source-role", stage: "source-after" }];
function paired(value: Record<string, unknown>, current: Record<string, string>, preparedAt: number): PairedRecoveryObservation {
  const root = object(value, ROOT_PAIRED_KEYS, "paired-shape"); verifyRoot(root, "paired-digest"); sourceMap(root.codeInputs, PHASE3_PAIRED_SOURCE_PATHS, current);
  check(root.schemaVersion === 1 && root.kind === "owned-native-paired-recovery-rehearsal" && root.status === "NATIVE_FIXTURE_PASSED_RELEASE_HOLD", "paired-markers");
  for (const key of ["sourceLedgerSynthetic", "sourceCommitSynthetic", "databaseRoleFixtureSuperuser", "inputHashesUnchanged", "physicalEnumOidsDiffer"]) check(root[key] === true, "paired-markers");
  for (const key of ["validReleaseEvidence", "productionEquivalent", "providerAuthTested", "sourceRowValuesPublic", "archiveContentsPublic", "storageObjectBytesCovered", "rolePasswordsCovered", "platformEncryptionKeysCovered", "walPitrCovered", "extensionBinariesRecoveredFromArchive"]) check(root[key] === false, "paired-markers");
  check(root.ownedSourceAndTargetsCleanup === "confirmed", "paired-cleanup"); check(root.serverVersionNum === "170006" && root.dumpVersion === "17.11", "paired-markers");
  for (const key of ["serverImage", "toolImage"]) check(typeof root[key] === "string" && /^public\.ecr\.aws\/supabase\/postgres@sha256:[a-f0-9]{64}$/.test(root[key] as string), "paired-markers");
  const start = timestamp(root.startedAt, "paired-time"), finish = timestamp(root.finishedAt, "paired-time"); check(start < finish && finish <= preparedAt, "paired-time");
  check(Array.isArray(root.cases) && root.cases.length === 9, "paired-cases"); const seen = new Set<string>();
  for (const raw of root.cases) {
    check(raw && typeof raw === "object", "paired-cases"); const name = (raw as Record<string, unknown>).case, expected = FAULT_CASES.find(item => item.name === name);
    check(expected && !seen.has(expected.name), "paired-cases"); seen.add(expected.name);
    const fault = name === "archive-tamper" || name === "restore-error";
    const row = object(raw, ["case", "result", ...(expected.stage ? ["stage"] : []), ...(fault ? ["faultEvidence"] : [])], "paired-cases");
    check(row.result === (expected.result ?? "REJECTED_HOLD") && (!expected.stage || row.stage === expected.stage), "paired-cases");
    if (name === "archive-tamper") equal(object(row.faultEvidence, ["archiveCopyTamperedAfterRead", "roleInputDelivered", "restoreAttempted"], "paired-fault-prerequisite"), { archiveCopyTamperedAfterRead: true, roleInputDelivered: true, restoreAttempted: false }, "paired-fault-prerequisite");
    if (name === "restore-error") equal(object(row.faultEvidence, ["templateFaultAcknowledged", "restoreCommandSpawned", "expectedTemplateDropErrorObserved"], "paired-fault-prerequisite"), { templateFaultAcknowledged: true, restoreCommandSpawned: true, expectedTemplateDropErrorObserved: true }, "paired-fault-prerequisite");
  }
  const observation = object(root.pairedObservation, PAIRED_KEYS, "paired-shape") as unknown as PairedRecoveryObservation;
  verifyRoot(observation as unknown as Record<string, unknown>, "paired-digest");
  const { contentDigest: ignoredDigest, reference: ignoredReference, manifestSha256, ...manifest } = observation;
  void ignoredDigest; void ignoredReference; check(manifestSha256 === digestDeltaProofPayload(manifest), "paired-digest");
  check(observation.schemaVersion === 1 && observation.kind === "paired-snapshot-recovery-observation" && observation.status === "HOLD" && observation.validReleaseEvidence === false && observation.projectRef === DELTA_RELEASE_PROJECT
    && COMMIT.test(observation.sourceCommit) && /^private-recovery:[a-f0-9-]{36}$/.test(observation.reference), "paired-markers");
  for (const key of ["scopeDigest", "targetBindingHash", "sourceSnapshotBindingHash", "toolProfileHash", "changeControlReferenceHash", "manifestSha256"] as const) hash(observation[key], "paired-shape");
  check(observation.sourceCleanupConfirmed === true && observation.ownedContainerCleanup === "confirmed", "paired-cleanup");
  check(observation.snapshotConsistency === "exported-database-snapshot-with-global-state-recheck", "paired-markers");
  const captureStart = timestamp(observation.captureStartedAt, "paired-time"), captureEnd = timestamp(observation.captureFinishedAt, "paired-time"), restoreStart = timestamp(observation.restoreStartedAt, "paired-time"), restoreEnd = timestamp(observation.restoreFinishedAt, "paired-time"), expiry = timestamp(observation.expiresAt, "paired-time");
  check(start <= captureStart && captureStart < captureEnd && captureEnd === restoreStart && restoreStart < restoreEnd && restoreEnd <= finish && expiry > restoreEnd && expiry - captureStart <= 900_000, "paired-time");
  integer(observation.measuredRestoreMilliseconds, 600_000, "paired-time", 1); check(observation.measuredRestoreMilliseconds === restoreEnd - restoreStart && captureEnd - captureStart <= 600_000, "paired-time");
  equal(observation.coverage, [...["database-schema", "database-rows", "role-definitions-without-passwords", "storage-configuration"].map(category => ({ category, result: "verified" })), ...["storage-object-bytes", "role-passwords", "platform-encryption-keys", "wal-pitr", "extension-binaries"].map(category => ({ category, result: "not-covered" }))], "paired-markers");
  check(Array.isArray(observation.artifacts) && observation.artifacts.length === 3, "paired-shape");
  equal(observation.artifacts.map(item => item.name).sort(), ["database.dump", "roles.sql", "toc.list"], "paired-shape");
  for (const item of observation.artifacts) { object(item, ["name", "bytes", "sha256"], "paired-shape"); integer(item.bytes, 64 * 1024 * 1024, "paired-shape", 1); hash(item.sha256, "paired-shape"); }
  for (const [inspection, lower, upper] of [[observation.sourceBefore, captureStart, captureEnd], [observation.restoredBefore, restoreStart, restoreEnd]] as const) {
    object(inspection, ["fingerprint", "data", "globalStateHash"], "paired-shape"); const fp: DeltaSemanticFingerprint = inspection.fingerprint;
    check(fp.rootSha256 === digestDeltaSemanticFingerprint(fp) && fp.scopeDigest === observation.scopeDigest && fp.collectorSha256 === current["scripts/release/delta-semantic-capture.sql"] && fp.canonicalizerSha256 === current["scripts/release/delta-fingerprint.ts"] && fp.components.length === DELTA_EXPORT_COMPONENTS.length, "paired-semantic");
    const observed = timestamp(fp.observedAt, "paired-time"); check(observed >= lower && observed <= upper && timestamp(fp.expiresAt, "paired-time") === expiry, "paired-time");
    check(fp.components.find(item => item.category === "migration-history")?.objectCount === 17, "paired-semantic");
    const global = digestDeltaProofPayload(fp.components.filter(component => ["roles-and-memberships", "database-role-settings"].includes(component.category)).slice().sort((left, right) => left.category < right.category ? -1 : 1));
    check(inspection.globalStateHash === global && global === observation.globalStateBeforeHash && global === observation.globalStateAfterHash, "paired-semantic");
    const data = object(inspection.data, ["algorithm", "collectorSha256", "normalizerSha256", "rootSha256", "rowCount", "sequenceCount", "tableCount"], "paired-data");
    check(data.algorithm === "pg17-portable-data-v1" && data.collectorSha256 === current["scripts/release/delta-recovery-data.sql"] && data.normalizerSha256 === current["scripts/release/delta-recovery-data.ts"], "paired-data");
    hash(data.rootSha256, "paired-data"); integer(data.rowCount, Number.MAX_SAFE_INTEGER, "paired-data", 1); integer(data.tableCount, 10_000, "paired-data", 1); integer(data.sequenceCount, 10_000, "paired-data", 1);
  }
  const before: PairedRecoveryInspection = observation.sourceBefore, restored = observation.restoredBefore;
  check(before.fingerprint.targetBindingHash === observation.targetBindingHash && before.fingerprint.snapshotBindingHash === observation.sourceSnapshotBindingHash
    && restored.fingerprint.targetBindingHash !== observation.targetBindingHash && restored.fingerprint.snapshotBindingHash !== observation.sourceSnapshotBindingHash, "paired-semantic");
  check(before.fingerprint.rootSha256 === restored.fingerprint.rootSha256, "paired-semantic"); equal(before.data, restored.data, "paired-data");
  check(root.contentDigest === PHASE3_PAIRED_RECEIPT_DIGEST, "paired-digest"); return observation;
}
const MISSING: Record<DeltaRequiredGate, readonly string[]> = {
  "source-integrity": ["Independent acceptance of the combined delta, exact source and migration-history freeze."],
  "target-binding": ["Fresh fixed-project identity and deployment/database binding for the approved release target."],
  "reviewed-baseline-equivalence": ["Reviewed reference baseline and complete before/after/replay equivalence for the target scope."],
  "empty-rehearsal": ["Accepted empty-target combined baseline/delta rehearsal with reviewed capability and transaction invariants."],
  "shaped-rehearsal": ["Accepted production-shaped combined baseline/delta rehearsal with complete semantic and data invariants."],
  "identical-replay": ["Accepted identical replay proof with same-database tuple, catalog, data and ACL receipts."],
  "legacy-integration": ["Historical NULL-mode provider join and actual legacy reward issuance remain uncovered.", "Independent legacy integration and immutable issued-history acceptance."],
  "active-mission": ["Independent acceptance of the active lifecycle and target-specific invariant coverage."],
  "reward-handoff": ["Actual active reward settlement and owner acceptance; a pending reward does not prove settlement."],
  "provider-auth-role-mfa": ["Live target-specific Auth, database roles and MFA acceptance; owned local sessions do not assign release roles."],
  "api-database-binding": ["Live approved application/API/database commit and target binding acceptance."],
  "storage-api": ["Target-specific Storage acceptance, cross-tenant writes, signed capability transfer, overwrite/delete and object-byte recovery."],
  "fresh-recovery": ["Fresh target snapshot/restore, accepted RPO/RTO and recovery owner/report set.", "Object bytes, role credentials, encryption keys, WAL/PITR and extension binaries remain uncovered."],
  "production-deployment": ["Approved production deployment, containment and forward-recovery plans and independent acceptance."],
  "source-ci": ["Independent source-CI gate acceptance and protected policy verification; green jobs confer no release authority."],
  "schema-change-control": ["Accepted live freeze, executor/observer/containment/product/approver roles, report set and outer approval."],
};
function observations(gate: DeltaRequiredGate, providerComplete: boolean, ciComplete: boolean): string[] {
  if (gate === "source-integrity") return ["All supplied current public code bytes match provider and paired-recovery input hashes."];
  if (gate === "fresh-recovery") return ["Nine native fixture cases include acknowledged archive-tamper and restore-error prerequisites.", "All seven semantic components and complete portable-data summaries compare equal; fixture cleanup is confirmed."];
  if (gate === "source-ci") return [ciComplete ? "Supplied exact-subject main push CI records all three successful jobs." : "A complete successful exact-subject main push CI run is missing."];
  if (["legacy-integration", "active-mission", "reward-handoff", "provider-auth-role-mfa", "api-database-binding", "storage-api"].includes(gate)) return [providerComplete ? ({ "legacy-integration": "Owned provider legacy +10 XP and neutral bounded resubmission; preseeded fixture history is preserved.", "active-mission": "Owned provider active join +0 XP, quota, draft revision, publication approval and proof correction/verification.", "reward-handoff": "Owned provider completion creates exactly one pending reward; replay leaves balances, budget and issued ledgers unchanged.", "provider-auth-role-mfa": "Owned local Auth sessions, negative controls and actual TOTP AAL2 HTTP journeys.", "api-database-binding": "Original application HTTP uses the newly owned loopback provider stack.", "storage-api": "Owned local Storage signed uploads, access isolation and MIME/size controls." } as Record<string, string>)[gate]! : "The supplied owned provider attempt is incomplete; no provider case is counted as passing."];
  return ["The supplied local engineering observations do not establish this gate's independent live acceptance."];
}
export function buildPhase3ReviewPacket(input: Phase3ReviewPacketInput): Phase3ReviewPacket {
  try {
    object(input, ["sourceCommit", "preparedAt", "provider", "pairedRecovery", "sourceCi", "currentSources"], "input-shape"); check(COMMIT.test(input.sourceCommit), "input-shape");
    const preparedAt = timestamp(input.preparedAt, "input-shape"), current = sources(input.currentSources);
    const providerArtifact = artifact(input.provider, "provider"), recoveryArtifact = artifact(input.pairedRecovery, "pairedRecovery"), ciArtifact = artifact(input.sourceCi, "sourceCi");
    const provider: ProviderObservation = validateProviderObservation(providerArtifact.report); check(provider.sourceCommit === input.sourceCommit && timestamp(provider.finishedAt, "provider-binding") <= preparedAt, "provider-binding");
    check(input.provider.path === `docs/verification/phase3-provider-rehearsal/owned-${provider.sourceCommit.slice(0, 12)}-${provider.runId}.json`, "provider-binding");
    sourceMap(provider.codeHashes, PHASE3_PROVIDER_SOURCE_PATHS, current); const recovery = paired(recoveryArtifact.report, current, preparedAt), sourceCi = ci(ciArtifact.report, input.sourceCommit);
    if (provider.engineeringStatus === "passed") check(provider.ownedStack?.applicationOrigin && provider.ownedStack.applicationOrigin !== provider.ownedStack.apiOrigin, "provider-binding");
    const providerComplete = provider.engineeringStatus === "passed" && provider.checks.length === 27 && provider.checks.length === PROVIDER_CASE_NAMES.length;
    const payload = { schemaVersion: 1 as const, kind: "phase3-review-packet" as const, status: "HOLD" as const, accepted: false as const, ownerAccepted: false as const, validReleaseEvidence: false as const, productionEquivalent: false as const,
      engineeringStatus: providerComplete && sourceCi.complete ? "complete" as const : "incomplete" as const, sourceCommit: input.sourceCommit, preparedAt: input.preparedAt,
      inputs: { provider: providerArtifact.binding, pairedRecovery: recoveryArtifact.binding, sourceCi: ciArtifact.binding }, currentCodeHashes: current,
      provider: { complete: providerComplete, validatedPassedCases: providerComplete ? 27 : 0, cleanupConfirmed: provider.cleanup.application === "verified" && provider.cleanup.namespace === "verified", notCovered: [...provider.notCovered] },
      recovery: { nativeCases: 9 as const, semanticComponents: 7 as const, portableDataEqual: true as const, cleanupConfirmed: true as const, fixtureRestoreMilliseconds: recovery.measuredRestoreMilliseconds,
        sourceLedgerSynthetic: true as const, sourceCommitSynthetic: true as const, productionFreshnessAccepted: false as const }, sourceCi,
      ownerInputs: { rpoSeconds: null, rtoSeconds: null, freeze: null, roles: null, reportSet: null, outerApproval: null },
      gates: DELTA_REQUIRED_GATES.map(gate => ({ gate, status: "HOLD" as const, accepted: false as const, observations: observations(gate, providerComplete, sourceCi.complete), missing: [...MISSING[gate], ...(!providerComplete && ["legacy-integration", "active-mission", "reward-handoff", "provider-auth-role-mfa", "api-database-binding", "storage-api"].includes(gate) ? ["Complete validated owned-provider CLI observation with all 27 cases and confirmed cleanup."] : []), ...(!sourceCi.complete && gate === "source-ci" ? ["Exact-subject main push CI with build-test, integration and provider-acceptance all successful."] : [])] })),
      limitations: ["Review-only engineering inputs; all sixteen gates remain HOLD and accepted=false.", "Hashes bind supplied bytes. The preparer must authenticate provenance; the offline adapter verifies subject ancestry.", "Recovery uses a synthetic source ledger/commit and local fixture superuser; it is not a production restore or accepted RPO/RTO.", "NULL schema guard is not a historical NULL provider join; preseeded issued history is not actual issuance; pending is not settlement.", "Blocked/unavailable external metadata and synthetic manual review do not establish external publication.", "Local loopback provider/container networking does not prove container egress firewall protection or production equivalence."], protectedV2ParserRejected: true as const };
    const packet = { ...payload, contentDigest: digestDeltaProofPayload(payload) }; const parsed = parseDeltaEvidence(packet); check(!parsed.evidence && parsed.errors.length > 0, "protected-parser"); return packet;
  } catch (error) { if (error instanceof Phase3ReviewPacketFailure) throw error; throw new Phase3ReviewPacketFailure("review-rejected"); }
}
