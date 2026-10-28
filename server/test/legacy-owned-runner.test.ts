// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const h = vi.hoisted(() => ({
  root: "", args: [] as string[], inherited: {} as Record<string, string>,
  sql: vi.fn(), spawn: vi.fn(), verify: vi.fn(), exit: vi.fn(),
}));
vi.mock("node:process", () => ({ default: {
  get argv() { return ["node", "scripts/audit/run-legacy-integration.mjs", ...h.args]; },
  get env() { return h.inherited; }, cwd: () => h.root, execPath: "node", exit: h.exit,
} }));
vi.mock("node:child_process", () => ({ spawnSync: h.spawn }));
vi.mock("../../scripts/audit/local-targets.mjs", () => ({ verifiedTarget: h.verify }));
vi.mock("node:fs", async original => {
  const fs = await original<typeof import("node:fs")>();
  const { isAbsolute, join } = await import("node:path");
  const local = (path: string) => isAbsolute(path) ? path : join(h.root, path);
  return { ...fs,
    readFileSync: (path: string, encoding?: "utf8") => fs.readFileSync(local(path), encoding),
    existsSync: (path: string) => fs.existsSync(local(path)),
    writeFileSync: (path: string, value: string, options?: Parameters<typeof fs.writeFileSync>[2]) => fs.writeFileSync(local(path), value, options),
  };
});

const identity = { runId: "11111111-1111-4111-8111-111111111111", databaseContainerId: "d".repeat(64) };
const workspace = "00000000-0000-0000-0000-0000000000aa";
const mission = "22222222-2222-4222-8222-222222222222", gift = "33333333-3333-4333-8333-333333333333";
let receiptPath: string, receipt: string;
// @ts-expect-error Executable ESM runner has no declaration file.
const launch = () => import("../../scripts/audit/run-legacy-integration.mjs");

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  h.root = mkdtempSync(join(tmpdir(), "adfocate-legacy-runner-"));
  h.args = ["server/test/missions.test.ts"];
  h.inherited = { INTEGRATION_MUTATION_OWNERSHIP: "0", NODE_OPTIONS: "--inherited-options", INTEGRATION_PRISTINE_TARGET_JSON: "unrelated" };
  h.sql.mockReturnValue("1"); h.spawn.mockReturnValue({ status: 0 });
  h.verify.mockReturnValue({ identity, sql: h.sql, env: { SUPABASE_URL: "http://127.0.0.1:56421", SUPABASE_SERVICE_KEY: "unit-only", SUPABASE_ANON_KEY: "unit-only" } });
  receiptPath = join(h.root, "docs/verification/legacy-fixture-ownership.json");
  mkdirSync(join(h.root, "docs/verification"), { recursive: true });
  receipt = JSON.stringify({ target: identity, workspaceIds: [workspace], missionIds: [mission], giftIds: [gift] });
  writeFileSync(receiptPath, receipt);
});
afterEach(() => rmSync(h.root, { recursive: true, force: true }));

describe("retained legacy integration launcher", () => {
  it.each([{ args: [] }, { args: ["server/test/campaigns-s2.test.ts"] }])("blocks global campaign jobs before target verification or fixture setup ($args)", async ({ args }) => {
    h.args = args;
    await expect(launch()).rejects.toThrow(/global.*pristine/i);
    expect(h.verify).not.toHaveBeenCalled(); expect(h.sql).not.toHaveBeenCalled(); expect(h.spawn).not.toHaveBeenCalled();
    expect(readFileSync(receiptPath, "utf8")).toBe(receipt);
  });

  it("rejects an unreviewed selection before target verification or fixture setup", async () => {
    h.args = ["server/test/not-reviewed.test.ts"];
    await expect(launch()).rejects.toThrow(/reviewed integration files/i);
    expect(h.verify).not.toHaveBeenCalled(); expect(h.sql).not.toHaveBeenCalled(); expect(h.spawn).not.toHaveBeenCalled();
  });

  it("requires owned transport with persisted creation IDs and provider denial for an allowed subset", async () => {
    await launch();
    const [, args, options] = h.spawn.mock.calls[0];
    expect(args).toEqual(["node_modules/vitest/vitest.mjs", "run", "--no-file-parallelism", "server/test/missions.test.ts"]);
    const env = options.env;
    expect(env.INTEGRATION_MUTATION_OWNERSHIP).toBe("1");
    expect(env.INTEGRATION_CAPABILITY_FIXTURES).toBe("1");
    expect(env.INTEGRATION_PRISTINE_TARGET_JSON).toBe("");
    expect(env.NODE_OPTIONS).toBe(`--import=${pathToFileURL(join(h.root, "scripts/audit/deny-external-fetch.mjs")).href}`);
    expect(JSON.parse(readFileSync(env.INTEGRATION_OWNED_IDS_PATH, "utf8"))).toEqual({ tables: {
      workspaces: { key: "id", ids: [workspace] }, missions: { key: "id", ids: [mission] }, redemption_gifts: { key: "id", ids: [gift] },
    } });
    expect(existsSync(env.INTEGRATION_OWNED_JOURNAL)).toBe(true);
    expect(readFileSync(env.INTEGRATION_OWNED_JOURNAL, "utf8")).toBe("");
    expect(readFileSync(receiptPath, "utf8")).toBe(receipt);
  });

  it("rejects a receipt missing exact seed IDs before it can launch tests", async () => {
    writeFileSync(receiptPath, JSON.stringify({ target: identity, workspaceIds: [workspace], missionIds: ["not-an-id"], giftIds: [gift] }));
    await expect(launch()).rejects.toThrow(/ownership.*IDs/i);
    expect(h.spawn).not.toHaveBeenCalled();
  });

  it("refuses to reseed a missing workspace when a historical ownership receipt already exists", async () => {
    h.sql.mockReturnValue("");
    await expect(launch()).rejects.toThrow(/existing.*receipt.*reseed/i);
    expect(h.sql).toHaveBeenCalledTimes(1); expect(h.spawn).not.toHaveBeenCalled();
    expect(readFileSync(receiptPath, "utf8")).toBe(receipt);
  });
});
