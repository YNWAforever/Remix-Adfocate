// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  files: new Map<string, string>(), spawn: vi.fn(), exit: vi.fn(), snapshot: vi.fn(),
}));
vi.mock("node:child_process", () => ({ spawnSync: h.spawn }));
vi.mock("node:process", () => ({ default: {
  argv: ["node", "scripts/audit/run-d17-r2-quality.mjs", "interim"],
  env: {}, execPath: "node", exit: h.exit,
} }));
vi.mock("node:fs", () => ({
  readFileSync: (path: string) => {
    const bytes = h.files.get(path);
    if (bytes === undefined) throw new Error(`ENOENT: ${path}`);
    return bytes;
  },
  writeFileSync: (path: string, bytes: string) => h.files.set(path, bytes),
}));
vi.mock("./local-targets.mjs", () => ({ verifiedTarget: () => ({
  identity: { projectId: "offline-owned-target" },
  env: { SUPABASE_URL: "http://127.0.0.1:56421", SUPABASE_ANON_KEY: "offline-only" },
}) }));
vi.mock("./neutrality-snapshot.mjs", () => ({ neutralitySnapshot: h.snapshot }));

const oldReportPath = ".codex-tmp/D17-R2-browser-interim.private.json";
const summaryPath = "docs/verification/D17-R2-browser-interim.json";
function report(title: string) {
  return JSON.stringify({ suites: [{ specs: [{ title, ok: true, tests: [{ results: [{ status: "passed", duration: 1 }] }] }] }], stats: { expected: 1 } });
}
// Only the external browser/target boundaries are replaced. Import runs the real launcher.
// @ts-expect-error Executable ESM runner has no declaration file.
const launch = () => import("./run-d17-r2-quality.mjs");
const output = () => JSON.parse(h.files.get(summaryPath)!);
function freshPassingChild(_command: string, _args: string[], options: { env: Record<string, string> }) {
  h.files.set(options.env.PLAYWRIGHT_JSON_OUTPUT_FILE ?? oldReportPath, report("current invocation"));
  return { status: 0, signal: null, error: undefined };
}

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); h.files.clear();
  h.files.set(".codex-tmp/R2-ui-fixture.private.json", JSON.stringify({
    target: { projectId: "offline-owned-target" }, runId: "owned-fixture", slug: "offline",
    creator: { id: "creator" }, other: { id: "other" }, workspaceId: "workspace",
  }));
  h.files.set(oldReportPath, report("historical passing run"));
  h.snapshot.mockReturnValue({ balance: 0 });
  h.exit.mockImplementation((code: number) => { throw new Error(`exit:${code}`); });
  h.spawn.mockImplementation(freshPassingChild);
});

describe("D17 R2 quality runner evidence", () => {
  it.each([
    { name: "signal termination", result: { status: null, signal: "SIGKILL" }, code: 1 },
    { name: "spawn error", result: { status: null, error: new Error("ENOENT browser child") }, code: 1 },
    { name: "normal test failure", result: { status: 17, signal: null }, code: 17 },
  ])("fails closed on $name without republishing a historical pass", async ({ result, code }) => {
    h.spawn.mockReturnValue(result);
    await expect(launch()).rejects.toThrow(`exit:${code}`);
    expect(h.exit).toHaveBeenCalledWith(code);
    expect(h.files.has(summaryPath)).toBe(false);
    expect(h.files.get(oldReportPath)).toBe(report("historical passing run"));
  });

  it("rejects a zero exit without a new report even when a historical pass exists", async () => {
    h.spawn.mockReturnValue({ status: 0, signal: null });
    await expect(launch()).rejects.toThrow(/ENOENT/);
    expect(h.files.has(summaryPath)).toBe(false);
    expect(h.files.get(oldReportPath)).toBe(report("historical passing run"));
  });

  it("publishes the current child report and preserves the historical raw bytes", async () => {
    await expect(launch()).rejects.toThrow("exit:0");
    expect(output().tests).toEqual([{ title: "current invocation", ok: true, results: [{ status: "passed", duration: 1 }] }]);
    expect(h.files.get(oldReportPath)).toBe(report("historical passing run"));
  });

  it("keeps neutrality drift failing after a normal browser pass", async () => {
    h.snapshot.mockReturnValueOnce({ balance: 0 }).mockReturnValueOnce({ balance: 0 })
      .mockReturnValueOnce({ balance: 1 }).mockReturnValueOnce({ balance: 0 });
    await expect(launch()).rejects.toThrow("exit:1");
    expect(JSON.parse(h.files.get("docs/verification/D17-R2-neutrality-interim.json")!).allEqual).toBe(false);
  });

  it("retains distinct raw reports for repeated invocations of the same phase", async () => {
    await expect(launch()).rejects.toThrow("exit:0");
    vi.resetModules();
    await expect(launch()).rejects.toThrow("exit:0");
    const paths = h.spawn.mock.calls.map(([, , options]) => options.env.PLAYWRIGHT_JSON_OUTPUT_FILE);
    expect(paths[0]).toEqual(expect.any(String));
    expect(paths[1]).not.toBe(paths[0]);
    for (const path of paths) expect(JSON.parse(h.files.get(path)!).suites[0].specs[0].title).toBe("current invocation");
  });
});
