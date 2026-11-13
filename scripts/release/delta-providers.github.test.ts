// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createGitHubDeltaReaders } from "./delta-providers.github";
import { provenanceDigest, validateSourceCi, verifyDeltaProvenance, type DeltaSourceCiRecord } from "./delta-provenance";
import { DELTA_FIXTURE_NOW as NOW, deltaFixtureAt as at, deltaFixtureHash as h } from "./delta-release.fixture";
import type { CommandRunner } from "./process";

// Synthetic provider bodies only. Both fetch and command execution are always mocked.
const REPO = "YNWAforever/Remix-Adfocate";
const API = `https://api.github.com/repos/${REPO}`;
const CANONICAL = "https://adfocate-2.vercel.app";
const GENERATED = "https://adfocate-2-fixture123-ynwaforevers-projects.vercel.app";
const A = h("github-source").slice(0, 40), B = h("github-evidence").slice(0, 40), C = h("github-unapproved").slice(0, 40);
const TOKEN = "fixture-private-bearer-value-never-report";
const VERCEL_TOKEN = "fixture-private-vercel-value-never-report";
const PROJECT = "prj_fixtureAdfocate", TEAM = "team_fixture", DPL = "dpl_fixtureBinding";
const VERCEL_API = "https://api.vercel.com";
const MH = "mhkoayftiuojxlrkollf";
const PATH = "docs/verification/releases/fixture-github.json";
const BYTES = Buffer.from('{"synthetic":true}\n');
const HTML = '<html><script src="/assets/fixture.js"></script></html>';
const WORKFLOW = "concurrency:\n  group: supabase-production-release\n  cancel-in-progress: false\njobs:\n  release:\n    if: github.ref == 'refs/heads/main'\n";
type Body = Record<string, unknown>;
interface Reply { body?: unknown; raw?: string; status?: number; fetchError?: Error; bodyError?: Error }
function set(value: unknown, path: string, replacement: unknown) {
  const parts = path.split("."); let current = value as Body;
  for (const part of parts.slice(0, -1)) current = current[part] as Body;
  current[parts.at(-1)!] = replacement;
}
function fixture() {
  const sourceRun = { id: 1001, repository: { full_name: REPO }, head_sha: A, head_branch: "main", event: "push", path: ".github/workflows/ci.yml",
    status: "completed", conclusion: "success", created_at: at(-20) };
  const jobs = { total_count: 2, jobs: [
    { name: "integration", status: "completed", conclusion: "success", completed_at: at(-10), run_id: 1001, head_sha: A },
    { name: "build-test", status: "completed", conclusion: "success", completed_at: at(-11), run_id: 1001, head_sha: A },
  ] };
  const run = { id: 2001, run_attempt: 2, repository: { full_name: REPO }, head_sha: B, head_branch: "main", event: "workflow_dispatch",
    path: ".github/workflows/supabase.yml", status: "in_progress" };
  const config = { id: 4001, name: "production", deployment_branch_policy: { custom_branch_policies: true, protected_branches: false },
    protection_rules: [{ type: "required_reviewers", reviewers: [{ type: "User", reviewer: { id: 3001 } }] }] };
  const branch = { name: "main", protected: true };
  const policies = { total_count: 1, branch_policies: [{ name: "main", type: "branch" }] };
  const approvals = [{ state: "approved", environments: [{ id: 4001, name: "production" }], user: { id: 3001 } }];
  const deployment = { id: 9001, sha: A, environment: "Production", production_environment: true, performed_via_github_app: { slug: "vercel" },
    creator: { login: "vercel[bot]", id: 35613825, type: "Bot" } };
  const statuses = [{ state: "success", environment_url: GENERATED }];
  const replies = new Map<string, Reply>([
    [`${API}/actions/runs/1001`, { body: sourceRun }], [`${API}/actions/runs/1001/jobs?per_page=100`, { body: jobs }],
    [`${API}/actions/runs/2001/attempts/2`, { body: run }], [`${API}/environments/production`, { body: config }],
    [`${API}/branches/main`, { body: branch }], [`${API}/environments/production/deployment-branch-policies?per_page=100`, { body: policies }],
    [`${API}/branches?protected=true&per_page=100`, { body: [{ name: "main" }] }], [`${API}/actions/runs/2001/approvals`, { body: approvals }],
    [`${API}/deployments?environment=Production&per_page=100`, { body: [deployment] }], [`${API}/deployments/9001/statuses?per_page=100`, { body: statuses }],
    [`${GENERATED}/`, { raw: HTML }], [`${CANONICAL}/`, { raw: HTML }],
    [`${GENERATED}/api/health`, { body: { ok: true, applicationCommit: A, apiProjectRef: MH } }],
    [`${CANONICAL}/api/health`, { body: { ok: true, applicationCommit: A, apiProjectRef: MH } }],
    [`${VERCEL_API}/v4/aliases/adfocate-2.vercel.app?projectId=${PROJECT}&teamId=${TEAM}`, { body: {
      alias: "adfocate-2.vercel.app", projectId: PROJECT, deploymentId: DPL, deployment: { id: DPL, url: new URL(GENERATED).hostname },
    } }],
    [`${VERCEL_API}/v13/deployments/${DPL}?withGitRepoInfo=true&teamId=${TEAM}`, { body: {
      id: DPL, projectId: PROJECT, ownerId: TEAM, team: { id: TEAM }, readyState: "READY", target: "production", url: new URL(GENERATED).hostname,
      gitSource: { type: "github", sha: A }, meta: { githubCommitSha: A },
    } }],
  ]);
  const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], _init?: RequestInit): Promise<Response> => {
    void _init;
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const reply = replies.get(url);
    if (!reply) throw new Error("unexpected synthetic GET");
    if (reply.fetchError) throw reply.fetchError;
    if (reply.bodyError) {
      const response = new Response("", { status: reply.status ?? 200 });
      vi.spyOn(response, "text").mockRejectedValue(reply.bodyError);
      return response;
    }
    return new Response(reply.raw ?? JSON.stringify(reply.body), { status: reply.status ?? 200 });
  });
  let statusOutput = "", workflow = WORKFLOW;
  let runError: Error | undefined;
  const runMock = vi.fn<CommandRunner>(async (file, args) => {
    if (file !== "git") throw new Error("unexpected synthetic command");
    if (runError) throw runError;
    let stdout: string;
    if (args[0] === "rev-parse") stdout = `${B}\n`;
    else if (args[0] === "status") stdout = statusOutput;
    else if (args[0] === "merge-base") stdout = "";
    else if (args[0] === "diff") stdout = `${PATH}\0`;
    else if (args[0] === "cat-file") stdout = String(BYTES.length);
    else if (args[0] === "show" && args[1]?.endsWith(":.github/workflows/supabase.yml")) stdout = workflow;
    else if (args[0] === "show" && args[1] === `${B}:${PATH}`) stdout = BYTES.toString("utf8");
    else throw new Error("unexpected synthetic git read");
    return { code: 0, stdout, stderr: "" };
  });
  const environment = { GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: REPO, GITHUB_REF: "refs/heads/main", GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_RUN_ID: "2001", GITHUB_RUN_ATTEMPT: "2", GITHUB_SHA: B };
  const options = { token: TOKEN, rootDir: "fixture-repository", sourceCiRunId: "1001", environment,
    vercel: { token: VERCEL_TOKEN, projectId: PROJECT, teamId: TEAM } };
  const create = () => createGitHubDeltaReaders(options, { fetch: fetchMock, run: runMock });
  const expectedCi: DeltaSourceCiRecord = { repository: REPO, runId: "1001", commit: A, branch: "main", event: "push", workflowPath: ".github/workflows/ci.yml",
    status: "completed", conclusion: "success", createdAt: at(-20), completedAt: at(-10), jobs: [
      { name: "build-test", status: "completed", conclusion: "success" }, { name: "integration", status: "completed", conclusion: "success" },
    ] };
  const verify = () => verifyDeltaProvenance({ sourceCommit: A, evidenceCommit: B, bundlePath: PATH, bundleBytes: BYTES,
    expectedSourceCiReportHash: provenanceDigest(expectedCi), expectedGitHubApproverId: "3001", runId: "2001", runAttempt: 2, now: NOW }, create());
  const verifyCi = async () => validateSourceCi(await create().sourceCi(A), A, NOW);
  return { create, verify, verifyCi, fetchMock, runMock, replies, options, expectedCi, sourceRun, jobs, run, config, branch, policies, approvals, deployment, statuses,
    status: (value: string) => { statusOutput = value; }, workflow: (value: string) => { workflow = value; }, failRun: (value: Error) => { runError = value; } };
}
async function safeRejected(promise: Promise<unknown>, reason?: string) {
  const failure = await promise.then(() => undefined, failure => failure as Error);
  expect(failure).toBeInstanceOf(Error);
  if (reason) expect(failure!.message).toContain(reason);
  expect(`${failure!.message}\n${failure!.stack}`).not.toContain(TOKEN);
  return failure!;
}

describe("authenticated GitHub readers with synthetic GET and git adapters", () => {
  it("normalizes exact CI and validates protected main, the current attempt, and actual reviewer identity", async () => {
    const f = fixture(); expect(await f.create().sourceCi(A)).toEqual(f.expectedCi);
    const result = await f.verify();
    expect(result.approvedByGitHubActorId).toBe("3001"); expect(result.protectedRunAttempt).toBe(2);
    expect(result.permittedDeploymentCommits).toEqual([A, B]);
    for (const [url, init] of f.fetchMock.mock.calls) {
      expect(String(url).startsWith(`${API}/`)).toBe(true); expect(init?.method).toBe("GET"); expect(init?.redirect).toBe("error");
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${TOKEN}`);
    }
    expect(f.runMock.mock.calls.every(([file, , options]) => file === "git" && options?.cwd === "fixture-repository")).toBe(true);
  });
  it("uses fixed read routes and NUL-delimited git paths without invoking a process", async () => {
    const f = fixture(), readers = f.create();
    expect(await readers.checkedOutCommit()).toBe(B); expect(await readers.trackedTreeClean()).toBe(true);
    expect(await readers.isAncestor(A, B)).toBe(true); expect(await readers.changedPaths(A, B)).toEqual([PATH]);
    expect(await readers.committedFile(B, PATH)).toEqual(BYTES);
    expect(f.runMock.mock.calls.map(([, args]) => args[0])).toEqual(["rev-parse", "status", "merge-base", "diff", "cat-file", "show"]);
    const before = f.runMock.mock.calls.length;
    await safeRejected(readers.committedFile(B, "docs/verification/releases/../../private.json"));
    expect(f.runMock.mock.calls).toHaveLength(before);
  });
  it("rejects tracked changes and untracked shadow files before provider reads", async () => {
    for (const output of [" M scripts/release/delta-executor.ts\0", "?? scripts/release/manifest.js\0"]) {
      const f = fixture(); f.status(output); await safeRejected(f.verify(), "source modifications"); expect(f.fetchMock).not.toHaveBeenCalled();
    }
  });
  it.each([
    ["head_sha", B], ["head_branch", "feature"], ["event", "pull_request"], ["path", ".github/workflows/other.yml"],
    ["status", "in_progress"], ["conclusion", "failure"], ["repository.full_name", "other/repository"],
  ])("rejects wrong actual CI identity at %s", async (path, value) => {
    const f = fixture(); set(f.sourceRun, path, value); await safeRejected(f.verifyCi());
  });
  it.each([
    ["jobs.0.conclusion", "skipped"], ["jobs.0.name", "lint"], ["jobs.0.name", "build-test"], ["jobs.0.completed_at", null],
    ["jobs.0.completed_at", at(1)], ["total_count", 101],
  ])("rejects incomplete, skipped, duplicate or stale CI job observations at %s", async (path, value) => {
    const f = fixture(); set(f.jobs, path, value); await safeRejected(f.verifyCi());
  });
  it("rejects CI pagination and oversized list truncation", async () => {
    const f = fixture(); f.jobs.total_count = 101;
    f.jobs.jobs = Array.from({ length: 100 }, () => ({ ...f.jobs.jobs[0]! })); await safeRejected(f.verifyCi(), "complete CI job coverage");
  });

  it("keeps the profile on HOLD when main is unprotected or production has no required reviewer rule", async () => {
    const f = fixture(); f.branch.protected = false; await safeRejected(f.verify(), "workflow context");
    const missing = fixture(); missing.config.protection_rules = []; await safeRejected(missing.verify(), "required production reviewer rule missing");
  });
  it.each([
    ["deployment_branch_policy", null], ["deployment_branch_policy", { custom_branch_policies: false, protected_branches: false }],
    ["protection_rules.0.reviewers.0.type", "Team"], ["protection_rules.0.reviewers", []],
  ])("rejects unsupported production protection at %s", async (path, value) => {
    const f = fixture(); set(f.config, path, value); await safeRejected(f.verify());
  });
  it("requires exactly main in custom or protected-branch environment policies", async () => {
    const f = fixture(); f.policies.branch_policies.push({ name: "release/*", type: "branch" }); f.policies.total_count = 2;
    await safeRejected(f.verify(), "workflow context");
    const protectedOnly = fixture(); protectedOnly.config.deployment_branch_policy = { custom_branch_policies: false, protected_branches: true };
    expect((await protectedOnly.verify()).approvedByGitHubActorId).toBe("3001");
    protectedOnly.replies.set(`${API}/branches?protected=true&per_page=100`, { body: [{ name: "main" }, { name: "other" }] });
    await safeRejected(protectedOnly.verify(), "workflow context");
  });
  it.each([
    ["user.id", 3002], ["state", "rejected"], ["environments.0.id", 4002],
  ])("requires approval from the configured actor for the actual environment: %s", async (path, value) => {
    const f = fixture(); set(f.approvals[0], path, value); await safeRejected(f.verify(), "reviewer approval");
  });
  it.each([
    ["run_attempt", 1], ["id", 2002], ["head_sha", C], ["head_branch", "other"], ["path", ".github/workflows/ci.yml"],
    ["status", "completed"], ["event", "push"], ["repository.full_name", "other/repository"],
  ])("rejects wrong current workflow identity or attempt at %s", async (path, value) => {
    const f = fixture(); set(f.run, path, value); await safeRejected(f.verify());
  });
  it("snapshots workflow environment and rejects non-main invocation before any provider read", async () => {
    const f = fixture(); f.options.environment.GITHUB_REF = "refs/heads/other";
    await safeRejected(f.create().protectedRun("2001", 2), "actual production workflow environment"); expect(f.fetchMock).not.toHaveBeenCalled();
    const stable = fixture(), readers = stable.create(); stable.options.environment.GITHUB_REF = "refs/heads/other";
    expect((await readers.protectedRun("2001", 2)).branch).toBe("main");
  });
  it("snapshots provider tokens, repository root and Vercel policy at construction", async () => {
    const f = fixture(), readers = f.create();
    set(f.options, "token", "changed-fixture-token"); set(f.options, "rootDir", "changed-fixture-root");
    set(f.options, "vercel.token", "changed-fixture-vercel-token"); set(f.options, "vercel.projectId", "prj_other");
    expect(await readers.checkedOutCommit()).toBe(B);
    expect((await readers.currentProductionDeployment([A, B])).commit).toBe(A);
    expect(f.runMock.mock.calls[0]![2]?.cwd).toBe("fixture-repository");
    for (const [url, init] of f.fetchMock.mock.calls) {
      if (String(url).startsWith(API)) expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${TOKEN}`);
      if (String(url).startsWith(VERCEL_API)) expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${VERCEL_TOKEN}`);
    }
  });
  it("requires reviewed workflow serialization and an explicit main guard", async () => {
    const f = fixture(); f.workflow(WORKFLOW.replace("cancel-in-progress: false", "cancel-in-progress: true")); await safeRejected(f.verify(), "serialization");
    const wrong = fixture(); wrong.workflow(WORKFLOW.replace("github.ref == 'refs/heads/main'", "true")); await safeRejected(wrong.verify(), "serialization");
  });

  it.each([401, 403, 404, 500])("rejects provider HTTP %s without returning a private response body", async status => {
    const f = fixture(); f.replies.set(`${API}/actions/runs/1001`, { status, raw: TOKEN }); await safeRejected(f.verifyCi(), `HTTP ${status}`);
  });
  it("redacts fetch, body-stream and command-runner failures", async () => {
    for (const source of ["fetch", "body", "run"] as const) {
      const f = fixture();
      if (source === "run") f.failRun(new Error(TOKEN));
      else f.replies.set(`${API}/actions/runs/1001`, { [source === "fetch" ? "fetchError" : "bodyError"]: new Error(TOKEN) });
      await safeRejected(source === "run" ? f.create().checkedOutCommit() : f.verifyCi());
    }
  });
  it("rejects malformed and oversized provider JSON", async () => {
    const malformed = fixture(); malformed.replies.set(`${API}/actions/runs/1001`, { raw: `not-json-${TOKEN}` }); await safeRejected(malformed.verifyCi(), "provider JSON");
    const huge = fixture(); huge.replies.set(`${API}/actions/runs/1001`, { raw: " ".repeat(2 * 1024 * 1024 + 1) }); await safeRejected(huge.verifyCi(), "body bound");
  });
});

describe("current production deployment observations (synthetic provider data)", () => {
  it("binds a successful Vercel deployment and canonical root while sending no token to public sites", async () => {
    const f = fixture(); const result = await f.create().currentProductionDeployment([A, B]);
    expect(result).toEqual({ commit: A, deploymentId: "9001", rootSha256: createHash("sha256").update(HTML).digest("hex") });
    for (const [url, init] of f.fetchMock.mock.calls) {
      expect(init?.method).toBe("GET"); expect(init?.redirect).toBe("error");
      if (String(url).startsWith(VERCEL_API)) expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${VERCEL_TOKEN}`);
      else if (!String(url).startsWith(API)) expect(new Headers(init?.headers).has("authorization")).toBe(false);
    }
  });
  it("accepts the exact legacy Vercel bot identity despite a false production_environment hint", async () => {
    const f = fixture(); set(f.deployment, "performed_via_github_app", null); f.deployment.production_environment = false;
    expect((await f.create().currentProductionDeployment([A])).commit).toBe(A);
  });
  it.each([
    ["sha", C], ["environment", "Preview"], ["performed_via_github_app.slug", "other-app"],
  ])("rejects wrong production deployment identity at %s", async (path, value) => {
    const f = fixture(); set(f.deployment, path, value);
    if (path.includes("performed")) set(f.deployment, "creator.id", 999);
    await safeRejected(f.create().currentProductionDeployment([A, B]));
  });
  it.each([["creator.id", 35613826], ["creator.login", "other[bot]"], ["creator.type", "User"]])("rejects forged legacy Vercel identity at %s", async (path, value) => {
    const f = fixture(); set(f.deployment, "performed_via_github_app", null); set(f.deployment, path as string, value);
    await safeRejected(f.create().currentProductionDeployment([A]));
  });
  it.each(["pending", "failure", "inactive"])("rejects latest deployment status %s", async state => {
    const f = fixture(); f.statuses[0]!.state = state; await safeRejected(f.create().currentProductionDeployment([A]));
  });
  it.each(["http://adfocate-2.vercel.app", "https://evil.example", "https://adfocate-2.vercel.app.evil.example", "https://adfocate-2-fixture123-ynwaforevers-projects.vercel.app/other"])("rejects untrusted public target %s", async url => {
    const f = fixture(); f.statuses[0]!.environment_url = url; await safeRejected(f.create().currentProductionDeployment([A]));
    expect(f.fetchMock.mock.calls.every(([target]) => String(target).startsWith(API) || String(target).startsWith(VERCEL_API))).toBe(true);
  });
  it("rejects a canonical alias with different HTML", async () => {
    const f = fixture(); f.replies.set(`${CANONICAL}/`, { raw: "different fixture application" });
    await safeRejected(f.create().currentProductionDeployment([A]), "canonical alias");
  });
  it("requires independent Vercel policy and rejects an unapproved alias before public requests", async () => {
    const missing = fixture(); set(missing.options, "vercel", undefined);
    await safeRejected(missing.create().currentProductionDeployment([A, B]));
    expect(missing.fetchMock.mock.calls.every(([url]) => String(url).startsWith(API))).toBe(true);
    const wrong = fixture();
    const reply = wrong.replies.get(`${VERCEL_API}/v13/deployments/${DPL}?withGitRepoInfo=true&teamId=${TEAM}`)!;
    set(reply.body, "gitSource.sha", C); set(reply.body, "meta.githubCommitSha", C);
    await safeRejected(wrong.create().currentProductionDeployment([A, B]));
    expect(wrong.fetchMock.mock.calls.every(([url]) => String(url).startsWith(API) || String(url).startsWith(VERCEL_API))).toBe(true);
  });
  it.each([
    { ok: true }, { ok: true, applicationCommit: A, apiProjectRef: "wrong-project" }, { ok: true, applicationCommit: C, apiProjectRef: MH },
  ])("requires current immutable API commit and the pinned backend project", async health => {
    const f = fixture(); f.replies.set(`${GENERATED}/api/health`, { body: health });
    await safeRejected(f.create().currentProductionDeployment([A, B]));
  });
  it("rejects a different API commit even when static root HTML matches", async () => {
    const f = fixture(); f.replies.set(`${CANONICAL}/api/health`, { body: { ok: true, applicationCommit: C, apiProjectRef: MH } });
    await safeRejected(f.create().currentProductionDeployment([A, B]));
  });
  it.each([`${GENERATED}/`, `${GENERATED}/api/health`, `${CANONICAL}/`, `${CANONICAL}/api/health`])("rejects public HTTP failure at %s", async url => {
    const f = fixture(); f.replies.set(url, { status: 503, raw: TOKEN }); await safeRejected(f.create().currentProductionDeployment([A]));
  });
  it("rejects unhealthy APIs, malformed health JSON, and private body-read errors", async () => {
    for (const reply of [{ body: { ok: false } }, { raw: "not JSON" }, { bodyError: new Error(TOKEN) }]) {
      const f = fixture(); f.replies.set(`${GENERATED}/api/health`, reply); await safeRejected(f.create().currentProductionDeployment([A]));
    }
    const root = fixture(); root.replies.set(`${GENERATED}/`, { bodyError: new Error(TOKEN) }); await safeRejected(root.create().currentProductionDeployment([A]));
  });
});
