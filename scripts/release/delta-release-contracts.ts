import type { ReleaseEvidence, ReleaseRoleAssignments } from "./contracts";

export const DELTA_RELEASE_PROFILE = "phase3-combined62-xp-v1" as const;
export const DELTA_RELEASE_PROJECT = "mhkoayftiuojxlrkollf" as const;
export const DELTA_SOURCE_SHA256 = "846cf3b5afd94d38f398170308f8e62c1f90f4a9a96b516d41f185986878bae2";
export const DELTA_REVIEWED_PACKET_SHA256 = "e7ce6a847f57d05d9efde376a2a774e9" + "f6b7310b3cb362fd979936a4891be9da";
export const DELTA_BASELINE_HISTORY_SHA256 = "8f73e44618f9af60644527e44e0a78e735d7d23fe1b9fc6fc64ee3e4dc339467";
export const DELTA_COMBINED_SQL_SHA256 = "9cbecbf1b4b68c476ed8d996f8f3d1c61408e46986584c22ab0111788cd9e5a5";
export const DELTA_REQUIRED_GATES = [
  "source-integrity", "target-binding", "reviewed-baseline-equivalence", "empty-rehearsal",
  "shaped-rehearsal", "identical-replay", "legacy-integration", "active-mission",
  "reward-handoff", "provider-auth-role-mfa", "api-database-binding", "storage-api",
  "fresh-recovery", "production-deployment", "source-ci", "schema-change-control",
] as const;
export type DeltaRequiredGate = typeof DELTA_REQUIRED_GATES[number];
export const DELTA_EXPORT_COMPONENTS = [
  "schema-export", "roles-and-memberships", "database-role-settings", "storage-configuration",
  "extension-configuration", "extension-members", "migration-history",
] as const;
export type DeltaExportComponent = typeof DELTA_EXPORT_COMPONENTS[number];

/** Cross-database comparison is deliberately distinct from V1's raw dump hash. */
export interface DeltaSemanticFingerprint {
  readonly schemaVersion: 1;
  readonly algorithm: "pg17-canonical-export-v1";
  readonly scopeDigest: string;
  readonly collectorSha256: string;
  readonly canonicalizerSha256: string;
  readonly targetBindingHash: string;
  readonly snapshotBindingHash: string;
  readonly observedAt: string;
  readonly expiresAt: string;
  readonly environment: {
    readonly serverVersionNum: "170006";
    readonly dumpVersion: "17.11";
    readonly extensionProfileHash: string;
    readonly databaseName: "postgres";
  };
  readonly components: readonly {
    readonly category: DeltaExportComponent;
    readonly coverage: "complete";
    readonly objectCount: number;
    readonly sha256: string;
  }[];
  readonly rootSha256: string;
}

/** OID/xmin are excluded across databases and retained only in same-database receipts. */
export interface DeltaEquivalenceProof {
  readonly schemaVersion: 1;
  readonly kind: "reviewed-baseline-and-delta-equivalence";
  readonly scopeDigest: string;
  readonly sourceBefore: DeltaSemanticFingerprint;
  readonly reviewedReferenceBefore: DeltaSemanticFingerprint;
  readonly restoredBefore: DeltaSemanticFingerprint;
  readonly emptyAfter: DeltaSemanticFingerprint;
  readonly shapedAfter: DeltaSemanticFingerprint;
  readonly replayAfter: DeltaSemanticFingerprint;
  readonly expectedAfterRoot: string;
  readonly requiredCapabilitiesHash: string;
  readonly requiredCapabilityCount: number;
  readonly transactionInvariantAlgorithm: "pg17-same-database-invariant-v1";
  readonly transactionInvariantCollectorSha256: string;
  readonly unchangedCatalogReceiptHash: string;
  readonly unchangedDataReceiptHash: string;
  readonly targetAttributesAclReceiptHash: string;
  readonly replayTupleReceiptHash: string;
  readonly allowedChanges: readonly ["two-function-prosrc", "one-migration-history-row"];
  readonly observedAt: string;
  readonly expiresAt: string;
}

export const DELTA_RECOVERY_CATEGORIES = [
  "database-schema", "database-rows", "role-definitions-without-passwords", "storage-configuration",
  "storage-object-bytes", "role-passwords", "platform-encryption-keys", "wal-pitr", "extension-binaries",
] as const;
export type DeltaRecoveryCategory = typeof DELTA_RECOVERY_CATEGORIES[number];
export interface DeltaRecoveryProof {
  readonly schemaVersion: 1;
  readonly kind: "verified-scoped-recovery";
  readonly reference: string;
  readonly scopeDigest: string;
  readonly targetBindingHash: string;
  readonly sourceSnapshotBindingHash: string;
  readonly manifestSha256: string;
  readonly artifacts: readonly { readonly name: "database.dump" | "roles.sql" | "toc.list"; readonly bytes: number; readonly sha256: string }[];
  readonly captureStartedAt: string;
  readonly captureFinishedAt: string;
  readonly restoreStartedAt: string;
  readonly restoreFinishedAt: string;
  readonly expiresAt: string;
  readonly restoreReceiptHash: string;
  readonly sourceCloneEquivalenceHash: string;
  readonly toolProfileHash: string;
  readonly ownedContainerCleanup: "confirmed";
  readonly snapshotConsistency: "exported-database-snapshot-with-global-state-recheck";
  readonly globalStateBeforeHash: string;
  readonly globalStateAfterHash: string;
  readonly coverage: readonly { readonly category: DeltaRecoveryCategory; readonly result: "verified" | "not-covered"; readonly acceptanceReference: string }[];
  /** Owner-accepted maximum snapshot-age/loss budget; actual age is derived from captureStartedAt. */
  readonly rpoSeconds: number;
  /** Reported restoration duration must cover the measured start-to-finish interval. */
  readonly rtoSeconds: number;
  readonly containmentPlanHash: string;
  readonly forwardRecoveryPlanHash: string;
  readonly acceptedBy: string;
}

export interface DeltaGateProof {
  readonly gate: DeltaRequiredGate;
  readonly status: "passed";
  readonly scopeDigest: string;
  readonly sourceCommit: string;
  readonly targetBindingHash: string;
  readonly reportSha256: string;
  readonly observedAt: string;
  readonly expiresAt: string;
}

export interface DeltaReleasePlan {
  readonly schemaVersion: 1;
  readonly kind: "combined-baseline-xp-delta-plan";
  readonly profile: typeof DELTA_RELEASE_PROFILE;
  readonly targetProjectRef: typeof DELTA_RELEASE_PROJECT;
  readonly sourceCommit: string;
  readonly manifestDigest: string;
  readonly scopeDigest: string;
  readonly baseline: {
    readonly recordedRows: 17;
    readonly historySha256: string;
    readonly combinedVersion: "20261031201901";
    readonly combinedName: "kocmax_studio_shared_review_c879b204";
    readonly appliedSqlSha256: string;
    readonly sourceEnvelopeCount: 62;
    readonly successors: readonly ["20261101075946", "20261113090000"];
  };
  readonly delta: {
    readonly version: "20261113090001";
    readonly name: "active_assignment_xp_neutrality";
    readonly sourceSha256: string;
    readonly reviewedPacketSha256: string;
    readonly executionProgramSha256: string;
  };
  readonly deferred: readonly { readonly version: "20261103215321" | "20261104134202"; readonly sourceSha256: string; readonly absenceProofHash: string }[];
  readonly retiredConstraint: { readonly removalVersion: "20260720193637"; readonly sourceSha256: string; readonly absenceProofHash: string };
  readonly requiredCapabilitiesHash: string;
  readonly requiredCapabilityCount: number;
  readonly targetBindingHash: string;
  readonly collectorSha256: string;
  readonly canonicalizerSha256: string;
  readonly invariantCollectorSha256: string;
}

/** An evidence-only commit may contain this envelope; its own SHA is never self-embedded. */
export interface DeltaReleaseEvidence {
  readonly schemaVersion: 2;
  readonly kind: "protected-bundled-xp-release";
  readonly profile: typeof DELTA_RELEASE_PROFILE;
  readonly core: ReleaseEvidence;
  readonly plan: DeltaReleasePlan;
  readonly equivalence: DeltaEquivalenceProof;
  readonly recovery: DeltaRecoveryProof;
  readonly gates: readonly DeltaGateProof[];
  readonly warnings: readonly [];
  readonly skippedChecks: readonly [];
  readonly contentDigest: string;
}

/** Supplied by independently verified protected-workflow/provenance providers, never inferred from the bundle. */
export interface DeltaExpectedContext {
  readonly projectRef: typeof DELTA_RELEASE_PROJECT;
  readonly sourceCommit: string;
  readonly manifestDigest: string;
  readonly scopeDigest: string;
  readonly planDigest: string;
  readonly targetBindingHash: string;
  readonly roles: ReleaseRoleAssignments;
  readonly recoveryReference: string;
  readonly recoveryToolProfileHash: string;
  readonly recoveryAcceptedBy: string;
  readonly containmentPlanHash: string;
  readonly forwardRecoveryPlanHash: string;
  readonly collectorSha256: string;
  readonly canonicalizerSha256: string;
  readonly invariantCollectorSha256: string;
  readonly executionProgramSha256: string;
  readonly extensionProfileHash: string;
  readonly requiredCapabilitiesHash: string;
  readonly requiredCapabilityCount: number;
  readonly requiredRecoveryCoverage: readonly DeltaRecoveryCategory[];
  readonly maximumEvidenceAgeMs: number;
  readonly maximumEvidenceLifetimeMs: number;
  readonly maximumProofAgeMs: number;
  readonly maximumRpoSeconds: number;
  readonly maximumRtoSeconds: number;
  readonly beforeRoot: string;
  readonly afterRoot: string;
}
