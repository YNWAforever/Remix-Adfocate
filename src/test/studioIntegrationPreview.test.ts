// @vitest-environment node
import { beforeEach, expect, it } from "vitest";
import { createIntegrationPreview } from "./studioIntegrationPreview";
import type { StudioDetail, StudioSource } from "../lib/studio/types";

const uuid = () => crypto.randomUUID();
const actor = { creatorId: uuid(), workspaceId: uuid() };
let detail: StudioDetail, preview: ReturnType<typeof createIntegrationPreview>, clears: number;
beforeEach(() => {
  detail = { thread: { id: uuid(), title: "試飲 Brief", topic: "creation", mission_id: null, conversation_id: uuid(), revision: 0, created_at: new Date().toISOString() }, sources: [], briefs: [], messages: [], shares: [] };
  clears = 0;
  preview = createIntegrationPreview(actor, () => [detail], () => { clears++; });
});
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
