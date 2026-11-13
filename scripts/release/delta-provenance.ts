import { createHash } from "node:crypto";
import { isAbsolute, relative, resolve, sep } from "node:path";

const SHA = /^[a-f0-9]{40}$/;
const REPOSITORY = "YNWAforever/Remix-Adfocate";
const EVIDENCE_PREFIX = "docs/verification/releases/";
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort(compare).map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export const provenanceDigest = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
function refused(reason: string): never { throw new Error(`protected delta provenance rejected: ${reason}`); }

export interface DeltaSourceCiRecord {
  readonly repository: string;
  readonly runId: string;
  readonly commit: string;
  readonly branch: string;
  readonly event: string;
  readonly workflowPath: string;
  readonly status: string;
  readonly conclusion: string;
  readonly createdAt: string;
  readonly completedAt: string;
  readonly jobs: readonly { readonly name: string; readonly status: string; readonly conclusion: string }[];
}
export interface DeltaProtectedRunRecord {
  readonly repository: string;
  readonly runId: string;
  readonly attempt: number;
  readonly commit: string;
  readonly branch: string;
  readonly event: string;
  readonly workflowPath: string;
  readonly status: string;
  readonly environment: string;
  readonly configuredReviewerIds: readonly string[];
  readonly actualApprovalReviewerIds: readonly string[];
  readonly mainBranchProtected: boolean;
  readonly environmentMainOnly: boolean;
  readonly concurrencyGroup: string;
}
export interface DeltaProvenanceInput {
  readonly sourceCommit: string;
  readonly evidenceCommit: string;
  readonly bundlePath: string;
  readonly bundleBytes: Buffer;
  readonly expectedSourceCiReportHash: string;
  readonly expectedGitHubApproverId: string;
  readonly runId: string;
  readonly runAttempt: number;
  readonly now: Date;
}
export interface DeltaProvenanceDeps {
  readonly isAncestor: (ancestor: string, descendant: string) => Promise<boolean>;
  readonly changedPaths: (before: string, after: string) => Promise<readonly string[]>;
  readonly committedFile: (commit: string, path: string) => Promise<Buffer>;
  readonly checkedOutCommit: () => Promise<string>;
  readonly trackedTreeClean: () => Promise<boolean>;
  readonly sourceCi: (commit: string) => Promise<DeltaSourceCiRecord>;
  readonly protectedRun: (runId: string, attempt: number) => Promise<DeltaProtectedRunRecord>;
}
export interface DeltaProvenanceReport {
  readonly schemaVersion: 1;
  readonly kind: "verified-source-evidence-provenance";
  readonly sourceCommit: string;
  readonly evidenceCommit: string;
  readonly artifactSha256: string;
  readonly sourceCiReportHash: string;
  readonly protectedRunId: string;
  readonly protectedRunAttempt: number;
  readonly approvedByGitHubActorId: string;
  readonly permittedDeploymentCommits: readonly string[];
  readonly reportSha256: string;
}

export function canonicalEvidencePath(value: string): string {
  if (typeof value !== "string" || value.includes("\\") || value.includes("\0") || !value.startsWith(EVIDENCE_PREFIX)
    || !/^docs\/verification\/releases\/[a-zA-Z0-9][a-zA-Z0-9._/-]*\.json$/.test(value)
    || value.split("/").some(part => !part || part === "." || part === "..")) refused("committed evidence path");
  return value;
}

/** Resolve each ancestor, rejecting links rather than relying on lexical containment. */
export async function verifyEvidenceFilePath(
  root: string,
  path: string,
  fs: { realpath(path: string): Promise<string>; lstat(path: string): Promise<{ isSymbolicLink(): boolean; isFile(): boolean; isDirectory(): boolean }> },
) {
  const normalized = canonicalEvidencePath(path);
  const actualRoot = await fs.realpath(root);
  let parent = actualRoot;
  const parts = normalized.split("/");
  for (let index = 0; index < parts.length; index++) {
    const candidate = resolve(parent, parts[index]!);
    const stat = await fs.lstat(candidate);
    if (stat.isSymbolicLink() || (index === parts.length - 1 ? !stat.isFile() : !stat.isDirectory())) refused("evidence links or object kind");
    const physical = await fs.realpath(candidate);
    const fromRoot = relative(actualRoot, physical);
    if (fromRoot === "" || fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) refused("evidence escaped repository");
    if (physical !== candidate) refused("evidence ancestor changed identity");
    parent = physical;
  }
  return parent;
}

export function validateSourceCi(record: DeltaSourceCiRecord, commit: string, now: Date) {
  if (record.repository !== REPOSITORY || record.commit !== commit || record.branch !== "main" || record.event !== "push"
    || record.workflowPath !== ".github/workflows/ci.yml" || record.status !== "completed" || record.conclusion !== "success"
    || !/^\d+$/.test(record.runId)) refused("exact main source CI identity");
  const created = Date.parse(record.createdAt), completed = Date.parse(record.completedAt);
  if (![created, completed, now.valueOf()].every(Number.isFinite) || created > completed || completed > now.valueOf()
    || !/(Z|[+-]\d{2}:\d{2})$/.test(record.createdAt) || !/(Z|[+-]\d{2}:\d{2})$/.test(record.completedAt)) refused("source CI chronology");
  const names = new Set<string>();
  for (const job of record.jobs) {
    if (names.has(job.name) || job.status !== "completed" || job.conclusion !== "success") refused("source CI jobs");
    names.add(job.name);
  }
  if (!names.has("build-test") || !names.has("integration")) refused("required source CI jobs");
  return provenanceDigest(record);
}

/** Records must come from authenticated GitHub readers; caller-supplied labels are not attestations. */
export async function verifyDeltaProvenance(input: DeltaProvenanceInput, deps: DeltaProvenanceDeps): Promise<DeltaProvenanceReport> {
  if (!SHA.test(input.sourceCommit) || !SHA.test(input.evidenceCommit) || input.sourceCommit === input.evidenceCommit || !/^\d+$/.test(input.runId)
    || !Number.isSafeInteger(input.runAttempt) || input.runAttempt < 1 || !/^\d+$/.test(input.expectedGitHubApproverId)) refused("trusted identifiers");
  const bundlePath = canonicalEvidencePath(input.bundlePath);
  if (await deps.checkedOutCommit() !== input.evidenceCommit) refused("checkout is not the protected evidence commit");
  if (!await deps.trackedTreeClean()) refused("checkout contains source modifications");
  if (!await deps.isAncestor(input.sourceCommit, input.evidenceCommit)) refused("source is not an evidence-commit ancestor");
  const changes = await deps.changedPaths(input.sourceCommit, input.evidenceCommit);
  if (new Set(changes).size !== changes.length || changes.some(path => {
    try { canonicalEvidencePath(path); return false; } catch { return true; }
  })) refused("evidence commit changes approved source bytes");
  const committed = await deps.committedFile(input.evidenceCommit, bundlePath);
  if (committed.length === 0 || committed.length > 8 * 1024 * 1024 || !committed.equals(input.bundleBytes)) refused("artifact differs from committed bytes");
  const ci = await deps.sourceCi(input.sourceCommit);
  const ciHash = validateSourceCi(ci, input.sourceCommit, input.now);
  if (ciHash !== input.expectedSourceCiReportHash) refused("approved source CI report changed");
  const run = await deps.protectedRun(input.runId, input.runAttempt);
  if (run.repository !== REPOSITORY || run.runId !== input.runId || run.attempt !== input.runAttempt
    || run.commit !== input.evidenceCommit || run.branch !== "main" || run.event !== "workflow_dispatch"
    || run.workflowPath !== ".github/workflows/supabase.yml" || run.status !== "in_progress" || run.environment !== "production"
    || run.mainBranchProtected !== true || run.environmentMainOnly !== true
    || run.concurrencyGroup !== "supabase-production-release") refused("protected production workflow context");
  if (!run.configuredReviewerIds.length || new Set(run.configuredReviewerIds).size !== run.configuredReviewerIds.length
    || new Set(run.actualApprovalReviewerIds).size !== run.actualApprovalReviewerIds.length
    || [...run.configuredReviewerIds, ...run.actualApprovalReviewerIds].some(id => !/^\d+$/.test(id))
    || !run.configuredReviewerIds.includes(input.expectedGitHubApproverId)
    || !run.actualApprovalReviewerIds.includes(input.expectedGitHubApproverId)) refused("required production reviewer approval");
  const result = {
    schemaVersion: 1 as const, kind: "verified-source-evidence-provenance" as const,
    sourceCommit: input.sourceCommit, evidenceCommit: input.evidenceCommit,
    artifactSha256: createHash("sha256").update(committed).digest("hex"), sourceCiReportHash: ciHash,
    protectedRunId: run.runId, protectedRunAttempt: run.attempt, approvedByGitHubActorId: input.expectedGitHubApproverId,
    permittedDeploymentCommits: [...new Set([input.sourceCommit, input.evidenceCommit])],
  };
  return { ...result, reportSha256: provenanceDigest(result) };
}
