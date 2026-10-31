// @vitest-environment node
import { expect, it } from "vitest";
import { MemoryIntegrationRepository } from "../lib/integrations/memoryRepo.js";
import { actor, ws, other, otherWs, connection, credential, connectionId, resource } from "./integrations-pilot-fixture.js";
const owner = { creatorId: actor, workspaceId: ws };
it("rejects a fake live connection and implements private OAuth lookup/buffer/one-use completion", async () => {
  const repo = new MemoryIntegrationRepository();
  await expect(repo.command(owner, crypto.randomUUID(), "connect", { expectedGeneration: 0, connection: connection({ sampleOnly: false }), credential })).rejects.toThrow("PILOT_BINDING_REQUIRED");
  const stateHash = "a".repeat(64), sessionHash = "b".repeat(64), ticketHash = "c".repeat(64);
  await repo.command(owner, crypto.randomUUID(), "oauth_start", { stateHash, sessionHash, provider: "google_drive", expectedGeneration: 0, returnPath: "/studio?thread=fixture", expiresAt: new Date(Date.now() + 590000).toISOString(), secret: credential });
  expect(await repo.lookupOAuthState(stateHash, "google_drive")).toMatchObject({ actor: owner, expectedGeneration: 0 });
  await repo.bufferOAuthCallback({ stateHash, provider: "google_drive", ticketHash, code: credential, expiresAt: new Date(Date.now() + 290000).toISOString() });
  await expect(repo.command({ creatorId: other, workspaceId: otherWs }, crypto.randomUUID(), "oauth_complete", { ticketHash, provider: "google_drive", sessionHash, allowRelogin: true })).rejects.toThrow("OAUTH_STATE_INVALID");
  const result = await repo.command(owner, crypto.randomUUID(), "oauth_complete", { ticketHash, provider: "google_drive", sessionHash, allowRelogin: false });
  expect(result).toMatchObject({ stateHash, returnPath: "/studio?thread=fixture", secret: credential, code: credential });
  await expect(repo.command(owner, crypto.randomUUID(), "oauth_complete", { ticketHash, provider: "google_drive", sessionHash, allowRelogin: false })).rejects.toThrow("OAUTH_STATE_INVALID");
});
it("revocation invalidates buffered pilot secrets and tickets", async () => {
  const repo = new MemoryIntegrationRepository();
  await repo.command(owner, crypto.randomUUID(), "connect", { expectedGeneration: 0, connection: connection(), credential });
  const stateHash = "a".repeat(64), sessionHash = "b".repeat(64), ticketHash = "c".repeat(64);
  await repo.command(owner, crypto.randomUUID(), "oauth_start", { stateHash, sessionHash, provider: "google_drive", expectedGeneration: 1, returnPath: "/connections", expiresAt: new Date(Date.now() + 590000).toISOString(), secret: credential });
  await repo.bufferOAuthCallback({ stateHash, provider: "google_drive", ticketHash, code: credential, expiresAt: new Date(Date.now() + 290000).toISOString() });
  await repo.command(owner, crypto.randomUUID(), "revoke", { id: connectionId, generation: 1 });
  await expect(repo.command(owner, crypto.randomUUID(), "oauth_complete", { ticketHash, provider: "google_drive", sessionHash, allowRelogin: false })).rejects.toThrow("OAUTH_STATE_INVALID");
  expect(JSON.stringify(await repo.command(owner, crypto.randomUUID(), "export", {}))).not.toContain("ciphertext");
});
it("rejects secret-bearing evidence before it reaches memory source DTOs", async () => {
  const repo = new MemoryIntegrationRepository();
  await repo.command(owner, crypto.randomUUID(), "connect", { expectedGeneration: 0, connection: connection(), credential });
  await expect(repo.command(owner, crypto.randomUUID(), "resources", { id: connectionId, generation: 1, resources: [resource({ evidence: { apiVersion: "v3", endpoint: "files", measurementPeriod: "version", accessToken: "SECRET" } })] })).rejects.toThrow("INVALID_INPUT");
});
it("mirrors private live grant fanout and idempotent revocation without exposing peers", async () => {
  const repo = new MemoryIntegrationRepository(), second = { creatorId: other, workspaceId: otherWs }, secondId = crypto.randomUUID();
  for (const [who, id] of [[owner, connectionId], [second, secondId]] as const) {
    const b = await repo.command(who, crypto.randomUUID(), "pilot_bind", { id, generation: 1, provider: "google_drive", environmentId: "fixture", databaseProjectId: "fixture", origin: "https://pilot.invalid", providerProjectId: "fixture", subjectHash: "a".repeat(64), apiVersion: "v3" });
    await repo.command(who, crypto.randomUUID(), "connect", { bindingId: b.bindingId, expectedGeneration: 0, connection: connection({ ...who, id, sampleOnly: false }), credential });
  }
  const request = crypto.randomUUID(), payload = { id: connectionId, generation: 1 };
  const result = await repo.command(owner, request, "revoke", payload);
  expect(JSON.stringify(result)).not.toContain(secondId);
  expect(await repo.connection(second, secondId)).toMatchObject({ status: "revoked", generation: 2 });
  expect(await repo.command(owner, request, "revoke", payload)).toEqual(result);
});

it.each(["purge", "revoke"])("memory old Google %s leaves a freshly authorized peer and refresh lease intact", async action => {
  const repo = new MemoryIntegrationRepository(), second = { creatorId: other, workspaceId: otherWs }, secondId = crypto.randomUUID();
  const bind = async (who: typeof owner, id: string, generation: number) => {
    const b = await repo.command(who, crypto.randomUUID(), "pilot_bind", { id, generation, provider: "google_drive", environmentId: "fixture", databaseProjectId: "fixture", origin: "https://pilot.invalid", providerProjectId: "fixture", subjectHash: "a".repeat(64), apiVersion: "v3" });
    await repo.command(who, crypto.randomUUID(), "connect", { bindingId: b.bindingId, expectedGeneration: generation - 1, connection: connection({ ...who, id, generation, sampleOnly: false }), credential });
  };
  await bind(owner, connectionId, 1); await bind(second, secondId, 1);
  await repo.command(owner, crypto.randomUUID(), "revoke", { id: connectionId, generation: 1 });
  await repo.command(owner, crypto.randomUUID(), "revoke_result", { id: connectionId, generation: 2, provider: "revoked" });
  await bind(second, secondId, 3);
  const lease = await repo.command(second, crypto.randomUUID(), "refresh_acquire", { id: secondId, generation: 3, holderId: "fixture-worker" });
  await repo.command(owner, crypto.randomUUID(), action, { id: connectionId, ...(action === "revoke" ? { generation: 2 } : {}) });
  expect(await repo.connection(second, secondId)).toMatchObject({ status: "connected", generation: 3, providerRevocation: "not_requested" });
  expect(await repo.command(second, crypto.randomUUID(), "refresh_commit", { id: secondId, generation: 3, leaseId: lease.leaseId, credentialVersion: lease.credentialVersion, credential, expiresAt: "2099-01-01T00:00:00Z" })).toEqual({ credentialVersion: 2 });
});

it("memory observation evolution creates a new snapshot without changing content identity", async () => {
  const repo = new MemoryIntegrationRepository();
  await repo.command(owner, crypto.randomUUID(), "connect", { expectedGeneration: 0, connection: connection(), credential });
  const firstRow = resource({ evidence: { apiVersion: "fixture-v1", endpoint: "media/insights", measurementPeriod: "lifetime", selectionPeriod: { start: "2026-10-01", end: "2026-10-31" } } });
  const save = (row: typeof firstRow) => repo.command(owner, crypto.randomUUID(), "resources", { id: connectionId, generation: 1, resources: [row] });
  const first = await save(firstRow);
  const secondRow = { ...firstRow, fetchedAt: "2026-11-01T02:00:00Z", evidence: { ...firstRow.evidence, selectionPeriod: { start: "2026-10-02", end: "2026-11-01" } } };
  const second = await save(secondRow);
  const one = (first.resources as Array<Record<string, unknown>>)[0], two = (second.resources as Array<Record<string, unknown>>)[0];
  expect(two.snapshotId).not.toBe(one.snapshotId); expect(two.contentHash).toBe(one.contentHash);
  expect(two.evidence).toEqual(secondRow.evidence);
  expect((await save(secondRow)).resources).toEqual(second.resources);
});

it("memory refresh rejects malformed fences and a missing lease without mutating credentials", async () => {
  const repo = new MemoryIntegrationRepository();
  await repo.command(owner, crypto.randomUUID(), "connect", { expectedGeneration: 0, connection: connection(), credential });
  const payload = { id: connectionId, generation: 1, credential: { ...credential, ciphertext: "UNLEASED-WRITE" }, expiresAt: "2099-01-01T00:00:00Z" };
  for (const action of ["refresh_commit", "refresh_abandon"]) {
    for (const fields of [{}, { leaseId: null, credentialVersion: null }, { leaseId: crypto.randomUUID(), credentialVersion: "1" }, { leaseId: 123, credentialVersion: 1 }, { leaseId: "not-a-uuid", credentialVersion: 1 }, { leaseId: crypto.randomUUID(), credentialVersion: 0 }, { leaseId: crypto.randomUUID(), credentialVersion: 2147483648 }]) {
      await expect(repo.command(owner, crypto.randomUUID(), action, { ...payload, ...fields })).rejects.toThrow("INVALID_INPUT");
    }
    await expect(repo.command(owner, crypto.randomUUID(), action, { ...payload, leaseId: crypto.randomUUID(), credentialVersion: 1 })).rejects.toThrow("REFRESH_LEASE_STALE");
  }
  expect((await repo.command(owner, crypto.randomUUID(), "credentials", { id: connectionId, generation: 1 })).credential).toEqual(credential);
  const lease = await repo.command(owner, crypto.randomUUID(), "refresh_acquire", { id: connectionId, generation: 1, holderId: "fixture" });
  await expect(repo.command(owner, crypto.randomUUID(), "refresh_commit", { ...payload, leaseId: lease.leaseId, credentialVersion: null })).rejects.toThrow("INVALID_INPUT");
  expect(await repo.command(owner, crypto.randomUUID(), "refresh_commit", { ...payload, leaseId: lease.leaseId, credentialVersion: lease.credentialVersion })).toEqual({ credentialVersion: 2 });
});
