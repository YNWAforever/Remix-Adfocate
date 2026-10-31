// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryIntegrationRepository } from "./memoryRepo.js";
import type { Actor, ConnectionRecord, ResourceRecord } from "./types.js";
import type { StudioSource } from "../../../src/lib/studio/types.js";

const actor: Actor = { workspaceId: "workspace-a", creatorId: "creator-a" };
const other: Actor = { ...actor, creatorId: "creator-b" };
let now = new Date("2026-10-31T12:00:00Z");
const connection: ConnectionRecord = { ...actor, id: "connection-1", provider: "google_drive", subject: "mock-owner", label: "Mock", generation: 1, status: "connected", scopes: ["https://www.googleapis.com/auth/drive.file"], expiresAt: "2099-01-01T00:00:00Z", lastSyncAt: null, lastError: null, sampleOnly: true, providerRevocation: "not_requested", consentVersion: "mock" };
const resource: ResourceRecord = { ...actor, id: "resource-1", connectionId: connection.id, externalId: "mock-file", title: "Mock private source", mimeType: "text/plain", version: "v1", selected: true, canDownload: true, rights: "owned", generation: 1, contentHash: "mock-hash", sizeBytes: 10, availability: "available", excerpt: "Mock text", metrics: {}, observedAt: now.toISOString(), fetchedAt: now.toISOString(), coverage: { region: null, language: null, partial: false }, sampleOnly: true };
let repo: MemoryIntegrationRepository;
const hooks = { revokeSources: vi.fn(), importSources: vi.fn(), purgeSources: vi.fn() };
beforeEach(async () => {
  now = new Date("2026-10-31T12:00:00Z");
  Object.values(hooks).forEach(hook => hook.mockReset());
  repo = new MemoryIntegrationRepository(() => now, hooks);
  await repo.command(actor, "connect-1", "connect", { connection, credential: { encrypted: "mock" }, expectedGeneration: 0 });
  await repo.command(actor, "resources-1", "resources", { id: connection.id, generation: 1, resources: [resource] });
});
async function importSource() {
  const result = await repo.command(actor, "import-1", "import", { id: connection.id, generation: 1, threadId: "thread-1", revision: 7, resourceIds: [resource.id], question: "Question?", modelConsent: true, processingRights: true, shareRights: true });
  return (result.sources as StudioSource[])[0];
}

describe("memory connection state transitions", () => {
  it("reauth is owner/generation scoped, repeatable, and blocks all active operations", async () => {
    const source = await importSource();
    await expect(repo.command(other, "wrong-owner", "reauth", { id: connection.id, generation: 1 })).rejects.toThrow("NOT_FOUND");
    await expect(repo.command(actor, "wrong-generation", "reauth", { id: connection.id, generation: 2 })).rejects.toThrow("STALE_CONNECTION");
    expect((await repo.connection(actor, connection.id))?.status).toBe("connected");
    const result = await repo.command(actor, "reauth-1", "reauth", { id: connection.id, generation: 1 });
    expect(result.connection).toMatchObject({ status: "reauth_required", lastError: "REAUTH_REQUIRED", generation: 1 });
    expect(await repo.command(actor, "reauth-2", "reauth", { id: connection.id, generation: 1 })).toEqual(result);
    for (const action of ["credentials", "update_credentials", "reserve_sync", "resources", "import", "finish_sync"]) {
      await expect(repo.command(actor, `blocked-${action}`, action, { id: connection.id, generation: 1 })).rejects.toThrow("REAUTH_REQUIRED");
    }
    await expect(repo.command(actor, "blocked-permit", "permit", { sourceIds: [source.id], use: "model" })).rejects.toThrow("REAUTH_REQUIRED");
  });

  it("reauth replay cannot change a revoked or reconnected generation", async () => {
    await repo.command(actor, "reauth", "reauth", { id: connection.id, generation: 1 });
    await repo.command(actor, "revoke", "revoke", { id: connection.id, generation: 1 });
    await expect(repo.command(actor, "reauth", "reauth", { id: connection.id, generation: 1 })).rejects.toThrow("STALE_CONNECTION");
    await expect(repo.command(actor, "reauth-new", "reauth", { id: connection.id, generation: 2 })).rejects.toThrow("STALE_CONNECTION");
    await repo.command(actor, "reconnect", "connect", { connection: { ...connection, generation: 3 }, credential: { encrypted: "new mock" }, expectedGeneration: 2 });
    await expect(repo.command(actor, "reauth", "reauth", { id: connection.id, generation: 1 })).rejects.toThrow("STALE_CONNECTION");
    expect(await repo.connection(actor, connection.id)).toMatchObject({ status: "connected", lastError: null, generation: 3 });
  });

  it("revokeSource updates the private source and disables prior permits without invoking canonical hooks", async () => {
    const source = await importSource(), payload = { text: "canonical draft" };
    await repo.command(actor, "permit", "permit", { sourceIds: [source.id], use: "share", commandPayload: payload });
    const beforeImportCalls = hooks.importSources.mock.calls.length;
    expect(() => repo.revokeSource(other, source.id)).toThrow("NOT_FOUND");
    expect(() => repo.revokeSource(actor, "missing")).toThrow("NOT_FOUND");
    repo.revokeSource(actor, source.id); repo.revokeSource(actor, source.id);
    const refs = await repo.command(actor, "refs", "source_refs", { sourceIds: [source.id] });
    expect(refs.sources).toEqual([expect.objectContaining({ id: source.id, revoked_at: now.toISOString(), shareable: false, integration: expect.objectContaining({ model_allowed: false, availability: "revoked" }) })]);
    expect(hooks.importSources).toHaveBeenCalledTimes(beforeImportCalls);
    expect(hooks.revokeSources).not.toHaveBeenCalled(); expect(hooks.purgeSources).not.toHaveBeenCalled();
    expect(() => repo.consumePermits(actor, [source.id], "share", payload)).toThrow("SOURCE_PERMISSION_REQUIRED");
    expect(await repo.connection(actor, connection.id)).toMatchObject({ status: "connected", generation: 1 });
  });

  it("requires a post-revoke generation for revoke_result and rejects malformed, cross-owner or active targets", async () => {
    for (const generation of [undefined, null, "2", 0, -1, 1.5]) {
      await expect(repo.command(actor, `bad-${generation}`, "revoke_result", { id: connection.id, generation, provider: "revoked" })).rejects.toThrow("INVALID_INPUT");
    }
    await expect(repo.command(actor, "active", "revoke_result", { id: connection.id, generation: 1, provider: "revoked" })).rejects.toThrow("STALE_CONNECTION");
    const result = await repo.command(actor, "revoke", "revoke", { id: connection.id, generation: 1 });
    expect(result.connection).toMatchObject({ generation: 2 });
    await expect(repo.command(other, "foreign-result", "revoke_result", { id: connection.id, generation: 2, provider: "revoked" })).rejects.toThrow("NOT_FOUND");
    await expect(repo.command(actor, "old-result", "revoke_result", { id: connection.id, generation: 1, provider: "revoked" })).rejects.toThrow("STALE_CONNECTION");
    await repo.command(actor, "valid-result", "revoke_result", { id: connection.id, generation: 2, provider: "revoked" });
    expect(await repo.connection(actor, connection.id)).toMatchObject({ generation: 2, status: "revoked", providerRevocation: "revoked" });
  });

  it.each([false, true])("stores metadata and a rights notice without processing rights, even if modelConsent=%s", async modelConsent => {
    const result = await repo.command(actor, "metadata-import", "import", { id: connection.id, generation: 1, threadId: "thread-1", revision: 7, resourceIds: [resource.id], question: "Question?", modelConsent, processingRights: false, shareRights: true });
    const source = (result.sources as StudioSource[])[0];
    expect(source.content).not.toContain("Mock text"); expect(source.content.length).toBeGreaterThan(0);
    expect(source).toMatchObject({ title: resource.title, shareable: false, integration: { model_allowed: false, source_version: "v1" } });
    expect(hooks.importSources.mock.calls[0][2][0]).toEqual(source);
    const refs = await repo.command(actor, "refs", "source_refs", { sourceIds: [source.id] });
    expect(refs.sources).toEqual([source]);
  });

  it("retains a private excerpt with processing rights but without model consent", async () => {
    const result = await repo.command(actor, "private-import", "import", { id: connection.id, generation: 1, threadId: "thread-1", revision: 7, resourceIds: [resource.id], question: "Question?", modelConsent: false, processingRights: true, shareRights: false });
    expect((result.sources as StudioSource[])[0]).toMatchObject({ content: "Mock text", shareable: false, integration: { model_allowed: false } });
  });

  it("changes the snapshot and revokes old consent when rights change without a content change", async () => {
    const source = await importSource();
    await repo.command(actor, "rights-changed", "resources", { id: connection.id, generation: 1, resources: [{ ...resource, rights: "unknown" }] });
    expect((await repo.resources(actor, connection.id))[0].snapshotId).not.toBe(source.integration!.snapshot_id);
    expect((await repo.command(actor, "refs", "source_refs", { sourceIds: [source.id] })).sources).toEqual([expect.objectContaining({ revoked_at: now.toISOString(), shareable: false, integration: expect.objectContaining({ model_allowed: false, availability: "revoked" }) })]);
    expect(hooks.revokeSources).toHaveBeenCalledTimes(1); expect(hooks.revokeSources).toHaveBeenCalledWith(actor, [source.id]);
  });

  it("reveals revocation credentials only for the owned pending generation within 24h and never from replay", async () => {
    await expect(repo.command(actor, "active-secret", "revocation_credentials", { id: connection.id, generation: 1 })).rejects.toThrow("STALE_CONNECTION");
    await repo.command(actor, "revoke", "revoke", { id: connection.id, generation: 1 });
    await expect(repo.command(other, "foreign-secret", "revocation_credentials", { id: connection.id, generation: 2 })).rejects.toThrow("NOT_FOUND");
    await expect(repo.command(actor, "old-secret", "revocation_credentials", { id: connection.id, generation: 1 })).rejects.toThrow("STALE_CONNECTION");
    expect(await repo.command(actor, "secret-read", "revocation_credentials", { id: connection.id, generation: 2 })).toEqual({ credential: { encrypted: "mock" }, credentialGeneration: 1 });
    now = new Date(now.getTime() + 24 * 3600_000);
    expect(await repo.command(actor, "secret-read", "revocation_credentials", { id: connection.id, generation: 2 })).toEqual({ credential: null, credentialGeneration: null });
    await repo.command(actor, "manual", "revoke_result", { id: connection.id, generation: 2, provider: "manual_action" });
    await expect(repo.command(actor, "secret-read", "revocation_credentials", { id: connection.id, generation: 2 })).rejects.toThrow("STALE_CONNECTION");
  });

  it("looks up only owned selected identities across generations without returning old content", async () => {
    await repo.command(actor, "reconnect", "connect", { connection: { ...connection, generation: 2 }, credential: { encrypted: "new mock" }, expectedGeneration: 1 });
    expect(await repo.resources(actor, connection.id)).toEqual([]);
    expect(await repo.resourceIdentities(actor, connection.id, [resource.externalId])).toEqual([{ id: resource.id, externalId: resource.externalId }]);
    expect(await repo.resourceIdentities(actor, connection.id, ["not-selected"])).toEqual([]);
    expect(await repo.resourceIdentities(other, connection.id, [resource.externalId])).toEqual([]);
    expect(await repo.resourceIdentities({ ...actor, workspaceId: "other-workspace" }, connection.id, [resource.externalId])).toEqual([]);
  });
});
