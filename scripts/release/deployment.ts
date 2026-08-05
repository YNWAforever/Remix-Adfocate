import type { DeploymentInput, DeploymentReport } from "./contracts";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export interface DeploymentDependencies {
  readonly fetch: typeof fetch;
}

interface DeploymentPayload {
  readonly id?: unknown;
  readonly readyState?: unknown;
  readonly target?: unknown;
  readonly meta?: {
    readonly githubCommitSha?: unknown;
    readonly githubCommitRef?: unknown;
  };
  readonly alias?: unknown;
  readonly aliases?: unknown;
  readonly createdAt?: unknown;
}

function requiredText(value: string, label: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`deployment verification failed: ${label} is required`);
  }
  return value.trim();
}

function schemaFingerprint(value: string) {
  const fingerprint = requiredText(value, "schema fingerprint");
  if (!/^[a-f0-9]{64}$/i.test(fingerprint)) {
    throw new Error("deployment verification failed: schema fingerprint is invalid");
  }
  return fingerprint.toLowerCase();
}

function productionHostname(value: string) {
  const alias = requiredText(value, "production alias").toLowerCase();
  let parsed: URL;
  try {
    parsed = new URL(`https://${alias}`);
  } catch {
    throw new Error("deployment verification failed: production alias is invalid");
  }
  if (
    parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || parsed.pathname !== "/"
    || parsed.search
    || parsed.hash
  ) {
    throw new Error("deployment verification failed: production alias is invalid");
  }
  return parsed.host;
}

function appOrigin(value: string, expectedHostname: string) {
  let origin: URL;
  try {
    origin = new URL(requiredText(value, "application origin"));
  } catch {
    throw new Error("deployment verification failed: application origin is invalid");
  }
  if (
    origin.protocol !== "https:"
    || origin.username
    || origin.password
    || origin.host.toLowerCase() !== expectedHostname
  ) {
    if (origin.host.toLowerCase() !== expectedHostname) {
      throw new Error("deployment verification failed: application origin does not match production alias");
    }
    throw new Error("deployment verification failed: application origin is invalid");
  }
  origin.pathname = "/";
  origin.search = "";
  origin.hash = "";
  return origin;
}

function safeDeploymentPayload(value: unknown): DeploymentPayload {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("deployment verification failed: deployment response is invalid");
  }
  return value as DeploymentPayload;
}

function aliasesFrom(payload: DeploymentPayload) {
  const raw = Array.isArray(payload.alias)
    ? payload.alias
    : Array.isArray(payload.aliases)
      ? payload.aliases
      : [];
  return raw.filter((alias): alias is string => typeof alias === "string");
}

async function fetchResponse(
  fetcher: typeof fetch,
  url: string,
  init: RequestInit,
  label: string,
) {
  try {
    return await fetcher(url, init);
  } catch {
    throw new Error(`deployment ${label} request failed`);
  }
}

async function jsonBody(response: Response, label: string) {
  try {
    return await response.json();
  } catch {
    throw new Error(`deployment ${label} response is invalid`);
  }
}

/**
 * Verifies the immutable identity of a production deployment and its two
 * public application health routes. The returned report contains no token,
 * request headers, or untrusted response fields.
 */
export async function verifyDeployment(
  input: DeploymentInput,
  deps: DeploymentDependencies,
): Promise<DeploymentReport> {
  const deploymentId = requiredText(input.deploymentId, "deployment ID");
  const teamId = requiredText(input.teamId, "team ID");
  const token = requiredText(input.token, "token");
  const expectedCommit = requiredText(input.expectedCommit, "expected commit");
  const productionAlias = productionHostname(input.productionAlias);
  const fingerprint = schemaFingerprint(input.expectedSchemaFingerprint);
  const origin = appOrigin(input.appOrigin, productionAlias);

  const deploymentUrl =
    `https://api.vercel.com/v13/deployments/${encodeURIComponent(deploymentId)}`
    + `?teamId=${encodeURIComponent(teamId)}`;
  const deploymentResponse = await fetchResponse(
    deps.fetch,
    deploymentUrl,
    {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
    },
    "deployment",
  );
  if (deploymentResponse.status !== 200) {
    throw new Error("deployment identity verification failed");
  }
  const payload = safeDeploymentPayload(await jsonBody(deploymentResponse, "deployment"));
  const commit = payload.meta?.githubCommitSha;
  const commitRef = payload.meta?.githubCommitRef;
  const aliases = aliasesFrom(payload).map((alias) => alias.trim().toLowerCase());
  if (
    payload.id !== deploymentId
    || payload.readyState !== "READY"
    || payload.target !== "production"
    || commit !== expectedCommit
    || commitRef !== "main"
    || !aliases.includes(productionAlias)
  ) {
    throw new Error("deployment identity verification failed");
  }

  const healthUrl = new URL("/api/health", origin).toString();
  const healthResponse = await fetchResponse(
    deps.fetch,
    healthUrl,
    { headers: { Accept: "application/json" } },
    "health",
  );
  if (healthResponse.status !== 200) {
    throw new Error("deployment health check failed");
  }
  const healthPayload = await jsonBody(healthResponse, "health");
  if (
    healthPayload === null
    || typeof healthPayload !== "object"
    || Array.isArray(healthPayload)
    || (healthPayload as { ok?: unknown }).ok !== true
  ) {
    throw new Error("deployment health check failed");
  }

  const homeUrl = new URL("/home", origin).toString();
  const homeResponse = await fetchResponse(deps.fetch, homeUrl, {}, "home");
  if (homeResponse.status !== 200) {
    throw new Error("deployment home check failed");
  }

  const verifiedAt = new Date().toISOString();
  const deploymentCreatedAt =
    typeof payload.createdAt === "string" && !Number.isNaN(Date.parse(payload.createdAt))
      ? new Date(payload.createdAt).toISOString()
      : undefined;
  return {
    schemaVersion: 1,
    status: "passed",
    deploymentId,
    deploymentStatusCode: deploymentResponse.status,
    deploymentReadyState: "READY",
    deploymentTarget: "production",
    commit: expectedCommit,
    commitRef: "main",
    productionAlias,
    healthStatusCode: healthResponse.status,
    homeStatusCode: homeResponse.status,
    schemaFingerprint: fingerprint,
    createdAt: verifiedAt,
    verifiedAt,
    ...(deploymentCreatedAt ? { deploymentCreatedAt } : {}),
  };
}

export type DeploymentCliDependencies = DeploymentDependencies;

function environmentValue(env: NodeJS.ProcessEnv, name: string) {
  const value = env[name];
  if (!value?.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

/**
 * Runs the guarded deployment check from trusted CI-provided environment
 * values. Positional arguments are intentionally unsupported so an operator
 * cannot substitute an unreviewed deployment target at invocation time.
 */
export async function runDeploymentCli(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  deps: DeploymentCliDependencies = { fetch: globalThis.fetch },
) {
  if (args.length > 0) throw new Error("usage: deployment.ts");
  const deploymentId = environmentValue(env, "RELEASE_VERCEL_DEPLOYMENT_ID");
  const teamId = environmentValue(env, "RELEASE_VERCEL_TEAM_ID");
  const token = environmentValue(env, "RELEASE_VERCEL_TOKEN");
  const expectedCommit = env.RELEASE_APPLICATION_COMMIT ?? env.GITHUB_SHA;
  if (!expectedCommit?.trim()) {
    throw new Error("RELEASE_APPLICATION_COMMIT or GITHUB_SHA is required");
  }
  return verifyDeployment(
    {
      deploymentId,
      teamId,
      token,
      expectedCommit: expectedCommit.trim(),
      productionAlias: environmentValue(env, "RELEASE_PRODUCTION_ALIAS"),
      appOrigin: environmentValue(env, "RELEASE_APP_ORIGIN"),
      expectedSchemaFingerprint: environmentValue(env, "RELEASE_SCHEMA_FINGERPRINT"),
    },
    deps,
  );
}

function cliFailure(error: unknown) {
  if (error instanceof Error && /^(usage: deployment\.ts|RELEASE_[A-Z_]+|RELEASE_APPLICATION_COMMIT)/.test(error.message)) {
    return error.message;
  }
  return "deployment verification failed";
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = await runDeploymentCli(process.argv.slice(2), process.env);
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ status: "failed", error: cliFailure(error) })}\n`);
    process.exitCode = 1;
  }
}
