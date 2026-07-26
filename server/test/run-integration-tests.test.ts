import { describe, expect, it, vi } from "vitest";

const importMocks = vi.hoisted(() => {
  const spawn = vi.fn();
  const spawnSync = vi.fn(() => ({ status: 0 }));
  const processRef = {
    argv: ["node", "vitest-entry.mjs"],
    cwd: () => "C:/repo",
    env: {},
    execPath: "node",
    exit: vi.fn(),
    kill: vi.fn(),
    pid: 10,
    stderr: { write: vi.fn() },
  };
  return { processRef, spawn, spawnSync };
});

vi.mock("node:child_process", () => ({
  default: { spawn: importMocks.spawn, spawnSync: importMocks.spawnSync },
  spawn: importMocks.spawn,
  spawnSync: importMocks.spawnSync,
}));
vi.mock("node:process", () => ({ default: importMocks.processRef }));

// @ts-expect-error -- the executable .mjs launcher intentionally has no declaration file.
const runner = await import("../../scripts/run-integration-tests.mjs");

const expectedIntegrationFiles = [
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
];

function harness() {
  const childHandlers = new Map();
  const signalHandlers = new Map();
  const child = {
    killed: false,
    kill: vi.fn(),
    once: vi.fn((event, handler) => {
      childHandlers.set(event, handler);
      return child;
    }),
  };
  const processRef = {
    argv: ["node", "test"],
    cwd: () => "C:/repo",
    env: { PRESERVE_ME: "yes" },
    execPath: "C:/node/node.exe",
    exit: vi.fn(),
    kill: vi.fn(),
    on: vi.fn((signal, handler) => signalHandlers.set(signal, handler)),
    pid: 42,
    removeListener: vi.fn((signal) => signalHandlers.delete(signal)),
    stderr: { write: vi.fn() },
  };
  const spawnImpl = vi.fn(() => child);
  return { child, childHandlers, processRef, signalHandlers, spawnImpl };
}

describe("integration test launcher", () => {
  it("keeps the complete ordered integration file list unique", () => {
    expect(runner.integrationFiles).toEqual(expectedIntegrationFiles);
    expect(new Set(runner.integrationFiles).size).toBe(expectedIntegrationFiles.length);
  });

  it("spawns local Vitest with the exact environment and preserves numeric exit codes", () => {
    const h = harness();
    runner.launchIntegrationTests({ processRef: h.processRef, spawnImpl: h.spawnImpl });

    expect(h.spawnImpl).toHaveBeenCalledWith(
      "C:/node/node.exe",
      [expect.stringMatching(/node_modules[\\/]vitest[\\/]vitest\.mjs$/), "run", "--no-file-parallelism", ...expectedIntegrationFiles],
      { cwd: "C:/repo", env: { PRESERVE_ME: "yes", RUN_INTEGRATION: "1" }, stdio: "inherit" },
    );
    h.childHandlers.get("exit")(7, null);
    expect(h.processRef.exit).toHaveBeenCalledWith(7);
  });

  it.each(["SIGINT", "SIGTERM"])("forwards and re-emits %s without orphaning the child", (signal) => {
    const h = harness();
    runner.launchIntegrationTests({ processRef: h.processRef, spawnImpl: h.spawnImpl });

    h.signalHandlers.get(signal)();
    expect(h.child.kill).toHaveBeenCalledWith(signal);
    h.childHandlers.get("exit")(null, signal);
    expect(h.processRef.kill).toHaveBeenCalledWith(42, signal);
    expect(h.processRef.exit).not.toHaveBeenCalled();
    expect(h.processRef.removeListener).toHaveBeenCalledTimes(2);
  });
});
