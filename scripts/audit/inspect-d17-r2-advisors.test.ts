import { beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ ports: undefined as unknown, cli: vi.fn(), docker: vi.fn(), sql: vi.fn(), write: vi.fn(), read: vi.fn() }));
vi.mock("node:child_process", () => ({ spawnSync: h.cli, execFileSync: h.docker, default: { spawnSync: h.cli, execFileSync: h.docker } }));
vi.mock("node:fs", () => ({ readFileSync: h.read, writeFileSync: h.write, default: { readFileSync: h.read, writeFileSync: h.write } }));
vi.mock("./local-targets.mjs", () => ({ verifiedTarget: (kind: string) => ({
  identity: { projectId: `owned-${kind}`, databaseContainerId: kind === "empty" ? "e".repeat(64) : "d".repeat(64) },
  env: { SUPABASE_URL: `http://127.0.0.1:${kind === "empty" ? "56421" : "56521"}` }, sql: h.sql,
}) }));

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  h.ports = { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "56422" }] };
  h.docker.mockImplementation((_command: string, args: string[]) => JSON.stringify(args.at(-1) === "d".repeat(64)
    ? { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "56522" }] } : h.ports));
  h.cli.mockReturnValue({ status: 0, stdout: '{"results":[]}', stderr: "" });
  h.sql.mockReturnValue('{"history":[]}');
  h.read.mockImplementation((path: string) => {
    if (path.includes("start.private.log")) {
      const port = path.includes("empty") ? 56421 : 56521;
      return JSON.stringify({ DB_URL: `postgresql://synthetic:fixture@127.0.0.1:${port + 1}/postgres`, API_URL: `http://127.0.0.1:${port}` });
    }
    return JSON.stringify({ query: "select 'read-only fixture'", targets: { empty: { observed: { history: [] } }, shaped: { observed: { history: [] } } } });
  });
});

it.each([
  ["missing published DB port", {}],
  ["different host port", { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "59999" }] }],
  ["non-loopback host binding", { "5432/tcp": [{ HostIp: "0.0.0.0", HostPort: "56422" }] }],
])("rejects %s before any SQL or CLI connection despite a matching local URL", async (_name, ports) => {
  h.ports = ports;
  await expect(import("./inspect-d17-r2-advisors.mjs")).rejects.toThrow("Local database host/port/container mapping mismatch");
  expect(h.sql).not.toHaveBeenCalled(); expect(h.cli).not.toHaveBeenCalled(); expect(h.write).not.toHaveBeenCalled();
});

it("opens the mocked read-only inspections only after both exact container DB port mappings agree", async () => {
  await import("./inspect-d17-r2-advisors.mjs");
  expect(h.cli).toHaveBeenCalledTimes(2);
  expect(h.sql).toHaveBeenCalledTimes(6);
});
