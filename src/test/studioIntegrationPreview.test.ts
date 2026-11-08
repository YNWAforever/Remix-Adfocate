// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createIntegrationPreview, integrationPreviewScenario } from "./studioIntegrationPreview";
import type { StudioDetail, StudioSource } from "../lib/studio/types";

const uuid = () => crypto.randomUUID();
const actor = { creatorId: uuid(), workspaceId: uuid() };
let detail: StudioDetail, preview: ReturnType<typeof createIntegrationPreview>, clears: number;
beforeEach(() => {
  detail = { thread: { id: uuid(), title: "試飲 Brief", topic: "creation", mission_id: null, conversation_id: uuid(), revision: 0, created_at: new Date().toISOString() }, sources: [], briefs: [], messages: [], shares: [] };
  clears = 0;
  preview = createIntegrationPreview(actor, () => [detail], () => { clears++; });
});
afterEach(() => vi.unstubAllGlobals());
async function request(path: string, body: Record<string, unknown> = {}, method = "POST") {
  const response = await preview.handle(`/me/integrations${path}`, method, body);
  expect(response?.ok).toBe(true);
  return response!.json();
}
async function importDrive(consent = false, share = false) {
  const start = await request("/google_drive/start", { returnPath: "/studio" });
  const { connection } = await request("/google_drive/complete", { state: start.state, code: "allow" });
  const { resources } = await request(`/${connection.id}/resources`, { fileIds: ["mock-owned-brief"], requestId: uuid() });
  await request(`/${connection.id}/import`, { threadId: detail.thread.id, revision: 0, resourceIds: [resources[0].id], question: "開場如何拍？", modelConsent: consent, processingRights: consent, shareRights: share, requestId: uuid() });
  return connection;
}
it("imports into the selected thread but excludes non-consented evidence from mock AI", async () => {
  await importDrive();
  expect(detail.thread.revision).toBe(1);
  expect(detail.sources).toHaveLength(1);
  expect(await preview.modelSources(detail, uuid())).toEqual([]);
  expect(detail.sources[0].shareable).toBe(false);
});
it("checks canonical sharing and revocation while preserving original paragraphs", async () => {
  const connection = await importDrive(true, true), source = detail.sources[0];
  expect((await preview.modelSources(detail, uuid()))[0].id).toBe(source.id);
  const sections = [{ id: uuid(), text: source.content, sourceIds: [source.id] }, { id: uuid(), text: "自己的想法", sourceIds: [] }];
  await preview.authorizeCommand("save_brief", { threadId: detail.thread.id, sections });
  detail.briefs.push({ id: uuid(), thread_id: detail.thread.id, version: 1, sections, created_at: new Date().toISOString() });
  await request(`/${connection.id}/revoke`, { requestId: uuid() });
  expect(source.revoked_at).toBeTruthy();
  await expect(preview.authorizeCommand("share_brief", { threadId: detail.thread.id, briefId: detail.briefs[0].id, sectionIds: [sections[0].id], sections: [] })).rejects.toThrow();
  await request(`/${connection.id}/purge`, { requestId: uuid() });
  expect(detail.sources).toHaveLength(0);
  expect(detail.briefs[0].sections).toEqual([sections[1]]);
  expect(clears).toBeGreaterThan(0);
});
it("does not import with a stale revision or silently replace consent", async () => {
  const connection = await importDrive(), original = structuredClone(detail.sources);
  const resources = await request(`/${connection.id}/resources`, {}, "GET");
  const response = await preview.handle(`/me/integrations/${connection.id}/import`, "POST", { threadId: detail.thread.id, revision: 0, resourceIds: [resources.resources[0].id], question: "新問題", modelConsent: true, processingRights: true, shareRights: true, requestId: uuid() });
  expect(response?.status).toBe(409);
  expect(detail.sources as StudioSource[]).toEqual(original);
});

it("exposes D0 in the existing preview and refuses external authorization/token/read routes", async () => {
  const network = vi.fn(() => { throw new Error("No external provider permitted"); }); vi.stubGlobal("fetch", network);
  preview = createIntegrationPreview(actor, () => [detail], () => {}, { scenario: "d0" });
  expect(await request("", {}, "GET")).toMatchObject({ mode: "live_pilot", pilot: { stage: "D0", externalAccess: false }, connections: [] });
  for (const [path, method] of [["/google_drive/start", "POST"], ["/sample/picker-token", "POST"], ["/sample/resources", "GET"], ["/sample/sync", "POST"]]) {
    const response = await preview.handle(`/me/integrations${path}`, method, {});
    expect(response?.status).toBe(403);
    expect(await response?.json()).toEqual({ code: "D0_EXTERNAL_ACCESS_DISABLED" });
  }
  expect(network).not.toHaveBeenCalled();
});

it("selects only known offline scenarios in the existing preview URL", () => {
  expect(integrationPreviewScenario("")).toBe("mock");
  expect(integrationPreviewScenario("?integrationPreview=d0-pending&thread=sample")).toBe("d0-pending");
  expect(integrationPreviewScenario("?integrationPreview=live")).toBe("d0");
  expect(integrationPreviewScenario("?integrationPreview=https://external.example.test")).toBe("d0");
});

it.each([
  ["d0-pending", "revoked", "pending"], ["d0-reauth", "reauth_required", "not_requested"],
  ["d0-manual-action", "revoked", "manual_action"], ["d0-reconnect", "revoked", "revoked"],
] as const)("uses explicit sample fixtures for %s and never a connected-live claim", async (scenario, status, providerRevocation) => {
  preview = createIntegrationPreview(actor, () => [detail], () => {}, { scenario });
  const list = await request("", {}, "GET");
  expect(list).toMatchObject({ mode: "mock", pilot: { stage: "D0", externalAccess: false }, connections: [{ sampleOnly: true, status, providerRevocation }] });
  expect(list.connections[0].label).toContain("synthetic");
  expect(list.connections[0].scopes).toEqual(["https://www.googleapis.com/auth/drive.file"]);
});

it("retries sample revocation, then reconnects without restoring the old grant or consent", async () => {
  preview = createIntegrationPreview(actor, () => [detail], () => {}, { scenario: "d0-pending" });
  const old = (await request("", {}, "GET")).connections[0];
  const denied = await preview.handle("/me/integrations/google_drive/start", "POST", {});
  expect(denied?.status).toBe(409);
  expect(await request(`/${old.id}/revoke`, { requestId: uuid() })).toEqual({ local: "revoked", provider: "revoked" });
  const start = await request("/google_drive/start", { returnPath: "/connections" });
  const fresh = await request("/google_drive/complete", { state: start.state, code: "allow" });
  expect(fresh.connection.id).not.toBe(old.id);
  expect(fresh.connection.sampleOnly).toBe(true);
  expect((await request(`/${fresh.connection.id}/resources`, {}, "GET")).resources).toEqual([]);
  expect(detail.sources).toEqual([]);
});
