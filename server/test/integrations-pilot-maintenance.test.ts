// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { actor, connect, connectionId, denied, imported, pilotFixture, resource, resources, rpc, scalar, ws } from "./integrations-pilot-fixture.js";
let db: PGlite;
beforeAll(async () => { db = (await pilotFixture()).db; }, 30000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => { await db.exec("begin"); });
afterEach(async () => { await db.exec("rollback"); });

it("dry-run changes nothing; leased cleanup is bounded and scrubs snapshots and cached results", async () => {
  await connect(db);
  await resources(db, Array.from({ length: 3 }, (_, i) => resource({ id: crypto.randomUUID(), externalId: `fixture-${i}` })));
  await db.exec("update public.integration_snapshots set expires_at=clock_timestamp()-interval '1 second'");
  const before = await rpc(db, "maintenance", { dryRun: true, batchSize: 2 });
  expect(before).toMatchObject({ dryRun: true, counts: { snapshots: 2 }, hasMore: true });
  expect(await scalar(db, "select count(*)::int n from public.integration_snapshots")).toBe(3);
  await denied(db, () => rpc(db, "maintenance", { dryRun: false, batchSize: 2 }), "MAINTENANCE_LEASE_REQUIRED");
  const lease = await rpc(db, "maintenance_acquire", { leaseSeconds: 30 });
  expect(await rpc(db, "maintenance_acquire", {})).toEqual({ status: "busy" });
  expect(await rpc(db, "maintenance", { dryRun: false, batchSize: 2, leaseId: lease.leaseId })).toMatchObject({ counts: { snapshots: 2 } });
  expect(await scalar(db, "select count(*)::int n from public.integration_snapshots")).toBe(1);
  expect(await scalar(db, "select count(*)::int n from public.integration_resources where data->>'excerpt'='PRIVATE-SOURCE-EXCERPT'")).toBe(1);
  expect(await scalar(db, "select count(*)::int n from private.integration_commands where action='resources' and result<>'{}'::jsonb")).toBe(0);
});

it("keeps referenced snapshots, bounds pending revoke at 24h, and never claims provider confirmation", async () => {
  await imported(db);
  await rpc(db, "revoke", { id: connectionId, generation: 1 });
  await db.exec("update public.integration_snapshots set expires_at=clock_timestamp()-interval '1 second'; update private.integration_credentials set revoke_until=clock_timestamp()-interval '1 second'");
  const lease = await rpc(db, "maintenance_acquire", {});
  expect(await rpc(db, "maintenance", { dryRun: false, batchSize: 2, leaseId: lease.leaseId })).toMatchObject({ counts: { snapshots: 0, credentials: 1 } });
  expect(await scalar(db, "select count(*)::int n from public.integration_snapshots")).toBe(1);
  const result = await rpc(db, "export", {});
  expect(result.connections[0].providerRevocation).toBe("manual_action");
});

it("replays owner-scoped erasure tombstones after restore and rejects forged cross-owner records", async () => {
  await imported(db);
  await rpc(db, "purge", { id: connectionId, generation: 1 });
  const exported = await rpc(db, "tombstone_export", { limit: 100 });
  expect(exported.tombstones).toEqual(expect.arrayContaining([expect.objectContaining({ connectionId, kind: "purge", throughGeneration: 2 })]));
  expect(JSON.stringify(exported)).not.toContain("PRIVATE-SOURCE");
  // Simulated stale backup record, no real backup or remote environment.
  await db.query("update public.integration_connections set status='connected',generation=1,data=data||'{\"status\":\"connected\",\"generation\":1}'::jsonb where id=$1", [connectionId]);
  await denied(db, () => rpc(db, "restore_import", { tombstones: [{ ...exported.tombstones[0], workspaceId: crypto.randomUUID() }] }), "NOT_FOUND");
  await rpc(db, "restore_import", { tombstones: exported.tombstones });
  await denied(db, () => rpc(db, "credentials", { id: connectionId, generation: 1 }), "RESTORE_PENDING");
  expect(await rpc(db, "restore_replay", { batchSize: 1 })).toMatchObject({ replayed: 1, complete: true });
  expect((await rpc(db, "export", {})).connections[0].status).toBe("revoked");
  expect(await rpc(db, "restore_replay", { batchSize: 1 })).toMatchObject({ replayed: 0, complete: true });
  expect(await scalar(db, "select count(*)::int n from private.integration_pilot_tombstones where workspace_id=$1 and creator_id=$2", [ws, actor])).toBeGreaterThan(0);
});

it("account deletion retains an exportable fence that prevents a restored actor reconnecting", async () => {
  await imported(db);
  await db.query("update public.creators set status='deleted' where id=$1", [actor]);
  expect(await scalar(db, "select count(*)::int n from private.integration_pilot_tombstones where kind='account_delete'")).toBe(1);
  const result = await rpc(db, "tombstone_export", {});
  expect(result.tombstones).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "account_delete" })]));
  await db.query("update public.creators set status='active' where id=$1", [actor]);
  await denied(db, () => connect(db), "SOURCE_UNAVAILABLE");
});
