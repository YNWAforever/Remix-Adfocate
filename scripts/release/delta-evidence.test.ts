// @vitest-environment node
import { describe, expect, it } from "vitest";
import { verifyEvidence } from "./evidence";
import { DELTA_EXPORT_COMPONENTS } from "./delta-release-contracts";
import type { DeltaReleaseEvidence, DeltaSemanticFingerprint } from "./delta-release-contracts";
import {
  canonicalDeltaJson, digestDeltaEquivalenceProof, digestDeltaEvidence,
  digestDeltaProofPayload, digestDeltaSemanticFingerprint, parseDeltaEvidence, verifyDeltaEvidence,
} from "./delta-evidence";
import {
  makeDeltaReleaseFixture as fixture, DELTA_FIXTURE_NOW as NOW, deltaFixtureHash as h, deltaFixtureAt as at,
  DELTA_FIXTURE_MANDATORY_RECOVERY as mandatory, DELTA_FIXTURE_FINGERPRINT_NAMES as fpNames,
} from "./delta-release.fixture";

// Synthetic fixtures are shared with controller tests; they never authenticate providers.
function set(value: unknown, path: string, replacement: unknown) {
  const parts = path.split(".");
  let current = value as Record<string, unknown>;
  for (const part of parts.slice(0, -1)) current = current[part] as Record<string, unknown>;
  current[parts.at(-1)!] = replacement;
}
function get(value: unknown, path: string): unknown {
  let current = value;
  for (const part of path.split(".")) current = (current as Record<string, unknown>)[part];
  return current;
}
// Recompute attacker-controlled digests so tests reach policy/binding validation,
// rather than passing solely because any changed byte invalidated the old digest.
function reseal(evidence: DeltaReleaseEvidence): DeltaReleaseEvidence {
  const { contentDigest: ignoredCore, ...core } = evidence.core;
  void ignoredCore;
  const refreshed = { ...evidence, core: { ...core, contentDigest: digestDeltaProofPayload(core) } };
  const { contentDigest: ignoredOuter, ...body } = refreshed;
  void ignoredOuter;
  return { ...body, contentDigest: digestDeltaProofPayload(body) };
}
function rebindProofHashes(e: DeltaReleaseEvidence) {
  set(e, "core.preflightHash", digestDeltaProofPayload(e.equivalence.sourceBefore));
  set(e, "core.rehearsalHash", digestDeltaEquivalenceProof(e.equivalence));
  set(e, "recovery.sourceCloneEquivalenceHash", digestDeltaEquivalenceProof(e.equivalence));
}

describe("strict protected delta evidence consistency", () => {
  it("builds a tagged wrapper without changing or replacing the valid v1 core", () => {
    const { evidence, context } = fixture();
    expect(parseDeltaEvidence(JSON.parse(JSON.stringify(evidence)))).toEqual({ evidence, errors: [] });
    expect(verifyDeltaEvidence(evidence, context, NOW)).toEqual([]);
    expect(verifyEvidence(evidence.core, {}, NOW)).toEqual([]);
    expect(evidence.schemaVersion).toBe(2);
    expect(evidence.core.schemaVersion).toBe(1);
    const { contentDigest, ...body } = evidence;
    expect(contentDigest).toBe(digestDeltaProofPayload(body));
    expect(digestDeltaEvidence(evidence)).toBe(digestDeltaProofPayload(evidence));
    expect(digestDeltaEvidence(evidence)).not.toBe(contentDigest);
    expect(digestDeltaEvidence(evidence)).not.toBe(evidence.core.contentDigest);
    expect(evidence.core.preflightHash).not.toBe(evidence.core.schemaFingerprint);
  });

  it("hashes complete payloads with ordinal keys while preserving array order", () => {
    expect(canonicalDeltaJson({ z: 0, a: { z: 1, A: 2, a: 3 } })).toBe('{"a":{"A":2,"a":3,"z":1},"z":0}');
    expect(digestDeltaProofPayload({ b: 1, a: [2, 3] })).toBe(digestDeltaProofPayload({ a: [2, 3], b: 1 }));
    expect(digestDeltaProofPayload([1, 2])).not.toBe(digestDeltaProofPayload([2, 1]));
    const { evidence } = fixture();
    const changed = structuredClone(evidence);
    set(changed, "equivalence.unchangedDataReceiptHash", h("changed-data-receipt"));
    expect(digestDeltaEquivalenceProof(changed.equivalence)).not.toBe(digestDeltaEquivalenceProof(evidence.equivalence));
    expect(digestDeltaEvidence(changed)).not.toBe(digestDeltaEvidence(evidence));
  });

  it.each([undefined, Number.NaN, Number.POSITIVE_INFINITY, 1n, new Date(), () => 1, new Map(), { value: undefined }])("rejects non-JSON canonical values: %s", value => {
    expect(() => canonicalDeltaJson(value)).toThrow();
  });
  it("rejects cycles, sparse arrays, non-plain objects and excessive nesting", () => {
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    expect(() => canonicalDeltaJson(cycle)).toThrow("cyclic");
    expect(() => canonicalDeltaJson(Array(2))).toThrow("dense");
    expect(() => canonicalDeltaJson(Object.create({ value: 1 }))).toThrow("plain");
    let nested: unknown = null; for (let i = 0; i < 34; i++) nested = { value: nested };
    expect(() => canonicalDeltaJson(nested)).toThrow("depth");
  });

  it("compares semantic roots across actual targets/snapshots/times but binds full descriptor provenance", () => {
    const { evidence } = fixture();
    const source = evidence.equivalence.sourceBefore;
    const clone = evidence.equivalence.restoredBefore;
    expect(source.rootSha256).toBe(clone.rootSha256);
    expect(source.targetBindingHash).not.toBe(clone.targetBindingHash);
    expect(source.snapshotBindingHash).not.toBe(clone.snapshotBindingHash);
    expect(digestDeltaProofPayload(source)).not.toBe(digestDeltaProofPayload(clone));
    expect(digestDeltaSemanticFingerprint({ ...source, components: [...source.components].reverse() })).toBe(source.rootSha256);
    const reordered = Object.fromEntries(Object.entries(source).reverse()) as unknown as DeltaSemanticFingerprint;
    expect(digestDeltaSemanticFingerprint(reordered)).toBe(source.rootSha256);
    for (const key of ["scopeDigest", "collectorSha256", "canonicalizerSha256"] as const) {
      expect(digestDeltaSemanticFingerprint({ ...source, [key]: h(`different/${key}`) })).not.toBe(source.rootSha256);
    }
  });

  it.each(DELTA_EXPORT_COMPONENTS)("binds %s content and counts into each semantic root", category => {
    const { evidence, context } = fixture();
    const index = evidence.equivalence.sourceBefore.components.findIndex(row => row.category === category);
    const original = evidence.equivalence.sourceBefore.rootSha256;
    set(evidence, `equivalence.sourceBefore.components.${index}.sha256`, h(`drift/${category}`));
    expect(digestDeltaSemanticFingerprint(evidence.equivalence.sourceBefore)).not.toBe(original);
    const attack = reseal(evidence);
    expect(verifyDeltaEvidence(attack, context, NOW).length).toBeGreaterThan(0);
  });

  it.each([
    ["schemaVersion", 1], ["kind", "phase3-combined-baseline-delta-preparation"], ["profile", "stock"],
    ["warnings", ["unreviewed"]], ["skippedChecks", ["provider-auth-role-mfa"]],
    ["core.warnings", ["a required check is unresolved"]], ["core.skippedChecks", ["legacy-integration"]],
    ["core.schemaFingerprint", h("dump-bytes-instead-of-semantic-root")], ["core.preflightHash", h("only-an-opaque-preflight-hash")],
    ["core.rehearsalHash", h("old-native-receipt")], ["core.applicationCommit", h("another-source").slice(0, 40)],
    ["core.migrationRange.from", "20260715163350"], ["core.migrationChecksums.0.sha256", h("other-source")],
    ["core.roles.executor", "TODO"], ["core.roles.approver", "<approver>"], ["core.roles.observer", "fixture\nobserver"],
    ["plan.baseline.recordedRows", 62], ["plan.baseline.sourceEnvelopeCount", 67], ["plan.baseline.historySha256", h("synthetic-raw-ledger")],
    ["plan.baseline.appliedSqlSha256", h("raw-source-hash")], ["plan.baseline.combinedName", "other"],
    ["plan.delta.sourceSha256", h("edited-xp-source")], ["plan.delta.reviewedPacketSha256", h("arbitrary-packet")],
    ["plan.delta.executionProgramSha256", "0".repeat(64)], ["plan.deferred.0.sourceSha256", h("other-private-growth-source")],
    ["plan.retiredConstraint.sourceSha256", h("repaired-fk")], ["plan.retiredConstraint.absenceProofHash", "placeholder"],
    ["equivalence.kind", "PHASE3_DISPOSABLE_DELTA_REPLAY_VERIFIED_AUTH_NOT_TESTED"],
    ["equivalence.transactionInvariantAlgorithm", "raw-dump-hash"], ["equivalence.allowedChanges", ["business-backfill"]],
    ["equivalence.sourceBefore.algorithm", "raw-pg-dump"], ["equivalence.sourceBefore.environment.serverVersionNum", "170011"],
    ["equivalence.sourceBefore.environment.dumpVersion", "17.6"], ["equivalence.sourceBefore.environment.databaseName", "other"],
    ["equivalence.sourceBefore.components.0.coverage", "unverifiable"],
    ["equivalence.shapedAfter.targetBindingHash", h("reference")], ["equivalence.replayAfter.targetBindingHash", h("another-cluster")],
    ["equivalence.sourceBefore.observedAt", "2026-11-13T15:49:00"], ["equivalence.sourceBefore.observedAt", "2026-02-31T15:49:00Z"],
    ["equivalence.expectedAfterRoot", h("arbitrary-after")],
    ["recovery.reference", "TBD"], ["recovery.sourceSnapshotBindingHash", h("other-snapshot")], ["recovery.sourceCloneEquivalenceHash", h("old-restore-hash")],
    ["recovery.globalStateAfterHash", h("global-role-drift")], ["recovery.ownedContainerCleanup", "pending"],
    ["recovery.snapshotConsistency", "two-unrelated-snapshots"], ["recovery.artifacts.0.name", "partial.dump"], ["recovery.artifacts.0.bytes", 0],
    ["recovery.artifacts.0.sha256", "f".repeat(64)], ["recovery.coverage.0.result", "not-covered"],
    ["recovery.coverage.4.acceptanceReference", ""], ["recovery.captureFinishedAt", at(-13)], ["recovery.restoreFinishedAt", at(-12)],
    ["gates.0.status", "failed"], ["gates.1.status", "skipped"], ["gates.2.status", false], ["gates.3.reportSha256", "TODO"],
    ["gates.0.targetBindingHash", h("another-project")], ["gates.0.sourceCommit", h("another-commit").slice(0, 40)],
    ["core.testResults.0.status", "failed"], ["core.testResults.1.status", "skipped"], ["core.testResults.2.evidenceHash", h("different-gate-result")],
  ])("rejects resealed malformed or mismatched payload at %s", (path, replacement) => {
    const { evidence, context } = fixture();
    set(evidence, path as string, replacement);
    const attack = reseal(evidence);
    expect(verifyDeltaEvidence(attack, context, NOW).length).toBeGreaterThan(0);
  });

  it.each(["plan", "equivalence", "recovery", "gates.0", "equivalence.sourceBefore", "equivalence.sourceBefore.environment", "equivalence.sourceBefore.components.0", "recovery.artifacts.0", "recovery.coverage.0"])("rejects unknown fields inside %s", path => {
    const { evidence } = fixture();
    set(evidence, `${path}.unexpected`, "untrusted");
    expect(parseDeltaEvidence(reseal(evidence)).errors.length).toBeGreaterThan(0);
  });
  it.each(["plan", "equivalence", "recovery", "core", "warnings", "skippedChecks", "contentDigest"])("rejects missing envelope field %s", path => {
    const { evidence } = fixture();
    delete (evidence as unknown as Record<string, unknown>)[path];
    expect(parseDeltaEvidence(evidence).errors.length).toBeGreaterThan(0);
  });

  it("rejects missing, duplicate, unknown gate and component coverage", () => {
    for (const path of ["gates", "core.testResults", "equivalence.sourceBefore.components", "recovery.coverage", "recovery.artifacts", "plan.deferred"]) {
      for (const mode of ["missing", "duplicate"] as const) {
        const { evidence, context } = fixture();
        const rows = get(evidence, path) as unknown[];
        if (mode === "missing") rows.pop(); else rows[1] = structuredClone(rows[0]);
        expect(verifyDeltaEvidence(reseal(evidence), context, NOW).length).toBeGreaterThan(0);
      }
    }
  });

  it("requires honest distinct source/reference/restored targets for cross-database equivalence", () => {
    for (const path of ["equivalence.reviewedReferenceBefore.targetBindingHash", "equivalence.restoredBefore.targetBindingHash"]) {
      const { evidence, context } = fixture();
      set(evidence, path, evidence.plan.targetBindingHash);
      const paired = path.includes("reviewedReference") ? ["emptyAfter"] : ["shapedAfter", "replayAfter"];
      for (const key of paired) set(evidence, `equivalence.${key}.targetBindingHash`, evidence.plan.targetBindingHash);
      rebindProofHashes(evidence);
      expect(verifyDeltaEvidence(reseal(evidence), context, NOW).length).toBeGreaterThan(0);
    }
  });

  it("rejects recomputed changed semantic roots even if before/after groups are internally consistent", () => {
    const { evidence, context } = fixture();
    for (const name of fpNames.slice(0, 3)) {
      set(evidence, `equivalence.${name}.components.0.sha256`, h("new-unreviewed-baseline"));
      set(evidence, `equivalence.${name}.rootSha256`, digestDeltaSemanticFingerprint(evidence.equivalence[name]));
    }
    set(evidence, "core.schemaFingerprint", evidence.equivalence.sourceBefore.rootSha256);
    rebindProofHashes(evidence);
    const attack = reseal(evidence);
    expect(parseDeltaEvidence(attack).errors).toEqual([]);
    expect(verifyDeltaEvidence(attack, context, NOW).join(" ")).toContain("approved before root");
  });

  it.each([
    ["sourceCommit", h("different-source").slice(0, 40)], ["manifestDigest", h("other-manifest")], ["scopeDigest", h("other-scope")],
    ["planDigest", h("another-plan")], ["targetBindingHash", h("other-target")], ["roles.executor", "another-executor"],
    ["roles.observer", "another-observer"], ["roles.containmentOwner", "another-containment"], ["roles.productOwner", "another-product"], ["roles.approver", "another-approver"],
    ["recoveryReference", "different-recovery"], ["recoveryToolProfileHash", h("other-recovery-tools")], ["recoveryAcceptedBy", "another-owner"], ["containmentPlanHash", h("different-containment")],
    ["forwardRecoveryPlanHash", h("different-forward-plan")], ["collectorSha256", h("other-collector")], ["canonicalizerSha256", h("other-canonicalizer")],
    ["invariantCollectorSha256", h("other-invariant-collector")], ["executionProgramSha256", h("different-runtime-program")],
    ["extensionProfileHash", h("other-extensions")], ["requiredCapabilitiesHash", h("other-capabilities")], ["requiredCapabilityCount", 885],
    ["beforeRoot", h("another-before")], ["afterRoot", h("another-after")],
    ["requiredRecoveryCoverage", ["database-schema"]], ["requiredRecoveryCoverage", [...mandatory, "unknown"]],
    ["maximumEvidenceAgeMs", 1], ["maximumEvidenceLifetimeMs", 1], ["maximumProofAgeMs", 1],
    ["maximumRpoSeconds", 59], ["maximumRtoSeconds", 299], ["roles.approver", "placeholder"],
  ])("requires independently supplied trusted expectation %s", (path, replacement) => {
    const { evidence, context } = fixture();
    set(context, path as string, replacement);
    expect(verifyDeltaEvidence(evidence, context, NOW).length).toBeGreaterThan(0);
  });

  it("rejects omitted trusted context fields and unknown recovery policy categories", () => {
    for (const path of ["roles", "recoveryReference", "recoveryAcceptedBy", "planDigest", "maximumProofAgeMs", "executionProgramSha256"]) {
      const { evidence, context } = fixture();
      delete (context as unknown as Record<string, unknown>)[path];
      expect(verifyDeltaEvidence(evidence, context, NOW).length).toBeGreaterThan(0);
    }
  });

  it("binds all deferred-source absence proofs and plan metadata through the independent plan digest", () => {
    const { evidence, context } = fixture();
    set(evidence, "plan.deferred.0.absenceProofHash", h("forged-absence"));
    const attack = reseal(evidence);
    expect(parseDeltaEvidence(attack).errors).toEqual([]);
    expect(verifyDeltaEvidence(attack, context, NOW).join(" ")).toContain("planDigest");
  });

  it("requires additional recovery categories when independent owner policy requires them", () => {
    const { evidence, context } = fixture();
    set(context, "requiredRecoveryCoverage", [...mandatory, "storage-object-bytes"]);
    expect(verifyDeltaEvidence(evidence, context, NOW).join(" ")).toContain("trusted required coverage");
    set(evidence, "recovery.coverage.4.result", "verified");
    expect(verifyDeltaEvidence(reseal(evidence), context, NOW)).toEqual([]);
  });

  it("rejects unzoned, invalid, future, stale, expired and reversed timestamps", () => {
    for (const [path, replacement] of [
      ["core.createdAt", "2026-11-13T15:59:00"], ["core.createdAt", at(1)], ["core.createdAt", at(-10)],
      ["core.expiresAt", at(0)], ["core.expiresAt", at(60)], ["core.expiresAt", at(-2)],
      ["gates.0.observedAt", at(1)], ["gates.0.observedAt", at(-31)], ["gates.0.expiresAt", at(0)],
      ["equivalence.observedAt", at(-12)], ["equivalence.expiresAt", at(0)], ["recovery.captureStartedAt", at(-31)],
      ["recovery.restoreFinishedAt", at(1)], ["recovery.expiresAt", at(0)],
    ]) {
      const { evidence, context } = fixture(); set(evidence, path, replacement);
      expect(verifyDeltaEvidence(reseal(evidence), context, NOW).length).toBeGreaterThan(0);
    }
    const { evidence, context } = fixture();
    expect(verifyDeltaEvidence(evidence, context, new Date("invalid")).length).toBeGreaterThan(0);
    expect(verifyDeltaEvidence(evidence, context, new Date(NOW.getTime() + 30 * 60000)).length).toBeGreaterThan(0);
  });

  it.each(fpNames)("rejects stale provenance for %s although the semantic root is unchanged", name => {
    const { evidence, context } = fixture();
    const original = evidence.equivalence[name].rootSha256;
    set(evidence, `equivalence.${name}.observedAt`, at(-31));
    expect(digestDeltaSemanticFingerprint(evidence.equivalence[name])).toBe(original);
    rebindProofHashes(evidence);
    expect(verifyDeltaEvidence(reseal(evidence), context, NOW).length).toBeGreaterThan(0);
  });

  it("rejects historic HOLD, native AUTH_NOT_TESTED and bare v1 payloads", () => {
    const { evidence } = fixture();
    for (const value of [evidence.core, { decision: "HOLD", validReleaseEvidence: false },
      { status: "PHASE3_DISPOSABLE_DELTA_REPLAY_VERIFIED_AUTH_NOT_TESTED", productionApplied: false },
      { ...evidence, validReleaseEvidence: true }]) expect(parseDeltaEvidence(value).errors.length).toBeGreaterThan(0);
  });

  it("enforces actual snapshot age against the independently accepted policy", () => {
    const { evidence, context } = fixture();
    set(context, "maximumRpoSeconds", 600); // Capture began 720s ago.
    expect(verifyDeltaEvidence(evidence, context, NOW).join(" ")).toContain("RPO/RTO policy exceeded");
  });
  it.each([0, 600])("rejects an aged snapshot exceeding its declared %ss RPO despite a larger policy maximum", budget => {
    const { evidence, context } = fixture();
    set(evidence, "recovery.rpoSeconds", budget);
    expect(context.maximumRpoSeconds).toBe(1800);
    expect(verifyDeltaEvidence(reseal(evidence), context, NOW).join(" ")).toContain("RPO/RTO policy exceeded");
  });

  it.each([
    ["recovery.restoreStartedAt", at(-12)], // Restore cannot begin before backup capture finishes.
    ["recovery.restoreStartedAt", at(-3)], // Restore cannot begin after it has finished.
    ["recovery.rtoSeconds", 239], // Actual restore duration is 240 seconds.
    ["recovery.restoreFinishedAt", at(-2)], // Expanded duration cannot retain the old 300s claim.
  ])("validates actual restore chronology/duration at %s", (path, replacement) => {
    const { evidence, context } = fixture();
    set(evidence, path as string, replacement);
    expect(verifyDeltaEvidence(reseal(evidence), context, NOW).length).toBeGreaterThan(0);
  });

  it("rejects non-JSON symbols on arrays and objects", () => {
    const rows = [1]; Object.defineProperty(rows, Symbol("hidden"), { value: 1 });
    expect(() => canonicalDeltaJson(rows)).toThrow();
    expect(() => canonicalDeltaJson({ [Symbol("hidden")]: 1 })).toThrow();
  });

  it("rejects a coherent but unapproved after-state and preserves expected-before semantics", () => {
    const { evidence, context } = fixture();
    for (const name of fpNames.slice(3)) {
      set(evidence, `equivalence.${name}.components.0.sha256`, h("unapproved-after"));
      set(evidence, `equivalence.${name}.rootSha256`, digestDeltaSemanticFingerprint(evidence.equivalence[name]));
    }
    set(evidence, "equivalence.expectedAfterRoot", evidence.equivalence.shapedAfter.rootSha256);
    rebindProofHashes(evidence);
    const attack = reseal(evidence);
    expect(parseDeltaEvidence(attack).errors).toEqual([]);
    expect(verifyDeltaEvidence(attack, context, NOW).join(" ")).toContain("approved after root");
    expect(attack.core.schemaFingerprint).toBe(context.beforeRoot);
  });

  it("enforces 17 before-history rows even if all baseline roots are rehashed coherently", () => {
    const { evidence, context } = fixture();
    for (const name of fpNames.slice(0, 3)) {
      const index = evidence.equivalence[name].components.findIndex(row => row.category === "migration-history");
      set(evidence, `equivalence.${name}.components.${index}.objectCount`, 18);
      set(evidence, `equivalence.${name}.rootSha256`, digestDeltaSemanticFingerprint(evidence.equivalence[name]));
    }
    set(evidence, "core.schemaFingerprint", evidence.equivalence.sourceBefore.rootSha256);
    rebindProofHashes(evidence);
    expect(verifyDeltaEvidence(reseal(evidence), context, NOW).join(" ")).toContain("migration-history");
  });

  it("does not mistake an opaque changed provider hash for proof authentication", () => {
    const { evidence, context } = fixture();
    const gate = evidence.gates[0]!;
    const changedHash = h("unresolved-provider-result");
    set(evidence, "gates.0.reportSha256", changedHash);
    const index = evidence.core.testResults.findIndex(result => result.gate === gate.gate);
    set(evidence, `core.testResults.${index}.evidenceHash`, changedHash);
    // External authenticity belongs to Lead's independently verified providers.
    expect(verifyDeltaEvidence(reseal(evidence), context, NOW)).toEqual([]);
  });
});
