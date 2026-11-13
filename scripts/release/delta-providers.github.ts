import { createHash } from "node:crypto";
import type { CommandRunner } from "./process";
import { deltaChildEnvironment, runDeltaCommand } from "./delta-child-process";
import type { DeltaProtectedRunRecord, DeltaProvenanceDeps, DeltaSourceCiRecord } from "./delta-provenance";
import { canonicalEvidencePath } from "./delta-provenance";
import { verifyDeltaVercelAlias, type DeltaVercelOptions } from "./delta-providers.vercel";
import { DELTA_RELEASE_PROJECT } from "./delta-release-contracts";

const REPO = "YNWAforever/Remix-Adfocate";
const PREFIX = `https://api.github.com/repos/${REPO}`;
function refused(reason: string): never { throw new Error(`protected GitHub reader rejected: ${reason}`); }
type Json = Record<string, unknown>;
function object(value: unknown): Json {
  if (!value || typeof value !== "object" || Array.isArray(value)) refused("response object");
  return value as Json;
}
function string(value: unknown): string { if (typeof value !== "string" || !value || value.length > 4096) refused("response text"); return value as string; }
function rows(value: unknown): Json[] { if (!Array.isArray(value) || value.length > 100) refused("response list bound"); return (value as unknown[]).map(object); }
function id(value: unknown): string { const text = String(value); if (!/^[1-9]\d{0,19}$/.test(text)) refused("provider identifier"); return text; }
function timestamp(value: unknown): string { const text = string(value); if (!/^\d{4}-\d\d-\d\dT.*Z$/.test(text) || !Number.isFinite(Date.parse(text))) refused("provider timestamp"); return text; }

export interface GitHubDeltaReaderOptions {
  readonly token: string;
  readonly rootDir: string;
  readonly sourceCiRunId: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly vercel?: DeltaVercelOptions;
}
export interface GitHubDeltaReaderDeps {
  readonly fetch: typeof fetch;
  readonly run: CommandRunner;
}

export interface DeltaGitHubReaders extends DeltaProvenanceDeps {
  currentProductionDeployment(allowedCommits: readonly string[]): Promise<{ readonly commit: string; readonly deploymentId: string; readonly rootSha256: string }>;
}

/** GET-only provider. Tokens and raw provider bodies never enter errors or reports. */
export function createGitHubDeltaReaders(options: GitHubDeltaReaderOptions, deps: GitHubDeltaReaderDeps = { fetch, run: runDeltaCommand }): DeltaGitHubReaders {
  if (!options.token || /[\r\n]/.test(options.token)) refused("credential unavailable");
  const sourceCiRunId = id(options.sourceCiRunId);
  const environment = Object.fromEntries(["GITHUB_ACTIONS", "GITHUB_REPOSITORY", "GITHUB_REF", "GITHUB_EVENT_NAME", "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT", "GITHUB_SHA"]
    .map(key => [key, options.environment[key]]));
  const vercel = options.vercel ? { ...options.vercel } : undefined;
  const token = options.token, rootDir = options.rootDir;
  async function get(path: string) {
    if (!path.startsWith("/") || path.includes("..") || path.includes("#")) refused("fixed API route");
    let response: Response;
    try {
      response = await deps.fetch(`${PREFIX}${path}`, { method: "GET", headers: {
        authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28",
      }, signal: AbortSignal.timeout(15_000), redirect: "error" });
    } catch { return refused("authenticated provider read failed"); }
    if (response.status !== 200) refused(`provider HTTP ${response.status}`);
    let body: string;
    try { body = await response.text(); } catch { return refused("provider response body unavailable"); }
    if (Buffer.byteLength(body, "utf8") > 2 * 1024 * 1024) refused("provider body bound");
    try { return JSON.parse(body) as unknown; } catch { return refused("provider JSON"); }
  }
  async function git(args: string[], allowedCodes = [0]) {
    let result: Awaited<ReturnType<CommandRunner>>;
    try { result = await deps.run("git", args, { cwd: rootDir, env: deltaChildEnvironment() }); } catch { return refused("local committed-source read unavailable"); }
    if (!allowedCodes.includes(result.code)) refused("local committed-source read failed");
    return result;
  }
  return {
    currentProductionDeployment: async allowedCommits => {
      const deployments = rows(await get("/deployments?environment=Production&per_page=100"));
      if (!deployments.length) refused("production deployment unavailable");
      const latest = deployments[0]!;
      const commit = string(latest.sha), deploymentId = id(latest.id);
      const app = latest.performed_via_github_app === null ? null : object(latest.performed_via_github_app);
      const creator = latest.creator == null ? null : object(latest.creator);
      const vercelOrigin = app?.slug === "vercel" || (creator?.type === "Bot" && creator.login === "vercel[bot]" && creator.id === 35613825);
      // Vercel's legacy bot sets GitHub's optional production flag false. The
      // authenticated origin plus canonical-alias equality below proves the target.
      if (!allowedCommits.includes(commit) || string(latest.environment).toLowerCase() !== "production" || !vercelOrigin) refused("latest production deployment identity");
      const statuses = rows(await get(`/deployments/${deploymentId}/statuses?per_page=100`));
      if (!statuses.length || statuses[0]!.state !== "success") refused("latest production deployment not successful");
      const url = string(statuses[0]!.environment_url);
      if (url !== "https://adfocate-2.vercel.app" && !/^https:\/\/adfocate-2-[a-z0-9]+-ynwaforevers-projects\.vercel\.app\/?$/.test(url)) refused("trusted production deployment URL");
      if (!vercel) refused("authenticated Vercel alias binding unavailable");
      const binding = await verifyDeltaVercelAlias(vercel, allowedCommits, commit, { fetch: deps.fetch });
      if (url !== "https://adfocate-2.vercel.app" && url.replace(/\/$/, "") !== binding.url) refused("GitHub and Vercel deployment identity differ");
      async function publicSite(base: string) {
        const fetchSafe = async (suffix: string) => {
          let response: Response;
          try { response = await deps.fetch(`${base.replace(/\/$/, "")}${suffix}`, { method: "GET", redirect: "error", signal: AbortSignal.timeout(15_000) }); }
          catch { return refused("production site read"); }
          if (response.status !== 200) refused("production site status");
          let body: string;
          try { body = await response.text(); } catch { return refused("production site response body unavailable"); }
          if (Buffer.byteLength(body, "utf8") > 2 * 1024 * 1024) refused("production site body bound");
          return body;
        };
        const root = await fetchSafe("/");
        let health: unknown;
        try { health = JSON.parse(await fetchSafe("/api/health")); } catch { return refused("production health JSON"); }
        const identity = object(health);
        if (identity.ok !== true) refused("production API health");
        if (identity.applicationCommit !== commit || identity.apiProjectRef !== DELTA_RELEASE_PROJECT) refused("current API commit and database project binding");
        return createHash("sha256").update(root, "utf8").digest("hex");
      }
      const deployedRoot = await publicSite(binding.url), canonicalRoot = await publicSite("https://adfocate-2.vercel.app");
      if (deployedRoot !== canonicalRoot) refused("canonical alias does not serve the verified deployment");
      return { commit, deploymentId, rootSha256: canonicalRoot };
    },
    checkedOutCommit: async () => (await git(["rev-parse", "HEAD"])).stdout.trim(),
    trackedTreeClean: async () => !(await git(["status", "--porcelain=v1", "-z", "--untracked-files=normal"])).stdout,
    isAncestor: async (before, after) => (await git(["merge-base", "--is-ancestor", before, after], [0, 1])).code === 0,
    changedPaths: async (before, after) => (await git(["diff", "--name-only", "--no-renames", "-z", before, after, "--"])).stdout.split("\0").filter(Boolean),
    committedFile: async (commit, path) => {
      canonicalEvidencePath(path);
      if (!/^[a-f0-9]{40}$/.test(commit)) refused("commit identifier");
      const size = (await git(["cat-file", "-s", `${commit}:${path}`])).stdout.trim();
      if (!/^\d+$/.test(size) || Number(size) < 1 || Number(size) > 8 * 1024 * 1024) refused("committed artifact bound");
      return Buffer.from((await git(["show", `${commit}:${path}`])).stdout, "utf8");
    },
    sourceCi: async commit => {
      if (!/^[a-f0-9]{40}$/.test(commit)) refused("source commit identifier");
      const run = object(await get(`/actions/runs/${sourceCiRunId}`));
      const result = object(await get(`/actions/runs/${sourceCiRunId}/jobs?per_page=100`));
      const jobs = rows(result.jobs);
      if (result.total_count !== jobs.length || jobs.length < 2) refused("complete CI job coverage");
      const completed = jobs.map(job => timestamp(job.completed_at)).sort().at(-1)!;
      const record: DeltaSourceCiRecord = {
        repository: string(object(run.repository).full_name), runId: id(run.id), commit: string(run.head_sha), branch: string(run.head_branch),
        event: string(run.event), workflowPath: string(run.path), status: string(run.status), conclusion: string(run.conclusion),
        createdAt: timestamp(run.created_at), completedAt: completed,
        jobs: jobs.map(job => ({ name: string(job.name), status: string(job.status), conclusion: string(job.conclusion) })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
      };
      if (record.commit !== commit) refused("CI source commit");
      return record;
    },
    protectedRun: async (runId, attempt) => {
      if (environment.GITHUB_ACTIONS !== "true" || environment.GITHUB_REPOSITORY !== REPO || environment.GITHUB_REF !== "refs/heads/main"
        || environment.GITHUB_EVENT_NAME !== "workflow_dispatch" || environment.GITHUB_RUN_ID !== runId || Number(environment.GITHUB_RUN_ATTEMPT) !== attempt
        || !/^[a-f0-9]{40}$/.test(environment.GITHUB_SHA ?? "")) refused("actual production workflow environment");
      id(runId);
      const run = object(await get(`/actions/runs/${runId}/attempts/${attempt}`));
      const config = object(await get("/environments/production"));
      if (string(config.name).toLowerCase() !== "production") refused("production environment identity");
      const environmentId = id(config.id);
      const branch = object(await get("/branches/main"));
      const branchPolicy = object(config.deployment_branch_policy);
      let environmentMainOnly = false;
      if (branchPolicy.custom_branch_policies === true && branchPolicy.protected_branches === false) {
        const policies = object(await get("/environments/production/deployment-branch-policies?per_page=100"));
        const values = rows(policies.branch_policies);
        environmentMainOnly = policies.total_count === values.length && values.length === 1 && values[0]!.name === "main"
          && (values[0]!.type === "branch" || values[0]!.type === undefined);
      } else if (branchPolicy.protected_branches === true && branchPolicy.custom_branch_policies === false) {
        const protectedBranches = rows(await get("/branches?protected=true&per_page=100"));
        environmentMainOnly = protectedBranches.length === 1 && protectedBranches[0]!.name === "main";
      }
      const protections = rows(config.protection_rules);
      const rule = protections.filter(row => row.type === "required_reviewers");
      if (rule.length !== 1) refused("required production reviewer rule missing");
      const reviewers = rows(rule[0]!.reviewers);
      if (reviewers.some(row => row.type !== "User")) refused("unsupported reviewer membership proof");
      const configuredReviewerIds = reviewers.map(row => id(object(row.reviewer).id));
      const approvals = rows(await get(`/actions/runs/${runId}/approvals`));
      const actualApprovalReviewerIds = [...new Set(approvals.filter(row => row.state === "approved"
        && rows(row.environments).some(env => id(env.id) === environmentId)).map(row => id(object(row.user).id)))];
      const workflow = (await git(["show", `${environment.GITHUB_SHA}:.github/workflows/supabase.yml`])).stdout;
      if (!/^concurrency:\s*\r?\n {2}group: supabase-production-release\s*\r?\n {2}cancel-in-progress: false\s*$/m.test(workflow)
        || !workflow.includes("github.ref == 'refs/heads/main'")) refused("reviewed workflow serialization and main guard");
      const record: DeltaProtectedRunRecord = {
        repository: string(object(run.repository).full_name), runId: id(run.id), attempt: Number(run.run_attempt),
        commit: string(run.head_sha), branch: string(run.head_branch), event: string(run.event), workflowPath: string(run.path), status: string(run.status),
        environment: "production", configuredReviewerIds, actualApprovalReviewerIds, mainBranchProtected: branch.protected === true,
        environmentMainOnly, concurrencyGroup: "supabase-production-release",
      };
      if (record.commit !== environment.GITHUB_SHA) refused("executing workflow commit");
      return record;
    },
  };
}
