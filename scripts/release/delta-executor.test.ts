// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildEvidence } from "./evidence";
import { buildDeltaEvidence, digestDeltaEquivalenceProof, digestDeltaEvidence, digestDeltaPlan, digestDeltaProofPayload } from "./delta-evidence";
import { DELTA_BASELINE_HISTORY_SHA256, DELTA_SOURCE_SHA256 } from "./delta-release-contracts";
import { makeDeltaReleaseFixture, DELTA_FIXTURE_NOW, deltaFixtureHash as h } from "./delta-release.fixture";
import { digestDeltaExecutionProgram, type CompiledDeltaProgram } from "./delta-program";
import { deltaEffectiveExpiry, deltaGateReportSetHash, executeBundledDelta, DeltaExecutionFailure,
  type DeltaExecuteDeps, type DeltaExecuteInput, type DeltaObservedState } from "./delta-executor";
import type { DeltaTransactionInvariant } from "./delta-fingerprint";

type Mutable<T> = T extends (...args: infer A) => infer R ? (...args: A) => R
  : T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
const mutable = <T>(value: T) => value as Mutable<T>;

function fixture(replay = false) {
  const { evidence: original, context: fixtureContext } = makeDeltaReleaseFixture();
  const context = mutable(fixtureContext);
  const capabilities = Array.from({ length: 886 }, (_, index) => `synthetic-capability-${index}`).sort();
  const plan = mutable(structuredClone(original.plan)), equivalence = mutable(structuredClone(original.equivalence)), recovery = mutable(structuredClone(original.recovery));
  plan.requiredCapabilitiesHash = digestDeltaProofPayload(capabilities);
  equivalence.requiredCapabilitiesHash = plan.requiredCapabilitiesHash;
  context.requiredCapabilitiesHash = plan.requiredCapabilitiesHash;
  const fields = { sessionLockSql: "SELECT 1;", beginSql: "BEGIN ISOLATION LEVEL REPEATABLE READ READ WRITE;", lockSql: "SELECT 1;",
    expiryGuardSql: "DO $$BEGIN NULL; END$$;", applyDoSql: "DO $$BEGIN NULL; END$$;", invariantSql: "SELECT 1;" };
  const programHash = digestDeltaExecutionProgram({ scopeDigest: plan.scopeDigest, ...fields });
  plan.delta.executionProgramSha256 = programHash;
  context.executionProgramSha256 = programHash;
  context.planDigest = digestDeltaPlan(plan);
  const { schemaVersion: ignoredVersion, contentDigest: ignoredCore, ...coreInput } = original.core;
  void ignoredVersion; void ignoredCore;
  coreInput.rehearsalHash = digestDeltaEquivalenceProof(equivalence);
  recovery.sourceCloneEquivalenceHash = coreInput.rehearsalHash;
  const core = buildEvidence(coreInput);
  const evidence = buildDeltaEvidence({ schemaVersion: 2, kind: original.kind, profile: original.profile, core, plan, equivalence, recovery,
    gates: original.gates, warnings: [], skippedChecks: [] });
  const bytes = Buffer.from(JSON.stringify(evidence));
  const evidenceDigest = digestDeltaEvidence(evidence);
  const input: DeltaExecuteInput = { evidence, committedBundleBytes: bytes, evidenceDigest, context, apply: true,
    approval: `APPROVE ${context.projectRef} ${evidenceDigest}` };
  const program: Mutable<CompiledDeltaProgram> = { plan, planDigest: context.planDigest, requiredCapabilities: capabilities,
    deferredObjects: { "20261103215321": [], "20261104134202": [] }, ...fields, executionProgramSha256: programHash };
  let time = DELTA_FIXTURE_NOW.valueOf(), committed = false;
  const calls: string[] = [];
  function state(after = replay || committed): Mutable<DeltaObservedState> {
    const fingerprint = mutable(structuredClone(after ? evidence.equivalence.shapedAfter : evidence.equivalence.sourceBefore));
    fingerprint.targetBindingHash = context.targetBindingHash;
    fingerprint.observedAt = new Date(time).toISOString();
    fingerprint.expiresAt = new Date(time + 60000).toISOString();
    return { targetBindingHash: context.targetBindingHash, fingerprint, migrationRows: after ? 18 : 17,
      baselineHistorySha256: DELTA_BASELINE_HISTORY_SHA256, deltaSourceSha256: after ? DELTA_SOURCE_SHA256 : null };
  }
  function invariant(after: boolean): Mutable<DeltaTransactionInvariant> {
    const present = after || replay;
    return { schemaVersion: 1, algorithm: "pg17-same-database-invariant-v1", databaseName: "postgres", serverVersionNum: "170006",
      isolationLevel: "repeatable read", transactionId: "500", catalogSha256: h("actual-catalog"), catalogCount: 60,
      dataSha256: h("actual-data"), tableCount: 104, baselineHistoryDataSha256: h("full-history-data"), baselineHistoryTupleSha256: h("history-tuples"),
      migrationRows: present ? 18 : 17, deltaHistory: present ? { version: "20261113090001", name: "active_assignment_xp_neutrality",
        statementCount: 1, statementsSha256: DELTA_SOURCE_SHA256, xmin: replay ? "499" : "500" } : null,
      targets: ["private.join_mission(uuid)", "public.accept_application(uuid)"].map((signature, index) => ({
        signature: signature as DeltaTransactionInvariant["targets"][number]["signature"], oid: String(1000 + index),
        xmin: present ? (replay ? "499" : "500") : "100", bodySha256: h(`${signature}/${present ? "after" : "before"}`), attributesAclSha256: h(`${signature}/acl`),
      })), unsupported: [] };
  }
  const provenance = { schemaVersion: 1 as const, kind: "verified-source-evidence-provenance" as const, sourceCommit: context.sourceCommit,
    evidenceCommit: h("evidence-commit").slice(0, 40), artifactSha256: createHash("sha256").update(bytes).digest("hex"),
    sourceCiReportHash: evidence.gates.find(gate => gate.gate === "source-ci")!.reportSha256, protectedRunId: "9001", protectedRunAttempt: 1, approvedByGitHubActorId: "3001",
    permittedDeploymentCommits: [context.sourceCommit, h("evidence-commit").slice(0, 40)], reportSha256: h("provenance-report") };
  let captures = 0;
  const tx = { inspectExportedSnapshot: async () => { calls.push("locked-inspect"); return state(); },
    captureInvariant: async () => { calls.push("invariant"); return invariant(captures++ > 0); },
    applyFixedProgram: async () => { calls.push("apply"); }, commitWithExpiryGuard: async () => { calls.push("commit"); committed = true; },
    rollback: async () => { calls.push("rollback"); }, close: async () => { calls.push("close"); } };
  const deps: Mutable<DeltaExecuteDeps> = { now: () => new Date(time), compile: async () => { calls.push("compile"); return program; },
    verifyProvenance: async () => { calls.push("provenance"); return provenance; },
    verifyProofs: async () => { calls.push("proofs"); return { reportSetHash: deltaGateReportSetHash(evidence),
      sourceCiReportHash: provenance.sourceCiReportHash, deploymentCommit: context.sourceCommit, targetBindingHash: context.targetBindingHash }; },
    inspect: async () => { calls.push("inspect"); return state(); }, begin: async () => { calls.push("begin"); return tx; } };
  return { input, deps, calls, tx, program, state, invariant, provenance, setTime: (value: number) => { time = value; } };
}

// All providers/snapshots are synthetic in-memory control-flow fixtures. No SQL is executed here.
describe("explicit protected delta execution control", () => {
  it("dry-runs with readonly inspection and never opens a write transaction", async () => {
    const f = fixture();
    const report = await executeBundledDelta({ ...f.input, apply: false, approval: "" }, f.deps);
    expect(report.status).toBe("verified-dry-run"); expect(report.sqlExecutionAttempted).toBe(false);
    expect(f.calls).not.toContain("begin"); expect(f.calls).not.toContain("apply");
  });
  it("checks both transaction invariants before committing and inspects again afterward", async () => {
    const f = fixture();
    const report = await executeBundledDelta(f.input, f.deps);
    expect(report).toMatchObject({ status: "applied", commitConfirmed: true, deltaChanged: true, migrationRowsAfter: 18 });
    expect(f.calls).toEqual(["provenance", "proofs", "compile", "inspect", "compile", "provenance", "proofs", "begin", "locked-inspect", "invariant", "apply", "invariant", "commit", "close", "inspect"]);
  });
  it("rejects an extra deployment commit even when a provider labels it permitted", async () => {
    const f = fixture(); f.provenance.permittedDeploymentCommits.push(h("unapproved-deployment").slice(0, 40));
    await expect(executeBundledDelta(f.input, f.deps)).rejects.toThrow("actual artifact provenance");
    expect(f.calls).not.toContain("inspect"); expect(f.calls).not.toContain("begin");
  });
  it("rechecks changed reviewer authority after readonly inspection before BEGIN", async () => {
    const f = fixture(); const original = f.deps.verifyProvenance; let checks = 0;
    await expect(executeBundledDelta(f.input, { ...f.deps, verifyProvenance: async evidence => {
      const report = await original(evidence); return ++checks === 1 ? report : { ...report, approvedByGitHubActorId: "3002" };
    } })).rejects.toMatchObject({ code: "reauthorize-before-transaction", outcome: { sqlExecutionAttempted: false, commitAttempted: false } });
    expect(f.calls).not.toContain("begin");
  });
  it("rejects deployment or proof drift on the last authority read", async () => {
    const f = fixture(); const original = f.deps.verifyProofs; let checks = 0;
    await expect(executeBundledDelta(f.input, { ...f.deps, verifyProofs: async (evidence, provenance) => {
      if (++checks > 1) throw new Error("synthetic current alias changed"); return original(evidence, provenance);
    } })).rejects.toMatchObject({ code: "reauthorize-before-transaction", outcome: { sqlExecutionAttempted: false } });
    expect(f.calls).not.toContain("begin");
  });
  it("permits an identical approved after-state replay without claiming a fresh delta", async () => {
    const f = fixture(true);
    expect(await executeBundledDelta(f.input, f.deps)).toMatchObject({ status: "already-applied", deltaChanged: false, commitConfirmed: true });
  });
  it("rejects missing approval before provider or database calls", async () => {
    const f = fixture();
    await expect(executeBundledDelta({ ...f.input, approval: "APPROVE placeholder" }, f.deps)).rejects.toThrow("exact production approval");
    expect(f.calls).toEqual([]);
  });
  it("snapshots apply=false before asynchronous caller mutation can bypass approval", async () => {
    const f = fixture();
    const mutable = { ...f.input, apply: false, approval: "" };
    const original = f.deps.verifyProvenance;
    const report = await executeBundledDelta(mutable, { ...f.deps, verifyProvenance: async evidence => {
      mutable.apply = true; return original(evidence);
    } });
    expect(report.status).toBe("verified-dry-run"); expect(f.calls).not.toContain("begin");
  });
  it("copies caller bundle bytes before asynchronous mutation", async () => {
    const f = fixture(); const original = f.deps.verifyProvenance;
    const report = await executeBundledDelta({ ...f.input, apply: false, approval: "" }, { ...f.deps, verifyProvenance: async evidence => {
      f.input.committedBundleBytes.fill(0); return original(evidence);
    } });
    expect(report.status).toBe("verified-dry-run");
  });
  it("rejects stale actual snapshot reuse even while approval/proof TTLs remain valid", async () => {
    const f = fixture();
    await expect(executeBundledDelta(f.input, { ...f.deps, inspect: async () => {
      const value = f.state(); value.fingerprint.observedAt = new Date(DELTA_FIXTURE_NOW.valueOf() - 1000).toISOString(); return value;
    } })).rejects.toThrow("actual observation freshness");
    expect(f.calls).not.toContain("begin");
  });
  it("rejects a forged actual fingerprint root before beginning a transaction", async () => {
    const f = fixture();
    await expect(executeBundledDelta(f.input, { ...f.deps, inspect: async () => {
      const value = f.state(); value.fingerprint.components[0]!.sha256 = h("altered-schema"); return value;
    } })).rejects.toThrow("actual fingerprint root");
    expect(f.calls).not.toContain("begin");
  });
  it("rejects a source change while the approved program hash scalar remains unchanged", async () => {
    const f = fixture();
    f.program.applyDoSql = "DO $$BEGIN RAISE EXCEPTION 'changed'; END$$;";
    await expect(executeBundledDelta(f.input, f.deps)).rejects.toThrow("re-derived execution program");
    expect(f.calls).not.toContain("begin");
  });
  it("rejects incomplete capability closure", async () => {
    const f = fixture(); f.program.requiredCapabilities = [];
    await expect(executeBundledDelta(f.input, f.deps)).rejects.toThrow("capability coverage");
    expect(f.calls).not.toContain("begin");
  });
  it("rechecks expiry after a slow readonly inspection", async () => {
    const f = fixture();
    await expect(executeBundledDelta(f.input, { ...f.deps, inspect: async () => {
      f.setTime(DELTA_FIXTURE_NOW.valueOf() + 20 * 60000); return f.state();
    } })).rejects.toThrow("freshness/binding");
    expect(f.calls).not.toContain("begin");
  });
  it("rolls back when the locked before-state differs from the inspected state", async () => {
    const f = fixture(); f.tx.inspectExportedSnapshot = async () => f.state(true);
    await expect(executeBundledDelta(f.input, f.deps)).rejects.toMatchObject({ code: "transaction-before-state", outcome: { sqlExecutionAttempted: false, rollbackAcknowledged: true } });
    expect(f.calls).not.toContain("apply"); expect(f.calls).toContain("rollback");
  });
  it("refuses a stale locked snapshot before any DDL", async () => {
    const f = fixture(); f.tx.inspectExportedSnapshot = async () => {
      const value = f.state(); value.fingerprint.observedAt = new Date(DELTA_FIXTURE_NOW.valueOf() - 1).toISOString(); return value;
    };
    await expect(executeBundledDelta(f.input, f.deps)).rejects.toMatchObject({ code: "transaction-before-state" });
    expect(f.calls).not.toContain("apply"); expect(f.calls).toContain("rollback");
  });
  it.each(["unexpected-row-write", "unexpected-sequence-advance"])("rolls back but retains containment on %s postcondition failure", async changedState => {
    const f = fixture(); let count = 0;
    f.tx.captureInvariant = async () => { const value = f.invariant(count++ > 0); if (count > 1) value.dataSha256 = h(changedState); return value; };
    await expect(executeBundledDelta(f.input, f.deps)).rejects.toMatchObject({ code: "transaction-postconditions", outcome: { commitAttempted: false, rollbackAcknowledged: true, containmentRequired: true } });
    expect(f.calls).not.toContain("commit");
  });
  it("does not commit when approval expires during the fixed SQL operation", async () => {
    const f = fixture();
    f.tx.applyFixedProgram = async () => { f.calls.push("apply"); f.setTime(DELTA_FIXTURE_NOW.valueOf() + 20 * 60000); };
    await expect(executeBundledDelta(f.input, f.deps)).rejects.toMatchObject({ code: "immediately-before-commit", outcome: { commitAttempted: false, rollbackAcknowledged: true } });
    expect(f.calls).not.toContain("commit");
  });
  it("retains containment after a failed fixed program even when rollback acknowledges", async () => {
    const f = fixture(); f.tx.applyFixedProgram = async () => { throw new Error("synthetic trigger advanced a sequence then raised"); };
    await expect(executeBundledDelta(f.input, f.deps)).rejects.toMatchObject({ code: "fixed-delta", outcome: {
      sqlExecutionAttempted: true, rollbackAcknowledged: true, commitAttempted: false, containmentRequired: true,
    } });
    expect(f.calls).not.toContain("commit");
  });
  it("requires containment when write was attempted and rollback/close were not acknowledged", async () => {
    const f = fixture(); f.tx.applyFixedProgram = async () => { throw new Error("native failure"); };
    f.tx.rollback = async () => { throw new Error("rollback unavailable"); }; f.tx.close = async () => { throw new Error("socket unavailable"); };
    await expect(executeBundledDelta(f.input, f.deps)).rejects.toMatchObject({ code: "fixed-delta", outcome: { sqlExecutionAttempted: true, rollbackAcknowledged: false, containmentRequired: true } });
  });
  it("does not claim rollback after an uncertain commit response", async () => {
    const f = fixture(); f.tx.commitWithExpiryGuard = async () => { throw new Error("response lost"); };
    await expect(executeBundledDelta(f.input, f.deps)).rejects.toMatchObject({ outcome: { commitAttempted: true, commitConfirmed: false, rollbackAcknowledged: false, containmentRequired: true } });
    expect(f.calls).not.toContain("rollback");
  });
  it("reports committed-but-unverified when the fresh postflight diverges", async () => {
    const f = fixture(); let count = 0; f.deps.inspect = async () => f.state(count++ > 0 ? false : false);
    await expect(executeBundledDelta(f.input, f.deps)).rejects.toMatchObject({ code: "fresh-postcommit-state", outcome: { commitConfirmed: true, containmentRequired: true } });
    expect(f.calls).not.toContain("rollback");
  });
  it("retains monotonic clock checks after commit", async () => {
    const f = fixture(); const commit = f.tx.commitWithExpiryGuard;
    f.tx.commitWithExpiryGuard = async () => { await commit(); f.setTime(DELTA_FIXTURE_NOW.valueOf() - 1); };
    await expect(executeBundledDelta(f.input, f.deps)).rejects.toMatchObject({ code: "fresh-postcommit-state", outcome: { commitConfirmed: true, containmentRequired: true } });
  });
  it("never echoes native error text into the failure receipt", async () => {
    const f = fixture(); f.tx.applyFixedProgram = async () => { throw new Error("synthetic-sensitive-native-detail"); };
    let error: unknown;
    try { await executeBundledDelta(f.input, f.deps); } catch (value) { error = value; }
    expect(error).toBeInstanceOf(DeltaExecutionFailure); expect(String(error)).not.toContain("synthetic-sensitive");
  });
  it("bounds the database-side expiry by every proof/RPO deadline", () => {
    const f = fixture();
    const cutoff = Date.parse(deltaEffectiveExpiry(f.input.evidence as ReturnType<typeof makeDeltaReleaseFixture>["evidence"], f.input.context));
    expect(cutoff).toBeLessThanOrEqual(Date.parse((f.input.evidence as ReturnType<typeof makeDeltaReleaseFixture>["evidence"]).core.expiresAt));
    expect(cutoff).toBeLessThanOrEqual(DELTA_FIXTURE_NOW.valueOf() + 18 * 60000);
  });
});
