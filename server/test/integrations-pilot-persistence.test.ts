// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { actor, colleague, connect, connection, connectionId, credential, denied, other, otherWs, pilotFixture, resource, resourceId, resources, rpc, scalar, studio, ws } from "./integrations-pilot-fixture.js";

let db: PGlite;
const hash = "a".repeat(64), sessionHash = "b".repeat(64), ticketHash = "c".repeat(64);
const next = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString();
const binding = (overrides = {}) => ({ id: connectionId, generation: 1, provider: "google_drive", environmentId: "synthetic-pilot", databaseProjectId: "synthetic-db", origin: "https://pilot.invalid", providerProjectId: "synthetic-google", subjectHash: hash, apiVersion: "v3", ...overrides });
async function live(owner = actor, workspace = ws, id = connectionId, overrides = {}) {
  const b = await rpc(db, "pilot_bind", binding({ id, ...overrides }), undefined, owner, workspace);
  return rpc(db, "connect", { expectedGeneration: 0, bindingId: b.bindingId, credential, connection: connection({ id, creatorId: owner, workspaceId: workspace, sampleOnly: false, scopes: ["https://www.googleapis.com/auth/drive.file", "openid"] }) }, undefined, owner, workspace);
}
async function start() { return rpc(db, "oauth_start", { stateHash: hash, sessionHash, provider: "google_drive", expiresAt: next(590), expectedGeneration: 0, returnPath: "/connections", secret: credential }); }
async function callback() { return db.query("select public.integration_oauth_callback($1,$2,$3,$4::jsonb,$5::timestamptz) result", [hash, "google_drive", ticketHash, JSON.stringify({ ...credential, ciphertext: "ENCRYPTED-CODE" }), next(290)]); }

describe("D0 pilot persistence (in-memory PostgreSQL only)", () => {
  beforeAll(async () => { db = (await pilotFixture()).db; }, 30000);
  afterAll(async () => { await db?.close(); });
  beforeEach(async () => { await db.exec("begin"); });
  afterEach(async () => { await db.exec("rollback"); });

  it("rejects spoofed live provenance and preserves old samples after a later live reconnect", async () => {
    await denied(db, () => rpc(db, "connect", { expectedGeneration: 0, connection: connection({ sampleOnly: false }), credential }), "PILOT_BINDING_REQUIRED");
    await connect(db); await resources(db);
    await rpc(db, "revoke", { id: connectionId, generation: 1 });
    await rpc(db, "revoke_result", { id: connectionId, generation: 2, provider: "revoked" });
    const b = await rpc(db, "pilot_bind", binding({ generation: 3 }));
    const result = await rpc(db, "connect", { expectedGeneration: 2, bindingId: b.bindingId, credential, connection: connection({ generation: 3, sampleOnly: false }) });
    expect(result.connection).toMatchObject({ sampleOnly: false, mode: "live_pilot", claimVerification: "unverified" });
    const old = (await db.query<{ data: Record<string, unknown> }>("select data from public.integration_snapshots")).rows[0].data;
    expect(old.sampleOnly).toBe(true);
  });

  it("carries server provenance through resource, snapshot, import and replay without upgrading verification", async () => {
    await live(); const request = crypto.randomUUID();
    const values = [resource({ sampleOnly: false })];
    const result = await resources(db, values, request);
    expect(result.resources[0]).toMatchObject({ sampleOnly: false, mode: "live_pilot", apiVersion: "v3", claimVerification: "unverified" });
    expect(await resources(db, values, request)).toEqual(result);
    const thread = await studio(db, "create_thread", { title: "Pilot", topic: "creation" });
    const imported = await rpc(db, "import", { id: connectionId, generation: 1, threadId: thread.id, revision: 0, resourceIds: [resourceId], question: "Evidence?", modelConsent: false, processingRights: true, shareRights: false });
    expect(imported.sources[0].integration).toMatchObject({ sample_only: false, mode: "live_pilot", claim_verification: "unverified", model_allowed: false });
    expect(imported.sources[0].status).toBe("unverified");
    expect(JSON.stringify(await rpc(db, "export", {}))).not.toMatch(/ciphertext|subjectHash|providerProjectId|ENCRYPTED/);
  });

  it("buffers code without accepting an actor, completes only as original owner and consumes secrets once", async () => {
    await start();
    expect((await db.query("select public.integration_oauth_lookup($1,$2) result", [hash, "google_drive"])).rows[0]).toMatchObject({ result: { actor: { creatorId: actor, workspaceId: ws }, expectedGeneration: 0 } });
    expect((await callback()).rows[0]).toEqual({ result: { stored: true } });
    await denied(db, callback, "OAUTH_STATE_INVALID");
    await denied(db, () => rpc(db, "oauth_complete", { ticketHash, provider: "google_drive", sessionHash, allowRelogin: true }, undefined, other, otherWs), "OAUTH_STATE_INVALID");
    await denied(db, () => rpc(db, "oauth_complete", { ticketHash, provider: "google_drive", sessionHash: "d".repeat(64), allowRelogin: false }), "OAUTH_STATE_INVALID");
    const value = await rpc(db, "oauth_complete", { ticketHash, provider: "google_drive", sessionHash: "d".repeat(64), allowRelogin: true });
    expect(value).toMatchObject({ stateHash: hash, expectedGeneration: 0, returnPath: "/connections", secret: credential, code: { ciphertext: "ENCRYPTED-CODE" } });
    await denied(db, () => rpc(db, "oauth_complete", { ticketHash, provider: "google_drive", sessionHash, allowRelogin: false }), "OAUTH_STATE_INVALID");
    expect(await scalar(db, "select count(*)::int n from private.integration_pilot_oauth where secret is not null or code is not null")).toBe(0);
    expect(JSON.stringify(await rpc(db, "export", {}))).not.toContain("ciphertext");
  });

  it("rejects expired tickets and generation changes, and prevents direct-consume/callback replay", async () => {
    await start(); await callback();
    await db.exec("update private.integration_pilot_oauth set ticket_expires_at=clock_timestamp()-interval '1 second'");
    await denied(db, () => rpc(db, "oauth_complete", { ticketHash, provider: "google_drive", sessionHash, allowRelogin: false }), "OAUTH_STATE_INVALID");
    await denied(db, () => rpc(db, "oauth_consume", { stateHash: hash, provider: "google_drive", sessionHash }), "OAUTH_STATE_INVALID");
  });

  it("returns to the original safe discussion path while rejecting external paths and retaining the old mock contract", async () => {
    const input = { stateHash: hash, sessionHash, provider: "google_drive", expiresAt: next(590), expectedGeneration: 0, returnPath: `/studio?thread=${crypto.randomUUID()}`, secret: credential };
    for (const returnPath of ["//evil.invalid", "/studio%3Fthread=other", "/studio\\evil", "/studio bad"]) {
      await denied(db, () => rpc(db, "oauth_start", { ...input, returnPath }), "INVALID_INPUT");
    }
    await denied(db, () => rpc(db, "start", input), "INVALID_INPUT");
    await rpc(db, "oauth_start", input); await callback();
    expect(await rpc(db, "oauth_complete", { ticketHash, provider: "google_drive", sessionHash, allowRelogin: false })).toMatchObject({ stateHash: hash, returnPath: input.returnPath });
  });

  it("persists safe adapter evidence for offline samples and rejects extra secret fields", async () => {
    await connect(db, { scopes: ["https://www.googleapis.com/auth/drive.file", "openid"] });
    const evidence = { apiVersion: "fixture-v3", endpoint: "files/export", measurementPeriod: "file_version", selectionPeriod: { start: "2026-10-01T00:00:00Z", end: "2026-10-31T00:00:00Z" } };
    await denied(db, () => resources(db, [resource({ evidence: { ...evidence, accessToken: "SECRET" } })]), "INVALID_INPUT");
    const result = await resources(db, [resource({ evidence })]);
    expect(result.resources[0]).toMatchObject({ sampleOnly: true, evidence });
    const thread = await studio(db, "create_thread", { title: "Sample adapter", topic: "creation" });
    const value = await rpc(db, "import", { id: connectionId, generation: 1, threadId: thread.id, revision: 0, resourceIds: [resourceId], question: "Evidence?", modelConsent: false, processingRights: true, shareRights: false });
    expect(value.sources[0].integration).toMatchObject({ sample_only: true, evidence });
  });

  it("revocation immediately erases buffered OAuth envelopes and invalidates completion", async () => {
    await connect(db);
    await rpc(db, "oauth_start", { stateHash: hash, sessionHash, provider: "google_drive", expiresAt: next(590), expectedGeneration: 1, returnPath: "/connections", secret: credential });
    await callback();
    await rpc(db, "revoke", { id: connectionId, generation: 1 });
    await denied(db, () => rpc(db, "oauth_complete", { ticketHash, provider: "google_drive", sessionHash, allowRelogin: true }), "OAUTH_STATE_INVALID");
    expect(await scalar(db, "select count(*)::int n from private.integration_pilot_oauth where secret is not null or code is not null")).toBe(0);
  });

  it("admits one refresh worker, fences versions, and makes expired/uncertain refresh require reauth", async () => {
    await live();
    const first = await rpc(db, "refresh_acquire", { id: connectionId, generation: 1, holderId: "worker-a", leaseSeconds: 30 });
    expect(first).toMatchObject({ status: "acquired", credentialVersion: 1, credential });
    expect(await rpc(db, "refresh_acquire", { id: connectionId, generation: 1, holderId: "worker-b" })).toEqual({ status: "busy" });
    await denied(db, () => rpc(db, "refresh_commit", { id: connectionId, generation: 1, leaseId: first.leaseId, credentialVersion: 99, credential, expiresAt: next(3600) }), "REFRESH_LEASE_STALE");
    expect(await rpc(db, "refresh_commit", { id: connectionId, generation: 1, leaseId: first.leaseId, credentialVersion: 1, credential: { ...credential, ciphertext: "ROTATED" }, expiresAt: next(3600) })).toEqual({ credentialVersion: 2 });
    const second = await rpc(db, "refresh_acquire", { id: connectionId, generation: 1, holderId: "worker-b" });
    await db.exec("update private.integration_refresh_leases set expires_at=clock_timestamp()-interval '1 second'");
    expect(await rpc(db, "refresh_acquire", { id: connectionId, generation: 1, holderId: "worker-c" })).toEqual({ status: "reauth_required" });
    await denied(db, () => rpc(db, "refresh_commit", { id: connectionId, generation: 1, leaseId: second.leaseId, credentialVersion: 2, credential, expiresAt: next(3600) }), "REAUTH_REQUIRED");
  });

  it("requires an existing refresh lease and non-null typed CAS fields before any credential mutation", async () => {
    await live();
    const payload = { id: connectionId, generation: 1, credential: { ...credential, ciphertext: "UNLEASED-WRITE" }, expiresAt: next(3600) };
    for (const action of ["refresh_commit", "refresh_abandon"]) {
      for (const fields of [{}, { leaseId: null, credentialVersion: null }, { leaseId: crypto.randomUUID(), credentialVersion: "1" }, { leaseId: 123, credentialVersion: 1 }, { leaseId: "not-a-uuid", credentialVersion: 1 }, { leaseId: crypto.randomUUID(), credentialVersion: 0 }, { leaseId: crypto.randomUUID(), credentialVersion: 2147483648 }]) {
        await denied(db, () => rpc(db, action, { ...payload, ...fields }), "INVALID_INPUT");
      }
      await denied(db, () => rpc(db, action, { ...payload, leaseId: crypto.randomUUID(), credentialVersion: 1 }), "REFRESH_LEASE_STALE");
    }
    expect((await rpc(db, "credentials", { id: connectionId, generation: 1 })).credential).toEqual(credential);
    const lease = await rpc(db, "refresh_acquire", { id: connectionId, generation: 1, holderId: "fixture" });
    await denied(db, () => rpc(db, "refresh_commit", { ...payload, leaseId: lease.leaseId, credentialVersion: null }), "INVALID_INPUT");
    expect(await rpc(db, "refresh_commit", { ...payload, leaseId: lease.leaseId, credentialVersion: lease.credentialVersion })).toEqual({ credentialVersion: 2 });
  });

  it.each(["purge", "revoke"])("an old Google %s cannot revoke a peer's subsequent authorization", async action => {
    const peerId = crypto.randomUUID(); await live(); await live(other, otherWs, peerId);
    await rpc(db, "revoke", { id: connectionId, generation: 1 });
    await rpc(db, "revoke_result", { id: connectionId, generation: 2, provider: "revoked" });
    const b = await rpc(db, "pilot_bind", binding({ id: peerId, generation: 3 }), undefined, other, otherWs);
    await rpc(db, "connect", { expectedGeneration: 2, bindingId: b.bindingId, credential, connection: connection({ id: peerId, creatorId: other, workspaceId: otherWs, generation: 3, sampleOnly: false }) }, undefined, other, otherWs);
    const lease = await rpc(db, "refresh_acquire", { id: peerId, generation: 3, holderId: "new-authorized-worker" }, undefined, other, otherWs);
    await rpc(db, action, { id: connectionId, ...(action === "revoke" ? { generation: 2 } : {}) });
    expect((await rpc(db, "export", {}, undefined, other, otherWs)).connections[0]).toMatchObject({ status: "connected", generation: 3, providerRevocation: "not_requested" });
    expect(await rpc(db, "refresh_commit", { id: peerId, generation: 3, leaseId: lease.leaseId, credentialVersion: lease.credentialVersion, credential, expiresAt: next(3600) }, undefined, other, otherWs)).toEqual({ credentialVersion: 2 });
  });

  it("appends newer observation evidence with identical metrics/hash while retaining immutable history", async () => {
    await connect(db, { provider: "instagram", scopes: ["instagram_business_basic", "instagram_business_manage_insights"] });
    const evidence = { apiVersion: "fixture-v1", endpoint: "media/insights", measurementPeriod: "lifetime", selectionPeriod: { start: "2026-10-01T00:00:00Z", end: "2026-10-31T00:00:00Z" } };
    const firstRow = resource({ evidence, fetchedAt: "2026-10-31T02:00:00Z" });
    const first = await resources(db, [firstRow]);
    const thread = await studio(db, "create_thread", { title: "Observed metrics", topic: "creation" });
    const imported = await rpc(db, "import", { id: connectionId, generation: 1, threadId: thread.id, revision: 0, resourceIds: [resourceId], question: "Observation?", modelConsent: false, processingRights: true, shareRights: false });
    const secondRow = { ...firstRow, fetchedAt: "2026-11-01T02:00:00Z", evidence: { ...evidence, selectionPeriod: { start: "2026-10-02T00:00:00Z", end: "2026-11-01T00:00:00Z" } } };
    const second = await resources(db, [secondRow]);
    expect(second.resources[0]).toMatchObject({ id: resourceId, contentHash: firstRow.contentHash, evidence: secondRow.evidence, fetchedAt: secondRow.fetchedAt });
    expect(second.resources[0].snapshotId).not.toBe(first.resources[0].snapshotId);
    expect((await resources(db, [secondRow])).resources[0].snapshotId).toBe(second.resources[0].snapshotId);
    await denied(db, () => resources(db, [{ ...secondRow, evidence: { ...secondRow.evidence, endpoint: "other/observation" } }]), "SOURCE_CHANGED");
    expect(await scalar(db, "select count(*)::int n from private.integration_pilot_evidence")).toBe(2);
    const old = (await db.query<{ data: Record<string, unknown> }>("select data from public.integration_snapshots where id=$1", [first.resources[0].snapshotId])).rows[0].data;
    expect(old).toMatchObject({ fetchedAt: firstRow.fetchedAt, evidence, contentHash: firstRow.contentHash });
    expect((await rpc(db, "source_refs", { sourceIds: [imported.sources[0].id] })).sources[0].integration.evidence).toEqual(evidence);
    await denied(db, () => db.exec("update public.integration_snapshots set data='{}'"), "IMMUTABLE_SNAPSHOT");
  });

  it("replays a Drive selection intent before mutating newer observation metadata", async () => {
    await connect(db);
    const row = resource({ fetchedAt: "2026-10-31T02:00:00Z", evidence: { apiVersion: "v3", endpoint: "drive/v3/files", measurementPeriod: "document_version" } });
    const payload = { id: connectionId, generation: 1, intent: { fileIds: [row.externalId] }, resources: [row] }, request = crypto.randomUUID();
    const first = await rpc(db, "resources", payload, request);
    const retry = { ...payload, resources: [{ ...row, fetchedAt: "2026-10-31T02:01:00Z" }] };
    expect(await rpc(db, "resources", retry, request)).toEqual(first);
    expect(await scalar(db, "select count(*)::int n from public.integration_snapshots")).toBe(1);
    expect(await scalar(db, "select count(*)::int n from private.integration_pilot_evidence")).toBe(1);
    expect((await db.query<{ data: Record<string, unknown> }>("select data from public.integration_resources where id=$1", [resourceId])).rows[0].data).toEqual(first.resources[0]);
    await denied(db, () => rpc(db, "resources", { ...retry, intent: { fileIds: ["different-file"] } }, request), "IDEMPOTENCY_CONFLICT");
    const second = await rpc(db, "resources", retry);
    expect(second.resources[0].snapshotId).not.toBe(first.resources[0].snapshotId);
    // A superseded observation must still invalidate the old cached result.
    await denied(db, () => rpc(db, "resources", retry, request), "SOURCE_UNAVAILABLE");
    expect(await scalar(db, "select count(*)::int n from private.integration_pilot_evidence")).toBe(2);
  });

  it("fans out Google revocation privately, blocks reconnect, and fences late refresh completion", async () => {
    const secondId = crypto.randomUUID(), separateId = crypto.randomUUID();
    await live(); await live(other, otherWs, secondId); await live(colleague, ws, separateId, { providerProjectId: "other-project" });
    const lease = await rpc(db, "refresh_acquire", { id: secondId, generation: 1, holderId: "worker" }, undefined, other, otherWs);
    const result = await rpc(db, "revoke", { id: connectionId, generation: 1 });
    expect(JSON.stringify(result)).not.toContain(secondId); expect(JSON.stringify(result)).not.toContain(otherWs);
    const rows = (await db.query<{ id: string; status: string; generation: number }>("select id,status,generation from public.integration_connections order by id")).rows;
    expect(rows.find(row => row.id === secondId)).toMatchObject({ status: "revoked", generation: 2 });
    expect(rows.find(row => row.id === separateId)?.status).toBe("connected");
    await denied(db, () => rpc(db, "refresh_commit", { id: secondId, generation: 1, leaseId: lease.leaseId, credentialVersion: 1, credential, expiresAt: next(3600) }, undefined, other, otherWs), "STALE_CONNECTION");
    await denied(db, () => rpc(db, "pilot_bind", binding({ generation: 3 })), "REVOCATION_PENDING");
    await rpc(db, "revoke_result", { id: connectionId, generation: 2, provider: "revoked" });
    expect((await rpc(db, "pilot_bind", binding({ generation: 3 }))).bindingId).toEqual(expect.any(String));
  });

  it("replays a live revoke idempotently and cannot purge a later grant by retrying an old purge", async () => {
    await live();
    const revokeRequest = crypto.randomUUID(), purgeRequest = crypto.randomUUID();
    const stopped = await rpc(db, "revoke", { id: connectionId, generation: 1 }, revokeRequest);
    expect(await rpc(db, "revoke", { id: connectionId, generation: 1 }, revokeRequest)).toEqual(stopped);
    await rpc(db, "revoke_result", { id: connectionId, generation: 2, provider: "revoked" });
    await rpc(db, "purge", { id: connectionId }, purgeRequest);
    const b = await rpc(db, "pilot_bind", binding({ generation: 3 }));
    await rpc(db, "connect", { expectedGeneration: 2, bindingId: b.bindingId, credential, connection: connection({ generation: 3, sampleOnly: false }) });
    expect(await rpc(db, "purge", { id: connectionId }, purgeRequest)).toEqual({ state: "complete" });
    expect((await rpc(db, "export", {})).connections[0].status).toBe("connected");
  });

  it("keeps every private table and callback RPC inaccessible to browser roles", async () => {
    for (const role of ["anon", "authenticated"]) {
      expect(await scalar(db, "select has_function_privilege($1,'public.integration_oauth_callback(text,text,text,jsonb,timestamptz)','execute')::int n", [role])).toBe(0);
      expect(await scalar(db, "select has_function_privilege($1,'public.integration_oauth_lookup(text,text)','execute')::int n", [role])).toBe(0);
      expect(await scalar(db, "select has_function_privilege($1,'public.integration_command(uuid,uuid,uuid,text,jsonb)','execute')::int n", [role])).toBe(0);
      expect(await scalar(db, "select count(*)::int n from pg_tables where schemaname='private' and tablename like 'integration_pilot%' and not rowsecurity")).toBe(0);
      expect(await scalar(db, "select has_table_privilege($1,'private.integration_pilot_bindings','select')::int n", [role])).toBe(0);
    }
    await denied(db, () => rpc(db, "pilot_bind", binding(), undefined, actor, otherWs), "NOT_FOUND");
  });
});
