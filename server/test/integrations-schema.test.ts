// @vitest-environment node
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { actor, colleague, connect, connection, connectionId, credential, denied, fixture, imported, other, otherWs, resource, resources, rpc, scalar, studio, ws } from "./helpers/integrations-fixture.js";

let db: PGlite;
let originalStudio: string;
let originalSettlement: unknown;
beforeAll(async () => { ({ db, originalStudio, originalSettlement } = await fixture()); }, 30000);
beforeEach(async () => { await db.exec("begin"); });
afterEach(async () => { await db.exec("rollback"); });
afterAll(async () => { await db.close(); });

describe("integration foundation SQL in memory", () => {
  it("installs a service-only entry point and preserves the original Studio and settlement bodies", async () => {
    expect((await db.query<{ rpc: string | null }>("select to_regprocedure('public.integration_command(uuid,uuid,uuid,text,jsonb)')::text rpc")).rows[0].rpc).not.toBeNull();
    expect((await db.query<{ prosrc: string }>("select prosrc from pg_proc where oid='private.studio_command_stage3(uuid,uuid,uuid,text,jsonb)'::regprocedure")).rows[0].prosrc).toBe(originalStudio);
    expect((await db.query("select pg_get_functiondef('private.studio_settlement_badge()'::regprocedure) definition")).rows[0]).toEqual(originalSettlement);
    await db.exec("set local role service_role");
    expect((await connect(db)).connection).toMatchObject({ id: connectionId, generation: 1 });
  });

  it("allows only an active creator in the supplied workspace, including on replay", async () => {
    const request = crypto.randomUUID(), payload = { connection: connection(), credential, expectedGeneration: 0 };
    await rpc(db, "connect", payload, request);
    for (const [owner, workspace] of [[actor, otherWs], [other, ws], [colleague, ws]]) {
      await denied(db, () => rpc(db, "credentials", { id: connectionId, generation: 1 }, undefined, owner, workspace), "NOT_FOUND");
    }
    await db.exec(`update public.creators set status='suspended' where id='${actor}'`);
    await denied(db, () => rpc(db, "connect", payload, request), "NOT_FOUND");
  });

  it("applies owner RLS and denies direct browser writes, all RPCs and private tables", async () => {
    await imported(db);
    await rpc(db, "reserve_sync", { id: connectionId, generation: 1 });
    for (const owner of [other, colleague, "00000000-0000-4000-8000-000000000099", actor]) {
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [owner]);
      await db.exec("set local role authenticated");
      for (const table of ["integration_connections", "integration_resources", "integration_snapshots", "integration_events", "integration_sync_runs"]) {
        expect(await scalar(db, `select count(*)::int n from public.${table}`)).toBe(owner === actor ? 1 : 0);
        await denied(db, () => db.exec(`delete from public.${table}`), "permission denied");
      }
      await denied(db, () => rpc(db, "export", {}), "permission denied");
      await denied(db, () => studio(db, "create_thread", { title: "forged", topic: "creation" }), "permission denied");
      for (const table of ["integration_credentials", "integration_commands", "integration_oauth_states", "integration_use_permits"]) {
        await denied(db, () => db.exec(`select * from private.${table}`), "permission denied");
      }
      await db.exec("reset role");
    }
    await db.exec("set local role anon");
    await denied(db, () => db.exec("select * from public.integration_connections"), "permission denied");
    await denied(db, () => rpc(db, "export", {}), "permission denied");
  });

  it("enforces composite ownership even on privileged inserts and imported source references", async () => {
    const { source } = await imported(db);
    await denied(db, () => db.query("insert into public.integration_connections(id,workspace_id,creator_id,provider,generation,status,data) values($1,$2,$3,'instagram',1,'connected','{}')", [crypto.randomUUID(), otherWs, actor]), "foreign key");
    await denied(db, () => db.query("update public.integration_resources set creator_id=$1 where connection_id=$2", [colleague, connectionId]), "foreign key");
    await denied(db, () => db.query("insert into public.integration_snapshots(connection_id,resource_id,workspace_id,creator_id,generation,data) select connection_id,resource_id,$1,creator_id,generation,data from public.integration_snapshots where connection_id=$2", [otherWs, connectionId]), "foreign key");
    await denied(db, () => db.query("update public.studio_sources set creator_id=$1 where id=$2", [colleague, source.id]), "foreign key");
  });

  it("caches only a full payload fingerprint and safe response, never encrypted envelopes", async () => {
    const request = crypto.randomUUID(), payload = { connection: connection(), credential, expectedGeneration: 0 };
    const first = await rpc(db, "connect", payload, request);
    expect(await rpc(db, "connect", payload, request)).toEqual(first);
    await denied(db, () => rpc(db, "connect", { ...payload, credential: { ...credential, ciphertext: "changed" } }, request), "IDEMPOTENCY_CONFLICT");
    await denied(db, () => rpc(db, "revoke", { id: connectionId, generation: 1 }, request), "IDEMPOTENCY_CONFLICT");
    const logs = JSON.stringify((await db.query("select to_jsonb(c) row from private.integration_commands c union all select to_jsonb(e) from public.integration_events e")).rows);
    expect(logs).not.toContain(credential.ciphertext);
    expect(logs).not.toContain("credential");
    expect(await scalar(db, "select count(*)::int n from private.integration_commands")).toBe(1);
  });

  it("keeps credential operations, source_refs, OAuth state and export out of result caches", async () => {
    const { source } = await imported(db);
    const before = await scalar(db, "select count(*)::int n from private.integration_commands");
    expect((await rpc(db, "credentials", { id: connectionId, generation: 1 })).credential).toEqual(credential);
    const changed = { ...credential, ciphertext: "OTHER-SYNTHETIC-CIPHERTEXT" };
    await rpc(db, "update_credentials", { id: connectionId, generation: 1, credential: changed, expiresAt: "2099-01-01T00:00:00Z" });
    expect((await rpc(db, "credentials", { id: connectionId, generation: 1 })).credential).toEqual(changed);
    expect((await rpc(db, "source_refs", { sourceIds: [source.id] })).sources).toEqual([source]);
    await denied(db, () => rpc(db, "source_refs", { sourceIds: [source.id] }, undefined, colleague), "NOT_FOUND");
    const exported = await rpc(db, "export", {});
    expect(JSON.stringify(exported)).not.toContain("CIPHERTEXT");
    expect(await scalar(db, "select count(*)::int n from private.integration_commands")).toBe(before);
  });

  it("rejects credentials hidden in safe DTOs rather than persisting them in public JSON", async () => {
    await denied(db, () => connect(db, { refreshToken: "synthetic-secret" }), "INVALID_INPUT");
    await connect(db);
    await denied(db, () => resources(db, [resource({ accessToken: "synthetic-secret" })]), "INVALID_INPUT");
    expect(await scalar(db, "select count(*)::int n from public.integration_resources")).toBe(0);
  });

  it("binds one-time OAuth state to session/provider/owner, expiry and safe return path", async () => {
    const payload = { stateHash: "a".repeat(64), sessionHash: "b".repeat(64), provider: "google_drive", expiresAt: new Date(Date.now() + 590000).toISOString(), returnPath: "/connections", expectedGeneration: 0 };
    await denied(db, () => rpc(db, "start", { ...payload, returnPath: "https://evil.invalid" }), "INVALID_INPUT");
    await denied(db, () => rpc(db, "start", { ...payload, expiresAt: "2099-01-01T00:00:00Z" }), "INVALID_INPUT");
    await rpc(db, "start", payload);
    const consume = { stateHash: payload.stateHash, sessionHash: payload.sessionHash, provider: payload.provider };
    await denied(db, () => rpc(db, "consume_state", { ...consume, sessionHash: "c".repeat(64) }), "OAUTH_STATE_INVALID");
    await denied(db, () => rpc(db, "consume_state", consume, undefined, colleague), "OAUTH_STATE_INVALID");
    await denied(db, () => rpc(db, "consume_state", { ...consume, provider: "instagram" }), "OAUTH_STATE_INVALID");
    expect(await rpc(db, "consume_state", consume)).toEqual({ expectedGeneration: 0, returnPath: "/connections" });
    await denied(db, () => rpc(db, "consume_state", consume), "OAUTH_STATE_INVALID");
    await rpc(db, "start", { ...payload, stateHash: "d".repeat(64) });
    await db.exec("update private.integration_oauth_states set expires_at=clock_timestamp()-interval '1 second'");
    await denied(db, () => rpc(db, "consume_state", { ...consume, stateHash: "d".repeat(64) }), "OAUTH_STATE_INVALID");
    expect(await scalar(db, "select count(*)::int n from private.integration_commands")).toBe(0);
  });

  it("fences late connections and subject changes by the current generation and revocation", async () => {
    await connect(db);
    await denied(db, () => connect(db, { subject: "another-subject", generation: 2 }, 1), "STALE_CONNECTION");
    await denied(db, () => connect(db, { generation: 2 }, 0), "STALE_CONNECTION");
    const second = await connect(db, { generation: 2 }, 1);
    expect(second.connection.generation).toBe(2);
    await denied(db, () => rpc(db, "credentials", { id: connectionId, generation: 1 }), "STALE_CONNECTION");
    await rpc(db, "revoke", { id: connectionId, generation: 2 });
    expect((await connect(db, { generation: 4, subject: "another-subject" }, 3)).connection.generation).toBe(4);
  });

  it("requires an encrypted envelope shape, never a raw token object", async () => {
    await denied(db, () => rpc(db, "connect", { connection: connection(), credential: { accessToken: "synthetic-raw", refreshToken: "synthetic-raw" }, expectedGeneration: 0 }), "INVALID_INPUT");
    await connect(db);
    await denied(db, () => rpc(db, "update_credentials", { id: connectionId, generation: 1, credential: { refreshToken: "synthetic-raw" }, expiresAt: "2099-01-01T00:00:00Z" }), "INVALID_INPUT");
    expect((await rpc(db, "credentials", { id: connectionId, generation: 1 })).credential).toEqual(credential);
  });

  it("rejects envelopes smuggled inside scalar DTO fields and returns content-free errors", async () => {
    await denied(db, () => connect(db, { label: credential }), "INVALID_INPUT");
    await connect(db);
    for (const field of ["title", "excerpt", "contentHash", "externalId", "version", "mimeType"]) {
      await denied(db, () => resources(db, [resource({ [field]: credential })]), "INVALID_INPUT");
    }
    await db.exec("savepoint error_details");
    try {
      await rpc(db, "resources", { id: "PRIVATE-INVALID-ID", generation: 1, resources: [] });
      expect.fail("invalid UUID must be rejected");
    } catch (error) {
      const emitted = error as Error & { detail?: string; hint?: string; where?: string };
      expect(emitted.message).toBe("INVALID_INPUT");
      // PGlite attaches the caller's original params client-side. Check only the
      // error fields emitted by PostgreSQL, which are what the RPC must sanitize.
      expect(JSON.stringify({ message: emitted.message, detail: emitted.detail, hint: emitted.hint, where: emitted.where })).not.toContain("PRIVATE-INVALID-ID");
    } finally { await db.exec("rollback to savepoint error_details"); }
    expect(await scalar(db, "select count(*)::int n from public.integration_resources")).toBe(0);
  });
});
