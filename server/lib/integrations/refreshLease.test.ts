// @vitest-environment node
import { expect, it } from "vitest";
import { MemoryIntegrationRepository } from "./memoryRepo.js";
import { RepositoryRefreshLease } from "./refreshLease.js";
import { connection, credential, connectionId, actor, ws } from "../../test/integrations-pilot-fixture.js";
const owner = { creatorId: actor, workspaceId: ws };
it("shares repository leases across workers and fences an ambiguous expired refresh", async () => {
  let now = new Date("2026-10-31T12:00:00Z");
  const repo = new MemoryIntegrationRepository(() => now);
  await repo.command(owner, crypto.randomUUID(), "connect", { expectedGeneration: 0, connection: connection(), credential });
  const workerA = new RepositoryRefreshLease(repo, "a"), workerB = new RepositoryRefreshLease(repo, "b");
  const lease = await workerA.acquire(owner, connectionId, 1);
  expect(lease).toMatchObject({ status: "acquired", credentialVersion: 1 });
  expect(await workerB.acquire(owner, connectionId, 1)).toEqual({ status: "busy" });
  now = new Date(now.getTime() + 31000);
  expect(await workerB.acquire(owner, connectionId, 1)).toEqual({ status: "reauth_required" });
  if (lease.status !== "acquired") throw new Error("missing lease");
  await expect(workerA.commit(owner, connectionId, 1, lease, credential, "2099-01-01T00:00:00Z")).rejects.toThrow("REAUTH_REQUIRED");
});
it("increments credential version and rejects replayed CAS or post-revocation writes", async () => {
  const repo = new MemoryIntegrationRepository();
  await repo.command(owner, crypto.randomUUID(), "connect", { expectedGeneration: 0, connection: connection(), credential });
  const worker = new RepositoryRefreshLease(repo, "worker");
  const lease = await worker.acquire(owner, connectionId, 1);
  if (lease.status !== "acquired") throw new Error("missing lease");
  expect(await worker.commit(owner, connectionId, 1, lease, credential, "2099-01-01T00:00:00Z")).toEqual({ credentialVersion: 2 });
  await expect(worker.commit(owner, connectionId, 1, lease, credential, "2099-01-01T00:00:00Z")).rejects.toThrow("REFRESH_LEASE_STALE");
  const second = await worker.acquire(owner, connectionId, 1);
  if (second.status !== "acquired") throw new Error("missing lease");
  await repo.command(owner, crypto.randomUUID(), "revoke", { id: connectionId, generation: 1 });
  await expect(worker.commit(owner, connectionId, 1, second, credential, "2099-01-01T00:00:00Z")).rejects.toThrow("STALE_CONNECTION");
});
