// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IntegrationError } from "./policy.js";
import type { Actor, ConnectionRecord } from "./types.js";

const mocks = vi.hoisted(() => ({ client: vi.fn(() => ({})), connection: vi.fn(), command: vi.fn() }));
vi.mock("../supabase.js", () => ({ serviceClient: mocks.client }));
vi.mock("./repo.js", () => ({ SupabaseIntegrationRepository: class { connection = mocks.connection; command = mocks.command; } }));
import { getIntegrationService, manageDisabledConnection } from "./runtime.js";

const actor: Actor = { workspaceId: "workspace", creatorId: "creator" };
const connection: ConnectionRecord = { ...actor, id: "connection", provider: "google_drive", subject: "mock", label: "Mock", generation: 7, status: "connected", scopes: [], lastSyncAt: null, lastError: null, expiresAt: "2099-01-01T00:00:00Z", sampleOnly: true, providerRevocation: "not_requested", consentVersion: "mock" };
beforeEach(() => { mocks.client.mockClear(); mocks.connection.mockReset(); mocks.command.mockReset(); mocks.connection.mockResolvedValue(connection); });
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
