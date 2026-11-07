// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { actor, colleague, connection, connectionId, credential, denied, other, otherWs, pilotFixture, resource, resourceId, rpc, scalar, studio, ws } from "./integrations-pilot-fixture.js";

// A pre-verified mapping fixture, deliberately unrelated to the raw provider subject/user_id.
const mapping = { providerProjectId: "fixture-meta-project", subjectHash: "a".repeat(64) };
const notice = { ...mapping, receiptHash: "b".repeat(64), kind: "deauthorization" as const };
let db: PGlite;
type Scope = { creatorId: string; workspaceId: string; id: string; providerProjectId?: string; subjectHash?: string; provider?: "instagram" | "google_drive"; generation?: number; subject?: string };
async function bind(scope: Scope) {
  return rpc(db, "pilot_bind", { ...mapping, ...scope, generation: scope.generation ?? 1, provider: scope.provider ?? "instagram", environmentId: "fixture", databaseProjectId: "fixture-db", origin: "https://pilot.invalid", apiVersion: "fixture-v1" }, undefined, scope.creatorId, scope.workspaceId);
}
async function link(scope: Scope) {
  const b = await bind(scope), provider = scope.provider ?? "instagram", generation = scope.generation ?? 1;
  return rpc(db, "connect", { bindingId: b.bindingId, expectedGeneration: generation - 1, credential,
    connection: connection({ id: scope.id, creatorId: scope.creatorId, workspaceId: scope.workspaceId, provider, generation, subject: scope.subject ?? "fixture-IG-subject-NOT-ASID", sampleOnly: false, scopes: provider === "instagram" ? ["instagram_business_basic", "instagram_business_manage_insights"] : ["https://www.googleapis.com/auth/drive.file"] }) }, undefined, scope.creatorId, scope.workspaceId);
}
async function apply(input: Record<string, unknown> = notice) {
  return (await db.query<{ result: { confirmationCode: string; status: string } }>("select public.integration_provider_notice($1,$2,$3,$4) result", [input.providerProjectId, input.subjectHash, input.receiptHash, input.kind])).rows[0].result;
}
const own = { creatorId: actor, workspaceId: ws, id: connectionId };

describe("D0 mapped Instagram notice dispatch in in-memory SQL", () => {
  beforeAll(async () => { db = (await pilotFixture()).db; }, 30000);
  afterAll(async () => { await db?.close(); });
  beforeEach(async () => { await db.exec("begin"); });
  afterEach(async () => { await db.exec("rollback"); });

  it("atomically invalidates matching private IG bindings across owners and returns no identities", async () => {
    const second = { creatorId: other, workspaceId: otherWs, id: crypto.randomUUID() }, googleId = crypto.randomUUID();
    await link(own); await link(second); await link({ ...own, id: googleId, provider: "google_drive" });
    const lease = await rpc(db, "refresh_acquire", { id: connectionId, generation: 1, holderId: "fixture-worker" });
    const result = await apply();
    expect(result).toEqual({ confirmationCode: expect.stringMatching(/^[a-f0-9]{32}$/), status: "completed" });
    const rows = (await db.query<{ id: string; status: string; generation: number }>("select id,status,generation from public.integration_connections")).rows;
    expect(rows.find(row => row.id === connectionId)).toMatchObject({ status: "revoked", generation: 2 });
    expect(rows.find(row => row.id === second.id)).toMatchObject({ status: "revoked", generation: 2 });
    expect(rows.find(row => row.id === googleId)).toMatchObject({ status: "connected", generation: 1 });
    expect(await scalar(db, "select count(*)::int n from private.integration_credentials where connection_id<>$1", [googleId])).toBe(0);
    await denied(db, () => rpc(db, "refresh_commit", { id: connectionId, generation: 1, leaseId: lease.leaseId, credentialVersion: 1, credential, expiresAt: "2099-01-01T00:00:00Z" }), "STALE_CONNECTION");
    expect(JSON.stringify(result)).not.toMatch(new RegExp([actor, other, ws, otherWs, connectionId, mapping.subjectHash, mapping.providerProjectId].join("|")));
  });

  it.each([{ providerProjectId: "different-app" }, { subjectHash: "c".repeat(64) }])("does not resolve unrelated binding %j by a matching raw user_id", async mismatch => {
    await link(own);
    const untouched = { creatorId: colleague, workspaceId: ws, id: crypto.randomUUID(), ...mismatch };
    await link(untouched);
    await apply();
    expect((await rpc(db, "export", {}, undefined, colleague, ws)).connections[0]).toMatchObject({ id: untouched.id, status: "connected", generation: 1 });
  });

  it("purges matching private data and preserves canonical mission/reward state", async () => {
    await link(own);
    await rpc(db, "resources", { id: connectionId, generation: 1, resources: [resource({ sampleOnly: false })] });
    const thread = await studio(db, "create_thread", { title: "Notice fixture", topic: "creation" });
    await rpc(db, "import", { id: connectionId, generation: 1, threadId: thread.id, revision: 0, resourceIds: [resourceId], question: "Private fixture?", modelConsent: false, processingRights: true, shareRights: false });
    const result = await apply({ ...notice, kind: "deletion" });
    expect(result.status).toBe("completed");
    for (const table of ["integration_resources", "integration_snapshots", "studio_sources"]) expect(await scalar(db, `select count(*)::int n from public.${table}`)).toBe(0);
    expect(await scalar(db, "select count(*)::int n from private.integration_credentials")).toBe(0);
    expect((await db.query("select caption,revision from public.fixture_draft")).rows[0]).toEqual({ caption: "original", revision: 0 });
    expect(await scalar(db, "select count(*)::int n from public.point_transactions")).toBe(0);
    expect(await scalar(db, "select count(*)::int n from private.integration_pilot_tombstones where kind='purge'")).toBe(1);
  });

  it("replays the saved confirmation without revoking a later grant and rejects receipt-scope conflicts", async () => {
    await link(own); const first = await apply();
    await link({ ...own, generation: 3 });
    expect(await apply()).toEqual(first);
    expect((await rpc(db, "export", {})).connections[0]).toMatchObject({ status: "connected", generation: 3 });
    for (const changed of [{ kind: "deletion" }, { providerProjectId: "another-project" }, { subjectHash: "c".repeat(64) }]) {
      await denied(db, () => apply({ ...notice, ...changed }), "IDEMPOTENCY_CONFLICT");
    }
  });

  it("invalidates unfinished OAuth and a prepared binding before its first connection can land", async () => {
    const b = await bind(own), stateHash = "d".repeat(64), sessionHash = "e".repeat(64), ticketHash = "f".repeat(64);
    await rpc(db, "oauth_start", { provider: "instagram", stateHash, sessionHash, expiresAt: new Date(Date.now() + 590000).toISOString(), expectedGeneration: 0, returnPath: "/studio?thread=fixture", secret: credential });
    await db.query("select public.integration_oauth_callback($1,$2,$3,$4::jsonb,$5::timestamptz)", [stateHash, "instagram", ticketHash, JSON.stringify(credential), new Date(Date.now() + 290000).toISOString()]);
    await apply();
    await denied(db, () => rpc(db, "oauth_complete", { ticketHash, provider: "instagram", sessionHash, allowRelogin: true }), "OAUTH_STATE_INVALID");
    await denied(db, () => rpc(db, "connect", { bindingId: b.bindingId, expectedGeneration: 0, credential, connection: connection({ provider: "instagram", sampleOnly: false, scopes: ["instagram_business_basic", "instagram_business_manage_insights"] }) }), "SOURCE_UNAVAILABLE");
    expect(await scalar(db, "select count(*)::int n from private.integration_pilot_oauth where secret is not null or code is not null")).toBe(0);
  });

  it("rolls receipt, generation, binding and credential changes back together on a local failure", async () => {
    const second = { creatorId: other, workspaceId: otherWs, id: crypto.randomUUID() };
    await link(own); await link(second);
    await db.exec(`create function private.fixture_notice_failure() returns trigger language plpgsql as $$ begin if new.creator_id='${other}'::uuid and new.status='revoked' then raise exception 'NOTICE_FIXTURE_FAILURE'; end if; return new; end $$;
      create trigger fixture_notice_failure before update on public.integration_connections for each row execute function private.fixture_notice_failure()`);
    await denied(db, () => apply(), "NOTICE_FIXTURE_FAILURE");
    expect(await scalar(db, "select count(*)::int n from private.integration_pilot_notices")).toBe(0);
    expect(await scalar(db, "select count(*)::int n from public.integration_connections where status='connected' and generation=1")).toBe(2);
    expect(await scalar(db, "select count(*)::int n from private.integration_credentials")).toBe(2);
    expect(await scalar(db, "select count(*)::int n from private.integration_pilot_bindings where notice_invalidated_at is not null")).toBe(0);
    await db.exec("drop trigger fixture_notice_failure on public.integration_connections");
    expect((await apply()).status).toBe("completed");
  });

  it.each([false, true])("keeps other-account history intact and reports pending for shared connection lineage (current match=%s)", async currentMatches => {
    const otherHash = "c".repeat(64), oldResource = crypto.randomUUID();
    await link({ ...own, subjectHash: currentMatches ? otherHash : mapping.subjectHash, subject: "fixture-old-subject" });
    await rpc(db, "resources", { id: connectionId, generation: 1, resources: [resource({ id: oldResource, externalId: "old-file", sampleOnly: false })] });
    await rpc(db, "revoke", { id: connectionId, generation: 1 });
    await rpc(db, "revoke_result", { id: connectionId, generation: 2, provider: "revoked" });
    await link({ ...own, generation: 3, subjectHash: currentMatches ? mapping.subjectHash : otherHash, subject: "fixture-new-subject" });
    await rpc(db, "resources", { id: connectionId, generation: 3, resources: [resource({ generation: 3, sampleOnly: false })] });
    const result = await apply({ ...notice, kind: "deletion" });
    expect(result.status).toBe("pending");
    expect(await apply({ ...notice, kind: "deletion" })).toEqual(result);
    expect(await scalar(db, "select count(*)::int n from public.integration_snapshots")).toBe(2);
    expect((await rpc(db, "export", {})).connections[0].status).toBe(currentMatches ? "revoked" : "connected");
    expect(await scalar(db, "select count(*)::int n from private.integration_credentials")).toBe(currentMatches ? 0 : 1);
  });

  it("is service-only, rejects malformed input, and keeps private receipt scope out of user exports", async () => {
    for (const role of ["anon", "authenticated"]) {
      expect(await scalar(db, "select has_function_privilege($1,'public.integration_provider_notice(text,text,text,text)','execute')::int n", [role])).toBe(0);
      expect(await scalar(db, "select has_table_privilege($1,'private.integration_pilot_notices','select')::int n", [role])).toBe(0);
    }
    for (const bad of [{ receiptHash: "user_id" }, { subjectHash: "123456" }, { providerProjectId: "" }, { kind: "reconnect" }]) await denied(db, () => apply({ ...notice, ...bad }), "INVALID_INPUT");
    expect((await apply()).status).toBe("completed");
    expect(JSON.stringify(await rpc(db, "export", {}))).not.toMatch(/receiptHash|subjectHash|providerProjectId|confirmationCode/);
  });
});
