// @vitest-environment node
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { actor, briefPayload, colleague, connect, connectionId, credential, denied, fixture, imported, item, other, otherWs, permit, resource, resourceId, resources, rpc, scalar, sharePayload, studio, submission, ws } from "./helpers/integrations-fixture.js";
import type { Row } from "./helpers/integrations-fixture.js";
import { integrationServiceFixture } from "./helpers/integrations-service-fixture.js";

let db: PGlite;
beforeAll(async () => { ({ db } = await fixture()); }, 30000);
beforeEach(async () => { await db.exec("begin"); });
afterEach(async () => { await db.exec("rollback"); });
afterAll(async () => { await db.close(); });

describe("integration evidence and privacy SQL in memory", () => {
  it("keeps snapshots immutable, reuses identical versions, and distinguishes null from true zero", async () => {
    await connect(db);
    const first = await resources(db), second = await resources(db);
    expect(second.resources[0].snapshotId).toBe(first.resources[0].snapshotId);
    await resources(db, [resource({ version: "v2", excerpt: "NEW EXCERPT", contentHash: "new-hash" })]);
    const snapshots = (await db.query<{ data: { version: string; excerpt: string | null; metrics: Record<string, { value: number | null }> } }>("select data from public.integration_snapshots order by created_at,id")).rows;
    expect(snapshots).toHaveLength(2);
    const old = snapshots.find(row => row.data.version === "v1")!.data;
    expect(old.excerpt).toBe("PRIVATE-SOURCE-EXCERPT");
    expect(old.metrics.reach.value).toBeNull();
    expect(old.metrics.views.value).toBe(0);
    await denied(db, () => db.exec("update public.integration_snapshots set data='{}'"), "IMMUTABLE_SNAPSHOT");
  });

  it("rejects cross-owner resources, excess batches and provider reads without scopes", async () => {
    await connect(db);
    await denied(db, () => resources(db, [resource({ creatorId: colleague })]), "NOT_FOUND");
    await denied(db, () => resources(db, [resource({ workspaceId: otherWs })]), "NOT_FOUND");
    await denied(db, () => resources(db, [resource({ generation: 0 })]), "STALE_CONNECTION");
    await denied(db, () => resources(db, Array.from({ length: 51 }, () => resource({ id: crypto.randomUUID() }))), "INVALID_INPUT");
    await connect(db, { generation: 2, scopes: [], status: "partial" }, 1);
    await denied(db, () => rpc(db, "resources", { id: connectionId, generation: 2, resources: [] }), "SCOPE_REQUIRED");
  });

  it("imports nullable actual coverage and explicit rights once per snapshot/thread", async () => {
    const { source, thread, payload, snapshotId } = await imported(db, { import: { modelConsent: false, processingRights: true, shareRights: false } });
    expect(source).toMatchObject({ kind: "private", status: "unverified", region: null, language: null, shareable: false, integration: { snapshot_id: snapshotId, model_allowed: false, generation: 1, provenance: "google_drive" } });
    expect((await rpc(db, "import", { ...payload, revision: 1 })).sources[0].id).toBe(source.id);
    expect(await scalar(db, "select count(*)::int n from public.studio_sources")).toBe(1);
    expect(await scalar(db, "select revision n from public.studio_threads where id=$1", [thread.id])).toBe(1);
    await denied(db, () => permit(db, [source.id], "model"), "MODEL_CONSENT_REQUIRED");
    await denied(db, () => permit(db, [source.id], "share", { any: "payload" }), "SOURCE_PRIVATE");
    await denied(db, () => rpc(db, "import", { ...payload, revision: 1, question: "x".repeat(501) }), "INVALID_INPUT");
    await denied(db, () => rpc(db, "import", { ...payload, revision: 1, resourceIds: Array(6).fill(resourceId) }), "INVALID_INPUT");
  });

  it("never treats unknown ownership as permission to share and rejects unselected/unavailable sources", async () => {
    const { source, payload } = await imported(db, { resource: { rights: "unknown" } });
    expect(source.shareable).toBe(false);
    await resources(db, [resource({ selected: false, rights: "unknown" })]);
    await denied(db, () => rpc(db, "import", { ...payload, revision: 1 }), "SOURCE_UNAVAILABLE");
    await denied(db, () => permit(db, [source.id], "save_brief", {}), "SOURCE_UNAVAILABLE");
  });

  it("preserves the 8000-character and 100-source limits atomically", async () => {
    const { thread, source, payload } = await imported(db);
    await denied(db, () => resources(db, [resource({ excerpt: "x".repeat(8001), version: "large" })]), "INVALID_INPUT");
    await resources(db, [resource({ version: "v2", contentHash: "v2", excerpt: "next" })]);
    await db.query(`insert into public.studio_sources(thread_id,workspace_id,creator_id,title,content,kind,question,platform,region,language,observed_at)
      select $1,$2,$3,'manual','content','manual','question','manual','HK','zh-Hant',now() from generate_series(1,99)`, [thread.id, ws, actor]);
    await denied(db, () => rpc(db, "import", { ...payload, revision: 1 }), "SOURCE_LIMIT");
    expect(await scalar(db, "select count(*)::int n from public.studio_sources")).toBe(100);
    expect(await scalar(db, "select revision n from public.studio_threads where id=$1", [thread.id])).toBe(1);
    expect(source.integration.generation).toBe(1);
  });

  it("cannot forge provider imports through add_source or widen manual coverage", async () => {
    const { thread, source } = await imported(db);
    const manual = { threadId: thread.id, revision: 1, title: "note", content: "user text", question: "why", platform: "manual", region: "HK", language: "zh-Hant", observed_at: "2026-10-31T00:00:00Z", kind: "manual", shareable: true };
    await denied(db, () => studio(db, "add_source", { ...manual, integration: source.integration }), "INVALID_INPUT");
    await denied(db, () => studio(db, "add_source", { ...manual, platform: "google_drive" }), "INVALID_INPUT");
    await denied(db, () => studio(db, "add_source", { ...manual, region: null, language: null }), "UNSUPPORTED_COVERAGE");
    expect(await studio(db, "add_source", manual)).toMatchObject({ region: "HK", language: "zh-Hant", integration: null });
  });

  it("requires a 60-second payload-bound single-use permit for saving provider-derived sections", async () => {
    const { thread, source } = await imported(db);
    const payload = briefPayload(thread.id, source.id);
    await denied(db, () => studio(db, "save_brief", payload), "SOURCE_UNAVAILABLE");
    const issued = await permit(db, [source.id], "save_brief", payload);
    expect(issued.permits[0]).toMatchObject({ sourceId: source.id, generation: 1, snapshotId: source.integration.snapshot_id, use: "save_brief" });
    expect(await scalar(db, "select extract(epoch from (expires_at-created_at))::int n from private.integration_use_permits")).toBe(60);
    await denied(db, () => studio(db, "save_brief", { ...payload, sections: [{ ...payload.sections[0], text: "changed" }] }), "SOURCE_UNAVAILABLE");
    const key = crypto.randomUUID(), saved = await studio(db, "save_brief", payload, key);
    expect(await studio(db, "save_brief", payload, key)).toEqual(saved);
    expect(await scalar(db, "select count(*)::int n from private.integration_use_permits where consumed_at is not null")).toBe(1);
    await denied(db, () => studio(db, "save_brief", briefPayload(thread.id, source.id, 2)), "SOURCE_UNAVAILABLE");
    const next = briefPayload(thread.id, source.id, 2);
    await permit(db, [source.id], "save_brief", next);
    await db.exec("update private.integration_use_permits set expires_at=clock_timestamp()-interval '1 second' where consumed_at is null");
    await denied(db, () => studio(db, "save_brief", next), "SOURCE_UNAVAILABLE");
  });

  it("rejects mismatched thread sources and retains paragraph lineage", async () => {
    const { thread, source } = await imported(db);
    const payload = briefPayload(thread.id, source.id);
    await permit(db, [source.id], "save_brief", payload);
    await studio(db, "save_brief", payload);
    await denied(db, () => studio(db, "save_brief", { threadId: thread.id, revision: 2, sections: [{ id: "hook", text: "edited", sourceIds: [] }] }), "SOURCE_LINEAGE_REQUIRED");
    const otherThread = await studio(db, "create_thread", { title: "another thread", topic: "creation" });
    const forged = briefPayload(otherThread.id, source.id, 0);
    await permit(db, [source.id], "save_brief", forged);
    await denied(db, () => studio(db, "save_brief", forged), "SOURCE_UNAVAILABLE");
  });

  it("shares actual coverage with a scoped receipt, never full excerpts, and does not settle rewards", async () => {
    const { thread, source } = await imported(db);
    const save = briefPayload(thread.id, source.id);
    await permit(db, [source.id], "save_brief", save);
    const brief = await studio(db, "save_brief", save);
    const share = sharePayload(thread.id, brief.id);
    await denied(db, () => studio(db, "share_brief", share), "SOURCE_UNAVAILABLE");
    await permit(db, [source.id], "share", share);
    await denied(db, () => studio(db, "share_brief", { ...share, recipient: "public" }), "INVALID_INPUT");
    await denied(db, () => studio(db, "share_brief", { ...share, draftRevision: 1 }), "SOURCE_UNAVAILABLE");
    const key = crypto.randomUUID(), receipt = await studio(db, "share_brief", share, key);
    expect(await studio(db, "share_brief", share, key)).toEqual(receipt);
    expect(receipt).toMatchObject({ recipient: "task_review", draft_revision: 1, integration_receipt: { brief_id: brief.id, brief_version: 1, section_ids: ["hook"], submission_id: submission, work_item_id: item, recipient: "task_review" } });
    expect(receipt.integration_receipt.sources[0]).toMatchObject({ snapshot_id: source.integration.snapshot_id, generation: 1, content_hash: source.integration.content_hash, consent_version: "mock-v1" });
    const draft = (await db.query<{ caption: string }>("select caption from public.fixture_draft")).rows[0];
    expect(draft.caption).toContain("未驗證");
    expect(draft.caption).not.toContain("HK / 繁中");
    expect(draft.caption).not.toContain("PRIVATE-SOURCE-EXCERPT");
    expect(await scalar(db, "select count(*)::int n from public.point_transactions")).toBe(0);
    expect(await scalar(db, "select count(*)::int n from public.studio_badges")).toBe(0);
  });

  it("rolls back permit consumption on a canonical draft revision conflict", async () => {
    const { thread, source } = await imported(db);
    const save = briefPayload(thread.id, source.id);
    await permit(db, [source.id], "save_brief", save);
    const brief = await studio(db, "save_brief", save);
    const share = { ...sharePayload(thread.id, brief.id), draftRevision: 9 };
    await permit(db, [source.id], "share", share);
    await denied(db, () => studio(db, "share_brief", share), "WORKFLOW_STALE");
    expect(await scalar(db, "select count(*)::int n from private.integration_use_permits where use_kind='share' and consumed_at is null")).toBe(1);
    expect(await scalar(db, "select count(*)::int n from public.studio_shares")).toBe(0);
    expect(await scalar(db, "select revision n from public.fixture_draft")).toBe(0);
  });

  it("revocation fences cached data, pending OAuth, permits and late assistant results immediately", async () => {
    const { thread, source } = await imported(db);
    const syncRequest = crypto.randomUUID();
    await resources(db, [resource()], syncRequest);
    const pendingState = { stateHash: "e".repeat(64), sessionHash: "f".repeat(64), provider: "google_drive", expiresAt: new Date(Date.now() + 500000).toISOString(), returnPath: "/connections", expectedGeneration: 1 };
    await rpc(db, "start", pendingState);
    const save = briefPayload(thread.id, source.id);
    await permit(db, [source.id], "save_brief", save);
    const modelRequest = crypto.randomUUID();
    await db.query("select public.reserve_assistant_request($1,$2,$3,'user input','zh-HK',$4,'studio:old')", [ws, actor, modelRequest, thread.conversation_id]);
    await db.query("select public.claim_assistant_request($1,$2,$3)", [ws, actor, modelRequest]);
    const revoked = await rpc(db, "revoke", { id: connectionId, generation: 1 });
    expect(revoked.connection).toMatchObject({ generation: 2, status: "revoked" });
    await denied(db, () => resources(db, [resource()], syncRequest), "STALE_CONNECTION");
    await denied(db, () => rpc(db, "credentials", { id: connectionId, generation: 1 }), "STALE_CONNECTION");
    await denied(db, () => rpc(db, "credentials", { id: connectionId, generation: 2 }), "SOURCE_UNAVAILABLE");
    await denied(db, () => rpc(db, "consume_state", pendingState), "OAUTH_STATE_INVALID");
    await denied(db, () => studio(db, "save_brief", save), "SOURCE_UNAVAILABLE");
    await denied(db, () => db.query("select public.save_assistant_turn($1,$2,$3,'late private result','[]')", [ws, actor, modelRequest]), "outcome_unknown");
    expect((await db.query<{ message: string }>("select message from public.assistant_requests")).rows[0].message).toBe("user input");
    expect(await scalar(db, "select count(*)::int n from private.integration_use_permits where revoked_at is not null")).toBe(1);
    await connect(db, { generation: 3 }, 2);
    await denied(db, () => permit(db, [source.id], "model"), "SOURCE_UNAVAILABLE");
  });

  it("keeps revocation credentials inaccessible and erases them on result or bounded expiry", async () => {
    await connect(db);
    await rpc(db, "revoke", { id: connectionId, generation: 1 });
    await rpc(db, "revoke_result", { id: connectionId, generation: 2, provider: "pending" });
    expect(await scalar(db, "select count(*)::int n from private.integration_credentials")).toBe(1);
    await rpc(db, "expire", { now: new Date(Date.now() + 25 * 3600000).toISOString() });
    expect(await scalar(db, "select count(*)::int n from private.integration_credentials")).toBe(0);
    expect((await rpc(db, "export", {})).connections[0].providerRevocation).toBe("manual_action");
    await connect(db, { generation: 3 }, 2);
    await denied(db, () => rpc(db, "revoke_result", { id: connectionId, generation: 2, provider: "revoked" }), "STALE_CONNECTION");
    expect(await scalar(db, "select count(*)::int n from private.integration_credentials")).toBe(1);
    await rpc(db, "revoke", { id: connectionId, generation: 3 });
    await rpc(db, "revoke_result", { id: connectionId, generation: 4, provider: "revoked" });
    expect(await scalar(db, "select count(*)::int n from private.integration_credentials")).toBe(0);
  });

  it("purges source-derived content and caches while retaining user input, delivered copies and minimal receipts", async () => {
    const { thread, source } = await imported(db);
    const save = briefPayload(thread.id, source.id);
    await permit(db, [source.id], "save_brief", save);
    const brief = await studio(db, "save_brief", save);
    const share = sharePayload(thread.id, brief.id);
    await permit(db, [source.id], "share", share);
    const receipt = await studio(db, "share_brief", share);
    await studio(db, "add_source", { threadId: thread.id, revision: 3, title: "my note", content: "KEEP-MANUAL", question: "why", platform: "manual", region: "HK", language: "zh-Hant", observed_at: "2026-10-31T00:00:00Z", kind: "manual" });
    await db.query("insert into public.assistant_messages(conversation_id,role,content,citations) values($1,'user','KEEP-USER-INPUT','[]'),($1,'assistant','PRIVATE-ASSISTANT',$2)", [thread.conversation_id, JSON.stringify([{ sourceRef: source.id, sourceType: "integration_mock_unverified" }])]);
    const key = crypto.randomUUID();
    expect(await rpc(db, "purge", { id: connectionId }, key)).toEqual({ state: "complete" });
    expect(await rpc(db, "purge", { id: connectionId }, key)).toEqual({ state: "complete" });
    for (const table of ["integration_resources", "integration_snapshots"]) expect(await scalar(db, `select count(*)::int n from public.${table}`)).toBe(0);
    expect(await scalar(db, "select count(*)::int n from private.integration_credentials")).toBe(0);
    expect((await db.query("select content from public.studio_sources")).rows).toEqual([{ content: "KEEP-MANUAL" }]);
    expect((await db.query("select content from public.assistant_messages where role='user'")).rows).toEqual([{ content: "KEEP-USER-INPUT" }]);
    expect(await scalar(db, "select count(*)::int n from public.studio_shares where id=$1", [receipt.id])).toBe(1);
    const retained = JSON.stringify((await db.query(`select to_jsonb(t) data from public.studio_briefs t union all select to_jsonb(t) from public.studio_shares t
      union all select to_jsonb(t) from public.studio_commands t union all select to_jsonb(t) from private.integration_commands t
      union all select to_jsonb(t) from public.assistant_messages t union all select to_jsonb(t) from public.integration_events t`)).rows);
    for (const secret of ["PRIVATE-SOURCE-EXCERPT", "DERIVED-PRIVATE-PARAGRAPH", "PRIVATE-ASSISTANT", "SYNTHETIC-CIPHERTEXT"]) expect(retained).not.toContain(secret);
    expect((await db.query<{ caption: string }>("select caption from public.fixture_draft")).rows[0].caption).toContain("DERIVED-PRIVATE-PARAGRAPH");
    expect(await scalar(db, "select count(*)::int n from public.point_transactions")).toBe(0);
  });

  it("expires only the actor's unreferenced snapshots and does not remove saved evidence", async () => {
    const { source } = await imported(db);
    await resources(db, [resource({ version: "v2", contentHash: "v2" })]);
    await rpc(db, "connect", { connection: { ...(await rpc(db, "export", {})).connections[0], id: crypto.randomUUID(), creatorId: other, workspaceId: otherWs, generation: 1 }, credential, expectedGeneration: 0 }, undefined, other, otherWs);
    await rpc(db, "expire", { now: new Date(Date.now() + 31 * 86400000).toISOString() });
    expect(await scalar(db, "select count(*)::int n from public.integration_snapshots")).toBe(1);
    expect((await rpc(db, "source_refs", { sourceIds: [source.id] })).sources).toHaveLength(1);
    expect(await scalar(db, "select count(*)::int n from private.integration_credentials where creator_id=$1", [other])).toBe(1);
  });

  it("account deletion cancels integration work and erases private caches without changing the ledger", async () => {
    await imported(db);
    await db.query("insert into public.point_transactions(creator_id,workspace_id,type,delta,source_ref) values($1,$2,'earn',7,'existing-ledger')", [actor, ws]);
    await db.exec(`update public.creators set status='deleted' where id='${actor}'`);
    for (const table of ["integration_resources", "integration_snapshots", "studio_sources"]) expect(await scalar(db, `select count(*)::int n from public.${table}`)).toBe(0);
    for (const table of ["integration_credentials", "integration_oauth_states", "integration_commands", "integration_use_permits"]) expect(await scalar(db, `select count(*)::int n from private.${table}`)).toBe(0);
    expect(await scalar(db, "select sum(delta)::int n from public.point_transactions")).toBe(7);
    await denied(db, () => rpc(db, "export", {}), "NOT_FOUND");
  });

  it("durably reserves sync once, replays safely and enforces cooldown for new requests", async () => {
    await connect(db);
    const request = crypto.randomUUID(), payload = { id: connectionId, generation: 1 };
    expect(await rpc(db, "reserve_sync", payload, request)).toEqual({ action: "reserved" });
    expect(await rpc(db, "reserve_sync", payload, request)).toEqual({ action: "pending" });
    await denied(db, () => rpc(db, "reserve_sync", { ...payload, generation: 2 }, request), "IDEMPOTENCY_CONFLICT");
    const synced = await resources(db);
    const result = { status: "completed", resources: synced.resources };
    await rpc(db, "finish_sync", { ...payload, runRequestId: request, result });
    expect(await rpc(db, "reserve_sync", payload, request)).toEqual({ action: "replay", result });
    await denied(db, () => rpc(db, "reserve_sync", payload), "RATE_LIMITED");
    await rpc(db, "revoke", payload);
    await denied(db, () => rpc(db, "reserve_sync", payload, request), "STALE_CONNECTION");
  });

  it("never restarts an unknown sync automatically and rejects late or foreign completions", async () => {
    await connect(db);
    const request = crypto.randomUUID(), payload = { id: connectionId, generation: 1 };
    await rpc(db, "reserve_sync", payload, request);
    await rpc(db, "fail_sync", { ...payload, runRequestId: request });
    expect(await rpc(db, "reserve_sync", payload, request)).toEqual({ action: "pending" });
    const next = crypto.randomUUID();
    expect(await rpc(db, "reserve_sync", payload, next)).toEqual({ action: "reserved" });
    await denied(db, () => rpc(db, "finish_sync", { ...payload, runRequestId: next, result: { status: "completed", resources: [] } }, undefined, colleague), "NOT_FOUND");
    await rpc(db, "revoke", payload);
    await denied(db, () => rpc(db, "finish_sync", { ...payload, runRequestId: next, result: { status: "completed", resources: [] } }), "STALE_CONNECTION");
    expect(await scalar(db, "select count(*)::int n from public.integration_sync_runs where result is not null")).toBe(0);
  });

  it("requires and consumes a request-bound model permit at assistant persistence", async () => {
    const { thread, source } = await imported(db), request = crypto.randomUUID();
    const citations = [{ sourceRef: source.id, sourceType: "integration_mock_unverified", title: "chosen source" }];
    await db.query("select public.reserve_assistant_request($1,$2,$3,'model question','zh-HK',$4,'studio:provider')", [ws, actor, request, thread.conversation_id]);
    await db.query("select public.claim_assistant_request($1,$2,$3)", [ws, actor, request]);
    const save = () => db.query("select public.save_assistant_turn($1,$2,$3,'MODEL-DERIVED-ANSWER',$4) result", [ws, actor, request, JSON.stringify(citations)]);
    await denied(db, save, "SOURCE_UNAVAILABLE");
    await permit(db, [source.id], "model", { requestId: crypto.randomUUID() });
    await denied(db, save, "SOURCE_UNAVAILABLE");
    await permit(db, [source.id], "model", { requestId: request });
    await db.exec("update private.integration_use_permits set expires_at=clock_timestamp()-interval '1 second'");
    await denied(db, save, "SOURCE_UNAVAILABLE");
    await permit(db, [source.id], "model", { requestId: request });
    const first = await save();
    expect((await save()).rows).toEqual(first.rows);
    expect(await scalar(db, "select count(*)::int n from public.assistant_messages where role='assistant'")).toBe(1);
    expect(await scalar(db, "select count(*)::int n from private.integration_use_permits where consumed_at is not null")).toBe(1);
    await rpc(db, "revoke", { id: connectionId, generation: 1 });
    await denied(db, save, "SOURCE_UNAVAILABLE");
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [actor]);
    const replay = (await db.query("select public.get_assistant_request($1,$2) result", [ws, request])).rows;
    expect(JSON.stringify(replay)).not.toContain("MODEL-DERIVED-ANSWER");
  });

  it("rejects stripping provider citations from a request that obtained model authorization", async () => {
    const { thread, source } = await imported(db), request = crypto.randomUUID();
    await db.query("select public.reserve_assistant_request($1,$2,$3,'model question','zh-HK',$4,'studio:provider')", [ws, actor, request, thread.conversation_id]);
    await db.query("select public.claim_assistant_request($1,$2,$3)", [ws, actor, request]);
    await permit(db, [source.id], "model", { requestId: request });
    await denied(db, () => db.query("select public.save_assistant_turn($1,$2,$3,'stripped answer','[]')", [ws, actor, request]), "SOURCE_LINEAGE_REQUIRED");
    expect(await scalar(db, "select count(*)::int n from public.assistant_messages")).toBe(0);
  });

  it("preserves manual-only assistant persistence and exact saved-request replay without permits", async () => {
    const thread = await studio(db, "create_thread", { title: "manual", topic: "creation" }), request = crypto.randomUUID();
    await db.query("select public.reserve_assistant_request($1,$2,$3,'manual question','zh-HK',$4,'studio:manual')", [ws, actor, request, thread.conversation_id]);
    await db.query("select public.claim_assistant_request($1,$2,$3)", [ws, actor, request]);
    const args = [ws, actor, request, "manual answer", JSON.stringify([{ sourceRef: "manual-note" }])];
    const query = "select public.save_assistant_turn($1,$2,$3,$4,$5) result";
    expect((await db.query(query, args)).rows).toEqual((await db.query(query, args)).rows);
    await denied(db, () => db.query(query, [...args.slice(0, 3), "different", args[4]]), "IDEMPOTENCY_CONFLICT");
    expect(await scalar(db, "select count(*)::int n from private.integration_use_permits")).toBe(0);
  });

  it("keys Drive retries to selection intent rather than regenerated records and fetch times", async () => {
    await connect(db);
    const request = crypto.randomUUID(), intent = { fileIds: ["synthetic-file"] };
    const first = await rpc(db, "resources", { id: connectionId, generation: 1, intent, resources: [resource()] }, request);
    expect(await rpc(db, "resources", { id: connectionId, generation: 1, intent, resources: [resource({ id: crypto.randomUUID(), fetchedAt: "2026-11-01T00:00:00Z" })] }, request)).toEqual(first);
    await denied(db, () => rpc(db, "resources", { id: connectionId, generation: 1, intent: { fileIds: ["changed"] }, resources: [resource()] }, request), "IDEMPOTENCY_CONFLICT");
    expect(await scalar(db, "select count(*)::int n from public.integration_resources")).toBe(1);
  });

  it("reuses unchanged snapshot lineage across new fetch timestamps and explicit selection requests", async () => {
    const { source, payload, snapshotId } = await imported(db);
    const later = await resources(db, [resource({ fetchedAt: "2026-11-01T00:00:00Z" })]);
    expect(later.resources[0].snapshotId).toBe(snapshotId);
    expect((await rpc(db, "import", { ...payload, revision: 1 })).sources[0].id).toBe(source.id);
    expect(await scalar(db, "select count(*)::int n from public.studio_sources")).toBe(1);
    expect(await scalar(db, "select count(*)::int n from public.integration_snapshots")).toBe(1);
  });

  it("permits a fresh explicit import after source revocation without restoring the old consent", async () => {
    const { source, thread, payload } = await imported(db, { import: { modelConsent: false, shareRights: false } });
    await studio(db, "revoke_source", { threadId: thread.id, revision: 1, sourceId: source.id });
    const again = await rpc(db, "import", { ...payload, revision: 2, modelConsent: true, shareRights: true });
    expect(again.sources[0].id).not.toBe(source.id);
    expect(again.sources[0]).toMatchObject({ shareable: true, integration: { model_allowed: true } });
    expect(await scalar(db, "select count(*)::int n from public.studio_sources where revoked_at is null")).toBe(1);
    await denied(db, () => permit(db, [source.id], "model", { requestId: crypto.randomUUID() }), "SOURCE_UNAVAILABLE");
  });

  it("does not replay a completed sync after the resource permission becomes unavailable", async () => {
    await connect(db);
    const request = crypto.randomUUID(), payload = { id: connectionId, generation: 1 };
    await rpc(db, "reserve_sync", payload, request);
    const synced = await resources(db);
    await rpc(db, "finish_sync", { ...payload, runRequestId: request, result: { status: "completed", resources: synced.resources } });
    await resources(db, [resource({ availability: "revoked", canDownload: false, excerpt: null })]);
    await denied(db, () => rpc(db, "reserve_sync", payload, request), "SOURCE_UNAVAILABLE");
  });

  it("scrubs expired resource results from both idempotency and sync caches and preserves ownership", async () => {
    await connect(db);
    const request = crypto.randomUUID(), payload = { id: connectionId, generation: 1 };
    await rpc(db, "reserve_sync", payload, request);
    const synced = await resources(db);
    await rpc(db, "finish_sync", { ...payload, runRequestId: request, result: { status: "completed", resources: synced.resources } });
    await rpc(db, "expire", { now: new Date(Date.now() + 31 * 86400000).toISOString() });
    const retained = JSON.stringify((await db.query("select to_jsonb(t) data from public.integration_resources t union all select to_jsonb(t) from private.integration_commands t union all select to_jsonb(t) from public.integration_sync_runs t")).rows);
    expect(retained).not.toContain("PRIVATE-SOURCE-EXCERPT");
    expect(await rpc(db, "reserve_sync", payload, request)).toEqual({ action: "pending" });
    await rpc(db, "revoke", payload);
    await rpc(db, "purge", { id: connectionId });
    expect((await rpc(db, "export", {})).connections[0].providerRevocation).toBe("manual_action");
  });

  it("retains model-request lineage after permit expiry cleanup so a stripped late answer cannot land", async () => {
    const { thread, source } = await imported(db), request = crypto.randomUUID();
    await db.query("select public.reserve_assistant_request($1,$2,$3,'model question','zh-HK',$4,'studio:provider')", [ws, actor, request, thread.conversation_id]);
    await db.query("select public.claim_assistant_request($1,$2,$3)", [ws, actor, request]);
    await permit(db, [source.id], "model", { requestId: request });
    await rpc(db, "expire", { now: new Date(Date.now() + 120000).toISOString() });
    await denied(db, () => db.query("select public.save_assistant_turn($1,$2,$3,'stripped late result','[]')", [ws, actor, request]), "SOURCE_LINEAGE_REQUIRED");
    expect(await scalar(db, "select count(*)::int n from public.assistant_messages")).toBe(0);
  });

  it("rejects a different creator's provider citation even if its sourceType is forged as manual", async () => {
    const { source } = await imported(db), request = crypto.randomUUID();
    const conversation = crypto.randomUUID();
    await db.query("insert into public.assistant_conversations(id,creator_id,workspace) values($1,$2,$3)", [conversation, colleague, ws]);
    await db.query("select public.reserve_assistant_request($1,$2,$3,'forged question','zh-HK',$4,'studio:forged')", [ws, colleague, request, conversation]);
    await db.query("select public.claim_assistant_request($1,$2,$3)", [ws, colleague, request]);
    await denied(db, () => db.query("select public.save_assistant_turn($1,$2,$3,'forged result',$4)", [ws, colleague, request, JSON.stringify([{ sourceRef: source.id, sourceType: "manual" }])]), "SOURCE_UNAVAILABLE");
  });

  it("preserves manual Studio sharing, canonical draft revisions and unique settlement badges with Stage 4 installed", async () => {
    const thread = await studio(db, "create_thread", { title: "manual task", topic: "creation" });
    const source = await studio(db, "add_source", { threadId: thread.id, revision: 0, title: "manual note", content: "manual evidence", question: "why", platform: "manual", region: "HK", language: "zh-Hant", observed_at: "2026-10-31T00:00:00Z", kind: "manual", shareable: true });
    const brief = await studio(db, "save_brief", briefPayload(thread.id, source.id));
    const payload = sharePayload(thread.id, brief.id), request = crypto.randomUUID();
    const receipt = await studio(db, "share_brief", payload, request);
    expect(await studio(db, "share_brief", payload, request)).toEqual(receipt);
    expect(await scalar(db, "select revision n from public.fixture_draft")).toBe(1);
    expect((await db.query<{ caption: string }>("select caption from public.fixture_draft")).rows[0].caption).toContain("HK / 繁中");
    expect(await scalar(db, "select count(*)::int n from public.studio_badges")).toBe(0);
    await db.query("insert into public.mission_pending_rewards values($1,$2,$3,'pending',$1)", [submission, actor, ws]);
    await db.exec("update public.mission_pending_rewards set status='settled'; update public.mission_pending_rewards set status='settled'");
    expect(await scalar(db, "select count(*)::int n from public.studio_badges")).toBe(1);
    expect(await scalar(db, "select count(*)::int n from public.point_transactions")).toBe(0);
  });

  it("keeps purge receipts idempotent across later purge requests and reconnection", async () => {
    await connect(db);
    const first = crypto.randomUUID();
    await rpc(db, "purge", { id: connectionId }, first);
    await rpc(db, "purge", { id: connectionId });
    await connect(db, { generation: 3 }, 2);
    expect(await rpc(db, "purge", { id: connectionId }, first)).toEqual({ state: "complete" });
    expect((await rpc(db, "export", {})).connections[0].status).toBe("connected");
    expect(await scalar(db, "select count(*)::int n from private.integration_credentials")).toBe(1);
  });

  it("stops completed assistant replay after revoking only its imported source", async () => {
    const { thread, source } = await imported(db), request = crypto.randomUUID();
    await db.query("select public.reserve_assistant_request($1,$2,$3,'model question','zh-HK',$4,'studio:provider')", [ws, actor, request, thread.conversation_id]);
    await db.query("select public.claim_assistant_request($1,$2,$3)", [ws, actor, request]);
    await permit(db, [source.id], "model", { requestId: request });
    await db.query("select public.save_assistant_turn($1,$2,$3,'SOURCE-DERIVED-ANSWER',$4)", [ws, actor, request, JSON.stringify([{ sourceRef: source.id, sourceType: "integration_mock_unverified" }])]);
    await studio(db, "revoke_source", { threadId: thread.id, revision: 1, sourceId: source.id });
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [actor]);
    await db.exec("set local role authenticated");
    const result = (await db.query<{ result: Record<string, unknown> }>("select public.get_assistant_request($1,$2) result", [ws, request])).rows;
    expect(JSON.stringify(result)).not.toContain("SOURCE-DERIVED-ANSWER");
    expect(result[0].result).toMatchObject({ code: "studio_context_changed", persistence: "failed" });
  });

  it("fences reauth without changing generation and invalidates old source permissions on reconnect", async () => {
    const { source } = await imported(db);
    await denied(db, () => rpc(db, "reauth", { id: connectionId, generation: 1 }, undefined, colleague), "NOT_FOUND");
    expect((await rpc(db, "reauth", { id: connectionId, generation: 1 })).connection).toMatchObject({ status: "reauth_required", generation: 1, lastError: "REAUTH_REQUIRED" });
    expect((await rpc(db, "reauth", { id: connectionId, generation: 1 })).connection.status).toBe("reauth_required");
    await denied(db, () => rpc(db, "credentials", { id: connectionId, generation: 1 }), "SOURCE_UNAVAILABLE");
    await denied(db, () => resources(db), "SOURCE_UNAVAILABLE");
    await denied(db, () => rpc(db, "reauth", { id: connectionId, generation: 0 }), "STALE_CONNECTION");
    await connect(db, { generation: 2 }, 1);
    const old = (await rpc(db, "source_refs", { sourceIds: [source.id] })).sources[0];
    expect(old).toMatchObject({ shareable: false, integration: { model_allowed: false, availability: "revoked" } });
    expect(old.revoked_at).not.toBeNull();
    await rpc(db, "revoke", { id: connectionId, generation: 2 });
    await denied(db, () => rpc(db, "reauth", { id: connectionId, generation: 3 }), "STALE_CONNECTION");
  });

  it("runs the actual IntegrationService through PGlite from OAuth and sync/Picker to model, Brief, share and purge", async () => {
    const { service } = integrationServiceFixture(db), identity = { creatorId: actor, workspaceId: ws };
    await db.exec("set local role service_role");
    const igStart = await service.beginConnection(identity, "instagram", "fixture-session", "/connections");
    const ig = await service.completeConnection(identity, "instagram", "fixture-session", "allow", igStart.state);
    const syncRequest = crypto.randomUUID(), firstSync = await service.syncConnection(identity, ig.id, syncRequest);
    expect(firstSync.resources).toHaveLength(2);
    expect(await service.syncConnection(identity, ig.id, syncRequest)).toEqual(firstSync);
    const start = await service.beginConnection(identity, "google_drive", "fixture-session", "/connections");
    const drive = await service.completeConnection(identity, "google_drive", "fixture-session", "allow", start.state);
    const picker = await service.picker(identity, drive.id);
    const owned = picker.files.find(file => file.rights === "owned")!;
    const selectionRequest = crypto.randomUUID();
    const selected = await service.registerSelectedFiles(identity, drive.id, [owned.id], selectionRequest);
    expect(await service.registerSelectedFiles(identity, drive.id, [owned.id], selectionRequest)).toEqual(selected);
    const thread = await studio(db, "create_thread", { title: "Actual service + SQL", topic: "creation" });
    const imported = await service.importSources(identity, drive.id, { threadId: thread.id, revision: 0, resourceIds: [selected.resources[0].id], question: "What can be used?", modelConsent: true, processingRights: true, shareRights: true, requestId: crypto.randomUUID() });
    const source = (imported.sources as Row[])[0];
    expect(source).toMatchObject({ region: null, language: null, integration: { model_allowed: true } });
    expect(await service.readSelectedSource(identity, source.id)).toMatchObject({ id: source.id, content: source.content, integration: { model_allowed: true } });
    const modelRequest = crypto.randomUUID();
    await db.query("select public.reserve_assistant_request($1,$2,$3,'question','zh-HK',$4,'studio:service')", [ws, actor, modelRequest, thread.conversation_id]);
    await db.query("select public.claim_assistant_request($1,$2,$3)", [ws, actor, modelRequest]);
    await service.authorizeSources(identity, [source.id], "model", { requestId: modelRequest });
    await db.query("select public.save_assistant_turn($1,$2,$3,'SYNTHETIC-SERVICE-ANSWER',$4)", [ws, actor, modelRequest, JSON.stringify([{ sourceRef: source.id, sourceType: "integration_mock_unverified" }])]);
    const save = briefPayload(thread.id, source.id);
    await service.authorizeSources(identity, [source.id], "save_brief", save);
    const brief = await studio(db, "save_brief", save);
    const share = sharePayload(thread.id, brief.id);
    await service.authorizeSources(identity, [source.id], "share", share);
    expect(await studio(db, "share_brief", share)).toMatchObject({ draft_revision: 1, recipient: "task_review" });
    expect(await service.revokeConnection(identity, drive.id, crypto.randomUUID())).toEqual({ local: "revoked", provider: "revoked" });
    await denied(db, () => service.authorizeSources(identity, [source.id], "share", share), "SOURCE_UNAVAILABLE");
    expect(await service.purgeConnection(identity, drive.id, crypto.randomUUID())).toEqual({ state: "complete" });
    const exported = await service.exportData(identity);
    expect(exported.sources).toEqual([]);
    expect(JSON.stringify(exported)).not.toMatch(/accessToken|refreshToken|mock-access|mock-refresh|ciphertext/);
    await db.exec("reset role");
    const caches = JSON.stringify((await db.query("select to_jsonb(c) data from private.integration_commands c union all select to_jsonb(e) from public.integration_events e union all select to_jsonb(r) from public.integration_sync_runs r")).rows);
    expect(caches).not.toMatch(/accessToken|refreshToken|mock-access|mock-refresh|ciphertext/);
    expect(await scalar(db, "select count(*)::int n from public.point_transactions")).toBe(0);
    expect(await scalar(db, "select count(*)::int n from public.studio_badges")).toBe(0);
  });

  it("requires a valid post-revoke generation before accepting a revocation result", async () => {
    await connect(db);
    const revoked = await rpc(db, "revoke", { id: connectionId, generation: 1 });
    expect(revoked.connection.generation).toBe(2);
    for (const generation of [undefined, null, "2", 0, -1, 2.5]) {
      await denied(db, () => rpc(db, "revoke_result", { id: connectionId, generation, provider: "revoked" }), "INVALID_INPUT");
    }
    await denied(db, () => rpc(db, "revoke_result", { id: connectionId, generation: 1, provider: "revoked" }), "STALE_CONNECTION");
    await denied(db, () => rpc(db, "revoke_result", { id: connectionId, generation: 2, provider: "revoked" }, undefined, colleague), "NOT_FOUND");
    expect(await scalar(db, "select count(*)::int n from private.integration_credentials")).toBe(1);
    const request = crypto.randomUUID(), payload = { id: connectionId, generation: 2, provider: "revoked" };
    const first = await rpc(db, "revoke_result", payload, request);
    expect(await rpc(db, "revoke_result", payload, request)).toEqual(first);
    expect(first.connection).toMatchObject({ generation: 2, providerRevocation: "revoked" });
    expect(await scalar(db, "select count(*)::int n from private.integration_credentials")).toBe(0);
  });

  it.each(["revoked", "pending", "manual_action"])("rejects a delayed %s result across revoke/reconnect/revoke without touching the new credential", async provider => {
    await connect(db);
    await rpc(db, "revoke", { id: connectionId, generation: 1 });
    const oldRequest = crypto.randomUUID(), oldPayload = { id: connectionId, generation: 2, provider: "pending" };
    await rpc(db, "revoke_result", oldPayload, oldRequest);
    await connect(db, { generation: 3 }, 2);
    await denied(db, () => rpc(db, "revoke_result", { id: connectionId, generation: 2, provider }), "STALE_CONNECTION");
    await rpc(db, "revoke", { id: connectionId, generation: 3 });
    const before = (await db.query("select generation,credential,revoke_until from private.integration_credentials")).rows;
    const eventCount = await scalar(db, "select count(*)::int n from public.integration_events");
    await denied(db, () => rpc(db, "revoke_result", { id: connectionId, generation: 2, provider }), "STALE_CONNECTION");
    await denied(db, () => rpc(db, "revoke_result", oldPayload, oldRequest), "STALE_CONNECTION");
    expect((await db.query("select generation,credential,revoke_until from private.integration_credentials")).rows).toEqual(before);
    expect(await scalar(db, "select count(*)::int n from public.integration_events")).toBe(eventCount);
    expect((await rpc(db, "export", {})).connections[0]).toMatchObject({ generation: 4, status: "revoked", providerRevocation: "pending" });
    await rpc(db, "revoke_result", { id: connectionId, generation: 4, provider: "revoked" });
    expect(await scalar(db, "select count(*)::int n from private.integration_credentials")).toBe(0);
  });

  it("fences actual delayed provider completion after a reconnect and second service revocation", async () => {
    const { service, providers, repo } = integrationServiceFixture(db), identity = { creatorId: actor, workspaceId: ws };
    const start = await service.beginConnection(identity, "google_drive", "fixture-session", "/connections");
    const connected = await service.completeConnection(identity, "google_drive", "fixture-session", "allow", start.state);
    let releaseFirst!: () => void, releaseSecond!: () => void, enteredFirst!: () => void, enteredSecond!: () => void;
    const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; });
    const secondGate = new Promise<void>(resolve => { releaseSecond = resolve; });
    const firstEntered = new Promise<void>(resolve => { enteredFirst = resolve; });
    const secondEntered = new Promise<void>(resolve => { enteredSecond = resolve; });
    let calls = 0;
    providers.google_drive.revoke = async () => {
      if (++calls === 1) { enteredFirst(); await firstGate; }
      else { enteredSecond(); await secondGate; }
    };
    const first = service.revokeConnection(identity, connected.id, crypto.randomUUID());
    void first.catch(() => undefined);
    let second: ReturnType<typeof service.revokeConnection> | undefined;
    try {
      await firstEntered;
      const reconnectStart = await service.beginConnection(identity, "google_drive", "fixture-session", "/connections");
      const renewed = await service.completeConnection(identity, "google_drive", "fixture-session", "allow", reconnectStart.state);
      expect(renewed.generation).toBe(3);
      second = service.revokeConnection(identity, connected.id, crypto.randomUUID());
      void second.catch(() => undefined);
      await secondEntered;
      const credentialBefore = (await db.query("select generation,credential from private.integration_credentials")).rows;
      expect(await repo.connection(identity, connected.id)).toMatchObject({ generation: 4, providerRevocation: "pending" });
      await denied(db, () => { releaseFirst(); return first; }, "STALE_CONNECTION");
      expect((await db.query("select generation,credential from private.integration_credentials")).rows).toEqual(credentialBefore);
      expect(await repo.connection(identity, connected.id)).toMatchObject({ generation: 4, providerRevocation: "pending" });
      releaseSecond();
      expect(await second).toEqual({ local: "revoked", provider: "revoked" });
      expect(await scalar(db, "select count(*)::int n from private.integration_credentials")).toBe(0);
    } finally {
      releaseFirst(); releaseSecond();
      await Promise.allSettled([first, ...(second ? [second] : [])]);
    }
  });

  it("stores only a permission notice without processing rights, even when model and share consent are supplied", async () => {
    const { source } = await imported(db, { import: { processingRights: false, modelConsent: true, shareRights: true } });
    expect(source).toMatchObject({ kind: "private", shareable: false, integration: { model_allowed: false } });
    expect(source.content).toContain("權限");
    expect(source.content).not.toContain("PRIVATE-SOURCE-EXCERPT");
    const sourceRead = await rpc(db, "source_refs", { sourceIds: [source.id] });
    expect(JSON.stringify(sourceRead)).not.toContain("PRIVATE-SOURCE-EXCERPT");
    const importCache = (await db.query("select result from private.integration_commands where action='import'")).rows;
    expect(JSON.stringify(importCache)).not.toContain("PRIVATE-SOURCE-EXCERPT");
    await denied(db, () => permit(db, [source.id], "model", { requestId: crypto.randomUUID() }), "MODEL_CONSENT_REQUIRED");
    await denied(db, () => permit(db, [source.id], "share", {}), "SOURCE_PRIVATE");
  });

  it("retains the owned private excerpt with processing rights but keeps AI disabled without model consent", async () => {
    const { source } = await imported(db, { import: { processingRights: true, modelConsent: false, shareRights: false } });
    expect(source).toMatchObject({ kind: "private", content: "PRIVATE-SOURCE-EXCERPT", shareable: false, integration: { model_allowed: false } });
    await denied(db, () => permit(db, [source.id], "model", { requestId: crypto.randomUUID() }), "MODEL_CONSENT_REQUIRED");
  });

  it("reads pending revocation credentials only through the bounded uncached management action", async () => {
    await connect(db);
    await denied(db, () => rpc(db, "revocation_credentials", { id: connectionId, generation: 1 }), "STALE_CONNECTION");
    await rpc(db, "revoke", { id: connectionId, generation: 1 });
    const beforeCommands = await scalar(db, "select count(*)::int n from private.integration_commands");
    const beforeEvents = await scalar(db, "select count(*)::int n from public.integration_events");
    const request = crypto.randomUUID(), payload = { id: connectionId, generation: 2 };
    expect(await rpc(db, "revocation_credentials", payload, request)).toEqual({ credential, credentialGeneration: 1 });
    expect(await rpc(db, "revocation_credentials", payload, request)).toEqual({ credential, credentialGeneration: 1 });
    await denied(db, () => rpc(db, "revocation_credentials", payload, undefined, colleague), "NOT_FOUND");
    await denied(db, () => rpc(db, "revocation_credentials", { ...payload, generation: 1 }), "STALE_CONNECTION");
    await denied(db, () => rpc(db, "revocation_credentials", { id: connectionId }), "INVALID_INPUT");
    await denied(db, () => rpc(db, "credentials", payload), "SOURCE_UNAVAILABLE");
    await db.exec("set local role authenticated");
    await denied(db, () => rpc(db, "revocation_credentials", payload), "permission denied");
    await db.exec("reset role");
    await db.exec("update private.integration_credentials set revoke_until=clock_timestamp()-interval '1 second'");
    expect(await rpc(db, "revocation_credentials", payload, request)).toEqual({ credential: null, credentialGeneration: null });
    await db.exec("delete from private.integration_credentials");
    expect(await rpc(db, "revocation_credentials", payload, request)).toEqual({ credential: null, credentialGeneration: null });
    expect(await scalar(db, "select count(*)::int n from private.integration_commands")).toBe(beforeCommands);
    expect(await scalar(db, "select count(*)::int n from public.integration_events")).toBe(beforeEvents);
    await rpc(db, "revoke_result", { ...payload, provider: "manual_action" });
    await denied(db, () => rpc(db, "revocation_credentials", payload, request), "STALE_CONNECTION");
  });

  it.each([false, true])("retries pending provider revocation through the actual service using the original credential generation (expired=%s)", async expired => {
    const { service, providers, repo } = integrationServiceFixture(db), identity = { creatorId: actor, workspaceId: ws };
    const start = await service.beginConnection(identity, "google_drive", "fixture-session", "/connections");
    const connected = await service.completeConnection(identity, "google_drive", "fixture-session", "allow", start.state);
    let calls = 0;
    providers.google_drive.revoke = async grant => {
      expect(grant.subject).toContain(actor);
      if (++calls === 1) throw new Error("synthetic temporary provider failure");
    };
    expect(await service.revokeConnection(identity, connected.id, crypto.randomUUID())).toEqual({ local: "revoked", provider: "pending" });
    expect(await repo.connection(identity, connected.id)).toMatchObject({ generation: 2, status: "revoked", providerRevocation: "pending" });
    expect(await scalar(db, "select count(*)::int n from private.integration_credentials")).toBe(1);
    if (expired) await db.exec("update private.integration_credentials set revoke_until=clock_timestamp()-interval '1 second'");
    const expected = expired ? "manual_action" : "revoked";
    expect(await service.revokeConnection(identity, connected.id, crypto.randomUUID())).toEqual({ local: "revoked", provider: expected });
    expect(calls).toBe(expired ? 1 : 2);
    expect(await repo.connection(identity, connected.id)).toMatchObject({ generation: 2, status: "revoked", providerRevocation: expected });
    expect(await scalar(db, "select count(*)::int n from private.integration_credentials")).toBe(0);
  });

  it("does not restore old model/share consent when unchanged content changes rights and later becomes owned again", async () => {
    const { source, thread, payload, snapshotId } = await imported(db);
    await permit(db, [source.id], "save_brief", briefPayload(thread.id, source.id));
    const restricted = await resources(db, [resource({ rights: "unknown" })]);
    const old = (await rpc(db, "source_refs", { sourceIds: [source.id] })).sources[0];
    expect(old).toMatchObject({ shareable: false, integration: { model_allowed: false, availability: "revoked" } });
    expect(old.revoked_at).not.toBeNull();
    expect(restricted.resources[0].snapshotId).not.toBe(snapshotId);
    expect(await scalar(db, "select count(*)::int n from private.integration_use_permits where revoked_at is not null")).toBe(1);
    const restored = await resources(db, [resource()]);
    expect(restored.resources[0].snapshotId).not.toBe(snapshotId);
    expect(restored.resources[0].snapshotId).not.toBe(restricted.resources[0].snapshotId);
    const unchanged = await resources(db, [resource({ fetchedAt: "2026-11-01T00:00:00Z" })]);
    expect(unchanged.resources[0].snapshotId).toBe(restored.resources[0].snapshotId);
    await denied(db, () => permit(db, [source.id], "model", { requestId: crypto.randomUUID() }), "SOURCE_UNAVAILABLE");
    const revision = await scalar(db, "select revision n from public.studio_threads where id=$1", [thread.id]);
    const fresh = await rpc(db, "import", { ...payload, revision });
    expect(fresh.sources[0].id).not.toBe(source.id);
    expect(fresh.sources[0]).toMatchObject({ shareable: true, integration: { model_allowed: true } });
  });

  it("authorizes service-backed source reads without granting model, save or share permission", async () => {
    const { service } = integrationServiceFixture(db), identity = { creatorId: actor, workspaceId: ws };
    await db.exec("set local role service_role");
    const start = await service.beginConnection(identity, "google_drive", "fixture-session", "/connections");
    const connected = await service.completeConnection(identity, "google_drive", "fixture-session", "allow", start.state);
    const selected = await service.registerSelectedFiles(identity, connected.id, ["mock-owned-brief"], crypto.randomUUID());
    const thread = await studio(db, "create_thread", { title: "read without AI", topic: "creation" });
    const imported = await service.importSources(identity, connected.id, { threadId: thread.id, revision: 0, resourceIds: [selected.resources[0].id], question: "read privately", modelConsent: false, processingRights: true, shareRights: false, requestId: crypto.randomUUID() });
    const source = (imported.sources as Row[])[0];
    const granted = await service.authorizeSources(identity, [source.id], "read");
    expect(granted).toEqual([expect.objectContaining({ sourceId: source.id, use: "read", generation: 1, snapshotId: source.integration.snapshot_id })]);
    await denied(db, () => service.readSelectedSource(identity, source.id), "SOURCE_UNAVAILABLE");
    await denied(db, () => service.authorizeSources(identity, [source.id], "model", { requestId: crypto.randomUUID() }), "MODEL_CONSENT_REQUIRED");
    await denied(db, () => studio(db, "save_brief", briefPayload(thread.id, source.id)), "SOURCE_UNAVAILABLE");
    await denied(db, () => service.authorizeSources(identity, [source.id], "share", {}), "SOURCE_PRIVATE");
    await service.revokeConnection(identity, connected.id, crypto.randomUUID());
    await denied(db, () => service.authorizeSources(identity, [source.id], "read"), "SOURCE_UNAVAILABLE");
  });

  it("reselects the same Drive file after reconnect using its stable SQL resource identity and a fresh snapshot", async () => {
    const { service, repo } = integrationServiceFixture(db), identity = { creatorId: actor, workspaceId: ws };
    const start = await service.beginConnection(identity, "google_drive", "fixture-session", "/connections");
    const connected = await service.completeConnection(identity, "google_drive", "fixture-session", "allow", start.state);
    const first = await service.registerSelectedFiles(identity, connected.id, ["mock-owned-brief"], crypto.randomUUID());
    const before = (await repo.resources(identity, connected.id))[0];
    await service.revokeConnection(identity, connected.id, crypto.randomUUID());
    const restart = await service.beginConnection(identity, "google_drive", "fixture-session", "/connections");
    const renewed = await service.completeConnection(identity, "google_drive", "fixture-session", "allow", restart.state);
    expect(renewed.generation).toBe(3);
    expect(await service.resources(identity, connected.id)).toEqual([]);
    expect(await repo.resourceIdentities({ creatorId: colleague, workspaceId: ws }, connected.id, ["mock-owned-brief"])).toEqual([]);
    expect(await repo.resourceIdentities(identity, connected.id, ["mock-owned-brief"])).toEqual([{ id: before.id, externalId: "mock-owned-brief" }]);
    const second = await service.registerSelectedFiles(identity, connected.id, ["mock-owned-brief"], crypto.randomUUID());
    expect(second.resources[0].id).toBe(first.resources[0].id);
    const after = (await repo.resources(identity, connected.id))[0];
    expect(after.generation).toBe(3);
    expect(after.snapshotId).not.toBe(before.snapshotId);
    expect(await scalar(db, "select count(*)::int n from public.integration_resources")).toBe(1);
    expect(await scalar(db, "select count(*)::int n from public.integration_snapshots")).toBe(2);
  });

  it.each(["revoke", "purge"])("allows actual service %s when a SQL connection requires reauthentication", async operation => {
    const { service, repo } = integrationServiceFixture(db), identity = { creatorId: actor, workspaceId: ws };
    const start = await service.beginConnection(identity, "google_drive", "fixture-session", "/connections");
    const connected = await service.completeConnection(identity, "google_drive", "fixture-session", "allow", start.state);
    await repo.command(identity, crypto.randomUUID(), "reauth", { id: connected.id, generation: 1 });
    await denied(db, () => repo.command(identity, crypto.randomUUID(), "credentials", { id: connected.id, generation: 1 }), "SOURCE_UNAVAILABLE");
    const result = operation === "revoke"
      ? await service.revokeConnection(identity, connected.id, crypto.randomUUID())
      : await service.purgeConnection(identity, connected.id, crypto.randomUUID());
    expect(result).toEqual(operation === "revoke" ? { local: "revoked", provider: "revoked" } : { state: "complete" });
    expect(await repo.connection(identity, connected.id)).toMatchObject({ generation: 2, status: "revoked", providerRevocation: "revoked" });
    expect(await scalar(db, "select count(*)::int n from private.integration_credentials")).toBe(0);
  });

  it("preserves safe assistant answers and user input while purging only provider-derived conversation provenance", async () => {
    const { thread, source } = await imported(db);
    async function saveTurn(answer: string, provider: boolean) {
      const request = crypto.randomUUID();
      await db.query("select public.reserve_assistant_request($1,$2,$3,$4,'zh-HK',$5,'studio:mixed')", [ws, actor, request, `user ${answer}`, thread.conversation_id]);
      await db.query("select public.claim_assistant_request($1,$2,$3)", [ws, actor, request]);
      if (provider) await permit(db, [source.id], "model", { requestId: request });
      await db.query("select public.save_assistant_turn($1,$2,$3,$4,$5)", [ws, actor, request, answer, JSON.stringify(provider ? [{ sourceRef: source.id, sourceType: "integration_mock_unverified" }] : [])]);
      return request;
    }
    const safeBefore = await saveTurn("SAFE-BEFORE", false), derived = await saveTurn("PROVIDER-DERIVED", true);
    await rpc(db, "revoke", { id: connectionId, generation: 1 });
    expect((await db.query("select state,result->>'answer' answer from public.assistant_requests where request_id=$1", [safeBefore])).rows).toEqual([{ state: "saved", answer: "SAFE-BEFORE" }]);
    const safeAfter = await saveTurn("SAFE-AFTER", false);
    await rpc(db, "purge", { id: connectionId });
    expect((await db.query("select content from public.assistant_messages where role='user' order by content")).rows).toEqual([{ content: "user PROVIDER-DERIVED" }, { content: "user SAFE-AFTER" }, { content: "user SAFE-BEFORE" }]);
    expect((await db.query("select content from public.assistant_messages where role='assistant' and request_id=any($1::uuid[]) order by content", [[safeBefore, safeAfter]])).rows).toEqual([{ content: "SAFE-AFTER" }, { content: "SAFE-BEFORE" }]);
    expect(JSON.stringify((await db.query("select content,citations,tool_calls from public.assistant_messages where role='assistant' and request_id=$1", [derived])).rows)).not.toContain("PROVIDER-DERIVED");
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [actor]);
    for (const [request, answer] of [[safeBefore, "SAFE-BEFORE"], [safeAfter, "SAFE-AFTER"]]) {
      const result = (await db.query<{ result: Row }>("select public.get_assistant_request($1,$2) result", [ws, request])).rows[0].result;
      expect(result).toMatchObject({ answer, persistence: "saved" });
    }
    expect(JSON.stringify((await db.query("select public.get_assistant_request($1,$2) result", [ws, derived])).rows)).not.toContain("PROVIDER-DERIVED");
  });

  it("timestamps integration source revocation after a later-started answer while preserving manual timestamps and exact replay", async () => {
    const { thread, source } = await imported(db), request = crypto.randomUUID();
    // PGlite has one session. Represent an answer committed by another, later-
    // started transaction while this revoke transaction waited for the creator lock.
    await db.query("insert into public.assistant_messages(conversation_id,role,content,citations,created_at) values($1,'assistant','answer before lock',$2,clock_timestamp())", [thread.conversation_id, JSON.stringify([{ sourceRef: source.id }])]);
    const payload = { threadId: thread.id, revision: 1, sourceId: source.id };
    const result = await studio(db, "revoke_source", payload, request);
    expect(await scalar(db, `select count(*)::int n from public.studio_sources s join public.assistant_messages m on m.conversation_id=$2
      where s.id=$1 and s.revoked_at>=m.created_at and s.revoked_at>transaction_timestamp()`, [source.id, thread.conversation_id])).toBe(1);
    expect(await studio(db, "revoke_source", payload, request)).toEqual(result);
    expect((await studio(db, "revoke_source", { ...payload, revision: 2 })).revoked_at).toBe(result.revoked_at);
    expect((await rpc(db, "source_refs", { sourceIds: [source.id] })).sources[0].revoked_at).toBe(result.revoked_at);
    const manualThread = await studio(db, "create_thread", { title: "manual timestamps", topic: "creation" });
    const manual = await studio(db, "add_source", { threadId: manualThread.id, revision: 0, title: "manual", content: "keep", question: "why", platform: "manual", region: "HK", language: "zh-Hant", observed_at: "2026-10-31T00:00:00Z", kind: "manual" });
    await studio(db, "revoke_source", { threadId: manualThread.id, revision: 1, sourceId: manual.id });
    expect(await scalar(db, "select count(*)::int n from public.studio_sources where id=$1 and revoked_at=transaction_timestamp()", [manual.id])).toBe(1);
  });
});
