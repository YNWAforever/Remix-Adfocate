// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ args: [] as string[], aliasRetiredContainer: false, aliasRetiredVolume: false, calls: [] as string[][] }));
vi.mock("node:process", () => ({ default: {
  get argv() { return ["node", "scripts/audit/bind-local-targets.mjs", ...h.args]; },
} }));
vi.mock("node:child_process", () => ({ execFileSync: (_file: string, args: string[]) => {
  h.calls.push(args);
  if (args[0] === "context") return "npipe:////./pipe/dockerDesktopLinuxEngine";
  if (args[0] === "network") return JSON.stringify([{ Labels: { "adfocate.run": "01a16483-e55d-7332-9ddc-7e8a3f68eb11" } }]);
  if (args[0] === "stop" || args[0] === "rm" || args[0] === "start") throw new Error("UNSAFE_LIFECYCLE_INTERCEPTED");
  if (args[0] !== "inspect") throw new Error("Unexpected Docker command");
  const project = args[1].includes("shaped") ? "adfocate-r1-shaped-20261023" : "adfocate-r1-empty-20261023";
  const blocked = project.includes("shaped") || h.aliasRetiredContainer || h.aliasRetiredVolume;
  return JSON.stringify([{
    Id: h.aliasRetiredContainer ? "c96d960e276cb7c84ae5bf52fdf77e854865516d89d95ca2148a55b6137fa7e9" : "a".repeat(64),
    Image: "unit-image", Config: { Labels: { "com.supabase.cli.project": project } },
    NetworkSettings: { Networks: { unit: { NetworkID: "b".repeat(64) } } },
    Mounts: h.aliasRetiredVolume ? [{ Type: "volume", Name: "supabase_db_adfocate-r1-shaped-20261023" }] : [],
    HostConfig: { PortBindings: { "5432/tcp": [{ HostIp: blocked ? "0.0.0.0" : "127.0.0.1", HostPort: "56422" }] } },
  }]);
} }));
vi.mock("node:http", () => ({ default: { request: () => { throw new Error("UNSAFE_HTTP_INTERCEPTED"); } } }));

beforeEach(() => { vi.resetModules(); h.args = []; h.calls = []; h.aliasRetiredContainer = false; h.aliasRetiredVolume = false; });
// @ts-expect-error Executable ESM runner has no declaration file.
const rebind = () => import("../../scripts/audit/bind-local-targets.mjs");

describe("historical local target port rebinding", () => {
  it.each([{ args: [] }, { args: ["shaped"] }])("refuses a selection containing the retired shaped project before any Docker work ($args)", async ({ args }) => {
    h.args = args;
    await expect(rebind()).rejects.toThrow(/forensics-only/i);
    expect(h.calls).toEqual([]);
  });

  it("allows explicit empty selection to inspect the two existing loopback-bound containers", async () => {
    h.args = ["empty"];
    await expect(rebind()).resolves.toBeDefined();
    expect(h.calls.filter(args => args[0] === "inspect").map(args => args[1])).toEqual([
      "supabase_db_adfocate-r1-empty-20261023", "supabase_kong_adfocate-r1-empty-20261023",
    ]);
    expect(h.calls.some(args => ["stop", "rm", "start"].includes(args[0]))).toBe(false);
  });

  it.each(["container", "volume"])("refuses an immutable retired %s relabelled as empty before lifecycle operations", async kind => {
    h.args = ["empty"];
    h.aliasRetiredContainer = kind === "container"; h.aliasRetiredVolume = kind === "volume";
    await expect(rebind()).rejects.toThrow(/forensics-only/i);
    expect(h.calls.some(args => ["stop", "rm", "start"].includes(args[0]))).toBe(false);
  });
});
