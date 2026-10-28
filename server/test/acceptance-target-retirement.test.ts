import { describe, expect, it, vi } from "vitest";

const subprocesses = vi.hoisted(() => ({
  spawn: vi.fn(() => ({ once: vi.fn(), killed: false, kill: vi.fn() })),
  spawnSync: vi.fn<(_command: string, _args?: string[]) => { status: number; stdout?: string }>(() => ({ status: 0 })),
  execFileSync: vi.fn(),
  readFileSync: vi.fn(),
}));
vi.mock("node:child_process", () => ({ ...subprocesses, default: subprocesses }));
vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  return { ...fs, default: { ...fs, readFileSync: subprocesses.readFileSync }, readFileSync: subprocesses.readFileSync };
});

// @ts-expect-error Executable ESM runner intentionally has no declaration file.
const runner = await import("../../scripts/run-integration-tests.mjs");
// @ts-expect-error Executable ESM target helper intentionally has no declaration file.
const targets = await import("../../scripts/audit/local-targets.mjs");

const retiredProject = "adfocate-r1-shaped-20261023";
const retiredApi = "c96d960e276cb7c84ae5bf52fdf77e854865516d89d95ca2148a55b6137fa7e9";
const retiredDb = "34bd00cda4f4c91650795b83d4d48d5e46ecb90b310a3e409b31c02f99cec176";
const retiredNetwork = "fbf71b13e7f584b230b293383cccbd2157814168cbae1d9169b377d8f886f69d";
const retirement = /B1.*retired.*forensics-only/i;

function harness(overrides = {}) {
  const identity = {
    disposable: true, ownerAuthorization: "synthetic local policy test only", runId: "synthetic-run",
    projectId: "synthetic-unretired-project", proxy: "none", apiPort: 56731,
    apiContainerId: "a".repeat(64), databaseContainerId: "b".repeat(64), networkId: "c".repeat(64),
    apiImageId: "sha256:synthetic-api", databaseImageId: "sha256:synthetic-db", ...overrides,
  };
  const api = {
    id: identity.apiContainerId, image: identity.apiImageId, running: true, project: identity.projectId,
    ports: { "8000/tcp": [{ HostIp: "127.0.0.1", HostPort: String(identity.apiPort) }] },
    networks: { synthetic: { NetworkID: identity.networkId } }, mounts: [],
  };
  const database = {
    id: identity.databaseContainerId, image: identity.databaseImageId, running: true, project: identity.projectId,
    ports: {}, networks: { synthetic: { NetworkID: identity.networkId } },
    mounts: [{ Type: "volume", Name: "synthetic-unretired-volume", Destination: "/var/lib/postgresql/data", RW: true }],
  };
  const env: Record<string, string> = {
    SUPABASE_URL: `http://127.0.0.1:${identity.apiPort}`, SUPABASE_SERVICE_KEY: "synthetic-service",
    SUPABASE_ANON_KEY: "synthetic-anon", INTEGRATION_TARGET_IDENTITY_JSON: JSON.stringify(identity),
  };
  const inspect = vi.fn((_command: string, args: string[]) => ({
    status: 0, stdout: JSON.stringify(args.at(-1) === identity.databaseContainerId ? database : api),
  }));
  return { identity, api, database, env, inspect };
}

describe("B1 acceptance retirement before client/setup", () => {
  // Removing the retirement guard would permit these exact excluded resources to reach setup.
  it.each([
    ["project", { projectId: retiredProject }],
    ["API container", { apiContainerId: retiredApi }],
    ["database container", { databaseContainerId: retiredDb }],
    ["network", { networkId: retiredNetwork }],
  ])("rejects the retired %s even when the other claimed identifiers change", (_name, overrides) => {
    const h = harness(overrides);
    expect(() => runner.verifyIntegrationIdentity(h.env, h.inspect)).toThrow(retirement);
    expect(h.inspect).not.toHaveBeenCalled();
  });

  it("rejects a replacement container mounting the old data volume despite a new project name", () => {
    const h = harness();
    h.database.mounts[0].Name = "supabase_db_adfocate-r1-shaped-20261023";
    expect(() => runner.verifyIntegrationIdentity(h.env, h.inspect)).toThrow(retirement);
    expect(h.inspect.mock.calls.every(([, args]) => args[0] === "inspect")).toBe(true);
  });

  it("rejects observed attachment to the retired network alongside a new matching network", () => {
    const h = harness();
    Object.assign(h.api.networks, { retired: { NetworkID: retiredNetwork } });
    expect(() => runner.verifyIntegrationIdentity(h.env, h.inspect)).toThrow(retirement);
  });

  it("does not treat a caller's forensic-purpose flag as permission to run acceptance", () => {
    const h = harness({ projectId: retiredProject });
    h.env.INTEGRATION_PURPOSE = "forensics-only";
    expect(() => runner.verifyIntegrationIdentity(h.env, h.inspect)).toThrow(retirement);
    expect(h.inspect).not.toHaveBeenCalled();
  });

  it("does not let a pristine receipt override the excluded target identity", () => {
    const h = harness({ projectId: "adfocate-d19-pristine-synthetic", databaseContainerId: retiredDb });
    const created = "2026-10-24T09:00:00Z", volumeName = "adfocate-d19-pristine-synthetic-db-data";
    const containerIds = [h.identity.apiContainerId, h.identity.databaseContainerId];
    Object.assign(h.api, { created }); Object.assign(h.database, { created });
    h.database.mounts[0].Name = volumeName;
    h.env.INTEGRATION_PRISTINE_TARGET_JSON = JSON.stringify({
      identity: h.identity, createdThisRun: true, volumeWasAbsent: true, networkWasAbsent: true,
      databaseCreatedAt: created, volumeCreatedAt: created, volumeName, containerIds,
      pristineBaseline: { campaigns: 0, authUsers: 0 }, ownerAuthorization: h.identity.ownerAuthorization,
    });
    h.inspect.mockImplementation((_command, args) => {
      let value: unknown;
      if (args[0] === "context") return { status: 0, stdout: "npipe:////./pipe/dockerDesktopLinuxEngine" };
      if (args[0] === "network") value = {
        id: h.identity.networkId, internal: true, containers: containerIds,
        labels: { "adfocate.run": h.identity.runId, "adfocate.pristine": "true" },
      };
      else if (args[0] === "volume") value = {
        name: volumeName, created, labels: { "adfocate.run": h.identity.runId, "adfocate.pristine": "true" },
      };
      else value = args.at(-1) === h.identity.databaseContainerId ? h.database : h.api;
      return { status: 0, stdout: JSON.stringify(value) };
    });
    expect(() => runner.verifyIntegrationIdentity(h.env, h.inspect)).toThrow(retirement);
    expect(h.inspect).not.toHaveBeenCalled();
  });

  it("refuses the generic launcher before a secondary verifier, preflight or test child", () => {
    const h = harness({ projectId: retiredProject });
    const secondaryVerifier = vi.fn();
    subprocesses.spawn.mockClear(); subprocesses.spawnSync.mockClear();
    expect(() => runner.launchIntegrationTests({
      processRef: {
        env: h.env, cwd: () => "C:/synthetic-test", execPath: "synthetic-node", on: vi.fn(),
        removeListener: vi.fn(), stderr: { write: vi.fn() }, exit: vi.fn(), kill: vi.fn(), pid: 1,
      }, verifyIdentityImpl: secondaryVerifier,
    })).toThrow(retirement);
    expect(secondaryVerifier).not.toHaveBeenCalled();
    expect(subprocesses.spawnSync).not.toHaveBeenCalled();
    expect(subprocesses.spawn).not.toHaveBeenCalled();
  });

  it("refuses the shared shaped helper before Docker metadata, private key read or SQL setup", () => {
    const h = harness({ projectId: retiredProject, apiPort: 56521 });
    subprocesses.execFileSync.mockImplementation((_command: string, args: string[]) => {
      const last = args.at(-1) ?? "";
      if (args[0] === "network") return JSON.stringify({
        labels: { "adfocate.run": "01a16483-e55d-7332-9ddc-7e8a3f68eb11" },
        options: { "com.docker.network.bridge.host_binding_ipv4": "127.0.0.1" },
      });
      const metadata = last.startsWith("supabase_db_") ? h.database : h.api;
      return JSON.stringify({ ...metadata, network: metadata.networks });
    });
    subprocesses.readFileSync.mockReturnValue(JSON.stringify({
      DB_URL: "synthetic-not-a-connection", API_URL: h.env.SUPABASE_URL,
      ANON_KEY: "synthetic-anon", SERVICE_ROLE_KEY: "synthetic-service",
    }));
    subprocesses.spawnSync.mockImplementation((_command, args?: string[]) => h.inspect("docker", args ?? []));
    subprocesses.execFileSync.mockClear(); subprocesses.readFileSync.mockClear();
    expect(() => targets.verifiedTarget("shaped")).toThrow(retirement);
    expect(subprocesses.execFileSync).not.toHaveBeenCalled();
    expect(subprocesses.readFileSync).not.toHaveBeenCalled();
  });

  it("keeps the existing identity checks for an unrelated synthetic target without SQL", () => {
    const h = harness();
    expect(runner.verifyIntegrationIdentity(h.env, h.inspect)).toEqual(h.identity);
    expect(h.inspect).toHaveBeenCalledTimes(2);
    expect(h.inspect.mock.calls.every(([, args]) => args[0] === "inspect")).toBe(true);
  });
});
