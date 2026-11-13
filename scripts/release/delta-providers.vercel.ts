const ORIGIN = "https://api.vercel.com";
const CANONICAL_ALIAS = "adfocate-2.vercel.app";
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const SHA = /^[a-f0-9]{40}$/;
const GENERATED_HOST = /^adfocate-2-[a-z0-9]+-ynwaforevers-projects\.vercel\.app$/;
function refused(reason: string): never { throw new Error(`protected Vercel reader rejected: ${reason}`); }
type Row = Record<string, unknown>;
function object(value: unknown): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) refused("provider object");
  return value as Row;
}
function identifier(value: unknown, prefix: "prj_" | "team_" | "dpl_"): string {
  if (typeof value !== "string" || !new RegExp(`^${prefix}[A-Za-z0-9]{1,64}$`).test(value)) refused("provider identifier");
  return value;
}
function commit(value: unknown): string { if (typeof value !== "string" || !SHA.test(value)) refused("commit identifier"); return value; }
export interface DeltaVercelOptions {
  readonly token: string;
  readonly projectId: string;
  readonly teamId?: string;
}
export interface DeltaVercelDependencies { readonly fetch: typeof fetch }
export interface DeltaVercelAliasBinding {
  readonly commit: string;
  readonly deploymentId: string;
  readonly url: string;
  readonly projectId: string;
}

/**
 * Authenticated alias identity, never inferred from equal HTML. Policy inputs
 * must come from the protected environment independently of the evidence.
 * Docs: https://vercel.com/docs/rest-api/aliases/get-an-alias
 *       https://vercel.com/docs/rest-api/deployments/get-a-deployment-by-id-or-url
 */
export async function verifyDeltaVercelAlias(options: DeltaVercelOptions, allowedCommits: readonly string[], expectedGitHubCommit: string,
  deps: DeltaVercelDependencies = { fetch }): Promise<DeltaVercelAliasBinding> {
  // Capture all caller-controlled values before any await.
  const token = options?.token, projectId = identifier(options?.projectId, "prj_");
  const teamId = options?.teamId === undefined ? undefined : identifier(options.teamId, "team_");
  if (typeof token !== "string" || !/^[!-~]{1,4096}$/.test(token)) refused("credential unavailable");
  if (!Array.isArray(allowedCommits) || allowedCommits.length < 1 || allowedCommits.length > 2
    || Object.keys(allowedCommits).length !== allowedCommits.length) refused("independent allowed commits");
  const allowed = [...allowedCommits].map(commit), expected = commit(expectedGitHubCommit);
  if (new Set(allowed).size !== allowed.length || !allowed.includes(expected)) refused("independent allowed commits");
  const fetchProvider = deps.fetch;

  async function get(path: string): Promise<Row> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      void _resolve;
      timer = setTimeout(() => { controller.abort(); reject(new Error("protected Vercel reader rejected: provider timeout")); }, TIMEOUT_MS);
    });
    const read = async () => {
      let response: Response;
      try {
        response = await fetchProvider(`${ORIGIN}${path}`, { method: "GET", redirect: "error", headers: {
          authorization: `Bearer ${token}`, accept: "application/json",
        }, signal: controller.signal });
      } catch { return refused("authenticated provider read failed"); }
      if (response.status !== 200) refused("provider HTTP status");
      let body: string;
      try { body = await response.text(); } catch { return refused("provider body read failed"); }
      if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) refused("provider body bound");
      let value: unknown;
      try { value = JSON.parse(body); } catch { return refused("provider JSON"); }
      return object(value);
    };
    try { return await Promise.race([read(), deadline]); }
    finally { if (timer) clearTimeout(timer); }
  }

  const aliasQuery = new URLSearchParams({ projectId });
  if (teamId) aliasQuery.set("teamId", teamId);
  const alias = await get(`/v4/aliases/${CANONICAL_ALIAS}?${aliasQuery}`);
  if (alias.alias !== CANONICAL_ALIAS || alias.projectId !== projectId || alias.deletedAt != null
    || alias.redirect != null || alias.redirectStatusCode != null || alias.microfrontends != null) refused("canonical alias identity or routing");
  // The full alias representation must corroborate its required top-level ID.
  const aliasDeployment = object(alias.deployment);
  const deploymentId = identifier(alias.deploymentId, "dpl_");
  if (aliasDeployment.id !== deploymentId || (teamId !== undefined && alias.teamId !== undefined && alias.teamId !== teamId)) refused("alias deployment or team binding");
  const deploymentQuery = new URLSearchParams({ withGitRepoInfo: "true" });
  if (teamId) deploymentQuery.set("teamId", teamId);
  const deployment = await get(`/v13/deployments/${deploymentId}?${deploymentQuery}`);
  if (deployment.id !== deploymentId || deployment.readyState !== "READY" || deployment.target !== "production"
    || deployment.deletedAt != null || deployment.softDeletedByRetention === true) refused("ready production deployment");
  const project = deployment.project === undefined ? undefined : object(deployment.project);
  if ((deployment.projectId === undefined && project?.id === undefined)
    || (deployment.projectId !== undefined && deployment.projectId !== projectId) || (project !== undefined && project.id !== projectId)) refused("deployment project binding");
  const team = deployment.team == null ? undefined : object(deployment.team);
  if (teamId !== undefined) {
    if ((deployment.ownerId === undefined && team?.id === undefined) || (deployment.ownerId !== undefined && deployment.ownerId !== teamId)
      || (team !== undefined && team.id !== teamId)) refused("deployment team binding");
  } else if (deployment.ownerId !== undefined && team !== undefined && deployment.ownerId !== team.id) refused("ambiguous deployment owner");

  const git = deployment.gitSource == null ? undefined : object(deployment.gitSource);
  const meta = deployment.meta == null ? undefined : object(deployment.meta);
  if (git !== undefined && git.type !== "github") refused("GitHub deployment source");
  const candidates: string[] = [];
  if (git?.sha !== undefined) candidates.push(commit(git.sha));
  if (meta?.githubCommitSha !== undefined) candidates.push(commit(meta.githubCommitSha));
  if (!candidates.length || candidates.some(value => value !== candidates[0]) || candidates[0] !== expected || !allowed.includes(candidates[0]!)) refused("deployment commit binding");
  const host = deployment.url;
  if (typeof host !== "string" || !GENERATED_HOST.test(host) || (aliasDeployment.url !== undefined && aliasDeployment.url !== host)) refused("immutable deployment URL");
  return { commit: candidates[0]!, deploymentId, url: `https://${host}`, projectId };
}
