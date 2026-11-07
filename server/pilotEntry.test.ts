// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
const effects = vi.hoisted(() => ({ originalImport: vi.fn(), originalCreate: vi.fn(() => ({ app: { fetch: vi.fn() } })) }));
vi.mock("./app.js", () => { effects.originalImport(); return { createApp: effects.originalCreate }; });
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); vi.clearAllMocks(); });
it("pilot entry does not import original routes or construct their clients before admission", async () => {
  vi.stubEnv("INTEGRATIONS_PILOT_STAGE", "D1");
  await import("../api/index.js");
  expect(effects.originalImport).not.toHaveBeenCalled(); expect(effects.originalCreate).not.toHaveBeenCalled();
});
it("ordinary deployments retain the original application", async () => {
  vi.stubEnv("INTEGRATIONS_PILOT_STAGE", undefined);
  await import("../api/index.js"); expect(effects.originalCreate).toHaveBeenCalledOnce();
});
it("dedicated pilot entry remains closed even when the environment marker is missing", async () => {
  vi.stubEnv("INTEGRATIONS_PILOT_STAGE", undefined);
  const entry = await import("../api/pilot.js");
  expect(typeof entry.GET).toBe("function"); expect(effects.originalImport).not.toHaveBeenCalled();
});
