import { spawn, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import process from "node:process";
import { URL, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

export const publicationProofPreflightFile = "server/test/publication-proof-asset-grant-live.test.ts";

export const integrationFiles = [
  "server/test/rls.test.ts",
  "server/test/bootstrap.test.ts",
  "server/test/onboarding.test.ts",
  "server/test/missions.test.ts",
  "server/test/admin.test.ts",
  "server/test/admin-staff.test.ts",
  "server/test/redemption.test.ts",
  "server/test/wallet.test.ts",
  "server/test/me.test.ts",
  "server/test/leveling.test.ts",
  "server/test/passport.test.ts",
  "server/test/match.test.ts",
  "server/test/copilot.test.ts",
  "server/test/applications.test.ts",
  "server/test/social-schema.test.ts",
  "server/test/social.test.ts",
  "server/test/verificationGate.test.ts",
  "server/test/public-passport.test.ts",
  "server/test/cron-social-refresh.test.ts",
  "server/test/operator-crm-schema.test.ts",
  "server/test/operator-crm.test.ts",
  "server/test/assistant.test.ts",
  "server/test/adminContent.test.ts",
  "server/test/content.test.ts",
  "server/test/active-mission-schema.test.ts",
  "server/test/active-missions.test.ts",
  "server/test/reward-contracts.test.ts",
  "server/test/reward-handoffs.test.ts",
  "server/test/notifications-triggers.test.ts",
  "server/test/notifications-api.test.ts",
  "server/test/insights.test.ts",
  "server/test/radar.test.ts",
  "server/test/brand.test.ts",
  "server/test/campaigns.test.ts",
  "server/test/campaigns-s2.test.ts",
  "server/test/brandResources.test.ts",
  "server/test/academy.test.ts",
  "server/test/adminAcademy.test.ts",
  "server/test/academy-seed.test.ts",
  "server/test/publication-proof-review-live.test.ts",
];

const vitest = resolve("node_modules/vitest/vitest.mjs");

// B1: this retained incident target is forensics-only, never an acceptance baseline.
// Match immutable resources too, so relabelling a project cannot reuse its data volume.
export function assertAcceptanceTargetAllowed(target) {
  const retiredContainers = [
    "c96d960e276cb7c84ae5bf52fdf77e854865516d89d95ca2148a55b6137fa7e9",
    "34bd00cda4f4c91650795b83d4d48d5e46ecb90b310a3e409b31c02f99cec176",
  ];
  const networks = [target.networkId, ...Object.values(target.networks ?? {}).map(n => n.NetworkID)];
  const volumes = [target.volumeName, ...(target.mounts ?? []).filter(m => m.Type === "volume").map(m => m.Name)];
  if ([target.projectId, target.project].includes("adfocate-r1-shaped-20261023")
    || [target.apiContainerId, target.databaseContainerId, target.id].some(id => retiredContainers.includes(id))
    || networks.includes("fbf71b13e7f584b230b293383cccbd2157814168cbae1d9169b377d8f886f69d")
    || volumes.includes("supabase_db_adfocate-r1-shaped-20261023")) {
    throw new Error("B1: retired target is forensics-only; acceptance/pristine setup refused. B2 requires separate approval.");
  }
}

export function assertIntegrationEnvironment(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY || !env.SUPABASE_ANON_KEY) {
    throw new Error("SUPABASE_URL, SUPABASE_SERVICE_KEY, and SUPABASE_ANON_KEY are required");
  }
  let url;
  try {
    url = new URL(env.SUPABASE_URL);
  } catch {
    throw new Error("SUPABASE_URL must be a valid loopback HTTP(S) URL");
  }
  if (!["http:", "https:"].includes(url.protocol)
    || !["localhost", "127.0.0.1"].includes(url.hostname)) {
    throw new Error("SUPABASE_URL must be a loopback HTTP(S) URL");
  }
  let identity;
  try { identity = JSON.parse(env.INTEGRATION_TARGET_IDENTITY_JSON ?? ""); }
  catch { throw new Error("integration target identity is required before any client setup"); }
  if (!identity || identity.disposable !== true || !identity.ownerAuthorization
    || !identity.projectId || !identity.runId || identity.proxy !== "none"
    || !identity.apiContainerId || !identity.databaseContainerId || !identity.networkId
    || !identity.apiImageId || !identity.databaseImageId
    || url.protocol !== "http:" || url.username || url.password
    || Number(url.port || 80) !== identity.apiPort) {
    throw new Error("integration target identity is incomplete or conflicts with the API target");
  }
  assertAcceptanceTargetAllowed(identity);
  return identity;
}

// Read only selected Docker metadata. Never import a client or print container env/secrets.
export function verifyIntegrationIdentity(env, inspect = spawnSync, ownedCampaignIds = null) {
  const identity = assertIntegrationEnvironment(env);
  let pristine;
  if (env.INTEGRATION_PRISTINE_TARGET_JSON) {
    try { pristine = JSON.parse(env.INTEGRATION_PRISTINE_TARGET_JSON); }
    catch { throw new Error("pristine target receipt cannot be decoded"); }
    assertAcceptanceTargetAllowed(pristine);
    if (!isDeepStrictEqual(pristine.identity, identity)
      || !identity.projectId.startsWith("adfocate-d19-pristine-")
      || pristine.createdThisRun !== true || pristine.volumeWasAbsent !== true
      || pristine.networkWasAbsent !== true || !pristine.databaseCreatedAt
      || !pristine.volumeCreatedAt || pristine.volumeName !== `${identity.projectId}-db-data`
      || pristine.pristineBaseline?.campaigns !== 0 || pristine.pristineBaseline?.authUsers !== 0
      || pristine.ownerAuthorization !== identity.ownerAuthorization
      || !Array.isArray(pristine.containerIds) || new Set(pristine.containerIds).size !== pristine.containerIds.length
      || pristine.containerIds.length < 2 || pristine.containerIds.length > 5
      || !pristine.containerIds.includes(identity.apiContainerId)
      || !pristine.containerIds.includes(identity.databaseContainerId)) {
      throw new Error("pristine target requires a new authorized project, volume and zero-data baseline");
    }
  } else if (ownedCampaignIds !== null) throw new Error("pristine target receipt required for global campaign jobs");
  const containers = [identity.apiContainerId, identity.databaseContainerId].map((id) => {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("integration container identity must be exact");
    const format = '{"id":{{json .Id}},"image":{{json .Image}},"running":{{json .State.Running}},"project":{{json (index .Config.Labels "com.supabase.cli.project")}},"ports":{{json .NetworkSettings.Ports}},"networks":{{json .NetworkSettings.Networks}},"mounts":{{json .Mounts}},"created":{{json .Created}}}';
    const result = inspect("docker", ["inspect", "--format", format, id], { encoding: "utf8", timeout: 10000 });
    if (result.status !== 0 || result.error) throw new Error("integration container identity cannot be verified");
    try { return JSON.parse(result.stdout); }
    catch { throw new Error("integration container identity cannot be decoded"); }
  });
  for (const container of containers) assertAcceptanceTargetAllowed(container);
  const [api, database] = containers;
  for (const [index, container] of containers.entries()) {
    const expected = index === 0 ? identity.apiContainerId : identity.databaseContainerId;
    const image = index === 0 ? identity.apiImageId : identity.databaseImageId;
    if (container.id !== expected || container.image !== image || !container.running
      || container.project !== identity.projectId
      || !Object.values(container.networks ?? {}).some((network) => network.NetworkID === identity.networkId)) {
      throw new Error("integration container/project/network identity mismatch");
    }
  }
  if (api.id === database.id || !(api.ports?.["8000/tcp"] ?? []).some((binding) =>
    binding.HostIp === "127.0.0.1" && Number(binding.HostPort) === identity.apiPort)) {
    throw new Error("integration API host/port/container mapping mismatch");
  }
  if (pristine) {
    const metadata = (args, json = true) => {
      const result = inspect("docker", args, { encoding: "utf8", timeout: 10000 });
      if (result.status !== 0 || result.error) throw new Error("pristine target metadata unavailable");
      try { return json ? JSON.parse(result.stdout) : result.stdout.trim(); }
      catch { throw new Error("pristine target metadata invalid"); }
    };
    if (metadata(["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"], false)
      !== "npipe:////./pipe/dockerDesktopLinuxEngine") throw new Error("pristine target must use the local Docker engine");
    const network = metadata(["network", "inspect", "--format", '{"id":{{json .Id}},"internal":{{json .Internal}},"labels":{{json .Labels}},"containers":{{json .Containers}},"options":{{json .Options}}}', identity.networkId]);
    const members = Array.isArray(network.containers) ? network.containers : Object.keys(network.containers ?? {});
    const volume = metadata(["volume", "inspect", "--format", '{"name":{{json .Name}},"created":{{json .CreatedAt}},"labels":{{json .Labels}}}', pristine.volumeName]);
    const writable = (database.mounts ?? []).filter(m => m.RW);
    const isolatedNetwork = pristine.isolationMode === "dedicated-bridge-no-masquerade"
      ? network.internal === false && network.options?.["com.docker.network.bridge.enable_ip_masquerade"] === "false"
        && network.options?.["com.docker.network.bridge.host_binding_ipv4"] === "127.0.0.1"
      : !pristine.isolationMode && network.internal === true;
    if (network.id !== identity.networkId || !isolatedNetwork
      || network.labels?.["adfocate.run"] !== identity.runId || network.labels?.["adfocate.pristine"] !== "true"
      || !isDeepStrictEqual([...members].sort(), [...pristine.containerIds].sort())
      || containers.some(c => Object.keys(c.networks ?? {}).length !== 1)
      || database.created !== pristine.databaseCreatedAt
      || volume.name !== pristine.volumeName || volume.created !== pristine.volumeCreatedAt
      || volume.labels?.["adfocate.run"] !== identity.runId || volume.labels?.["adfocate.pristine"] !== "true"
      || writable.length !== 1 || writable[0].Type !== "volume" || writable[0].Name !== pristine.volumeName
      || writable[0].Destination !== "/var/lib/postgresql/data") throw new Error("pristine target volume, owner or exclusive internal network drift");
    if (ownedCampaignIds !== null) {
      if (!Array.isArray(ownedCampaignIds) || ownedCampaignIds.some(id => !/^[a-f0-9-]{36}$/i.test(id))) throw new Error("pristine campaign ownership invalid");
      const result = inspect("docker", ["exec", "-i", identity.databaseContainerId, "psql", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], {
        encoding: "utf8", timeout: 10000,
        input: "begin read only;select coalesce(jsonb_agg(id order by id),'[]'::jsonb)from public.campaigns;commit;",
      });
      let ids;
      try { ids = result.status === 0 && !result.error ? JSON.parse(result.stdout) : null; } catch { ids = null; }
      if (!Array.isArray(ids) || ids.some(id => !ownedCampaignIds.includes(id))) throw new Error("pristine campaign inventory contains rows not owned by this run");
    }
  }
  return identity;
}

export function launchIntegrationTests({
  processRef = process,
  spawnImpl = spawn,
  spawnSyncImpl = spawnSync,
  verifyIdentityImpl = verifyIntegrationIdentity,
} = {}) {
  assertIntegrationEnvironment(processRef.env);
  verifyIdentityImpl(processRef.env, spawnSyncImpl);
  const env = { ...processRef.env, RUN_INTEGRATION: "1", INTEGRATION_RUNNER: "1" };
  const preflight = spawnSyncImpl(
    processRef.execPath,
    [vitest, "run", "--no-file-parallelism", publicationProofPreflightFile],
    { cwd: processRef.cwd(), env, stdio: "inherit" },
  );
  if (preflight.error) {
    processRef.stderr.write(`${preflight.error}\n`);
    processRef.exit(1);
    return null;
  }
  if (preflight.signal) {
    processRef.kill(processRef.pid, preflight.signal);
    return null;
  }
  if (preflight.status !== 0) {
    processRef.exit(preflight.status ?? 1);
    return null;
  }
  const child = spawnImpl(
    processRef.execPath,
    [vitest, "run", "--no-file-parallelism", ...integrationFiles],
    {
      cwd: processRef.cwd(),
      env,
      stdio: "inherit",
    },
  );
  const signals = ["SIGINT", "SIGTERM"];
  const handlers = new Map(signals.map((signal) => [
    signal,
    () => {
      if (!child.killed) child.kill(signal);
    },
  ]));
  const cleanup = () => {
    for (const [signal, handler] of handlers) {
      processRef.removeListener(signal, handler);
    }
  };

  for (const [signal, handler] of handlers) processRef.on(signal, handler);
  child.once("error", (error) => {
    cleanup();
    processRef.stderr.write(`${error}\n`);
    processRef.exit(1);
  });
  child.once("exit", (code, signal) => {
    cleanup();
    if (signal) {
      processRef.kill(processRef.pid, signal);
      return;
    }
    processRef.exit(code ?? 1);
  });

  return child;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  launchIntegrationTests();
}
