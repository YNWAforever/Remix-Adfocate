import { createHash } from "node:crypto";
import { buildEvidence } from "./evidence";
import {
  DELTA_BASELINE_HISTORY_SHA256, DELTA_COMBINED_SQL_SHA256, DELTA_EXPORT_COMPONENTS, DELTA_RECOVERY_CATEGORIES,
  DELTA_RELEASE_PROFILE, DELTA_RELEASE_PROJECT, DELTA_REQUIRED_GATES, DELTA_REVIEWED_PACKET_SHA256, DELTA_SOURCE_SHA256,
} from "./delta-release-contracts";
import type { DeltaEquivalenceProof, DeltaExpectedContext, DeltaRecoveryProof, DeltaReleaseEvidence, DeltaReleasePlan, DeltaSemanticFingerprint } from "./delta-release-contracts";
import {
  buildDeltaEvidence, digestDeltaEquivalenceProof, digestDeltaPlan, digestDeltaProofPayload, digestDeltaSemanticFingerprint,
} from "./delta-evidence";

// Entirely synthetic payloads and expected context. No provider authentication,
// owner approval, target access, native execution, or real release evidence.
// No test-framework imports: consumers can reuse this without registering tests.
const NOW = new Date("2026-11-13T16:00:00.000Z");
const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const h = (label: string) => sha(`synthetic-delta-evidence/${label}`);
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60000).toISOString();
const roles = { executor: "fixture-executor", observer: "fixture-observer", containmentOwner: "fixture-containment",
  productOwner: "fixture-product", approver: "fixture-approver" };
const mandatory = ["database-schema", "database-rows", "role-definitions-without-passwords", "storage-configuration"] as const;
const fpNames = ["sourceBefore", "reviewedReferenceBefore", "restoredBefore", "emptyAfter", "shapedAfter", "replayAfter"] as const;
export {
  NOW as DELTA_FIXTURE_NOW, h as deltaFixtureHash, at as deltaFixtureAt,
  mandatory as DELTA_FIXTURE_MANDATORY_RECOVERY, fpNames as DELTA_FIXTURE_FINGERPRINT_NAMES,
};

function fp(phase: "before" | "after", target: string, minutes: number): DeltaSemanticFingerprint {
  const value: Omit<DeltaSemanticFingerprint, "rootSha256"> = {
    schemaVersion: 1, algorithm: "pg17-canonical-export-v1", scopeDigest: h("scope"), collectorSha256: h("collector"), canonicalizerSha256: h("canonicalizer"),
    targetBindingHash: h(target), snapshotBindingHash: h(`snapshot/${target}/${phase}`), observedAt: at(minutes), expiresAt: at(25),
    environment: { serverVersionNum: "170006", dumpVersion: "17.11", extensionProfileHash: h("extensions"), databaseName: "postgres" },
    components: DELTA_EXPORT_COMPONENTS.map(category => ({ category, coverage: "complete", objectCount: category === "migration-history" ? (phase === "before" ? 17 : 18) : 5,
      sha256: h(`${category}/${phase === "after" && ["schema-export", "migration-history"].includes(category) ? "after" : "before"}`) })),
  };
  return { ...value, rootSha256: digestDeltaSemanticFingerprint(value) };
}

export function makeDeltaReleaseFixture(): { evidence: DeltaReleaseEvidence; context: DeltaExpectedContext } {
  const plan: DeltaReleasePlan = {
    schemaVersion: 1, kind: "combined-baseline-xp-delta-plan", profile: DELTA_RELEASE_PROFILE, targetProjectRef: DELTA_RELEASE_PROJECT,
    sourceCommit: h("source-commit").slice(0, 40), manifestDigest: h("manifest"), scopeDigest: h("scope"),
    baseline: { recordedRows: 17, historySha256: DELTA_BASELINE_HISTORY_SHA256, combinedVersion: "20261031201901", combinedName: "kocmax_studio_shared_review_c879b204",
      appliedSqlSha256: DELTA_COMBINED_SQL_SHA256, sourceEnvelopeCount: 62, successors: ["20261101075946", "20261113090000"] },
    delta: { version: "20261113090001", name: "active_assignment_xp_neutrality", sourceSha256: DELTA_SOURCE_SHA256, reviewedPacketSha256: DELTA_REVIEWED_PACKET_SHA256,
      executionProgramSha256: h("execution-program") },
    deferred: [
      { version: "20261103215321", sourceSha256: "76d30f9f3fbb296ab5c27589e42d304dcd8ed52bcc444ccb4c2189fe9fb0b22d", absenceProofHash: h("growth-absence") },
      { version: "20261104134202", sourceSha256: "d740d13d59e722548d4396639b62f9423ba1b287e42c639032c0f0de09a45eb7", absenceProofHash: h("publish-absence") },
    ],
    retiredConstraint: { removalVersion: "20260720193637", sourceSha256: "47db6932bbfe05aff34d6f91e2f8717ae3dd14c3ccf0041d5678ee29a8e16436", absenceProofHash: h("retired-fk-absence") },
    requiredCapabilitiesHash: h("required-capabilities"), requiredCapabilityCount: 886, targetBindingHash: h("source"), collectorSha256: h("collector"),
    canonicalizerSha256: h("canonicalizer"), invariantCollectorSha256: h("invariant-collector"),
  };
  const equivalence: DeltaEquivalenceProof = {
    schemaVersion: 1, kind: "reviewed-baseline-and-delta-equivalence", scopeDigest: h("scope"),
    sourceBefore: fp("before", "source", -11), reviewedReferenceBefore: fp("before", "reference", -10), restoredBefore: fp("before", "restored", -9),
    emptyAfter: fp("after", "reference", -8), shapedAfter: fp("after", "restored", -7), replayAfter: fp("after", "restored", -6),
    expectedAfterRoot: fp("after", "reference", -8).rootSha256, requiredCapabilitiesHash: h("required-capabilities"), requiredCapabilityCount: 886,
    transactionInvariantAlgorithm: "pg17-same-database-invariant-v1", transactionInvariantCollectorSha256: h("invariant-collector"),
    unchangedCatalogReceiptHash: h("unchanged-catalog-receipt"), unchangedDataReceiptHash: h("unchanged-data-receipt"),
    targetAttributesAclReceiptHash: h("target-attributes-acl-receipt"), replayTupleReceiptHash: h("replay-tuple-receipt"),
    allowedChanges: ["two-function-prosrc", "one-migration-history-row"], observedAt: at(-5), expiresAt: at(25),
  };
  const recovery: DeltaRecoveryProof = {
    schemaVersion: 1, kind: "verified-scoped-recovery", reference: "fixture-recovery-001", scopeDigest: h("scope"), targetBindingHash: h("source"),
    sourceSnapshotBindingHash: equivalence.sourceBefore.snapshotBindingHash, manifestSha256: h("backup-manifest"),
    artifacts: ["database.dump", "roles.sql", "toc.list"].map((name, index) => ({ name: name as DeltaRecoveryProof["artifacts"][number]["name"], bytes: 100 + index, sha256: h(`artifact/${name}`) })),
    captureStartedAt: at(-12), captureFinishedAt: at(-11), restoreStartedAt: at(-8), restoreFinishedAt: at(-4), expiresAt: at(25),
    restoreReceiptHash: h("restore-receipt"), sourceCloneEquivalenceHash: digestDeltaEquivalenceProof(equivalence), toolProfileHash: h("tool-profile"),
    ownedContainerCleanup: "confirmed", snapshotConsistency: "exported-database-snapshot-with-global-state-recheck", globalStateBeforeHash: h("global-state"), globalStateAfterHash: h("global-state"),
    coverage: DELTA_RECOVERY_CATEGORIES.map(category => ({ category, result: (mandatory as readonly string[]).includes(category) ? "verified" : "not-covered",
      acceptanceReference: `fixture-owner-acceptance/${category}` })),
    rpoSeconds: 1800, rtoSeconds: 300, containmentPlanHash: h("containment"), forwardRecoveryPlanHash: h("forward-recovery"), acceptedBy: "fixture-recovery-owner",
  };
  const gates = DELTA_REQUIRED_GATES.map(gate => ({ gate, status: "passed" as const, scopeDigest: plan.scopeDigest, sourceCommit: plan.sourceCommit,
    targetBindingHash: plan.targetBindingHash, reportSha256: h(`provider-report/${gate}`), observedAt: at(-3), expiresAt: at(25) }));
  const core = buildEvidence({ targetProjectRef: DELTA_RELEASE_PROJECT, schemaFingerprint: equivalence.sourceBefore.rootSha256, manifestDigest: plan.manifestDigest,
    preflightHash: digestDeltaProofPayload(equivalence.sourceBefore), rehearsalHash: digestDeltaEquivalenceProof(equivalence), applicationCommit: plan.sourceCommit,
    migrationRange: { from: plan.delta.version, to: plan.delta.version }, migrationChecksums: [{ version: plan.delta.version, sha256: plan.delta.sourceSha256 }],
    recoveryReference: recovery.reference, roles, testResults: gates.map(gate => ({ gate: gate.gate, status: "passed", evidenceHash: gate.reportSha256 })),
    proposedProductionCommands: ["release:delta:execute with protected workflow inputs"], containmentCommands: ["Use the owner-accepted forward recovery procedure"],
    warnings: [], skippedChecks: [], createdAt: at(-1), expiresAt: at(15) });
  const evidence = buildDeltaEvidence({ schemaVersion: 2, kind: "protected-bundled-xp-release", profile: DELTA_RELEASE_PROFILE, core, plan, equivalence, recovery,
    gates, warnings: [], skippedChecks: [] });
  const context: DeltaExpectedContext = {
    projectRef: DELTA_RELEASE_PROJECT, sourceCommit: plan.sourceCommit, manifestDigest: plan.manifestDigest, scopeDigest: plan.scopeDigest, planDigest: digestDeltaPlan(plan),
    targetBindingHash: plan.targetBindingHash, roles: { ...roles }, recoveryReference: recovery.reference, recoveryToolProfileHash: recovery.toolProfileHash, recoveryAcceptedBy: recovery.acceptedBy,
    containmentPlanHash: recovery.containmentPlanHash, forwardRecoveryPlanHash: recovery.forwardRecoveryPlanHash, collectorSha256: plan.collectorSha256,
    canonicalizerSha256: plan.canonicalizerSha256, invariantCollectorSha256: plan.invariantCollectorSha256, executionProgramSha256: plan.delta.executionProgramSha256,
    extensionProfileHash: equivalence.sourceBefore.environment.extensionProfileHash, requiredCapabilitiesHash: plan.requiredCapabilitiesHash, requiredCapabilityCount: 886,
    requiredRecoveryCoverage: [...mandatory], maximumEvidenceAgeMs: 5 * 60000, maximumEvidenceLifetimeMs: 30 * 60000, maximumProofAgeMs: 30 * 60000,
    maximumRpoSeconds: 1800, maximumRtoSeconds: 900, beforeRoot: equivalence.sourceBefore.rootSha256, afterRoot: equivalence.expectedAfterRoot,
  };
  return { evidence, context };
}
