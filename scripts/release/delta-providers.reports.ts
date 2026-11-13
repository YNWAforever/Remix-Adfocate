import { lstat, readFile, realpath } from "node:fs/promises";
import { assertSanitized } from "./evidence";
import { canonicalDeltaJson, digestDeltaProofPayload } from "./delta-evidence";
import { deltaGateReportSetHash, type DeltaResolvedProofs } from "./delta-executor";
import { DELTA_RELEASE_PROJECT, DELTA_REQUIRED_GATES, type DeltaExpectedContext, type DeltaReleaseEvidence, type DeltaRequiredGate } from "./delta-release-contracts";
import { verifyEvidenceFilePath, validateSourceCi, type DeltaProvenanceReport } from "./delta-provenance";

function refused(reason: string): never { throw new Error(`protected gate reports rejected: ${reason}`); }
export interface DeltaOwnerProofAcceptance {
  readonly schemaVersion: 1;
  readonly acceptedReportSetHash: string;
  readonly acceptedByGitHubActorId: string;
  readonly acceptanceReference: string;
}
const PRODUCERS: Record<DeltaRequiredGate, string> = {
  "source-integrity": "repo-source-validator", "target-binding": "managed-readonly-pg17", "reviewed-baseline-equivalence": "native-reviewed-reference-pg17",
  "empty-rehearsal": "native-reviewed-reference-pg17", "shaped-rehearsal": "native-restored-pg17", "identical-replay": "native-restored-pg17",
  "legacy-integration": "provider-rehearsal", "active-mission": "provider-rehearsal", "reward-handoff": "provider-rehearsal",
  "provider-auth-role-mfa": "provider-rehearsal", "api-database-binding": "hosted-readonly-api", "storage-api": "provider-rehearsal",
  "fresh-recovery": "native-private-recovery", "production-deployment": "github-vercel-reader", "source-ci": "github-actions-ci",
  "schema-change-control": "owner-change-control",
};
const CHECKS: Record<DeltaRequiredGate, readonly string[]> = {
  "source-integrity": ["complete-67-source-integrity", "reviewed-62-lineage", "deferred-absence", "retired-constraint"],
  "target-binding": ["pinned-project-route", "verify-full-ca", "postgres-session-identity"],
  "reviewed-baseline-equivalence": ["source-reference-full-root", "source-restored-full-root", "source-restored-row-data"],
  "empty-rehearsal": ["reviewed-reference-forward-delta", "complete-after-root"],
  "shaped-rehearsal": ["restored-before-root", "bounded-delta", "unchanged-catalog-data-acl", "complete-after-root"],
  "identical-replay": ["exact-source-archive", "history-17-18-18", "unchanged-function-and-ledger-tuples", "complete-after-root"],
  "legacy-integration": ["legacy-join-xp-ten", "null-mode-join-xp-ten", "prior-awards-preserved", "legacy-submit-review-rewards"],
  "active-mission": ["active-join-xp-zero", "active-accept-xp-zero", "quota-and-replay", "no-backfill-or-clawback"],
  "reward-handoff": ["reward-snapshot-preserved", "no-publication", "no-pilot-enablement"],
  "provider-auth-role-mfa": ["provider-issued-signed-sessions", "revoked-session-denied", "tenant-role-denial", "aal1-denied-aal2-authorized", "actual-http-roundtrips"],
  "api-database-binding": ["api-issuer-project", "api-target-database", "deployed-api-authority"],
  "storage-api": ["actual-storage-http", "anonymous-and-cross-owner-denial", "mime-size-policy"],
  "fresh-recovery": ["paired-exported-snapshot", "global-state-recheck", "complete-archive-read", "owned-native-restore", "source-restored-row-data", "cleanup"],
  "production-deployment": ["source-ci", "vercel-production-ready", "canonical-alias-binding", "api-health"],
  "source-ci": ["build-test", "integration"],
  "schema-change-control": ["all-ddl-writers-frozen", "global-and-sequence-control", "window-through-postflight", "named-containment-owner"],
};
function object(value: unknown, keys: readonly string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) refused("closed report object");
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== keys.length || keys.some(key => !Object.hasOwn(row, key))) refused("unknown or missing report fields");
  return row;
}
export function deltaExpectedGateFacts(gate: DeltaRequiredGate, e: DeltaReleaseEvidence, c: DeltaExpectedContext): Record<string, unknown> {
  switch (gate) {
    case "source-integrity": return { manifestDigest: c.manifestDigest, sourceCount: 67, baselineSourceCount: 62, baselineRows: 17,
      requiredCapabilitiesHash: c.requiredCapabilitiesHash, requiredCapabilityCount: c.requiredCapabilityCount, deferredSourceCount: 2 };
    case "target-binding": return { projectRef: DELTA_RELEASE_PROJECT, targetBindingHash: c.targetBindingHash, databaseName: "postgres", serverVersionNum: "170006", sslMode: "verify-full" };
    case "reviewed-baseline-equivalence": return { sourceBeforeRoot: c.beforeRoot, referenceBeforeRoot: c.beforeRoot, restoredBeforeRoot: c.beforeRoot, sourceRestoredDataEqual: true };
    case "empty-rehearsal": return { referenceBeforeRoot: c.beforeRoot, afterRoot: c.afterRoot, migrationRowsAfter: 18 };
    case "shaped-rehearsal": return { restoredBeforeRoot: c.beforeRoot, afterRoot: c.afterRoot, catalogReceiptHash: e.equivalence.unchangedCatalogReceiptHash,
      dataReceiptHash: e.equivalence.unchangedDataReceiptHash, attributesAclReceiptHash: e.equivalence.targetAttributesAclReceiptHash };
    case "identical-replay": return { afterRoot: c.afterRoot, migrationRowsBefore: 17, migrationRowsFirst: 18, migrationRowsReplay: 18, replayTupleReceiptHash: e.equivalence.replayTupleReceiptHash };
    case "legacy-integration": return { ordinaryJoinXp: 10, nullModeJoinXp: 10, priorAwardsPreserved: true, submitAndReviewRewardsPassed: true };
    case "active-mission": return { joinXp: 0, acceptXp: 0, quotaAndReplayPassed: true, backfillRows: 0, clawbackRows: 0 };
    case "reward-handoff": return { rewardSnapshotPreserved: true, rewardMutations: 0, publicationAttempts: 0, pilotEnables: 0 };
    case "provider-auth-role-mfa": return { providerIssuedSessions: true, signaturesVerified: true, revokedSessionDenied: true, tenantRoleDenialsPassed: true,
      aal1Denied: true, aal2Authorized: true, actualHttpRoundtrips: true, sqlRoleOrForgedSessionSubstitute: false };
    case "api-database-binding": return { apiProjectRef: DELTA_RELEASE_PROJECT, issuerProjectRef: DELTA_RELEASE_PROJECT, databaseTargetBindingHash: c.targetBindingHash, deployedApiAuthorityVerified: true };
    case "storage-api": return { actualHttpRoundtrips: true, anonymousDenied: true, crossOwnerDenied: true, mimeAndSizePolicyPassed: true };
    case "fresh-recovery": return { reference: c.recoveryReference, manifestSha256: e.recovery.manifestSha256, sourceSnapshotBindingHash: e.recovery.sourceSnapshotBindingHash,
      toolProfileHash: c.recoveryToolProfileHash, restoreReceiptHash: e.recovery.restoreReceiptHash, snapshotConsistency: e.recovery.snapshotConsistency,
      globalStateBeforeHash: e.recovery.globalStateBeforeHash, globalStateAfterHash: e.recovery.globalStateAfterHash, acceptedBy: c.recoveryAcceptedBy,
      rpoSeconds: e.recovery.rpoSeconds, rtoSeconds: e.recovery.rtoSeconds, cleanup: "confirmed" };
    case "production-deployment": return { sourceCommit: c.sourceCommit, environment: "production", sourceCiPassed: true, canonicalAliasVerified: true, apiHealthPassed: true };
    case "source-ci": return {};
    case "schema-change-control": return { allDdlWritersFrozen: true, globalCatalogControlled: true, sequenceAndApplicationWritersQuiesced: true, deploymentsAndConfigurationFrozen: true,
      controlUntil: e.gates.find(value => value.gate === gate)!.expiresAt, containmentOwner: c.roles.containmentOwner };
  }
}

export function checkAcceptedDeltaGatePayload(gate: DeltaRequiredGate, value: unknown, e: DeltaReleaseEvidence, c: DeltaExpectedContext, now: Date) {
  assertSanitized(value);
  if (gate === "source-ci") {
    // Its exact normalized payload is independently re-read from GitHub by provenance.
    return validateSourceCi(value as Parameters<typeof validateSourceCi>[0], c.sourceCommit, now);
  }
  const report = object(value, ["schemaVersion", "kind", "gate", "status", "scopeDigest", "sourceCommit", "targetBindingHash", "observedAt", "expiresAt", "producer", "checks", "facts", "warnings", "skippedChecks"]);
  const approved = e.gates.find(value => value.gate === gate)!;
  if (report.schemaVersion !== 1 || report.kind !== "protected-delta-gate-report" || report.gate !== gate || report.status !== "passed"
    || report.scopeDigest !== c.scopeDigest || report.sourceCommit !== c.sourceCommit || report.targetBindingHash !== c.targetBindingHash
    || report.observedAt !== approved.observedAt || report.expiresAt !== approved.expiresAt
    || !Array.isArray(report.warnings) || report.warnings.length || !Array.isArray(report.skippedChecks) || report.skippedChecks.length) refused("gate identity, binding or incomplete outcome");
  const producer = object(report.producer, ["kind", "sourceCommit"]);
  if (producer.kind !== PRODUCERS[gate] || producer.sourceCommit !== c.sourceCommit) refused("declared producer class");
  if (!Array.isArray(report.checks) || report.checks.length !== CHECKS[gate].length) refused("complete check coverage");
  const checks = report.checks.map(value => {
    const check = object(value, ["name", "status", "evidenceSha256"]);
    if (typeof check.name !== "string" || check.status !== "passed" || typeof check.evidenceSha256 !== "string" || !/^[a-f0-9]{64}$/.test(check.evidenceSha256)) refused("failed, unknown or unhashed check");
    return check.name;
  });
  if (new Set(checks).size !== checks.length || canonicalDeltaJson([...checks].sort()) !== canonicalDeltaJson([...CHECKS[gate]].sort())) refused("check matrix mismatch");
  if (canonicalDeltaJson(report.facts) !== canonicalDeltaJson(deltaExpectedGateFacts(gate, e, c))) refused("approved gate facts mismatch");
  return digestDeltaProofPayload(value);
}

export interface DeltaAcceptedReportDeps {
  readonly readCommittedProof: (hash: string) => Promise<unknown>;
  readonly currentDeployment: (allowedCommits: readonly string[]) => Promise<{ readonly commit: string }>;
}
/**
 * Hashes authenticate bytes only. Native/provider rehearsal facts require the
 * named protected reviewer to accept this exact report set via independent policy.
 * Source CI and the current production deployment are also re-read live.
 */
export async function resolveOwnerAcceptedDeltaReports(e: DeltaReleaseEvidence, c: DeltaExpectedContext, p: DeltaProvenanceReport,
  acceptance: DeltaOwnerProofAcceptance, deps: DeltaAcceptedReportDeps, now: Date): Promise<DeltaResolvedProofs> {
  object(acceptance, ["schemaVersion", "acceptedReportSetHash", "acceptedByGitHubActorId", "acceptanceReference"]);
  const setHash = deltaGateReportSetHash(e);
  if (acceptance.schemaVersion !== 1 || acceptance.acceptedReportSetHash !== setHash || acceptance.acceptedByGitHubActorId !== p.approvedByGitHubActorId
    || !/^\d+$/.test(acceptance.acceptedByGitHubActorId) || !acceptance.acceptanceReference?.trim() || /<|>|TODO|TBD/i.test(acceptance.acceptanceReference)) refused("authenticated owner acceptance unavailable");
  for (const gate of DELTA_REQUIRED_GATES) {
    const binding = e.gates.find(value => value.gate === gate)!;
    const payload = await deps.readCommittedProof(binding.reportSha256);
    if (checkAcceptedDeltaGatePayload(gate, payload, e, c, now) !== binding.reportSha256) refused("committed proof payload digest");
  }
  const sourceCi = e.gates.find(value => value.gate === "source-ci")!.reportSha256;
  if (sourceCi !== p.sourceCiReportHash) refused("actual source CI report");
  const deployed = await deps.currentDeployment(p.permittedDeploymentCommits);
  if (!p.permittedDeploymentCommits.includes(deployed.commit)) refused("actual deployed source bytes");
  return { reportSetHash: setHash, sourceCiReportHash: sourceCi, deploymentCommit: deployed.commit, targetBindingHash: c.targetBindingHash };
}

export function committedDeltaProofReader(rootDir: string) {
  return async (hash: string) => {
    if (!/^[a-f0-9]{64}$/.test(hash)) refused("proof address");
    const path = await verifyEvidenceFilePath(rootDir, `docs/verification/releases/proofs/${hash}.json`, { lstat, realpath });
    const stat = await lstat(path);
    if (stat.size < 1 || stat.size > 2 * 1024 * 1024) refused("proof artifact bound");
    let value: unknown;
    try { value = JSON.parse(await readFile(path, "utf8")); } catch { return refused("proof artifact JSON"); }
    return value;
  };
}
