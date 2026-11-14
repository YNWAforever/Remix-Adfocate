import { assertSanitized } from "./evidence";
import { canonicalDeltaJson, digestDeltaProofPayload, parseDeltaEvidence } from "./delta-evidence";
import { DELTA_RECOVERY_CATEGORIES, DELTA_RELEASE_PROFILE, DELTA_RELEASE_PROJECT, DELTA_REQUIRED_GATES, type DeltaRecoveryCategory, type DeltaRequiredGate } from "./delta-release-contracts";

const ROLES = ["executor", "observer", "containmentOwner", "productOwner", "approver"] as const;
const BUDGETS = ["maximumRpoSeconds", "maximumRtoSeconds", "maximumEvidenceAgeMs", "maximumEvidenceLifetimeMs", "maximumProofAgeMs"] as const;
const FREEZE_TEXT = ["startsAt", "expiresAt", "changeControlReference"] as const;
const FREEZE_FLAGS = ["allDdlWritersFrozen", "globalCatalogControlled", "sequenceAndApplicationWritersQuiesced", "deploymentsAndConfigurationFrozen"] as const;
const PLAN_REFERENCES = ["captureScope", "containment", "forwardRecovery"] as const;
const MANDATORY: readonly DeltaRecoveryCategory[] = ["database-schema", "database-rows", "role-definitions-without-passwords", "storage-configuration"];
export interface Phase3RehearsalWorksheet {
  readonly schemaVersion: 1;
  readonly kind: "phase3-owner-rehearsal-worksheet";
  readonly projectRef: typeof DELTA_RELEASE_PROJECT;
  readonly sourceCommit: string;
  readonly githubReviewerId: string | null;
  readonly roles: Readonly<Record<typeof ROLES[number], string | null>>;
  readonly recoveryAcceptedBy: string | null;
  readonly budgets: Readonly<Record<typeof BUDGETS[number], number | null>>;
  readonly recoveryCoverage: readonly { readonly category: DeltaRecoveryCategory; readonly decision: "verify" | "accept-not-covered" | null; readonly acceptanceReference: string | null }[];
  readonly freeze: Readonly<Record<typeof FREEZE_TEXT[number], string | null>> & Readonly<Record<typeof FREEZE_FLAGS[number], boolean | null>>;
  readonly planReferences: Readonly<Record<typeof PLAN_REFERENCES[number], string | null>>;
}
export interface Phase3RehearsalPlanMetadata {
  readonly sourceCommit: string;
  readonly preparedAt: string;
  readonly manifestSourceCount: number;
  readonly worksheetSha256: string;
}
export interface Phase3RehearsalPlan {
  readonly schemaVersion: 1;
  readonly kind: "phase3-rehearsal-plan";
  readonly status: "HOLD";
  readonly accepted: false;
  readonly validReleaseEvidence: false;
  readonly ownerAccepted: false;
  readonly productionEquivalent: false;
  readonly captureAuthorized: false;
  readonly executionAuthorized: false;
  readonly decisionStatus: "incomplete" | "complete-unverified";
  readonly sourceCommit: string;
  readonly preparedAt: string;
  readonly manifestSourceCount: 67;
  readonly worksheetSha256: string;
  readonly worksheetDigest: string;
  readonly declaredInputs: Phase3RehearsalWorksheet;
  readonly missingInputs: readonly string[];
  readonly blockers: readonly "freeze-window-expired"[];
  readonly producerLimits: { readonly maximumCaptureMs: 600000; readonly maximumRestoreMs: 600000; readonly maximumArchiveBytes: 67108864; readonly maximumPairedLifetimeMs: 900000; readonly runtimeInspectionTtlMs: 60000 };
  readonly gates: readonly { readonly gate: DeltaRequiredGate; readonly status: "HOLD"; readonly accepted: false }[];
  readonly protectedV2ParserRejected: true;
  readonly nextPrerequisites: readonly string[];
  readonly contentDigest: string;
}
const FAILURE_CODES = ["worksheet-shape", "metadata-shape", "invalid-text", "invalid-budget", "invalid-coverage", "invalid-freeze", "protected-parser", "worksheet-rejected"] as const;
type FailureCode = typeof FAILURE_CODES[number];
const failures = new WeakMap<object, FailureCode>();
export class Phase3RehearsalPlanFailure extends Error {
  readonly code: FailureCode;
  constructor(code: FailureCode) {
    super("Offline rehearsal worksheet rejected"); this.name = "Phase3RehearsalPlanFailure";
    this.code = FAILURE_CODES.includes(code) ? code : "worksheet-rejected"; failures.set(this, this.code);
  }
}
function check(value: unknown, code: FailureCode): asserts value { if (!value) throw new Phase3RehearsalPlanFailure(code); }
function object(value: unknown, keys: readonly string[], code: FailureCode): Record<string, unknown> {
  check(value && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)), code);
  check(!Object.getOwnPropertySymbols(value).length && Object.getOwnPropertyNames(value).length === keys.length, code);
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const property = Object.getOwnPropertyDescriptor(value, key);
    check(property && property.enumerable && Object.hasOwn(property, "value"), code); result[key] = property.value;
  }
  return result;
}
function text(value: unknown): asserts value is string {
  check(typeof value === "string" && value.length > 0 && value.length <= 4096 && value === value.trim()
    && !/\p{Cc}/u.test(value)
    && !/^(?:todo|tbd|unknown|pending|placeholder|none|null|undefined|n\/a|not[-_ ]?(?:run|tested|available))$/i.test(value)
    && !/(?:<[^>]+>|\b(?:TODO|TBD|placeholder)\b)/i.test(value)
    && !/(?:file:\/\/|(?:^|[\s"'(=])(?:[a-z]:[\\/]|[\\/]))/i.test(value), "invalid-text");
}
function nullableText(value: unknown) { if (value !== null) text(value); }
function timestamp(value: unknown, code: FailureCode): number {
  check(typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value), code);
  const parsed = Date.parse(value); check(Number.isFinite(parsed) && new Date(parsed).toISOString() === value, code); return parsed;
}
function clone<T>(value: T): T { return JSON.parse(canonicalDeltaJson(value)) as T; }
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
function worksheetShape(input: unknown): Phase3RehearsalWorksheet {
  const row = object(input, ["schemaVersion", "kind", "projectRef", "sourceCommit", "githubReviewerId", "roles", "recoveryAcceptedBy", "budgets", "recoveryCoverage", "freeze", "planReferences"], "worksheet-shape");
  check(row.schemaVersion === 1 && row.kind === "phase3-owner-rehearsal-worksheet" && row.projectRef === DELTA_RELEASE_PROJECT
    && typeof row.sourceCommit === "string" && /^[a-f0-9]{40}$/.test(row.sourceCommit), "worksheet-shape");
  nullableText(row.githubReviewerId); check(row.githubReviewerId === null || /^\d+$/.test(row.githubReviewerId as string), "worksheet-shape");
  const roles = object(row.roles, ROLES, "worksheet-shape"); for (const role of ROLES) nullableText(roles[role]); row.roles = roles;
  nullableText(row.recoveryAcceptedBy);
  const budgets = object(row.budgets, BUDGETS, "worksheet-shape");
  for (const key of BUDGETS) check(budgets[key] === null || Number.isSafeInteger(budgets[key]) && Number(budgets[key]) >= (key === "maximumRpoSeconds" || key === "maximumRtoSeconds" ? 0 : 1), "invalid-budget");
  const coverage = row.recoveryCoverage;
  check(Array.isArray(coverage) && coverage.length === DELTA_RECOVERY_CATEGORIES.length && !Object.getOwnPropertySymbols(coverage).length
    && Object.getOwnPropertyNames(coverage).length === coverage.length + 1, "invalid-coverage");
  const categories = new Set<string>(), safeCoverage: Record<string, unknown>[] = [];
  for (let index = 0; index < coverage.length; index++) {
    const property = Object.getOwnPropertyDescriptor(coverage, String(index)); check(property && property.enumerable && Object.hasOwn(property, "value"), "invalid-coverage");
    const item = object(property.value, ["category", "decision", "acceptanceReference"], "invalid-coverage");
    check(typeof item.category === "string" && (DELTA_RECOVERY_CATEGORIES as readonly string[]).includes(item.category) && !categories.has(item.category), "invalid-coverage");
    categories.add(item.category);
    check(item.decision === null || item.decision === "verify" || item.decision === "accept-not-covered", "invalid-coverage");
    check(item.decision !== "accept-not-covered" || !MANDATORY.includes(item.category as DeltaRecoveryCategory), "invalid-coverage");
    nullableText(item.acceptanceReference); safeCoverage.push(item);
  }
  row.budgets = budgets; row.recoveryCoverage = safeCoverage;
  const declaredFreeze = object(row.freeze, [...FREEZE_TEXT, ...FREEZE_FLAGS], "worksheet-shape");
  for (const key of FREEZE_TEXT) nullableText(declaredFreeze[key]);
  for (const key of ["startsAt", "expiresAt"] as const) if (declaredFreeze[key] !== null) timestamp(declaredFreeze[key], "invalid-freeze");
  if (declaredFreeze.startsAt !== null && declaredFreeze.expiresAt !== null) check(timestamp(declaredFreeze.startsAt, "invalid-freeze") < timestamp(declaredFreeze.expiresAt, "invalid-freeze"), "invalid-freeze");
  for (const key of FREEZE_FLAGS) check(declaredFreeze[key] === null || typeof declaredFreeze[key] === "boolean", "invalid-freeze");
  const references = object(row.planReferences, PLAN_REFERENCES, "worksheet-shape"); for (const key of PLAN_REFERENCES) nullableText(references[key]);
  row.freeze = declaredFreeze; row.planReferences = references;
  const result = clone(row) as unknown as Phase3RehearsalWorksheet; assertSanitized(result); return result;
}

/** Pure declaration validation only. Completeness is never acceptance, verification or authority. */
export function buildPhase3RehearsalPlan(input: unknown, metadata: Phase3RehearsalPlanMetadata): Phase3RehearsalPlan {
  try {
    const meta = object(metadata, ["sourceCommit", "preparedAt", "manifestSourceCount", "worksheetSha256"], "metadata-shape");
    check(typeof meta.sourceCommit === "string" && /^[a-f0-9]{40}$/.test(meta.sourceCommit) && meta.manifestSourceCount === 67
      && typeof meta.worksheetSha256 === "string" && /^[a-f0-9]{64}$/.test(meta.worksheetSha256), "metadata-shape");
    const preparedAt = timestamp(meta.preparedAt, "metadata-shape"), worksheet = worksheetShape(input);
    check(worksheet.sourceCommit === meta.sourceCommit, "metadata-shape");
    const missing: string[] = [], blockers: "freeze-window-expired"[] = [];
    if (worksheet.githubReviewerId === null) missing.push("githubReviewerId");
    for (const role of ROLES) if (worksheet.roles[role] === null) missing.push(`roles.${role}`);
    if (worksheet.recoveryAcceptedBy === null) missing.push("recoveryAcceptedBy");
    for (const key of BUDGETS) if (worksheet.budgets[key] === null) missing.push(`budgets.${key}`);
    for (const category of DELTA_RECOVERY_CATEGORIES) {
      const item = worksheet.recoveryCoverage.find(row => row.category === category)!;
      if (item.decision === null) missing.push(`recoveryCoverage.${category}.decision`);
      if (item.decision === "accept-not-covered" && item.acceptanceReference === null) missing.push(`recoveryCoverage.${category}.acceptanceReference`);
    }
    for (const key of FREEZE_TEXT) if (worksheet.freeze[key] === null) missing.push(`freeze.${key}`);
    for (const key of FREEZE_FLAGS) if (worksheet.freeze[key] !== true) missing.push(`freeze.${key}`);
    if (worksheet.freeze.expiresAt !== null && timestamp(worksheet.freeze.expiresAt, "invalid-freeze") <= preparedAt) blockers.push("freeze-window-expired");
    for (const key of PLAN_REFERENCES) if (worksheet.planReferences[key] === null) missing.push(`planReferences.${key}`);
    const body = { schemaVersion: 1 as const, kind: "phase3-rehearsal-plan" as const, status: "HOLD" as const, accepted: false as const,
      validReleaseEvidence: false as const, ownerAccepted: false as const, productionEquivalent: false as const, captureAuthorized: false as const,
      executionAuthorized: false as const, decisionStatus: missing.length || blockers.length ? "incomplete" as const : "complete-unverified" as const,
      sourceCommit: worksheet.sourceCommit, preparedAt: meta.preparedAt as string, manifestSourceCount: 67 as const, worksheetSha256: meta.worksheetSha256 as string,
      worksheetDigest: digestDeltaProofPayload(worksheet), declaredInputs: worksheet, missingInputs: missing, blockers,
      producerLimits: { maximumCaptureMs: 600000 as const, maximumRestoreMs: 600000 as const, maximumArchiveBytes: 67108864 as const, maximumPairedLifetimeMs: 900000 as const, runtimeInspectionTtlMs: 60000 as const },
      gates: DELTA_REQUIRED_GATES.map(gate => ({ gate, status: "HOLD" as const, accepted: false as const })), protectedV2ParserRejected: true as const,
      nextPrerequisites: ["owner-decision-review-and-separate-capture-authorization", "fresh-source-reference-restored-provider-and-deployment-evidence", "complete-sixteen-gate-proof-reports",
        "independent-protected-policy-and-report-set-acceptance", "protected-read-only-verification-of-final-bundle", "separate-exact-outer-digest-approval-and-execution-authorization"] };
    const result = { ...body, contentDigest: digestDeltaProofPayload(body) };
    check(!parseDeltaEvidence(result).evidence && !parseDeltaEvidence({ ...result, schemaVersion: 2, kind: "protected-bundled-xp-release", profile: DELTA_RELEASE_PROFILE }).evidence, "protected-parser");
    return freeze(result);
  } catch (error) { throw new Phase3RehearsalPlanFailure(error && typeof error === "object" ? failures.get(error) ?? "worksheet-rejected" : "worksheet-rejected"); }
}
