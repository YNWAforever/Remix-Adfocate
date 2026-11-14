// @vitest-environment node
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildPhase3RehearsalPlan, Phase3RehearsalPlanFailure, type Phase3RehearsalPlan, type Phase3RehearsalPlanMetadata, type Phase3RehearsalWorksheet } from "./delta-rehearsal-plan";
import { canonicalDeltaJson, digestDeltaProofPayload, parseDeltaEvidence } from "./delta-evidence";
import { DELTA_RECOVERY_CATEGORIES, DELTA_RELEASE_PROFILE, DELTA_RELEASE_PROJECT, DELTA_REQUIRED_GATES } from "./delta-release-contracts";
import { bindPairedRecoveryContext, type PairedRecoveryContext } from "./delta-recovery";

// All populated declarations are fictional unit DTOs, never owner decisions or
// native evidence. No source client, archive, store, provider or process is used.
const io = vi.hoisted(() => ({ fs: vi.fn(() => { throw new Error("Filesystem forbidden in pure plan tests"); }), spawn: vi.fn(() => { throw new Error("Child processes forbidden"); }) }));
vi.mock("node:fs/promises", () => ({ mkdir: io.fs, readFile: io.fs, writeFile: io.fs }));
vi.mock("node:child_process", () => ({ spawn: io.spawn }));
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const SOURCE = hash("fictional-unit-source").slice(0, 40), PREPARED = "2026-11-15T00:00:00.000Z";
const ROLES = ["executor", "observer", "containmentOwner", "productOwner", "approver"] as const;
const BUDGETS = ["maximumRpoSeconds", "maximumRtoSeconds", "maximumEvidenceAgeMs", "maximumEvidenceLifetimeMs", "maximumProofAgeMs"] as const;
const FLAGS = ["allDdlWritersFrozen", "globalCatalogControlled", "sequenceAndApplicationWritersQuiesced", "deploymentsAndConfigurationFrozen"] as const;
type Mutable<T> = { -readonly [Key in keyof T]: T[Key] extends object ? Mutable<T[Key]> : T[Key] };
type Draft = Mutable<Phase3RehearsalWorksheet>;
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
function metadata(): Phase3RehearsalPlanMetadata { return { sourceCommit: SOURCE, preparedAt: PREPARED, manifestSourceCount: 67, worksheetSha256: hash("fictional raw worksheet bytes") }; }
function unknownWorksheet(): Draft {
  return { schemaVersion: 1, kind: "phase3-owner-rehearsal-worksheet", projectRef: DELTA_RELEASE_PROJECT, sourceCommit: SOURCE, githubReviewerId: null,
    roles: { executor: null, observer: null, containmentOwner: null, productOwner: null, approver: null }, recoveryAcceptedBy: null,
    budgets: { maximumRpoSeconds: null, maximumRtoSeconds: null, maximumEvidenceAgeMs: null, maximumEvidenceLifetimeMs: null, maximumProofAgeMs: null },
    recoveryCoverage: DELTA_RECOVERY_CATEGORIES.map(category => ({ category, decision: null, acceptanceReference: null })),
    freeze: { startsAt: null, expiresAt: null, changeControlReference: null, allDdlWritersFrozen: null, globalCatalogControlled: null, sequenceAndApplicationWritersQuiesced: null, deploymentsAndConfigurationFrozen: null },
    planReferences: { captureScope: null, containment: null, forwardRecovery: null } };
}
function completeWorksheet(): Draft {
  const row = unknownWorksheet(); row.githubReviewerId = "123456789";
  for (const role of ROLES) row.roles[role] = `fictional-person-${role}`;
  row.recoveryAcceptedBy = "fictional-recovery-reviewer";
  row.budgets = { maximumRpoSeconds: 1200, maximumRtoSeconds: 600, maximumEvidenceAgeMs: 300000, maximumEvidenceLifetimeMs: 900000, maximumProofAgeMs: 900000 };
  for (const [index, coverage] of row.recoveryCoverage.entries()) {
    coverage.decision = index < 4 ? "verify" : "accept-not-covered"; coverage.acceptanceReference = index < 4 ? null : `fictional-review-${coverage.category}`;
  }
  row.freeze = { startsAt: "2026-11-15T00:10:00.000Z", expiresAt: "2026-11-15T00:20:00.000Z", changeControlReference: "fictional-change-control-review",
    allDdlWritersFrozen: true, globalCatalogControlled: true, sequenceAndApplicationWritersQuiesced: true, deploymentsAndConfigurationFrozen: true };
  row.planReferences = { captureScope: "fictional-scope-review", containment: "fictional-containment-review", forwardRecovery: "fictional-forward-recovery-review" }; return row;
}
function changed(path: string, value: unknown, row: unknown = completeWorksheet()) {
  const result = copy(row) as Record<string, unknown>, keys = path.split("."); let target = result;
  for (const key of keys.slice(0, -1)) target = target[key] as Record<string, unknown>;
  target[keys.at(-1)!] = value; return result;
}
function rejected(input: unknown, meta: unknown = metadata()) {
  let failure: unknown;
  try { buildPhase3RehearsalPlan(input, meta as Phase3RehearsalPlanMetadata); } catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(Phase3RehearsalPlanFailure);
  const error = failure as Phase3RehearsalPlanFailure;
  expect(error.message).toBe("Offline rehearsal worksheet rejected"); expect(error.code).toMatch(/^(worksheet-shape|metadata-shape|invalid-text|invalid-budget|invalid-coverage|invalid-freeze|protected-parser|worksheet-rejected)$/);
  expect(error).not.toHaveProperty("cause"); expect(String(error)).not.toContain("private-marker"); expect(JSON.stringify(error)).not.toContain("private-marker");
}
function held(plan: Phase3RehearsalPlan) {
  expect(plan).toMatchObject({ schemaVersion: 1, kind: "phase3-rehearsal-plan", status: "HOLD", accepted: false, validReleaseEvidence: false,
    ownerAccepted: false, productionEquivalent: false, captureAuthorized: false, executionAuthorized: false, protectedV2ParserRejected: true });
  expect(plan).not.toHaveProperty("executeAuthorized"); expect(plan.gates.map(row => row.gate)).toEqual(DELTA_REQUIRED_GATES);
  expect(plan.gates).toHaveLength(16); expect(plan.gates.every(row => row.status === "HOLD" && row.accepted === false)).toBe(true);
}
beforeEach(() => { io.fs.mockClear(); io.spawn.mockClear(); vi.stubGlobal("fetch", vi.fn(() => { throw new Error("HTTP forbidden in pure plan tests"); })); });
afterEach(() => { expect(io.fs).not.toHaveBeenCalled(); expect(io.spawn).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe("pure offline owner worksheet planning, never authority", () => {
  it("keeps every unknown null and reports fixed missing paths without defaults", () => {
    const row = unknownWorksheet(), before = copy(row), plan = buildPhase3RehearsalPlan(row, metadata()); held(plan);
    expect(plan.decisionStatus).toBe("incomplete"); expect(plan.declaredInputs).toEqual(before); expect(row).toEqual(before);
    expect(plan.missingInputs).toEqual(expect.arrayContaining(["githubReviewerId", ...ROLES.map(role => `roles.${role}`), "recoveryAcceptedBy", ...BUDGETS.map(key => `budgets.${key}`),
      ...DELTA_RECOVERY_CATEGORIES.map(category => `recoveryCoverage.${category}.decision`), "freeze.startsAt", "freeze.expiresAt", "freeze.changeControlReference", ...FLAGS.map(key => `freeze.${key}`),
      "planReferences.captureScope", "planReferences.containment", "planReferences.forwardRecovery"]));
    expect(plan.missingInputs.some(path => path.endsWith("acceptanceReference"))).toBe(false); expect(plan.blockers).toEqual([]);
  });
  it("treats a known reviewer and mandatory verify choices as declarations, with no invented future proof reference", () => {
    const row = unknownWorksheet(); row.githubReviewerId = "201698560"; for (const coverage of row.recoveryCoverage.slice(0, 4)) coverage.decision = "verify";
    const plan = buildPhase3RehearsalPlan(row, metadata()); held(plan); expect(plan.decisionStatus).toBe("incomplete");
    expect(plan.missingInputs).not.toContain("githubReviewerId"); expect(plan.missingInputs.some(path => path.endsWith("acceptanceReference"))).toBe(false);
    for (const coverage of row.recoveryCoverage.slice(0, 4)) expect(plan.missingInputs).not.toContain(`recoveryCoverage.${coverage.category}.decision`);
    expect(plan.declaredInputs.roles).toEqual(row.roles); expect(plan.declaredInputs.budgets).toEqual(row.budgets);
  });
  it("calls a complete fictional declaration complete-unverified while every authority and gate stays false/HOLD", () => {
    const plan = buildPhase3RehearsalPlan(completeWorksheet(), metadata()); held(plan);
    expect(plan.decisionStatus).toBe("complete-unverified"); expect(plan.missingInputs).toEqual([]); expect(plan.blockers).toEqual([]);
    expect(plan.nextPrerequisites).toContain("owner-decision-review-and-separate-capture-authorization"); expect(plan.nextPrerequisites).toContain("complete-sixteen-gate-proof-reports");
    expect(plan.nextPrerequisites.join(" ")).not.toMatch(/npm|--apply|--input|CREATE|pg_dump/);
  });
  it("allows overlap in all five role labels without inventing a separation rule", () => {
    const row = completeWorksheet(); for (const role of ROLES) row.roles[role] = "fictional-same-person";
    const plan = buildPhase3RehearsalPlan(row, metadata()); expect(plan.decisionStatus).toBe("complete-unverified"); held(plan);
  });
  it("allows optional verification choices without an acceptance reference", () => {
    const row = completeWorksheet(); for (const coverage of row.recoveryCoverage) { coverage.decision = "verify"; coverage.acceptanceReference = null; }
    const plan = buildPhase3RehearsalPlan(row, metadata()); expect(plan.decisionStatus).toBe("complete-unverified"); expect(plan.missingInputs).toEqual([]); held(plan);
  });
  it("reports only the reference as missing when accepting an optional uncovered category without one", () => {
    const row = completeWorksheet(); row.recoveryCoverage[4]!.acceptanceReference = null;
    const plan = buildPhase3RehearsalPlan(row, metadata()); expect(plan.decisionStatus).toBe("incomplete"); expect(plan.missingInputs).toEqual(["recoveryCoverage.storage-object-bytes.acceptanceReference"]); held(plan);
  });
  it("reports an unselected category as missing even if a reference was supplied", () => {
    const row = completeWorksheet(); row.recoveryCoverage[4]!.decision = null;
    expect(buildPhase3RehearsalPlan(row, metadata()).missingInputs).toEqual(["recoveryCoverage.storage-object-bytes.decision"]);
  });
  it("uses fixed missing-path order despite coverage-row order", () => {
    const first = unknownWorksheet(), reversed = copy(first); reversed.recoveryCoverage.reverse();
    expect(buildPhase3RehearsalPlan(first, metadata()).missingInputs).toEqual(buildPhase3RehearsalPlan(reversed, metadata()).missingInputs);
  });
  it("binds raw and canonical digests separately and computes a deterministic complete payload digest", () => {
    const row = completeWorksheet(), meta = metadata(), first = buildPhase3RehearsalPlan(row, meta), second = buildPhase3RehearsalPlan(row, meta);
    expect(first).toEqual(second); expect(first.worksheetSha256).toBe(meta.worksheetSha256); expect(first.worksheetDigest).toBe(digestDeltaProofPayload(row));
    const { contentDigest, ...payload } = first; expect(contentDigest).toBe(digestDeltaProofPayload(payload));
    const altered = buildPhase3RehearsalPlan(changed("roles.observer", "fictional-other-observer"), meta); expect(altered.worksheetDigest).not.toBe(first.worksheetDigest); expect(altered.contentDigest).not.toBe(first.contentDigest);
  });
  it("detaches and freezes declarations so caller mutation cannot change a prepared report", () => {
    const row = completeWorksheet(), plan = buildPhase3RehearsalPlan(row, metadata()); row.roles.executor = "fictional-changed"; row.recoveryCoverage[0]!.decision = null;
    expect(plan.declaredInputs.roles.executor).toBe("fictional-person-executor"); expect(plan.declaredInputs.recoveryCoverage[0]!.decision).toBe("verify");
    expect(Object.isFrozen(plan)).toBe(true); expect(Object.isFrozen(plan.declaredInputs.roles)).toBe(true);
    expect(() => { (plan as unknown as Record<string, unknown>).captureAuthorized = true; }).toThrow(); held(plan);
  });
  it("is rejected by protected v2 parsing, also after superficial relabeling and rerooting its digest", () => {
    const plan = buildPhase3RehearsalPlan(completeWorksheet(), metadata()); expect(parseDeltaEvidence(plan).evidence).toBeUndefined();
    const { contentDigest: old, ...body } = plan; void old;
    const relabeled = { ...body, schemaVersion: 2, kind: "protected-bundled-xp-release", profile: DELTA_RELEASE_PROFILE };
    expect(parseDeltaEvidence({ ...relabeled, contentDigest: digestDeltaProofPayload(relabeled) }).evidence).toBeUndefined();
  });
});

describe("closed types, coverage and private-safe rejection", () => {
  it.each([null, [], "private-marker", 1, true])("rejects nonobject worksheet %j", value => { rejected(value); });
  it.each(["schemaVersion", "kind", "projectRef", "sourceCommit", "githubReviewerId", "roles", "recoveryAcceptedBy", "budgets", "recoveryCoverage", "freeze", "planReferences"])("requires worksheet field %s", key => {
    const row = copy(completeWorksheet()) as unknown as Record<string, unknown>; delete row[key]; rejected(row);
  });
  it.each(["", "roles", "budgets", "freeze", "planReferences", "recoveryCoverage.0"])("rejects extra fields at closed object %s", path => {
    rejected(changed(path ? `${path}.privateToken` : "privateToken", "private-marker"));
  });
  it.each([{ path: "schemaVersion", value: 2 }, { path: "kind", value: "protected-bundled-xp-release" }, { path: "projectRef", value: "other-project" },
    { path: "sourceCommit", value: SOURCE.toUpperCase() }, { path: "sourceCommit", value: "a".repeat(39) }, { path: "githubReviewerId", value: "user-label" },
    { path: "githubReviewerId", value: 1234 }, { path: "roles.executor", value: 1234 }, { path: "freeze.allDdlWritersFrozen", value: 1 }])("rejects invalid field $path=$value", ({ path, value }) => { rejected(changed(path, value)); });
  it.each(["", " ", "TODO", "TBD", "unknown", "pending", "none", "null", "undefined", "n/a", "not-tested", "<owner>", "review TODO now", " owner", "owner ", "private-marker\n", "private-marker\u0000", "private-marker\u007f", "x".repeat(4097)])("rejects invalid declaration text %j", value => { rejected(changed("roles.observer", value)); });
  it.each(["C:\\private-marker\\archive", "C:/private-marker/archive", "\\\\host\\private-marker", "\\private-marker\\archive", "/private-marker/archive", "//host/private-marker", "file:///private-marker", "review C:\\private-marker\\archive", "scope (/private-marker/archive)"])("rejects absolute filesystem text %s", value => { rejected(changed("planReferences.captureScope", value)); });
  it.each(["postgresql://user:private-marker@db.invalid/postgres", "eyJprivate-marker.payload.signature", "--token private-marker", "person@private-marker.invalid", "sb_secret_private-marker-value"])("rejects sensitive values without returning them: %s", value => { rejected(changed("recoveryAcceptedBy", value)); });
  it("permits a public control URL or relative document reference without following it", () => {
    const row = completeWorksheet(); row.planReferences.captureScope = "docs/operations/fictional-scope.md"; row.freeze.changeControlReference = "https://example.invalid/fictional-review";
    expect(buildPhase3RehearsalPlan(row, metadata()).decisionStatus).toBe("complete-unverified");
  });
  it.each(["duplicate", "missing", "unknown", "extra", "sparse", "array-property", "unknown-decision", "row-extra"])("rejects malformed coverage: %s", mode => {
    const row = completeWorksheet();
    if (mode === "duplicate") row.recoveryCoverage[8]!.category = row.recoveryCoverage[0]!.category;
    if (mode === "missing") row.recoveryCoverage.pop(); if (mode === "extra") row.recoveryCoverage.push(copy(row.recoveryCoverage[0]!));
    if (mode === "unknown") (row.recoveryCoverage[8] as unknown as Record<string, unknown>).category = "private-marker-category";
    if (mode === "sparse") delete (row.recoveryCoverage as unknown as Record<string, unknown>)["1"];
    if (mode === "array-property") (row.recoveryCoverage as unknown as Record<string, unknown>).privateToken = "private-marker";
    if (mode === "unknown-decision") (row.recoveryCoverage[8] as unknown as Record<string, unknown>).decision = "accepted";
    if (mode === "row-extra") (row.recoveryCoverage[8] as unknown as Record<string, unknown>).verified = true;
    rejected(row);
  });
  it.each([0, 1, 2, 3])("cannot accept mandatory category %i as uncovered", index => {
    const row = completeWorksheet(); row.recoveryCoverage[index]!.decision = "accept-not-covered"; row.recoveryCoverage[index]!.acceptanceReference = "fictional-review"; rejected(row);
  });
  it("validates a supplied reference even when the decision is verify", () => { rejected(changed("recoveryCoverage.0.acceptanceReference", "TODO")); });
  it.each(["prototype", "symbol", "nonenumerable", "getter"])("rejects non-JSON worksheet shape %s without invoking a getter", mode => {
    const row = completeWorksheet(), getter = vi.fn(() => "private-marker");
    if (mode === "prototype") Object.setPrototypeOf(row, { privateToken: "private-marker" });
    if (mode === "symbol") Object.defineProperty(row, Symbol("private-marker"), { value: "private-marker" });
    if (mode === "nonenumerable") Object.defineProperty(row, "hidden", { value: "private-marker" });
    if (mode === "getter") Object.defineProperty(row.roles, "executor", { enumerable: true, get: getter });
    rejected(row); expect(getter).not.toHaveBeenCalled();
  });
  it("normalizes exceptions and forged error instances without retaining their message/code/cause", () => {
    const forged = Object.create(Phase3RehearsalPlanFailure.prototype) as Error; Object.assign(forged, { message: "private-marker", code: "private-marker", cause: "private-marker" });
    for (const error of [new Error("private-marker"), forged]) rejected(new Proxy({}, { getPrototypeOf() { throw error; } }));
    const branded = new Phase3RehearsalPlanFailure("invalid-text"); branded.message = "private-marker"; rejected(new Proxy({}, { getPrototypeOf() { throw branded; } }));
  });
});

describe("owner numeric and freeze declarations", () => {
  it.each(BUDGETS)("requires finite safe integer range for %s", key => {
    for (const value of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN, Number.POSITIVE_INFINITY, "600", true]) {
      const row = completeWorksheet(); (row.budgets as unknown as Record<string, unknown>)[key] = value; rejected(row);
    }
  });
  it("allows zero RPO/RTO as declarations without making capture possible or authorized", () => {
    const row = completeWorksheet(); row.budgets.maximumRpoSeconds = 0; row.budgets.maximumRtoSeconds = 0;
    const plan = buildPhase3RehearsalPlan(row, metadata()); expect(plan.decisionStatus).toBe("complete-unverified"); held(plan);
  });
  it.each(["maximumEvidenceAgeMs", "maximumEvidenceLifetimeMs", "maximumProofAgeMs"])("rejects zero %s", key => { rejected(changed(`budgets.${key}`, 0)); });
  it.each(FLAGS)("reports false and null freeze flag %s as missing, with no freeze verification", key => {
    for (const value of [false, null]) { const plan = buildPhase3RehearsalPlan(changed(`freeze.${key}`, value), metadata()); expect(plan.missingInputs).toEqual([`freeze.${key}`]); expect(plan.decisionStatus).toBe("incomplete"); held(plan); }
  });
  it.each(["2026-11-15", "2026-11-15T00:10:00Z", "2026-11-15T08:10:00.000+08:00", "2026-02-30T00:10:00.000Z", "2026-11-15T24:10:00.000Z"])("requires canonical real UTC freeze timestamp %s", value => { rejected(changed("freeze.startsAt", value)); });
  it.each(["2026-11-15T00:10:00.000Z", "2026-11-15T00:09:59.999Z"])("requires freeze expiry strictly after start: %s", value => { rejected(changed("freeze.expiresAt", value)); });
  it("reports an expired declaration window as a fixed blocker, not invalid owner data or authority", () => {
    const row = completeWorksheet(); row.freeze.startsAt = "2026-11-14T23:00:00.000Z"; row.freeze.expiresAt = PREPARED;
    const plan = buildPhase3RehearsalPlan(row, metadata()); expect(plan.blockers).toEqual(["freeze-window-expired"]); expect(plan.missingInputs).toEqual([]); expect(plan.decisionStatus).toBe("incomplete"); held(plan);
  });
  it("supports a partial freeze date declaration without inventing its other endpoint", () => {
    const row = completeWorksheet(); row.freeze.startsAt = null; const plan = buildPhase3RehearsalPlan(row, metadata()); expect(plan.missingInputs).toEqual(["freeze.startsAt"]); held(plan);
  });
});

describe("closed preparation metadata and existing pure producer limits", () => {
  it.each(["sourceCommit", "preparedAt", "manifestSourceCount", "worksheetSha256"])("requires metadata field %s", key => {
    const meta = metadata() as unknown as Record<string, unknown>; delete meta[key]; rejected(completeWorksheet(), meta);
  });
  it.each([{ key: "privateToken", value: "private-marker" }, { key: "sourceCommit", value: hash("different source").slice(0, 40) },
    { key: "sourceCommit", value: SOURCE.toUpperCase() }, { key: "manifestSourceCount", value: 66 }, { key: "manifestSourceCount", value: "67" },
    { key: "worksheetSha256", value: "a".repeat(63) }, { key: "worksheetSha256", value: "A".repeat(64) }, { key: "preparedAt", value: "2026-02-30T00:00:00.000Z" },
    { key: "preparedAt", value: "2026-11-15T00:00:00Z" }])("rejects invalid metadata $key=$value", ({ key, value }) => { rejected(completeWorksheet(), { ...metadata(), [key]: value }); });
  it("agrees with actual pure paired-producer boundary validation and never extends limits for larger owner budgets", () => {
    const row = completeWorksheet(); for (const key of BUDGETS) row.budgets[key] = Number.MAX_SAFE_INTEGER;
    const plan = buildPhase3RehearsalPlan(row, metadata()), limits = plan.producerLimits; held(plan);
    expect(limits).toEqual({ maximumCaptureMs: 600000, maximumRestoreMs: 600000, maximumArchiveBytes: 67108864, maximumPairedLifetimeMs: 900000, runtimeInspectionTtlMs: 60000 });
    const context: PairedRecoveryContext = { schemaVersion: 1, projectRef: DELTA_RELEASE_PROJECT, sourceCommit: SOURCE, scopeDigest: hash("fictional scope"), targetBindingHash: hash("fictional target"), beforeRoot: hash("fictional root"),
      collectorSha256: hash("fictional collector"), canonicalizerSha256: hash("fictional normalizer"), dataCollectorSha256: hash("fictional data collector"), dataNormalizerSha256: hash("fictional data normalizer"),
      extensionProfileHash: hash("fictional extensions"), toolProfileHash: hash("fictional tools"), changeControlReferenceHash: hash("fictional controls"),
      expiresAt: new Date(Date.parse(PREPARED) + limits.maximumPairedLifetimeMs).toISOString(), maximumCaptureMs: limits.maximumCaptureMs, maximumRestoreMs: limits.maximumRestoreMs, maximumArchiveBytes: limits.maximumArchiveBytes };
    expect(bindPairedRecoveryContext(context, new Date(PREPARED))).toEqual(context);
    for (const key of ["maximumCaptureMs", "maximumRestoreMs", "maximumArchiveBytes"] as const) expect(() => bindPairedRecoveryContext({ ...context, [key]: context[key] + 1 }, new Date(PREPARED))).toThrow();
    expect(() => bindPairedRecoveryContext({ ...context, expiresAt: new Date(Date.parse(context.expiresAt) + 1).toISOString() }, new Date(PREPARED))).toThrow();
    expect(canonicalDeltaJson(plan)).not.toContain("APPROVE ");
  });
});
