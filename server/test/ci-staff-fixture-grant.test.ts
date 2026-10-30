// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  owned: true,
  localProject: "adfocate-2",
  grant: vi.fn(() => "granted"),
  sql: vi.fn(() => ""),
  capture: vi.fn(),
  verifiedTarget: vi.fn(),
}));

vi.mock("../../scripts/run-integration-tests.mjs", () => ({
  verifyIntegrationIdentity: vi.fn(),
  localSupabaseProjectId: () => h.localProject,
  bootstrapVerifiedLocalStaffGrant: h.grant,
}));
vi.mock("../../scripts/audit/local-targets.mjs", () => ({ verifiedTarget: h.verifiedTarget }));
vi.mock("./ownedFixtureTransport.js", () => ({
  ownsFixtureId: () => h.owned,
  captureFixtureRows: h.capture,
  createOwnedFixtureFetch: vi.fn(),
  fixtureOwnership: () => ({}),
}));

const userId = "11111111-1111-4111-8111-111111111111";
const workspaceId = "00000000-0000-0000-0000-0000000000aa";

beforeEach(() => {
  vi.clearAllMocks();
  h.owned = true;
  h.localProject = "adfocate-2";
  h.grant.mockReturnValue("granted");
  h.sql.mockReturnValue("");
  vi.stubEnv("INTEGRATION_CAPABILITY_FIXTURES", "1");
  vi.stubEnv("INTEGRATION_TARGET_IDENTITY_JSON", JSON.stringify({ projectId: "adfocate-2", disposable: true }));
});
afterEach(() => vi.unstubAllEnvs());

it("grants CI fixture staff on the verified local database, not a shaped target", async () => {
  const { grantStaffFixture } = await import("./helpers");
  await grantStaffFixture(userId, workspaceId, "workspace_admin");
  expect(h.grant).toHaveBeenCalledWith(expect.any(Object), { userId, workspaceId, role: "workspace_admin" });
  expect(h.verifiedTarget).not.toHaveBeenCalled();
  expect(h.capture).toHaveBeenCalledWith("staff_workspace_roles", { user_id: userId });
});

it("does not recapture an idempotent local grant", async () => {
  h.grant.mockReturnValue("exists");
  const { grantStaffFixture } = await import("./helpers");
  await grantStaffFixture(userId, null, "content_editor");
  expect(h.grant).toHaveBeenCalledWith(expect.any(Object), { userId, workspaceId: null, role: "content_editor" });
  expect(h.capture).not.toHaveBeenCalled();
});

it("keeps shaped grants on the D19 target helper", async () => {
  const identity = { projectId: "adfocate-r1-shaped-20261023", runId: "shaped-run" };
  h.verifiedTarget.mockReturnValue({ identity, sql: h.sql });
  vi.stubEnv("INTEGRATION_TARGET_IDENTITY_JSON", JSON.stringify(identity));
  const { grantStaffFixture } = await import("./helpers");
  await grantStaffFixture(userId, workspaceId, "operator");
  expect(h.verifiedTarget).toHaveBeenCalledWith("shaped");
  expect(h.grant).not.toHaveBeenCalled();
  expect(h.sql.mock.calls.flat().join("\n")).toContain("bootstrap_staff_access");
  expect(h.capture).toHaveBeenCalledWith("staff_workspace_roles", { user_id: userId });
});

it("does not grant a pre-existing unowned staff subject", async () => {
  h.owned = false;
  const { grantStaffFixture } = await import("./helpers");
  await expect(grantStaffFixture(userId, workspaceId, "operator")).rejects.toThrow(/owned/);
  expect(h.grant).not.toHaveBeenCalled();
  expect(h.verifiedTarget).not.toHaveBeenCalled();
});

it("refuses an unapproved project before any grant", async () => {
  vi.stubEnv("INTEGRATION_TARGET_IDENTITY_JSON", JSON.stringify({ projectId: "not-the-local-project" }));
  const { grantStaffFixture } = await import("./helpers");
  await expect(grantStaffFixture(userId, workspaceId, "operator")).rejects.toThrow(/Unapproved fixture project/);
  expect(h.grant).not.toHaveBeenCalled();
  expect(h.verifiedTarget).not.toHaveBeenCalled();
});

it("does nothing when capability fixtures are disabled", async () => {
  vi.stubEnv("INTEGRATION_CAPABILITY_FIXTURES", "");
  const { grantStaffFixture } = await import("./helpers");
  await grantStaffFixture(userId, workspaceId, "operator");
  expect(h.grant).not.toHaveBeenCalled();
  expect(h.verifiedTarget).not.toHaveBeenCalled();
  expect(h.capture).not.toHaveBeenCalled();
});
