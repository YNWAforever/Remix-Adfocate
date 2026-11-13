import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import {
  canonicalEvidencePath, provenanceDigest, validateSourceCi, verifyDeltaProvenance, verifyEvidenceFilePath,
  type DeltaProvenanceDeps, type DeltaProvenanceInput, type DeltaProtectedRunRecord, type DeltaSourceCiRecord,
} from "./delta-provenance";

const source = "1".repeat(40), evidence = "2".repeat(40);
const path = "docs/verification/releases/synthetic-evidence.json";
const now = new Date("2026-11-14T00:00:00Z");
function fixture() {
  const ci: DeltaSourceCiRecord = { repository: "YNWAforever/Remix-Adfocate", runId: "1001", commit: source,
    branch: "main", event: "push", workflowPath: ".github/workflows/ci.yml", status: "completed", conclusion: "success",
    createdAt: "2026-11-13T23:30:00Z", completedAt: "2026-11-13T23:40:00Z", jobs: [
      { name: "build-test", status: "completed", conclusion: "success" }, { name: "integration", status: "completed", conclusion: "success" },
    ] };
  const run: DeltaProtectedRunRecord = { repository: "YNWAforever/Remix-Adfocate", runId: "2001", attempt: 1, commit: evidence,
    branch: "main", event: "workflow_dispatch", workflowPath: ".github/workflows/supabase.yml", status: "in_progress", environment: "production",
    configuredReviewerIds: ["3001"], actualApprovalReviewerIds: ["3001"], mainBranchProtected: true, environmentMainOnly: true,
    concurrencyGroup: "supabase-production-release" };
  const bytes = Buffer.from('{"synthetic":true}\n');
  const input: DeltaProvenanceInput = { sourceCommit: source, evidenceCommit: evidence, bundlePath: path, bundleBytes: bytes,
    expectedSourceCiReportHash: provenanceDigest(ci), expectedGitHubApproverId: "3001", runId: run.runId, runAttempt: 1, now };
  const deps: DeltaProvenanceDeps = { isAncestor: async () => true, changedPaths: async () => [path], committedFile: async () => bytes,
    checkedOutCommit: async () => evidence, trackedTreeClean: async () => true, sourceCi: async () => ci, protectedRun: async () => run };
  return { input, deps, ci, run };
}

describe("protected delta source/evidence commit provenance (synthetic provider records)", () => {
  it("accepts an evidence-only successor with exact green source CI and actual protected review", async () => {
    const { input, deps } = fixture();
    const result = await verifyDeltaProvenance(input, deps);
    expect(result.permittedDeploymentCommits).toEqual([source, evidence]);
    expect(result.sourceCommit).toBe(source);
    expect(result.evidenceCommit).toBe(evidence);
    expect(result.reportSha256).toMatch(/^[a-f0-9]{64}$/);
  });
  it("keeps the source SHA independent from the evidence commit rather than solving a self-reference", async () => {
    const { input, deps } = fixture();
    await expect(verifyDeltaProvenance({ ...input, evidenceCommit: source }, deps)).rejects.toThrow("trusted identifiers");
  });
  it("rejects a clean checkout at an unrelated HEAD", async () => {
    const { input, deps } = fixture();
    await expect(verifyDeltaProvenance(input, { ...deps, checkedOutCommit: async () => "3".repeat(40) })).rejects.toThrow("protected evidence commit");
  });
  it("rejects a dirty checkout before reading CI or protected approval records", async () => {
    const { input, deps } = fixture();
    let requests = 0;
    await expect(verifyDeltaProvenance(input, { ...deps, trackedTreeClean: async () => false,
      sourceCi: async () => { requests++; return fixture().ci; } })).rejects.toThrow("modifications");
    expect(requests).toBe(0);
  });
  it("rejects unrelated source/evidence branches", async () => {
    const { input, deps } = fixture();
    await expect(verifyDeltaProvenance(input, { ...deps, isAncestor: async () => false })).rejects.toThrow("ancestor");
  });
  it.each(["scripts/release/executor.ts", "src/main.tsx", "supabase/release-manifest.json", ".github/workflows/supabase.yml",
    "docs/verification/releases/../other.json", "docs/verification/releases/metadata.sql"])("rejects evidence commit changing %s", async changed => {
    const { input, deps } = fixture();
    await expect(verifyDeltaProvenance(input, { ...deps, changedPaths: async () => [path, changed] })).rejects.toThrow("source bytes");
  });
  it("rejects duplicate path reports rather than trusting a lossy git adapter", async () => {
    const { input, deps } = fixture();
    await expect(verifyDeltaProvenance(input, { ...deps, changedPaths: async () => [path, path] })).rejects.toThrow("source bytes");
  });
  it("rejects altered working artifact bytes", async () => {
    const { input, deps } = fixture();
    await expect(verifyDeltaProvenance({ ...input, bundleBytes: Buffer.from("{}") }, deps)).rejects.toThrow("committed bytes");
  });
  it("rejects an unapproved CI report even when it is otherwise successful", async () => {
    const { input, deps } = fixture();
    await expect(verifyDeltaProvenance({ ...input, expectedSourceCiReportHash: "f".repeat(64) }, deps)).rejects.toThrow("CI report changed");
  });
  it.each([
    { branch: "feature" }, { event: "pull_request" }, { commit: evidence }, { conclusion: "failure" }, { status: "in_progress" },
    { repository: "other/repository" }, { workflowPath: ".github/workflows/supabase.yml" },
  ])("rejects wrong source CI identity %j", patch => {
    const { ci } = fixture();
    expect(() => validateSourceCi({ ...ci, ...patch }, source, now)).toThrow("source CI identity");
  });
  it.each([
    [{ name: "build-test", status: "completed", conclusion: "success" }],
    [{ name: "build-test", status: "completed", conclusion: "success" }, { name: "integration", status: "completed", conclusion: "skipped" }],
    [{ name: "build-test", status: "completed", conclusion: "success" }, { name: "build-test", status: "completed", conclusion: "success" }],
  ])("requires unique successful build and integration jobs", (...jobs) => {
    const { ci } = fixture();
    expect(() => validateSourceCi({ ...ci, jobs }, source, now)).toThrow();
  });
  it.each([
    { createdAt: "2026-11-14T01:00:00Z" }, { completedAt: "2026-11-14T01:00:00Z" },
    { completedAt: "2026-11-13T22:00:00Z" }, { createdAt: "2026-11-13T23:30:00" },
  ])("rejects impossible or unzoned CI chronology %j", patch => {
    const { ci } = fixture();
    expect(() => validateSourceCi({ ...ci, ...patch }, source, now)).toThrow("chronology");
  });
  it.each([
    { branch: "feature" }, { event: "push" }, { commit: source }, { environment: "preview" }, { status: "completed" },
    { mainBranchProtected: false }, { environmentMainOnly: false }, { concurrencyGroup: "arbitrary" }, { attempt: 2 },
  ])("rejects unprotected current execution context %j", async patch => {
    const { input, deps, run } = fixture();
    await expect(verifyDeltaProvenance(input, { ...deps, protectedRun: async () => ({ ...run, ...patch }) })).rejects.toThrow("workflow context");
  });
  it.each([
    { configuredReviewerIds: [] }, { actualApprovalReviewerIds: [] }, { actualApprovalReviewerIds: ["other"] },
    { configuredReviewerIds: ["3001", "3001"] }, { actualApprovalReviewerIds: ["3001", "3001"] },
  ])("rejects missing or fabricated reviewer approval %j", async patch => {
    const { input, deps, run } = fixture();
    await expect(verifyDeltaProvenance(input, { ...deps, protectedRun: async () => ({ ...run, ...patch }) })).rejects.toThrow("reviewer approval");
  });
});

describe("canonical committed evidence file boundary", () => {
  it.each(["../evidence.json", "/evidence.json", "docs\\verification\\releases\\a.json", "docs/verification/releases/../../a.json",
    "docs/verification/releases/a/./b.json", "docs/verification/releases/a.sql", "docs/verification/releases/a.json\0"])("refuses %s", path => {
    expect(() => canonicalEvidencePath(path)).toThrow();
  });
  it("rejects a linked ancestor even if its lexical name stays inside the repository", async () => {
    const root = resolve("synthetic-repo");
    await expect(verifyEvidenceFilePath(root, path, {
      realpath: async value => value,
      lstat: async value => ({ isSymbolicLink: () => value.endsWith("verification"), isFile: () => value.endsWith(".json"), isDirectory: () => !value.endsWith(".json") }),
    })).rejects.toThrow("links");
  });
  it("rejects a physical ancestor identity change", async () => {
    const root = resolve("synthetic-repo");
    await expect(verifyEvidenceFilePath(root, path, {
      realpath: async value => value.endsWith("verification") ? resolve("outside") : value,
      lstat: async value => ({ isSymbolicLink: () => false, isFile: () => value.endsWith(".json"), isDirectory: () => !value.endsWith(".json") }),
    })).rejects.toThrow("escaped repository");
  });
  it("returns a fully resolved ordinary committed artifact path", async () => {
    const root = resolve("synthetic-repo");
    await expect(verifyEvidenceFilePath(root, path, {
      realpath: async value => value,
      lstat: async value => ({ isSymbolicLink: () => false, isFile: () => value.endsWith(".json"), isDirectory: () => !value.endsWith(".json") }),
    })).resolves.toBe(resolve(root, path));
  });
});
