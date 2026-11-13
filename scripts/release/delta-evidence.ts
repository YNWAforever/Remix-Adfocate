import { createHash } from "node:crypto";
import { assertSanitized, parseEvidence, verifyEvidence } from "./evidence";
import {
  DELTA_BASELINE_HISTORY_SHA256, DELTA_COMBINED_SQL_SHA256, DELTA_EXPORT_COMPONENTS,
  DELTA_RECOVERY_CATEGORIES, DELTA_RELEASE_PROFILE, DELTA_RELEASE_PROJECT, DELTA_REQUIRED_GATES,
  DELTA_REVIEWED_PACKET_SHA256, DELTA_SOURCE_SHA256,
} from "./delta-release-contracts";
import type {
  DeltaEquivalenceProof, DeltaExpectedContext, DeltaGateProof, DeltaRecoveryCategory,
  DeltaRecoveryProof, DeltaReleaseEvidence, DeltaReleasePlan, DeltaSemanticFingerprint,
} from "./delta-release-contracts";

const VERSION = "20261113090001";
const ROLES = ["executor", "observer", "containmentOwner", "productOwner", "approver"] as const;
const DEFERRED = new Map([
  ["20261103215321", "76d30f9f3fbb296ab5c27589e42d304dcd8ed52bcc444ccb4c2189fe9fb0b22d"],
  ["20261104134202", "d740d13d59e722548d4396639b62f9423ba1b287e42c639032c0f0de09a45eb7"],
]);
const RETIRED_SOURCE = "47db6932bbfe05aff34d6f91e2f8717ae3dd14c3ccf0041d5678ee29a8e16436";
const MANDATORY_RECOVERY: readonly DeltaRecoveryCategory[] = [
  "database-schema", "database-rows", "role-definitions-without-passwords", "storage-configuration",
];
const FP_KEYS = ["schemaVersion", "algorithm", "scopeDigest", "collectorSha256", "canonicalizerSha256", "targetBindingHash",
  "snapshotBindingHash", "observedAt", "expiresAt", "environment", "components"];
const ENVELOPE_KEYS = ["schemaVersion", "kind", "profile", "core", "plan", "equivalence", "recovery", "gates", "warnings", "skippedChecks"];
const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
function fail(path: string, reason: string): never { throw new Error(`${path}: ${reason}`); }

function object(value: unknown, keys: readonly string[], path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Object.getOwnPropertySymbols(value).length) fail(path, "plain object required");
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== keys.length || keys.some(key => !Object.hasOwn(row, key))) fail(path, "unknown or missing fields");
  return row;
}
function text(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 4096 || value !== value.trim()
    || Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
    || /^(?:todo|tbd|unknown|pending|placeholder|none|null|undefined|n\/a|not[-_ ]?(?:run|tested|available))$/i.test(value)
    || /(?:<[^>]+>|\b(?:TODO|TBD|placeholder)\b)/i.test(value)) fail(path, "non-placeholder text required");
  return value;
}
function hex(value: unknown, path: string, length = 64): string {
  const result = text(value, path);
  if (!new RegExp(`^[a-f0-9]{${length}}$`).test(result) || /^(.)\1+$/.test(result)) fail(path, "non-placeholder lowercase digest required");
  return result;
}
function integer(value: unknown, path: string, minimum = 0): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) fail(path, "safe integer required");
  return value;
}
function array(value: unknown, path: string, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum || Object.keys(value).length !== value.length || Object.getOwnPropertySymbols(value).length
    || Array.from({ length: value.length }, (_, index) => index).some(index => !Object.hasOwn(value, index))) fail(path, "bounded dense array required");
  return value;
}
function same(actual: unknown, expected: unknown, path: string) {
  if (canonicalDeltaJson(actual) !== canonicalDeltaJson(expected)) fail(path, "binding mismatch");
}
function stamp(value: unknown, path: string): number {
  const source = text(value, path);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/.exec(source);
  if (!match) fail(path, "explicitly zoned timestamp required");
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  if (month! < 1 || month! > 12 || day! < 1 || day! > new Date(Date.UTC(year!, month!, 0)).getUTCDate()
    || hour! > 23 || minute! > 59 || second! > 59 || !Number.isFinite(Date.parse(source))) fail(path, "invalid timestamp");
  return Date.parse(source);
}
function interval(observed: unknown, expires: unknown, path: string) {
  const start = stamp(observed, `${path}.observedAt`);
  const end = stamp(expires, `${path}.expiresAt`);
  if (end <= start) fail(path, "expiry must follow observation");
  return { start, end };
}

/** Strict JSON canonicalization: ordinal object keys; array order is significant. */
export function canonicalDeltaJson(value: unknown): string {
  const seen = new Set<object>();
  let nodes = 0;
  function visit(item: unknown, depth: number): string {
    if (++nodes > 20000 || depth > 32) fail("canonical JSON", "size or depth limit exceeded");
    if (item === null) return "null";
    if (typeof item === "string" || typeof item === "boolean") return JSON.stringify(item);
    if (typeof item === "number" && Number.isFinite(item)) return JSON.stringify(item);
    if (typeof item !== "object" || seen.has(item)) fail("canonical JSON", "non-JSON or cyclic value");
    seen.add(item);
    try {
      if (Array.isArray(item)) return `[${array(item, "canonical JSON", 10000).map(child => visit(child, depth + 1)).join(",")}]`;
      if (![Object.prototype, null].includes(Object.getPrototypeOf(item)) || Object.getOwnPropertySymbols(item).length) fail("canonical JSON", "plain JSON object required");
      return `{${Object.keys(item).sort(compare).map(key => `${JSON.stringify(key)}:${visit((item as Record<string, unknown>)[key], depth + 1)}`).join(",")}}`;
    } finally { seen.delete(item); }
  }
  return visit(value, 0);
}

/** Hashes the actual complete payload; it does not authenticate its producer. */
export function digestDeltaProofPayload(value: unknown): string {
  return createHash("sha256").update(canonicalDeltaJson(value), "utf8").digest("hex");
}
export function digestDeltaPlan(plan: DeltaReleasePlan): string { return digestDeltaProofPayload(plan); }
export function digestDeltaEquivalenceProof(proof: DeltaEquivalenceProof): string { return digestDeltaProofPayload(proof); }

function fingerprint(value: unknown, path: string, checkRoot: boolean): DeltaSemanticFingerprint {
  const hasRoot = value !== null && typeof value === "object" && Object.hasOwn(value, "rootSha256");
  const row = object(value, [...FP_KEYS, ...(hasRoot ? ["rootSha256"] : [])], path);
  same(row.schemaVersion, 1, path); same(row.algorithm, "pg17-canonical-export-v1", path);
  for (const key of ["scopeDigest", "collectorSha256", "canonicalizerSha256", "targetBindingHash", "snapshotBindingHash"]) hex(row[key], `${path}.${key}`);
  interval(row.observedAt, row.expiresAt, path);
  const env = object(row.environment, ["serverVersionNum", "dumpVersion", "extensionProfileHash", "databaseName"], `${path}.environment`);
  same(env.serverVersionNum, "170006", path); same(env.dumpVersion, "17.11", path); same(env.databaseName, "postgres", path);
  hex(env.extensionProfileHash, `${path}.extensionProfileHash`);
  const components = array(row.components, `${path}.components`, DELTA_EXPORT_COMPONENTS.length);
  const categories = new Set<string>();
  for (const item of components) {
    const component = object(item, ["category", "coverage", "objectCount", "sha256"], `${path}.component`);
    const category = text(component.category, `${path}.category`);
    if (!(DELTA_EXPORT_COMPONENTS as readonly string[]).includes(category) || categories.has(category)) fail(path, "unknown or duplicate component");
    categories.add(category); same(component.coverage, "complete", `${path}.coverage`);
    integer(component.objectCount, `${path}.objectCount`, category === "schema-export" ? 1 : 0);
    hex(component.sha256, `${path}.component.sha256`);
  }
  if (categories.size !== DELTA_EXPORT_COMPONENTS.length) fail(path, "incomplete component coverage");
  if (hasRoot) hex(row.rootSha256, `${path}.rootSha256`);
  if (checkRoot && (!hasRoot || row.rootSha256 !== semanticRoot(row as unknown as DeltaSemanticFingerprint))) fail(path, "semantic root mismatch");
  return row as unknown as DeltaSemanticFingerprint;
}
function semanticRoot(value: DeltaSemanticFingerprint | Omit<DeltaSemanticFingerprint, "rootSha256">) {
  const { schemaVersion, algorithm, scopeDigest, collectorSha256, canonicalizerSha256, environment } = value;
  return digestDeltaProofPayload({ schemaVersion, algorithm, scopeDigest, collectorSha256, canonicalizerSha256, environment,
    components: [...value.components].sort((left, right) => compare(left.category, right.category)) });
}
/** Cross-database semantics only; provenance remains bound by full-payload hashes. */
export function digestDeltaSemanticFingerprint(value: DeltaSemanticFingerprint | Omit<DeltaSemanticFingerprint, "rootSha256">): string {
  fingerprint(value, "fingerprint", false);
  return semanticRoot(value);
}

function planShape(value: unknown): DeltaReleasePlan {
  const p = object(value, ["schemaVersion", "kind", "profile", "targetProjectRef", "sourceCommit", "manifestDigest", "scopeDigest", "baseline", "delta",
    "deferred", "retiredConstraint", "requiredCapabilitiesHash", "requiredCapabilityCount", "targetBindingHash", "collectorSha256", "canonicalizerSha256", "invariantCollectorSha256"], "plan");
  same(p.schemaVersion, 1, "plan"); same(p.kind, "combined-baseline-xp-delta-plan", "plan");
  same(p.profile, DELTA_RELEASE_PROFILE, "plan"); same(p.targetProjectRef, DELTA_RELEASE_PROJECT, "plan");
  hex(p.sourceCommit, "plan.sourceCommit", 40);
  for (const key of ["manifestDigest", "scopeDigest", "requiredCapabilitiesHash", "targetBindingHash", "collectorSha256", "canonicalizerSha256", "invariantCollectorSha256"]) hex(p[key], `plan.${key}`);
  integer(p.requiredCapabilityCount, "plan.requiredCapabilityCount", 1);
  const b = object(p.baseline, ["recordedRows", "historySha256", "combinedVersion", "combinedName", "appliedSqlSha256", "sourceEnvelopeCount", "successors"], "plan.baseline");
  same(b.recordedRows, 17, "plan.baseline"); same(b.historySha256, DELTA_BASELINE_HISTORY_SHA256, "plan.baseline");
  same(b.combinedVersion, "20261031201901", "plan.baseline"); same(b.combinedName, "kocmax_studio_shared_review_c879b204", "plan.baseline");
  same(b.appliedSqlSha256, DELTA_COMBINED_SQL_SHA256, "plan.baseline"); same(b.sourceEnvelopeCount, 62, "plan.baseline");
  same(b.successors, ["20261101075946", "20261113090000"], "plan.baseline.successors");
  const d = object(p.delta, ["version", "name", "sourceSha256", "reviewedPacketSha256", "executionProgramSha256"], "plan.delta");
  same(d.version, VERSION, "plan.delta"); same(d.name, "active_assignment_xp_neutrality", "plan.delta");
  same(d.sourceSha256, DELTA_SOURCE_SHA256, "plan.delta.sourceSha256"); same(d.reviewedPacketSha256, DELTA_REVIEWED_PACKET_SHA256, "plan.delta.reviewedPacketSha256");
  hex(d.executionProgramSha256, "plan.delta.executionProgramSha256");
  const deferred = array(p.deferred, "plan.deferred", 2);
  const versions = new Set<string>();
  for (const item of deferred) {
    const row = object(item, ["version", "sourceSha256", "absenceProofHash"], "plan.deferred");
    const version = text(row.version, "plan.deferred.version");
    if (!DEFERRED.has(version) || versions.has(version)) fail("plan.deferred", "unknown or duplicate source");
    versions.add(version); same(row.sourceSha256, DEFERRED.get(version), "plan.deferred.sourceSha256"); hex(row.absenceProofHash, "plan.deferred.absenceProofHash");
  }
  if (versions.size !== 2) fail("plan.deferred", "both deferred sources required");
  const retired = object(p.retiredConstraint, ["removalVersion", "sourceSha256", "absenceProofHash"], "plan.retiredConstraint");
  same(retired.removalVersion, "20260720193637", "plan.retiredConstraint"); same(retired.sourceSha256, RETIRED_SOURCE, "plan.retiredConstraint");
  hex(retired.absenceProofHash, "plan.retiredConstraint.absenceProofHash");
  return p as unknown as DeltaReleasePlan;
}
function equivalenceShape(value: unknown, plan: DeltaReleasePlan): DeltaEquivalenceProof {
  const e = object(value, ["schemaVersion", "kind", "scopeDigest", "sourceBefore", "reviewedReferenceBefore", "restoredBefore", "emptyAfter", "shapedAfter", "replayAfter",
    "expectedAfterRoot", "requiredCapabilitiesHash", "requiredCapabilityCount", "transactionInvariantAlgorithm", "transactionInvariantCollectorSha256",
    "unchangedCatalogReceiptHash", "unchangedDataReceiptHash", "targetAttributesAclReceiptHash", "replayTupleReceiptHash", "allowedChanges", "observedAt", "expiresAt"], "equivalence");
  same(e.schemaVersion, 1, "equivalence"); same(e.kind, "reviewed-baseline-and-delta-equivalence", "equivalence"); same(e.scopeDigest, plan.scopeDigest, "equivalence.scopeDigest");
  same(e.requiredCapabilitiesHash, plan.requiredCapabilitiesHash, "equivalence.capabilities"); same(e.requiredCapabilityCount, plan.requiredCapabilityCount, "equivalence.capabilities");
  same(e.transactionInvariantAlgorithm, "pg17-same-database-invariant-v1", "equivalence.invariantAlgorithm");
  same(e.transactionInvariantCollectorSha256, plan.invariantCollectorSha256, "equivalence.invariantCollector");
  for (const key of ["expectedAfterRoot", "unchangedCatalogReceiptHash", "unchangedDataReceiptHash", "targetAttributesAclReceiptHash", "replayTupleReceiptHash"]) hex(e[key], `equivalence.${key}`);
  same(e.allowedChanges, ["two-function-prosrc", "one-migration-history-row"], "equivalence.allowedChanges");
  const proofTime = interval(e.observedAt, e.expiresAt, "equivalence");
  const before = ["sourceBefore", "reviewedReferenceBefore", "restoredBefore"] as const;
  const after = ["emptyAfter", "shapedAfter", "replayAfter"] as const;
  for (const key of [...before, ...after]) {
    const fp = fingerprint(e[key], `equivalence.${key}`, true);
    for (const field of ["scopeDigest", "collectorSha256", "canonicalizerSha256"] as const) same(fp[field], plan[field], `equivalence.${key}.${field}`);
    const history = fp.components.find(component => component.category === "migration-history")!;
    same(history.objectCount, (before as readonly string[]).includes(key) ? 17 : 18, `equivalence.${key}.migration-history`);
    if (stamp(fp.observedAt, key) > proofTime.start) fail("equivalence", "observation precedes fingerprint");
  }
  const proof = e as unknown as DeltaEquivalenceProof;
  for (const key of before) same(proof[key].rootSha256, proof.sourceBefore.rootSha256, `equivalence.${key}.root`);
  for (const key of after) same(proof[key].rootSha256, proof.expectedAfterRoot, `equivalence.${key}.root`);
  if (proof.sourceBefore.rootSha256 === proof.expectedAfterRoot) fail("equivalence", "before and after must differ");
  same(proof.sourceBefore.targetBindingHash, plan.targetBindingHash, "equivalence.sourceTarget");
  same(proof.reviewedReferenceBefore.targetBindingHash, proof.emptyAfter.targetBindingHash, "equivalence.referenceTarget");
  same(proof.restoredBefore.targetBindingHash, proof.shapedAfter.targetBindingHash, "equivalence.shapedTarget");
  same(proof.restoredBefore.targetBindingHash, proof.replayAfter.targetBindingHash, "equivalence.replayTarget");
  if (new Set([plan.targetBindingHash, proof.reviewedReferenceBefore.targetBindingHash, proof.restoredBefore.targetBindingHash]).size !== 3) fail("equivalence", "three distinct source/reference/restored targets required");
  return proof;
}
function recoveryShape(value: unknown, plan: DeltaReleasePlan, eq: DeltaEquivalenceProof): DeltaRecoveryProof {
  const r = object(value, ["schemaVersion", "kind", "reference", "scopeDigest", "targetBindingHash", "sourceSnapshotBindingHash", "manifestSha256", "artifacts",
    "captureStartedAt", "captureFinishedAt", "restoreStartedAt", "restoreFinishedAt", "expiresAt", "restoreReceiptHash", "sourceCloneEquivalenceHash", "toolProfileHash", "ownedContainerCleanup",
    "snapshotConsistency", "globalStateBeforeHash", "globalStateAfterHash", "coverage", "rpoSeconds", "rtoSeconds", "containmentPlanHash", "forwardRecoveryPlanHash", "acceptedBy"], "recovery");
  same(r.schemaVersion, 1, "recovery"); same(r.kind, "verified-scoped-recovery", "recovery");
  same(r.scopeDigest, plan.scopeDigest, "recovery.scope"); same(r.targetBindingHash, plan.targetBindingHash, "recovery.target");
  same(r.sourceSnapshotBindingHash, eq.sourceBefore.snapshotBindingHash, "recovery.snapshot");
  for (const key of ["reference", "acceptedBy"]) text(r[key], `recovery.${key}`);
  for (const key of ["manifestSha256", "restoreReceiptHash", "sourceCloneEquivalenceHash", "toolProfileHash", "globalStateBeforeHash", "globalStateAfterHash", "containmentPlanHash", "forwardRecoveryPlanHash"]) hex(r[key], `recovery.${key}`);
  same(r.sourceCloneEquivalenceHash, digestDeltaEquivalenceProof(eq), "recovery.equivalence"); same(r.globalStateBeforeHash, r.globalStateAfterHash, "recovery.globalState");
  same(r.ownedContainerCleanup, "confirmed", "recovery.cleanup"); same(r.snapshotConsistency, "exported-database-snapshot-with-global-state-recheck", "recovery.consistency");
  const names = new Set<string>();
  for (const item of array(r.artifacts, "recovery.artifacts", 3)) {
    const artifact = object(item, ["name", "bytes", "sha256"], "recovery.artifact");
    const name = text(artifact.name, "recovery.artifact.name");
    if (!["database.dump", "roles.sql", "toc.list"].includes(name) || names.has(name)) fail("recovery.artifacts", "unknown or duplicate artifact");
    names.add(name); integer(artifact.bytes, "recovery.artifact.bytes", 1); hex(artifact.sha256, "recovery.artifact.sha256");
  }
  if (names.size !== 3) fail("recovery.artifacts", "three complete artifacts required");
  const categories = new Set<string>();
  for (const item of array(r.coverage, "recovery.coverage", DELTA_RECOVERY_CATEGORIES.length)) {
    const row = object(item, ["category", "result", "acceptanceReference"], "recovery.coverage");
    const category = text(row.category, "recovery.coverage.category");
    if (!(DELTA_RECOVERY_CATEGORIES as readonly string[]).includes(category) || categories.has(category)) fail("recovery.coverage", "unknown or duplicate category");
    categories.add(category);
    if (row.result !== "verified" && row.result !== "not-covered") fail("recovery.coverage", "unreviewed result");
    if (MANDATORY_RECOVERY.includes(category as DeltaRecoveryCategory) && row.result !== "verified") fail("recovery.coverage", "mandatory category not verified");
    text(row.acceptanceReference, "recovery.coverage.acceptanceReference");
  }
  if (categories.size !== DELTA_RECOVERY_CATEGORIES.length) fail("recovery.coverage", "complete coverage declaration required");
  integer(r.rpoSeconds, "recovery.rpoSeconds"); integer(r.rtoSeconds, "recovery.rtoSeconds");
  const start = stamp(r.captureStartedAt, "recovery.captureStartedAt"), finish = stamp(r.captureFinishedAt, "recovery.captureFinishedAt");
  const restoreStarted = stamp(r.restoreStartedAt, "recovery.restoreStartedAt");
  const restored = stamp(r.restoreFinishedAt, "recovery.restoreFinishedAt"), expires = stamp(r.expiresAt, "recovery.expiresAt");
  if (start > finish || finish > restoreStarted || restoreStarted > restored || restored >= expires) fail("recovery", "capture/restore/expiry order");
  if ((r.rtoSeconds as number) * 1000 < restored - restoreStarted) fail("recovery", "reported RTO understates restore duration");
  return r as unknown as DeltaRecoveryProof;
}
function gateShapes(value: unknown, plan: DeltaReleasePlan): DeltaGateProof[] {
  const gates = array(value, "gates", DELTA_REQUIRED_GATES.length);
  const names = new Set<string>();
  for (const item of gates) {
    const g = object(item, ["gate", "status", "scopeDigest", "sourceCommit", "targetBindingHash", "reportSha256", "observedAt", "expiresAt"], "gate");
    const name = text(g.gate, "gate.name");
    if (!(DELTA_REQUIRED_GATES as readonly string[]).includes(name) || names.has(name)) fail("gates", "unknown or duplicate gate");
    names.add(name); same(g.status, "passed", "gate.status"); same(g.scopeDigest, plan.scopeDigest, "gate.scope");
    same(g.sourceCommit, plan.sourceCommit, "gate.sourceCommit"); same(g.targetBindingHash, plan.targetBindingHash, "gate.target");
    hex(g.reportSha256, "gate.reportSha256"); interval(g.observedAt, g.expiresAt, "gate");
  }
  if (names.size !== DELTA_REQUIRED_GATES.length) fail("gates", "required gate coverage incomplete");
  return gates as DeltaGateProof[];
}
function checkedEnvelope(value: unknown): DeltaReleaseEvidence {
  const e = object(value, [...ENVELOPE_KEYS, "contentDigest"], "delta evidence");
  same(e.schemaVersion, 2, "delta evidence"); same(e.kind, "protected-bundled-xp-release", "delta evidence"); same(e.profile, DELTA_RELEASE_PROFILE, "delta evidence");
  assertSanitized(e);
  const parsed = parseEvidence(e.core);
  if (!parsed.evidence) fail("core", parsed.errors.join("; "));
  const core = parsed.evidence;
  for (const role of ROLES) text(core.roles[role], `core.roles.${role}`);
  for (const key of ["proposedProductionCommands", "containmentCommands"] as const) {
    const commands = array(core[key], `core.${key}`, 32);
    if (!commands.length) fail("core", "production and containment command descriptions required");
    for (const command of commands) text(command, `core.${key}`);
  }
  same(core.warnings, [], "core.warnings"); same(core.skippedChecks, [], "core.skippedChecks");
  same(e.warnings, [], "warnings"); same(e.skippedChecks, [], "skippedChecks");
  const plan = planShape(e.plan), eq = equivalenceShape(e.equivalence, plan), recovery = recoveryShape(e.recovery, plan, eq);
  const gates = gateShapes(e.gates, plan);
  const coreTime = interval(core.createdAt, core.expiresAt, "core");
  const coreErrors = verifyEvidence(core, { projectRef: DELTA_RELEASE_PROJECT, schemaFingerprint: eq.sourceBefore.rootSha256,
    manifestDigest: plan.manifestDigest, applicationCommit: plan.sourceCommit, migrationRange: { from: VERSION, to: VERSION },
    migrationChecksums: [{ version: VERSION, sha256: DELTA_SOURCE_SHA256 }], recoveryReference: recovery.reference }, new Date(coreTime.start));
  if (coreErrors.length) fail("core", coreErrors.join("; "));
  same(core.preflightHash, digestDeltaProofPayload(eq.sourceBefore), "core.preflightHash");
  same(core.rehearsalHash, digestDeltaEquivalenceProof(eq), "core.rehearsalHash");
  const gateHashes = new Map(gates.map(gate => [gate.gate, gate.reportSha256]));
  const coreGates = new Set<string>();
  for (const test of array(core.testResults, "core.testResults", DELTA_REQUIRED_GATES.length) as typeof core.testResults) {
    if (!gateHashes.has(test.gate as DeltaGateProof["gate"]) || coreGates.has(test.gate)) fail("core.testResults", "unknown or duplicate required gate");
    coreGates.add(test.gate); same(test.status, "passed", "core.testResults.status"); same(test.evidenceHash, gateHashes.get(test.gate as DeltaGateProof["gate"]), "core.testResults.hash");
  }
  if (coreGates.size !== DELTA_REQUIRED_GATES.length) fail("core.testResults", "required gate coverage incomplete");
  hex(e.contentDigest, "contentDigest");
  const { contentDigest, ...body } = e;
  if (contentDigest !== digestDeltaProofPayload(body)) fail("contentDigest", "outer content digest mismatch");
  return e as unknown as DeltaReleaseEvidence;
}

export function parseDeltaEvidence(value: unknown): { evidence?: DeltaReleaseEvidence; errors: string[] } {
  try { return { evidence: checkedEnvelope(value), errors: [] }; }
  catch (error) { return { errors: [error instanceof Error ? error.message : "invalid delta evidence"] }; }
}
export function buildDeltaEvidence(input: Omit<DeltaReleaseEvidence, "contentDigest">): DeltaReleaseEvidence {
  object(input, ENVELOPE_KEYS, "delta evidence input");
  const result = { ...input, contentDigest: digestDeltaProofPayload(input) };
  return checkedEnvelope(result);
}
/** Whole-envelope digest includes the independently checked outer content digest. */
export function digestDeltaEvidence(evidence: DeltaReleaseEvidence): string { return digestDeltaProofPayload(evidence); }

function contextShape(value: unknown): DeltaExpectedContext {
  const c = object(value, ["projectRef", "sourceCommit", "manifestDigest", "scopeDigest", "planDigest", "targetBindingHash", "roles", "recoveryReference", "recoveryToolProfileHash", "recoveryAcceptedBy",
    "containmentPlanHash", "forwardRecoveryPlanHash", "collectorSha256", "canonicalizerSha256", "invariantCollectorSha256", "executionProgramSha256", "extensionProfileHash",
    "requiredCapabilitiesHash", "requiredCapabilityCount", "requiredRecoveryCoverage", "maximumEvidenceAgeMs", "maximumEvidenceLifetimeMs", "maximumProofAgeMs", "maximumRpoSeconds",
    "maximumRtoSeconds", "beforeRoot", "afterRoot"], "trusted context");
  same(c.projectRef, DELTA_RELEASE_PROJECT, "trusted context.projectRef"); hex(c.sourceCommit, "trusted context.sourceCommit", 40);
  for (const key of ["manifestDigest", "scopeDigest", "planDigest", "targetBindingHash", "containmentPlanHash", "forwardRecoveryPlanHash", "collectorSha256", "canonicalizerSha256",
    "invariantCollectorSha256", "executionProgramSha256", "extensionProfileHash", "recoveryToolProfileHash", "requiredCapabilitiesHash", "beforeRoot", "afterRoot"]) hex(c[key], `trusted context.${key}`);
  if (c.beforeRoot === c.afterRoot) fail("trusted context", "before and after must differ");
  const roles = object(c.roles, ROLES, "trusted context.roles"); for (const role of ROLES) text(roles[role], `trusted context.roles.${role}`);
  text(c.recoveryReference, "trusted context.recoveryReference"); text(c.recoveryAcceptedBy, "trusted context.recoveryAcceptedBy");
  for (const key of ["requiredCapabilityCount", "maximumEvidenceAgeMs", "maximumEvidenceLifetimeMs", "maximumProofAgeMs"]) integer(c[key], `trusted context.${key}`, 1);
  integer(c.maximumRpoSeconds, "trusted context.maximumRpoSeconds"); integer(c.maximumRtoSeconds, "trusted context.maximumRtoSeconds");
  const coverage = array(c.requiredRecoveryCoverage, "trusted context.requiredRecoveryCoverage", DELTA_RECOVERY_CATEGORIES.length);
  const known = new Set(coverage);
  if (known.size !== coverage.length || coverage.some(category => !(DELTA_RECOVERY_CATEGORIES as readonly unknown[]).includes(category))
    || MANDATORY_RECOVERY.some(category => !known.has(category))) fail("trusted context.requiredRecoveryCoverage", "mandatory or known unique coverage required");
  return c as unknown as DeltaExpectedContext;
}

/**
 * Checks complete payloads and independent expected bindings. Empty errors prove
 * consistency with the supplied trusted context, not producer authenticity,
 * CI success, owner authorization, or permission to execute any SQL. Providers
 * must authenticate external report hashes and approvals separately.
 */
export function verifyDeltaEvidence(evidence: DeltaReleaseEvidence, expected: DeltaExpectedContext, now: Date): string[] {
  try {
    const e = checkedEnvelope(evidence), c = contextShape(expected);
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) fail("now", "trusted clock required");
    const time = now.getTime(), plan = e.plan, eq = e.equivalence, recovery = e.recovery;
    for (const key of ["sourceCommit", "manifestDigest", "scopeDigest", "targetBindingHash", "collectorSha256", "canonicalizerSha256", "invariantCollectorSha256", "requiredCapabilitiesHash", "requiredCapabilityCount"] as const) same(plan[key], c[key], `plan.${key}`);
    same(digestDeltaPlan(plan), c.planDigest, "planDigest"); same(plan.delta.executionProgramSha256, c.executionProgramSha256, "executionProgramSha256");
    same(eq.sourceBefore.rootSha256, c.beforeRoot, "approved before root"); same(eq.expectedAfterRoot, c.afterRoot, "approved after root");
    same(recovery.reference, c.recoveryReference, "recovery.reference"); same(recovery.acceptedBy, c.recoveryAcceptedBy, "recovery.acceptedBy");
    same(recovery.toolProfileHash, c.recoveryToolProfileHash, "recovery.toolProfileHash");
    same(recovery.containmentPlanHash, c.containmentPlanHash, "recovery.containmentPlanHash"); same(recovery.forwardRecoveryPlanHash, c.forwardRecoveryPlanHash, "recovery.forwardRecoveryPlanHash");
    const coreErrors = verifyEvidence(e.core, { projectRef: c.projectRef, schemaFingerprint: c.beforeRoot, manifestDigest: c.manifestDigest, applicationCommit: c.sourceCommit,
      migrationRange: { from: VERSION, to: VERSION }, migrationChecksums: [{ version: VERSION, sha256: DELTA_SOURCE_SHA256 }], roles: c.roles, recoveryReference: c.recoveryReference }, now);
    if (coreErrors.length) return coreErrors;
    const core = interval(e.core.createdAt, e.core.expiresAt, "core");
    if (core.start > time || time - core.start > c.maximumEvidenceAgeMs || core.end - core.start > c.maximumEvidenceLifetimeMs) fail("core", "future, stale or excessive evidence lifetime");
    function fresh(observed: string, expires: string, path: string) {
      const window = interval(observed, expires, path);
      if (window.start > time || window.start > core.start || window.end <= time || time - window.start > c.maximumProofAgeMs) fail(path, "future, stale or expired proof");
    }
    for (const key of ["sourceBefore", "reviewedReferenceBefore", "restoredBefore", "emptyAfter", "shapedAfter", "replayAfter"] as const) {
      const fp = eq[key]; same(fp.environment.extensionProfileHash, c.extensionProfileHash, `${key}.extensions`); fresh(fp.observedAt, fp.expiresAt, key);
    }
    fresh(eq.observedAt, eq.expiresAt, "equivalence");
    for (const gate of e.gates) fresh(gate.observedAt, gate.expiresAt, `gate.${gate.gate}`);
    fresh(recovery.captureStartedAt, recovery.expiresAt, "recovery capture"); fresh(recovery.restoreFinishedAt, recovery.expiresAt, "recovery restore");
    const snapshotAge = time - stamp(recovery.captureStartedAt, "recovery.captureStartedAt");
    const restoreDuration = stamp(recovery.restoreFinishedAt, "recovery.restoreFinishedAt") - stamp(recovery.restoreStartedAt, "recovery.restoreStartedAt");
    if (recovery.rpoSeconds > c.maximumRpoSeconds || recovery.rtoSeconds > c.maximumRtoSeconds
      || snapshotAge > Math.min(recovery.rpoSeconds, c.maximumRpoSeconds) * 1000 || restoreDuration > c.maximumRtoSeconds * 1000) fail("recovery", "RPO/RTO policy exceeded");
    for (const category of c.requiredRecoveryCoverage) {
      if (recovery.coverage.find(row => row.category === category)?.result !== "verified") fail("recovery.coverage", "trusted required coverage not verified");
    }
    return [];
  } catch (error) { return [error instanceof Error ? error.message : "invalid delta evidence"]; }
}
