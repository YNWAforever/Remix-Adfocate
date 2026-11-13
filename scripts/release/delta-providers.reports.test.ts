// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { buildEvidence } from "./evidence";
import { buildDeltaEvidence, digestDeltaProofPayload, verifyDeltaEvidence } from "./delta-evidence";
import { deltaGateReportSetHash } from "./delta-executor";
import {
  checkAcceptedDeltaGatePayload, deltaExpectedGateFacts, resolveOwnerAcceptedDeltaReports,
  type DeltaOwnerProofAcceptance,
} from "./delta-providers.reports";
import { DELTA_REQUIRED_GATES, type DeltaRequiredGate } from "./delta-release-contracts";
import { provenanceDigest, type DeltaProvenanceReport, type DeltaSourceCiRecord } from "./delta-provenance";
import { makeDeltaReleaseFixture, DELTA_FIXTURE_NOW as NOW, deltaFixtureAt as at, deltaFixtureHash as h } from "./delta-release.fixture";

// All facts, acceptances, artifacts and provider callbacks in this file are
// synthetic. Passing these tests authenticates no real session, owner or release.
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
const PRODUCERS: Record<DeltaRequiredGate, string> = {
  "source-integrity": "repo-source-validator", "target-binding": "managed-readonly-pg17", "reviewed-baseline-equivalence": "native-reviewed-reference-pg17",
  "empty-rehearsal": "native-reviewed-reference-pg17", "shaped-rehearsal": "native-restored-pg17", "identical-replay": "native-restored-pg17",
  "legacy-integration": "provider-rehearsal", "active-mission": "provider-rehearsal", "reward-handoff": "provider-rehearsal", "provider-auth-role-mfa": "provider-rehearsal",
  "api-database-binding": "hosted-readonly-api", "storage-api": "provider-rehearsal", "fresh-recovery": "native-private-recovery",
  "production-deployment": "github-vercel-reader", "source-ci": "github-actions-ci", "schema-change-control": "owner-change-control",
};
type Row = Record<string, unknown>;
function set(value: unknown, path: string, replacement: unknown) {
  const parts = path.split("."); let current = value as Row;
  for (const part of parts.slice(0, -1)) current = current[part] as Row;
  current[parts.at(-1)!] = replacement;
}
function fixture() {
  const base = makeDeltaReleaseFixture();
  let evidence = base.evidence;
  const context = base.context;
  const ci: DeltaSourceCiRecord = { repository: "YNWAforever/Remix-Adfocate", runId: "1001", commit: context.sourceCommit, branch: "main", event: "push",
    workflowPath: ".github/workflows/ci.yml", status: "completed", conclusion: "success", createdAt: at(-20), completedAt: at(-10), jobs: [
      { name: "build-test", status: "completed", conclusion: "success" }, { name: "integration", status: "completed", conclusion: "success" },
    ] };
  const payloads = new Map<DeltaRequiredGate, unknown>();
  for (const gate of DELTA_REQUIRED_GATES) {
    const binding = evidence.gates.find(value => value.gate === gate)!;
    payloads.set(gate, gate === "source-ci" ? ci : {
      schemaVersion: 1, kind: "protected-delta-gate-report", gate, status: "passed", scopeDigest: context.scopeDigest,
      sourceCommit: context.sourceCommit, targetBindingHash: context.targetBindingHash, observedAt: binding.observedAt, expiresAt: binding.expiresAt,
      producer: { kind: PRODUCERS[gate], sourceCommit: context.sourceCommit }, checks: CHECKS[gate].map(name => ({ name, status: "passed", evidenceSha256: h(`synthetic-check/${gate}/${name}`) })),
      facts: deltaExpectedGateFacts(gate, evidence, context), warnings: [], skippedChecks: [],
    });
  }
  const proofByHash = new Map<string, unknown>();
  function seal() {
    proofByHash.clear();
    const gates = evidence.gates.map(gate => {
      const payload = payloads.get(gate.gate)!; const hash = digestDeltaProofPayload(payload); proofByHash.set(hash, structuredClone(payload));
      return { ...gate, reportSha256: hash };
    });
    const { schemaVersion: ignoredVersion, contentDigest: ignoredCore, ...coreInput } = evidence.core;
    void ignoredVersion; void ignoredCore;
    const core = buildEvidence({ ...coreInput, testResults: gates.map(gate => ({ gate: gate.gate, status: "passed", evidenceHash: gate.reportSha256 })) });
    const { contentDigest: ignoredOuter, ...body } = evidence; void ignoredOuter;
    evidence = buildDeltaEvidence({ ...body, core, gates });
  }
  seal();
  const sourceCiHash = digestDeltaProofPayload(ci), evidenceCommit = h("report-evidence-commit").slice(0, 40);
  const provenance: DeltaProvenanceReport = { schemaVersion: 1, kind: "verified-source-evidence-provenance", sourceCommit: context.sourceCommit, evidenceCommit,
    artifactSha256: h("committed-outer-json"), sourceCiReportHash: sourceCiHash, protectedRunId: "2001", protectedRunAttempt: 2,
    approvedByGitHubActorId: "3001", permittedDeploymentCommits: [context.sourceCommit, evidenceCommit], reportSha256: h("synthetic-provenance") };
  let acceptance: DeltaOwnerProofAcceptance = { schemaVersion: 1, acceptedReportSetHash: deltaGateReportSetHash(evidence), acceptedByGitHubActorId: "3001",
    acceptanceReference: "fixture-protected-review-2001-3001" };
  const readCommittedProof = vi.fn(async (hash: string) => {
    if (!proofByHash.has(hash)) throw new Error("synthetic proof unavailable");
    return structuredClone(proofByHash.get(hash));
  });
  const currentDeployment = vi.fn(async (allowed: readonly string[]) => {
    expect(allowed).toEqual(provenance.permittedDeploymentCommits);
    return { commit: context.sourceCommit };
  });
  const resolve = () => resolveOwnerAcceptedDeltaReports(evidence, context, provenance, acceptance, { readCommittedProof, currentDeployment }, NOW);
  const install = (gate: DeltaRequiredGate, payload: unknown, accept = true) => {
    payloads.set(gate, payload); seal();
    if (accept) acceptance = { ...acceptance, acceptedReportSetHash: deltaGateReportSetHash(evidence) };
  };
  const mutate = (gate: DeltaRequiredGate, path: string, replacement: unknown) => {
    const payload = structuredClone(payloads.get(gate)); set(payload, path, replacement); install(gate, payload);
  };
  return { get evidence() { return evidence; }, context, provenance, get acceptance() { return acceptance; }, payloads, proofByHash, ci,
    resolve, install, mutate, readCommittedProof, currentDeployment };
}

const NON_CI = DELTA_REQUIRED_GATES.filter(gate => gate !== "source-ci");
describe("closed owner-accepted delta reports (synthetic proofs only)", () => {
  it("resolves all sixteen actual payloads only with exact independent report-set and reviewer acceptance", async () => {
    const f = fixture(); expect(verifyDeltaEvidence(f.evidence, f.context, NOW)).toEqual([]);
    const result = await f.resolve();
    expect(result).toEqual({ reportSetHash: deltaGateReportSetHash(f.evidence), sourceCiReportHash: provenanceDigest(f.ci),
      deploymentCommit: f.context.sourceCommit, targetBindingHash: f.context.targetBindingHash });
    expect(f.readCommittedProof).toHaveBeenCalledTimes(16);
    expect(f.currentDeployment).toHaveBeenCalledWith(f.provenance.permittedDeploymentCommits);
  });
  it.each([
    ["schemaVersion", 2], ["acceptedReportSetHash", h("unaccepted-set")], ["acceptedByGitHubActorId", "3002"],
    ["acceptedByGitHubActorId", "owner-label"], ["acceptanceReference", ""], ["acceptanceReference", "TODO"], ["acceptanceReference", "<owner-approval>"],
  ])("rejects independent acceptance mismatch at %s before resolving any payload", async (path, value) => {
    const f = fixture(); set(f.acceptance, path as string, value);
    await expect(f.resolve()).rejects.toThrow("owner acceptance"); expect(f.readCommittedProof).not.toHaveBeenCalled(); expect(f.currentDeployment).not.toHaveBeenCalled();
  });
  it("rejects missing or extra acceptance fields and does not infer acceptance from bundle hashes", async () => {
    for (const mode of ["missing", "extra"] as const) {
      const f = fixture(); const acceptance = f.acceptance as unknown as Row;
      if (mode === "missing") delete acceptance.acceptedByGitHubActorId; else acceptance.inferredApproval = true;
      await expect(f.resolve()).rejects.toThrow(); expect(f.readCommittedProof).not.toHaveBeenCalled();
    }
  });
  it("rejects rehashed proof changes when independent acceptance still names the previous set", async () => {
    const f = fixture(); const report = structuredClone(f.payloads.get("active-mission")) as Row;
    set(report, "checks.0.evidenceSha256", h("different-check-receipt")); f.install("active-mission", report, false);
    await expect(f.resolve()).rejects.toThrow("owner acceptance"); expect(f.readCommittedProof).not.toHaveBeenCalled();
  });
  it("rejects a payload different from its approved content address", async () => {
    const f = fixture(); const binding = f.evidence.gates.find(gate => gate.gate === "active-mission")!;
    const changed = structuredClone(f.payloads.get("active-mission")); set(changed, "checks.0.evidenceSha256", h("substituted-valid-looking-receipt"));
    f.proofByHash.set(binding.reportSha256, changed);
    await expect(f.resolve()).rejects.toThrow("payload digest"); expect(f.currentDeployment).not.toHaveBeenCalled();
  });

  it.each(NON_CI)("requires every check and a closed passed report for %s even if the reviewer accepts its hash", async gate => {
    const f = fixture(); f.mutate(gate, "checks", []); await expect(f.resolve()).rejects.toThrow("check coverage");
    const unknown = fixture(); unknown.mutate(gate, "extra", "unrecognized"); await expect(unknown.resolve()).rejects.toThrow("unknown or missing");
    const failed = fixture(); failed.mutate(gate, "status", "failed"); await expect(failed.resolve()).rejects.toThrow("incomplete outcome");
  });
  it.each([
    ["scopeDigest", h("different-scope")], ["sourceCommit", h("different-source").slice(0, 40)], ["targetBindingHash", h("different-database")],
    ["observedAt", at(-4)], ["expiresAt", at(30)], ["producer.kind", "postgres-sql-only"], ["producer.sourceCommit", h("foreign-tool-commit").slice(0, 40)],
    ["warnings", ["unresolved auth"]], ["skippedChecks", ["actual-http-roundtrips"]], ["checks.0.status", "skipped"],
    ["checks.0.evidenceSha256", "not-a-digest"], ["checks.0.name", "sql-role-fixture"], ["checks.0.unrecognized", true],
  ])("rejects auth report policy or identity substitution at %s", async (path, value) => {
    const f = fixture(); f.mutate("provider-auth-role-mfa", path as string, value); await expect(f.resolve()).rejects.toThrow();
  });
  it("rejects duplicated check names even if their count and hashes are plausible", async () => {
    const f = fixture(); const payload = structuredClone(f.payloads.get("provider-auth-role-mfa")) as Row;
    const checks = payload.checks as Row[]; checks[1] = structuredClone(checks[0]!); f.install("provider-auth-role-mfa", payload);
    await expect(f.resolve()).rejects.toThrow("matrix mismatch");
  });

  it.each([
    ["provider-auth-role-mfa", "providerIssuedSessions", false], ["provider-auth-role-mfa", "signaturesVerified", false],
    ["provider-auth-role-mfa", "revokedSessionDenied", false], ["provider-auth-role-mfa", "tenantRoleDenialsPassed", false],
    ["provider-auth-role-mfa", "aal1Denied", false], ["provider-auth-role-mfa", "aal2Authorized", false],
    ["provider-auth-role-mfa", "actualHttpRoundtrips", false], ["provider-auth-role-mfa", "sqlRoleOrForgedSessionSubstitute", true],
    ["storage-api", "actualHttpRoundtrips", false], ["storage-api", "crossOwnerDenied", false], ["storage-api", "anonymousDenied", false],
    ["storage-api", "mimeAndSizePolicyPassed", false], ["api-database-binding", "apiProjectRef", "different-project"],
    ["api-database-binding", "issuerProjectRef", "different-issuer"], ["api-database-binding", "databaseTargetBindingHash", h("other-target")],
    ["api-database-binding", "deployedApiAuthorityVerified", false], ["active-mission", "joinXp", 10], ["active-mission", "acceptXp", 10],
    ["active-mission", "backfillRows", 1], ["active-mission", "clawbackRows", 1], ["legacy-integration", "ordinaryJoinXp", 0],
    ["legacy-integration", "nullModeJoinXp", 0], ["legacy-integration", "priorAwardsPreserved", false],
    ["reward-handoff", "publicationAttempts", 1], ["reward-handoff", "pilotEnables", 1], ["reward-handoff", "rewardMutations", 1],
    ["production-deployment", "sourceCommit", h("other-deployed-source").slice(0, 40)], ["production-deployment", "canonicalAliasVerified", false],
    ["production-deployment", "environment", "preview"], ["schema-change-control", "allDdlWritersFrozen", false],
    ["schema-change-control", "sequenceAndApplicationWritersQuiesced", false], ["schema-change-control", "controlUntil", at(1)],
    ["schema-change-control", "containmentOwner", "unaccepted-operator"], ["fresh-recovery", "sourceSnapshotBindingHash", h("other-backup-snapshot")],
    ["fresh-recovery", "manifestSha256", h("other-archive")], ["fresh-recovery", "toolProfileHash", h("other-recovery-tools")],
    ["fresh-recovery", "rpoSeconds", 60], ["fresh-recovery", "rtoSeconds", 1], ["fresh-recovery", "cleanup", "pending"],
  ] as const)("rejects reviewer-accepted but unsafe %s fact %s", async (gate, name, value) => {
    const f = fixture(); f.mutate(gate, `facts.${name}`, value); await expect(f.resolve()).rejects.toThrow("gate facts mismatch");
  });

  it("rejects raw HOLD, AUTH_NOT_TESTED and SQL-role-only legacy artifacts", () => {
    const f = fixture();
    for (const value of [{ decision: "HOLD", validReleaseEvidence: false },
      { status: "PHASE3_DISPOSABLE_DELTA_REPLAY_VERIFIED_AUTH_NOT_TESTED", productionApplied: false },
      { kind: "sql-role-rehearsal", status: "passed", actualHttpRoundtrips: false }]) {
      expect(() => checkAcceptedDeltaGatePayload("provider-auth-role-mfa", value, f.evidence, f.context, NOW)).toThrow();
    }
  });
  it("rejects sensitive report data rather than treating a matching hash as authentication", async () => {
    const f = fixture(); f.mutate("provider-auth-role-mfa", "facts.accessToken", "fixture-private-value"); await expect(f.resolve()).rejects.toThrow("sensitive evidence key");
  });
  it("requires actual CI, not a reviewer-rehashed replacement", async () => {
    const f = fixture(); f.mutate("source-ci", "runId", "1002");
    await expect(f.resolve()).rejects.toThrow("actual source CI report"); expect(f.currentDeployment).not.toHaveBeenCalled();
  });
  it.each([
    ["jobs.1.conclusion", "skipped"], ["jobs.1.name", "unrelated"], ["commit", h("wrong-ci-source").slice(0, 40)],
    ["workflowPath", ".github/workflows/supabase.yml"], ["status", "in_progress"], ["completedAt", at(1)],
  ])("rejects a resealed invalid CI report at %s", async (path, value) => {
    const f = fixture(); f.mutate("source-ci", path as string, value); await expect(f.resolve()).rejects.toThrow(); expect(f.currentDeployment).not.toHaveBeenCalled();
  });
  it("re-reads current production and permits only the independently proven code-equivalent commits", async () => {
    const f = fixture(); f.currentDeployment.mockResolvedValue({ commit: f.provenance.evidenceCommit });
    expect((await f.resolve()).deploymentCommit).toBe(f.provenance.evidenceCommit);
    f.currentDeployment.mockResolvedValue({ commit: h("unapproved-current-production").slice(0, 40) });
    await expect(f.resolve()).rejects.toThrow("actual deployed source bytes");
    f.currentDeployment.mockRejectedValue(new Error("synthetic deployment unavailable")); await expect(f.resolve()).rejects.toThrow();
  });
});
