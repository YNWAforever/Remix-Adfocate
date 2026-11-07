// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IntegrationError } from "./policy.js";
import type { Actor, ConnectionRecord } from "./types.js";

const mocks = vi.hoisted(() => ({ client: vi.fn(() => ({})), connection: vi.fn(), command: vi.fn() }));
vi.mock("../supabase.js", () => ({ serviceClient: mocks.client }));
vi.mock("./repo.js", () => ({ SupabaseIntegrationRepository: class { connection = mocks.connection; command = mocks.command; } }));
import { getIntegrationService, getIntegrationRuntimeStage, manageDisabledConnection } from "./runtime.js";

const actor: Actor = { workspaceId: "workspace", creatorId: "creator" };
const connection: ConnectionRecord = { ...actor, id: "connection", provider: "google_drive", subject: "mock", label: "Mock", generation: 7, status: "connected", scopes: [], lastSyncAt: null, lastError: null, expiresAt: "2099-01-01T00:00:00Z", sampleOnly: true, providerRevocation: "not_requested", consentVersion: "mock" };
beforeEach(() => { vi.stubEnv("INTEGRATIONS_PILOT_STAGE", "D0"); mocks.client.mockClear(); mocks.connection.mockReset(); mocks.command.mockReset(); mocks.connection.mockResolvedValue(connection); });
afterEach(() => vi.unstubAllEnvs());

it("disabled management uses the returned post-revoke generation with no live client", async () => {
  mocks.command.mockImplementation(async (_actor, _request, action, payload) => {
    if (action === "revoke") return { connection: { ...connection, generation: 8, status: "revoked" } };
    if (action === "revoke_result" && payload.generation !== 8) throw new IntegrationError("STALE_CONNECTION", 409);
    return {};
  });
  await expect(manageDisabledConnection(actor, connection.id, "revoke", "request")).resolves.toEqual({ local: "revoked", provider: "manual_action" });
  expect(mocks.command.mock.calls[1][3]).toEqual({ id: connection.id, generation: 8, provider: "manual_action" });
});

it("does not continue a disabled purge after a stale revoke result", async () => {
  mocks.command.mockImplementation(async (_actor, _request, action) => {
    if (action === "revoke") return { connection: { ...connection, generation: 8, status: "revoked" } };
    throw new IntegrationError("STALE_CONNECTION", 409);
  });
  await expect(manageDisabledConnection(actor, connection.id, "purge", "request")).rejects.toThrow("STALE_CONNECTION");
  expect(mocks.command.mock.calls.map(call => call[2])).toEqual(["revoke", "revoke_result"]);
});

it("keeps production integration providers disabled without creating a client", () => {
  vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("INTEGRATIONS_MODE", "mock");
  expect(getIntegrationService()).toBeNull(); expect(mocks.client).not.toHaveBeenCalled();
});

it.each(["mock", "live_pilot"])("D1 denies %s before client construction even with malicious flags", mode => {
  vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("INTEGRATIONS_MODE", mode);
  vi.stubEnv("INTEGRATIONS_ENABLED", "true"); vi.stubEnv("INTEGRATIONS_PILOT_STAGE", "D1");
  vi.stubEnv("PILOT_APPROVED", "true"); vi.stubEnv("INTEGRATIONS_SAMPLE_ONLY", "false");
  expect(getIntegrationService()).toBeNull();
  expect(mocks.client).not.toHaveBeenCalled();
});

it("does not construct the D0 mock client against a known product database", () => {
  vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("INTEGRATIONS_MODE", "mock");
  vi.stubEnv("SUPABASE_URL", "https://mhkoayftiuojxlrkollf.supabase.co");
  expect(getIntegrationService()).toBeNull();
  expect(mocks.client).not.toHaveBeenCalled();
});

it("D1 disabled-management cannot construct an unverified application database client", async () => {
  vi.stubEnv("INTEGRATIONS_PILOT_STAGE", "D1");
  await expect(manageDisabledConnection(actor, connection.id, "revoke", "request")).rejects.toThrow("PILOT_APPROVAL_REQUIRED");
  expect(mocks.client).not.toHaveBeenCalled();
});

it.each(["", "garbage", "D2", "d0", " D0 "])("explicit invalid stage %s denies every default client path", async stage => {
  vi.stubEnv("INTEGRATIONS_PILOT_STAGE", stage); vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("INTEGRATIONS_MODE", "mock");
  expect(getIntegrationRuntimeStage()).toBe("disabled");
  expect(getIntegrationService()).toBeNull();
  await expect(manageDisabledConnection(actor, connection.id, "purge", "request")).rejects.toThrow("PILOT_APPROVAL_REQUIRED");
  expect(mocks.client).not.toHaveBeenCalled();
});

it("missing pilot stage retains the original non-production mock factory", () => {
  vi.stubEnv("INTEGRATIONS_PILOT_STAGE", undefined); vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("INTEGRATIONS_MODE", "mock");
  expect(getIntegrationRuntimeStage()).toBe("D0");
  expect(getIntegrationService()).not.toBeNull();
});

it.each(["revoke", "purge"] as const)("missing pilot stage retains production local %s on the original product DB", async action => {
  vi.stubEnv("INTEGRATIONS_PILOT_STAGE", undefined); vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("SUPABASE_URL", "https://mhkoayftiuojxlrkollf.supabase.co");
  mocks.command.mockImplementation(async (_actor, _request, command) => command === "revoke" ? { connection: { ...connection, generation: 8 } } : {});
  await expect(manageDisabledConnection(actor, connection.id, action, "request")).resolves.toEqual(action === "revoke" ? { local: "revoked", provider: "manual_action" } : {});
  expect(mocks.command.mock.calls.map(call => call[2])).toEqual(action === "revoke" ? ["revoke", "revoke_result"] : ["revoke", "revoke_result", "purge"]);
});

it("retains the explicitly selected D0 mock fixture factory", () => {
  vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("INTEGRATIONS_MODE", "mock");
  expect(getIntegrationRuntimeStage()).toBe("D0");
  expect(getIntegrationService()).not.toBeNull();
});
