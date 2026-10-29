import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { URL, pathToFileURL } from "node:url";
import { verifyIntegrationIdentity } from "./run-integration-tests.mjs";

// CI owns the disposable stack on its fresh hosted runner. Capture physical
// identities from that stack; never synthesize container/image/network IDs.
export function captureCiIntegrationIdentity(env, projectId, inspect = spawnSync) {
  if (env.GITHUB_ACTIONS !== "true" || env.RUNNER_ENVIRONMENT !== "github-hosted"
    || !/^[0-9]+$/.test(env.GITHUB_RUN_ID ?? "") || !/^[0-9]+$/.test(env.GITHUB_RUN_ATTEMPT ?? "")
    || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(env.GITHUB_REPOSITORY ?? "")) {
    throw new Error("CI target capture requires a GitHub-hosted Actions run");
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(projectId ?? "")) throw new Error("local Supabase project_id is required");
  const metadata = (service) => {
    // Select only public metadata, never .Config.Env or local credentials.
    const format = '{"id":{{json .Id}},"image":{{json .Image}},"networks":{{json .NetworkSettings.Networks}}}';
    const result = inspect("docker", ["inspect", "--format", format, `supabase_${service}_${projectId}`], {
      encoding: "utf8", timeout: 10000,
    });
    if (result.status !== 0 || result.error) throw new Error("CI integration container metadata unavailable");
    return JSON.parse(result.stdout);
  };
  const api = metadata("kong"), database = metadata("db");
  const network = Object.values(api.networks ?? {}).find((entry) => entry.NetworkID
    && Object.values(database.networks ?? {}).some((peer) => peer.NetworkID === entry.NetworkID));
  if (!network) throw new Error("CI integration containers must share a verified network");
  const identity = {
    disposable: true,
    ownerAuthorization: `GitHub Actions ${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}/attempts/${env.GITHUB_RUN_ATTEMPT}: disposable integration job`,
    runId: `${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`,
    projectId, proxy: "none", apiPort: Number(new URL(env.SUPABASE_URL).port || 80),
    apiContainerId: api.id, databaseContainerId: database.id,
    apiImageId: api.image, databaseImageId: database.image, networkId: network.NetworkID,
  };
  // Reinspect by exact ID using the same checks the launcher and test clients use.
  return verifyIntegrationIdentity({ ...env, INTEGRATION_TARGET_IDENTITY_JSON: JSON.stringify(identity) }, inspect);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const projectId = /^project_id\s*=\s*"([^"]+)"/m.exec(readFileSync("supabase/config.toml", "utf8"))?.[1];
  const identity = captureCiIntegrationIdentity(process.env, projectId);
  process.stdout.write(`INTEGRATION_TARGET_IDENTITY_JSON=${JSON.stringify(identity)}\n`);
}
