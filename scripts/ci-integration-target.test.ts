// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

// @ts-expect-error Executable ESM helper intentionally has no declaration file.
import { captureCiIntegrationIdentity } from "./ci-integration-target.mjs";
// @ts-expect-error Executable ESM runner intentionally has no declaration file.
import { assertIntegrationEnvironment, verifyIntegrationIdentity } from "./run-integration-tests.mjs";

function harness() {
  const projectId = "adfocate-2";
  const networkId = "c".repeat(64);
  const api = {
    id: "a".repeat(64), image: "sha256:synthetic-api", running: true, project: projectId,
    ports: { "8000/tcp": [{ HostIp: "127.0.0.1", HostPort: "54321" }] },
    networks: { ci: { NetworkID: networkId } }, mounts: [],
  };
  const database = {
    ...api, id: "b".repeat(64), image: "sha256:synthetic-db", ports: {},
    networks: { ci: { NetworkID: networkId } },
  };
  const env = {
    GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted",
    GITHUB_REPOSITORY: "YNWAforever/Remix-Adfocate", GITHUB_RUN_ID: "40755337706", GITHUB_RUN_ATTEMPT: "2",
    SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_ANON_KEY: "synthetic-anon",
    SUPABASE_SERVICE_KEY: "synthetic-service", ADMIN_SECRET: "test-admin-secret",
  };
  const inspect = vi.fn((_command: string, args: string[]) => ({
    status: 0,
    stdout: JSON.stringify([`supabase_kong_${projectId}`, api.id].includes(args.at(-1) ?? "") ? api : database),
  }));
  return { api, database, env, inspect, networkId, projectId };
}

describe("CI integration target identity", () => {
  it("reproduces main's missing identity failure with the original CI environment", () => {
    expect(() => assertIntegrationEnvironment(harness().env)).toThrow("integration target identity is required");
  });

  it("captures actual Docker metadata and passes the unchanged guard with CI-equivalent env", () => {
    const h = harness();
    const identity = captureCiIntegrationIdentity(h.env, h.projectId, h.inspect);
    expect(identity).toMatchObject({
      disposable: true, proxy: "none", projectId: h.projectId, apiPort: 54321,
      apiContainerId: h.api.id, databaseContainerId: h.database.id,
      apiImageId: h.api.image, databaseImageId: h.database.image, networkId: h.networkId,
      runId: "40755337706-2",
      ownerAuthorization: expect.stringContaining("YNWAforever/Remix-Adfocate/actions/runs/40755337706/attempts/2"),
    });
    const env = { ...h.env, INTEGRATION_TARGET_IDENTITY_JSON: JSON.stringify(identity) };
    expect(verifyIntegrationIdentity(env, h.inspect)).toEqual(identity);
    expect(JSON.stringify(identity)).not.toMatch(/synthetic-anon|synthetic-service|test-admin-secret/);
    expect(h.inspect.mock.calls.every(([command, args]) => command === "docker" && args[0] === "inspect")).toBe(true);
    expect(h.inspect.mock.calls[0][1]).not.toContain("{{json .Config}}");
  });

  it.each(["GITHUB_ACTIONS", "RUNNER_ENVIRONMENT", "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT", "GITHUB_REPOSITORY"] as const)(
    "refuses to assert a disposable CI target without %s", (key) => {
      const h = harness();
      h.env[key] = "";
      expect(() => captureCiIntegrationIdentity(h.env, h.projectId, h.inspect)).toThrow(/GitHub-hosted/);
      expect(h.inspect).not.toHaveBeenCalled();
    },
  );

  it.each([
    "https://production.supabase.co", "http://192.168.1.2:54321", "http://127.0.0.1.attacker.example:54321",
    "https://127.0.0.1:54321", "http://user:password@127.0.0.1:54321", "not-a-url",
  ])("still rejects the unsafe API target %s", (url) => {
    const h = harness();
    const identity = captureCiIntegrationIdentity(h.env, h.projectId, h.inspect);
    const env = { ...h.env, SUPABASE_URL: url, INTEGRATION_TARGET_IDENTITY_JSON: JSON.stringify(identity) };
    h.inspect.mockClear();
    expect(() => verifyIntegrationIdentity(env, h.inspect)).toThrow();
    expect(h.inspect).not.toHaveBeenCalled();
  });

  it.each(["", "{", "{}", "null"])("still rejects unidentified target receipt %j", (identity) => {
    const h = harness();
    expect(() => verifyIntegrationIdentity({ ...h.env, INTEGRATION_TARGET_IDENTITY_JSON: identity }, h.inspect)).toThrow();
    expect(h.inspect).not.toHaveBeenCalled();
  });

  it.each(["public-binding", "wrong-port", "wrong-project", "different-networks", "stopped", "retired-volume"])(
    "refuses %s Docker metadata while capturing the CI target", (kind) => {
      const h = harness();
      if (kind === "public-binding") h.api.ports["8000/tcp"][0].HostIp = "0.0.0.0";
      if (kind === "wrong-port") h.api.ports["8000/tcp"][0].HostPort = "54399";
      if (kind === "wrong-project") h.database.project = "other-project";
      if (kind === "different-networks") h.database.networks.ci.NetworkID = "d".repeat(64);
      if (kind === "stopped") h.api.running = false;
      if (kind === "retired-volume") Object.assign(h.database, { mounts: [{ Type: "volume", Name: "supabase_db_adfocate-r1-shaped-20261023" }] });
      expect(() => captureCiIntegrationIdentity(h.env, h.projectId, h.inspect)).toThrow();
    },
  );

  it("still detects image drift after capture before any test clients", () => {
    const h = harness();
    const identity = captureCiIntegrationIdentity(h.env, h.projectId, h.inspect);
    h.api.image = "sha256:replacement";
    expect(() => verifyIntegrationIdentity({ ...h.env, INTEGRATION_TARGET_IDENTITY_JSON: JSON.stringify(identity) }, h.inspect))
      .toThrow("identity mismatch");
  });

  it("fails closed if Docker inspection fails", () => {
    const h = harness();
    const inspect = vi.fn(() => ({ status: 1, stdout: "" }));
    expect(() => captureCiIntegrationIdentity(h.env, h.projectId, inspect)).toThrow(/metadata/);
  });
});
