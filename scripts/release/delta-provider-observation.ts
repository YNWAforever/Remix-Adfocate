import { digestDeltaProofPayload } from "./delta-evidence";
import { requireProviderFact as check, type ProviderCaseResult } from "./delta-provider-contracts";

export const PROVIDER_CASE_NAMES = Object.freeze([
  "provider-auth-issued-session", "provider-auth-fabricated-token-denied", "auth-owned-trusted-expired-token-denied", "provider-auth-anonymous-denied", "provider-auth-creator-cross-tenant-denied",
  "provider-auth-staff-totp-aal2", "provider-auth-operator-totp-aal2", "provider-auth-reviewer-totp-aal2", "provider-auth-no-membership-totp-aal2", "provider-auth-staff-cross-tenant-denied", "provider-auth-staff-no-membership-denied", "provider-auth-revoked-session-denied",
  "journey-legacy-join-xp", "journey-null-mode-schema-guard", "journey-legacy-resubmission", "journey-active-join-neutrality", "journey-active-draft-review", "journey-active-proof-correction", "journey-active-pending-reward", "journey-synthetic-issued-anchor-preserved",
  "storage.draft.owner-access-isolation", "storage.draft.signed-upload", "storage.draft.mime-size-enforcement", "storage.proof.owner-access-isolation", "storage.proof.signed-upload", "storage.proof.mime-size-enforcement", "provider-hosted-origin-refused",
]);
export const PROVIDER_NOT_COVERED = Object.freeze([
  "production-provider-equivalence", "historical-null-mode-provider-join", "actual-legacy-reward-issuance", "actual-active-reward-settlement", "external-publication-or-proof-metadata", "cross-tenant-storage-write", "signed-capability-nontransferability", "storage-overwrite-and-delete-permissions", "owner-release-acceptance-and-rpo-rto",
]);
export interface ProviderObservation {
  readonly schemaVersion: 1; readonly kind: "phase3-owned-provider-observation";
  readonly status: "HOLD"; readonly validReleaseEvidence: false; readonly productionEquivalent: false; readonly ownerAccepted: false;
  readonly engineeringStatus: "passed" | "failed"; readonly reasonCode: string | null;
  readonly runId: string; readonly sourceCommit: string; readonly sourceDirty: false;
  readonly platform: "linux" | "win32"; readonly startedAt: string; readonly finishedAt: string;
  readonly codeHashes: Readonly<Record<string, string>>;
  readonly ownedStack: null | { readonly projectId: string; readonly sourceProfileHash: string; readonly configurationHash: string;
    readonly apiOrigin: string; readonly applicationOrigin: string | null; readonly targetIdentityHash: string;
    readonly containers: readonly { readonly id: string; readonly image: string; readonly imageRef: string }[];
    readonly network: "internal-bridge-loopback-published" };
  readonly checks: readonly ProviderCaseResult[]; readonly actualHttpResponses: number; readonly externalRequestsBlocked: number;
  readonly cleanup: { readonly application: "verified" | "not-started" | "unknown"; readonly namespace: "verified" | "unknown" };
  readonly notCovered: readonly string[]; readonly contentDigest: string;
}
const SHA = /^[a-f0-9]{64}$/;
function exactKeys(value: object, names: readonly string[]) { check(Object.keys(value).sort().join() === [...names].sort().join(), "provider-observation-closed-shape"); }
export function validateProviderObservation(input: unknown): ProviderObservation {
  check(input && typeof input === "object" && !Array.isArray(input), "provider-observation-shape");
  const report = input as ProviderObservation;
  exactKeys(report, ["schemaVersion", "kind", "status", "validReleaseEvidence", "productionEquivalent", "ownerAccepted", "engineeringStatus", "reasonCode", "runId", "sourceCommit", "sourceDirty", "platform", "startedAt", "finishedAt", "codeHashes", "ownedStack", "checks", "actualHttpResponses", "externalRequestsBlocked", "cleanup", "notCovered", "contentDigest"]);
  check(report.schemaVersion === 1 && report.kind === "phase3-owned-provider-observation" && report.status === "HOLD" && report.validReleaseEvidence === false
    && report.productionEquivalent === false && report.ownerAccepted === false && report.sourceDirty === false, "provider-observation-authority");
  check(/^[a-f0-9]{40}$/.test(report.sourceCommit) && /^[a-f0-9-]{36}$/.test(report.runId) && ["linux", "win32"].includes(report.platform), "provider-observation-source");
  check(Number.isFinite(Date.parse(report.startedAt)) && Number.isFinite(Date.parse(report.finishedAt)) && Date.parse(report.finishedAt) >= Date.parse(report.startedAt), "provider-observation-time");
  check(report.codeHashes && Object.keys(report.codeHashes).length >= 10 && Object.entries(report.codeHashes).every(([name, digest]) => /^scripts\/release\/delta-[a-z0-9.-]+\.(?:ts|mjs|ps1)$/.test(name) && SHA.test(digest)), "provider-observation-code");
  check(JSON.stringify(report.notCovered) === JSON.stringify(PROVIDER_NOT_COVERED), "provider-observation-coverage");
  check(Number.isSafeInteger(report.actualHttpResponses) && report.actualHttpResponses >= 0 && Number.isSafeInteger(report.externalRequestsBlocked) && report.externalRequestsBlocked >= 0, "provider-observation-counters");
  check(Array.isArray(report.checks) && report.cleanup && ["verified", "not-started", "unknown"].includes(report.cleanup.application) && ["verified", "unknown"].includes(report.cleanup.namespace), "provider-observation-cleanup");
  exactKeys(report.cleanup, ["application", "namespace"]);
  for (const row of report.checks) exactKeys(row, ["name", "status", "actualHttpRequests", "evidenceSha256"]);
  if (report.engineeringStatus === "passed") {
    check(report.reasonCode === null && report.cleanup.application === "verified" && report.cleanup.namespace === "verified" && report.ownedStack && report.actualHttpResponses > 0 && report.externalRequestsBlocked > 0, "provider-observation-incomplete");
    const names = report.checks.map(row => row.name);
    check(names.length === PROVIDER_CASE_NAMES.length && new Set(names).size === names.length && names.every(name => PROVIDER_CASE_NAMES.includes(name)), "provider-observation-cases");
    check(report.checks.every(row => row.status === "passed" && SHA.test(row.evidenceSha256) && Number.isSafeInteger(row.actualHttpRequests) && row.actualHttpRequests > 0), "provider-observation-http");
    check(report.checks.reduce((sum, row) => sum + row.actualHttpRequests, 0) <= report.actualHttpResponses, "provider-observation-counter-overlap");
  } else check(report.engineeringStatus === "failed" && typeof report.reasonCode === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(report.reasonCode) && report.checks.length === 0, "provider-observation-failure");
  if (report.ownedStack) {
    const stack = report.ownedStack;
    exactKeys(stack, ["projectId", "sourceProfileHash", "configurationHash", "apiOrigin", "applicationOrigin", "targetIdentityHash", "containers", "network"]);
    for (const row of stack.containers) exactKeys(row, ["id", "image", "imageRef"]);
    check(/^adfocate-provider-[a-f0-9]{32}$/.test(stack.projectId) && SHA.test(stack.sourceProfileHash) && SHA.test(stack.configurationHash) && SHA.test(stack.targetIdentityHash)
      && stack.network === "internal-bridge-loopback-published" && /^http:\/\/127\.0\.0\.1:\d{4,5}$/.test(stack.apiOrigin)
      && (stack.applicationOrigin === null || /^http:\/\/127\.0\.0\.1:\d{4,5}$/.test(stack.applicationOrigin)), "provider-observation-target");
    check(Array.isArray(stack.containers) && stack.containers.length >= 5 && stack.containers.every(row => /^[a-f0-9]{64}$/.test(row.id) && /^sha256:[a-f0-9]{64}$/.test(row.image)
      && /^(?:public\.ecr\.aws\/supabase|supabase|postgrest|kong)\/[a-z0-9_.-]+:[a-zA-Z0-9_.-]+$/.test(row.imageRef)), "provider-observation-images");
  }
  const { contentDigest, ...payload } = report; check(SHA.test(contentDigest) && digestDeltaProofPayload(payload) === contentDigest, "provider-observation-digest"); return report;
}
