// @vitest-environment node
import { readFile, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  MemoryPublishDatabase,
  MemoryPublishRepository,
  SupabasePublishRepository,
  type PublishRepository,
  type PublishBinding,
  type PublishIntent,
  type PublishRpc,
  type TransitionPublishInput,
} from "../lib/creatorGrowth/publishRepo.js";
import {
  fixture,
  connect,
  studio,
  rpc as integrationCommand,
  ws,
  actor,
  colleague,
  otherWs,
  other,
  connectionId,
} from "./helpers/integrations-fixture.js";

const migration = "supabase/migrations/20261104134202_kocmax_publish_intents.sql";
const owner = { workspaceId: ws, creatorId: actor };
const session = { ...owner, sessionHash: "a".repeat(64) };
const assetId = "00000000-0000-4000-8000-000000000071";
const draftId = "00000000-0000-4000-8000-000000000081";
const binding: PublishBinding = {
  draftId,
  draftRevision: 1,
  assetId,
  imageSha256: "b".repeat(64),
  captionSha256: createHash("sha256").update("private caption").digest("hex"),
  connectionId,
  accountSubject: "123456789",
  grantGeneration: 1,
  fingerprint: "c".repeat(64),
};
let db: PGlite;
let repo: SupabasePublishRepository;
let clock: number;
let queue: Promise<unknown> = Promise.resolve();
const call: PublishRpc = (name, args) => {
  // One PGlite connection: serialize its role/savepoint wrapper, not repository commands.
  const pending = queue.then(async () => {
    await db.exec("savepoint publish_rpc; set local role service_role");
    try {
      const result = await db.query<{ result: unknown }>(
        `select public.${name}($1,$2,$3,$4::jsonb,$5::timestamptz) result`,
        [
          args.p_workspace,
          args.p_creator,
          args.p_action,
          JSON.stringify(args.p_payload),
          args.p_now,
        ],
      );
      await db.exec("reset role; release savepoint publish_rpc");
      return result.rows[0].result;
    } catch (error) {
      await db.exec("rollback to savepoint publish_rpc; release savepoint publish_rpc");
      throw error;
    }
  });
  queue = pending.catch(() => undefined);
  return pending;
};
async function preview() {
  const p = await repo.issuePreview(session, binding);
  return { approvalId: p.approvalId, nonce: p.nonce, binding, requestId: randomUUID() };
}
async function intent() {
  return repo.reserve(session, await preview());
}
function step(
  i: PublishIntent,
  nextState: TransitionPublishInput["nextState"],
  receipt: TransitionPublishInput["receipt"] = {},
) {
  return {
    intentId: i.id,
    expectedState: i.state,
    expectedVersion: i.version,
    nextState,
    receipt,
    fingerprint: binding.fingerprint,
    requestId: randomUUID(),
  };
}
async function denied(sql: string, pattern: string) {
  await db.exec("savepoint expected_denial");
  try {
    await expect(db.exec(sql)).rejects.toThrow(pattern);
  } finally {
    await db.exec("rollback to savepoint expected_denial; release savepoint expected_denial");
  }
}
describe("publish migration and fresh Supabase adapters in PGlite", () => {
  beforeAll(async () => {
    ({ db } = await fixture());
    await db.exec(`create schema storage;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner_id uuid);
      alter table storage.objects enable row level security;`);
    await db.exec(
      await readFile(
        "supabase/migrations/20261103215321_kocmax_creator_growth_private.sql",
        "utf8",
      ),
    );
    await db.exec(await readFile(migration, "utf8"));
  }, 30_000);
  afterAll(async () => {
    await db?.close();
  });
  beforeEach(async () => {
    await db.exec("begin");
    clock = Date.parse("2030-01-01T00:00:00.000Z");
    await connect(db, {
      provider: "instagram",
      subject: binding.accountSubject,
      scopes: ["instagram_business_basic", "instagram_business_manage_insights"],
    });
    // Synthetic grant only: current OAuth command does not request publishing scope.
    await db.query(
      "update public.integration_connections set data=jsonb_set(data,'{scopes}',$1::jsonb) where id=$2",
      [
        JSON.stringify(["instagram_business_basic", "instagram_business_content_publish"]),
        connectionId,
      ],
    );
    const thread = await studio(db, "create_thread", {
      title: "Synthetic publish fixture",
      topic: "creation",
    });
    await db.query(
      `insert into private.creator_growth_assets(id,workspace_id,creator_id,thread_id,storage_path,sha256,mime,byte_size,width,height,rights_confirmed,source_kind,sample_only,fixture_id,upload_state,expires_at)
      values($1,$2,$3,$4,$5,$6,'image/jpeg',100,640,640,true,'synthetic-fixture',true,'publish-test','uploaded','2099-01-01');`,
      [
        assetId,
        ws,
        actor,
        thread.id,
        `${ws}/${actor}/${thread.id}/${assetId}.jpg`,
        binding.imageSha256,
      ],
    );
    await db.query(
      `insert into private.creator_growth_drafts(id,workspace_id,creator_id,thread_id,asset_id,revision,caption,manual_description,status)
      values($1,$2,$3,$4,$5,1,'private caption','','private')`,
      [draftId, ws, actor, thread.id, assetId],
    );
    repo = new SupabasePublishRepository({ rpc: call, enabled: true, now: () => new Date(clock) });
  });
  afterEach(async () => {
    await queue;
    await db.exec("rollback");
  });
  it("installs only private default-deny tables and service-only RPC", async () => {
    for (const table of [
      "creator_publish_approvals",
      "creator_publish_intents",
      "creator_publish_commands",
      "creator_publish_revisions",
    ]) {
      expect(
        (
          await db.query<{ relrowsecurity: boolean }>(
            "select relrowsecurity from pg_class where oid=$1::regclass",
            [`private.${table}`],
          )
        ).rows[0].relrowsecurity,
      ).toBe(true);
      for (const role of ["anon", "authenticated", "service_role"]) {
        await denied(`set local role ${role}; select * from private.${table}`, "permission denied");
      }
    }
    for (const role of ["anon", "authenticated"]) {
      await denied(
        `set local role ${role}; select public.creator_publish_command('${ws}','${actor}','get','{}',now())`,
        "permission denied",
      );
    }
  });
  it("durably consumes nonce once and replays across fresh adapters with original times", async () => {
    const p = await preview();
    const first = await repo.reserve(session, p);
    clock += 60_000;
    const fresh = new SupabasePublishRepository({
      rpc: call,
      enabled: true,
      now: () => new Date(clock),
    });
    expect(await fresh.reserve(session, p)).toEqual(first);
    await expect(fresh.reserve(session, { ...p, requestId: randomUUID() })).rejects.toThrow(
      "PUBLISH_APPROVAL_INVALID",
    );
    await expect(
      fresh.reserve(session, { ...p, binding: { ...binding, imageSha256: "e".repeat(64) } }),
    ).rejects.toThrow("PUBLISH_CONFLICT");
    const stored = JSON.stringify(
      (await db.query("select to_jsonb(a) a from private.creator_publish_approvals a")).rows,
    );
    expect(stored).not.toContain(p.nonce);
    expect(stored).not.toContain("private caption");
  });
  it("two tabs share one intent and only one worker wins the durable CAS", async () => {
    const a = await preview(),
      b = await preview();
    const results = await Promise.all([repo.reserve(session, a), repo.reserve(session, b)]);
    expect(results[0]).toEqual(results[1]);
    const claim = step(results[0], "container_preparing");
    const contenders = await Promise.allSettled([
      repo.transition(owner, claim),
      repo.transition(owner, { ...claim, requestId: randomUUID() }),
    ]);
    expect(contenders.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await repo.transition(owner, claim)).toMatchObject({ applied: false });
  });
  it("checks same-workspace, cross-workspace, brand and staff owners even with service RPC", async () => {
    const i = await intent();
    for (const o of [
      { workspaceId: ws, creatorId: colleague },
      { workspaceId: otherWs, creatorId: other },
      { workspaceId: ws, creatorId: randomUUID() },
      { workspaceId: otherWs, creatorId: actor },
    ]) {
      await expect(repo.getOwned(o, i.id)).rejects.toThrow("PUBLISH_DENIED");
      await expect(repo.transition(o, step(i, "container_preparing"))).rejects.toThrow(
        "PUBLISH_DENIED",
      );
    }
  });
  it("canonical connection update stops queued and in-flight intents atomically", async () => {
    const i = await intent();
    await repo.transition(owner, step(i, "container_preparing"));
    await db.query(
      "update public.integration_connections set status='revoked',generation=generation+1 where id=$1",
      [connectionId],
    );
    expect(await repo.getOwned(owner, i.id)).toMatchObject({ state: "outcome_unknown" });
    await expect(repo.issuePreview(session, binding)).rejects.toThrow("PUBLISH_STALE");
  });
  it("rejects stale caption/image and expired or wrong-session approval", async () => {
    const p = await preview();
    await expect(repo.reserve({ ...session, sessionHash: "e".repeat(64) }, p)).rejects.toThrow(
      "PUBLISH_APPROVAL_INVALID",
    );
    clock += 300_000;
    await expect(repo.reserve(session, p)).rejects.toThrow("PUBLISH_APPROVAL_INVALID");
    clock -= 300_000;
    await db.query("update private.creator_growth_drafts set caption='edited' where id=$1", [
      draftId,
    ]);
    await expect(repo.reserve(session, p)).rejects.toThrow("PUBLISH_STALE");
  });
  it("does not forget revision consumption when terminal metadata reaches retention", async () => {
    const i = await intent();
    await repo.transition(owner, step(i, "cancelled"));
    clock += 91 * 86400_000;
    expect((await repo.cleanup(owner)).intentsDeleted).toBe(1);
    await expect(repo.reserve(session, await preview())).rejects.toThrow("PUBLISH_CONFLICT");
  });
  it.each([
    "update private.creator_growth_drafts set revision=2 where id='" + draftId + "'",
    "update private.creator_growth_assets set sha256=repeat('e',64) where id='" + assetId + "'",
    "update public.integration_connections set generation=2 where id='" + connectionId + "'",
    "update public.integration_connections set data=jsonb_set(data,'{subject}','\"999\"') where id='" +
      connectionId +
      "'",
    "update public.integration_connections set data=jsonb_set(data,'{scopes}','[]') where id='" +
      connectionId +
      "'",
    "update public.integration_connections set data=jsonb_set(data,'{expiresAt}','\"2020-01-01T00:00:00Z\"') where id='" +
      connectionId +
      "'",
  ])("denies canonical change before approving or replaying: %s", async (sql) => {
    const p = await preview();
    const i = await repo.reserve(session, p);
    await db.exec(sql);
    await expect(repo.reserve(session, p)).rejects.toThrow("PUBLISH_STALE");
    expect(await repo.getOwned(owner, i.id)).toMatchObject({ state: "invalidated" });
    expect(
      (
        await db.query(
          "select 1 from private.creator_publish_approvals where invalidated_at is null",
        )
      ).rows,
    ).toHaveLength(0);
  });
  it.each(["suspended", "deleted"])(
    "denies %s owners and removes actionable previews",
    async (status) => {
      const p = await preview();
      const i = await repo.reserve(session, p);
      await db.query("update public.creators set status=$1 where id=$2", [status, actor]);
      await expect(repo.getOwned(owner, i.id)).rejects.toThrow("PUBLISH_DENIED");
      await expect(repo.reserve(session, p)).rejects.toThrow("PUBLISH_DENIED");
      expect(
        (
          await db.query(
            "select 1 from private.creator_publish_approvals where invalidated_at is null and consumed_at is null",
          )
        ).rows,
      ).toHaveLength(0);
    },
  );
  it("canonical revoke transaction invalidates queued approval and rollback restores it", async () => {
    const p = await preview();
    const i = await repo.reserve(session, p);
    await db.exec("savepoint revoke_atomic");
    await integrationCommand(db, "revoke", { id: connectionId, generation: 1 });
    expect(await repo.getOwned(owner, i.id)).toMatchObject({ state: "invalidated" });
    await db.exec("rollback to savepoint revoke_atomic; release savepoint revoke_atomic");
    expect(await repo.reserve(session, p)).toEqual(i);
  });
  it("retains in-flight old-target evidence and cannot revive via late receipts", async () => {
    const c = (await repo.transition(owner, step(await intent(), "container_preparing"))).intent;
    const ready = (
      await repo.transition(
        owner,
        step(c, "provider_processing", { containerId: "123", status: "ready" }),
      )
    ).intent;
    const posted = (await repo.transition(owner, step(ready, "publish_requested"))).intent;
    await integrationCommand(db, "revoke", { id: connectionId, generation: 1 });
    const input = {
      intentId: posted.id,
      requestId: randomUUID(),
      target: { connectionId, accountSubject: binding.accountSubject, grantGeneration: 1 },
      receipt: { mediaId: "456", status: "published" as const },
    };
    const late = await repo.recordLateReceipt(owner, input);
    expect(late).toMatchObject({ state: "outcome_unknown", lateReceipt: { mediaId: "456" } });
    expect(await repo.recordLateReceipt(owner, input)).toEqual(late);
    await expect(repo.transition(owner, step(late, "published", input.receipt))).rejects.toThrow(
      "PUBLISH_STALE",
    );
    await expect(
      repo.recordLateReceipt(owner, { ...input, target: { ...input.target, grantGeneration: 2 } }),
    ).rejects.toThrow("PUBLISH_CONFLICT");
  });
  it("does not re-POST when interrupted before receiving a container ID", async () => {
    const command = step(await intent(), "container_preparing");
    const i = (await repo.transition(owner, command)).intent;
    const fresh = new SupabasePublishRepository({
      rpc: call,
      enabled: true,
      now: () => new Date(clock),
    });
    expect(await fresh.transition(owner, command)).toMatchObject({ applied: false });
    const unknown = (
      await fresh.transition(owner, step(i, "outcome_unknown", { code: "INTERRUPTED" }))
    ).intent;
    for (const state of [
      "creator_approved",
      "container_preparing",
      "publish_requested",
      "published",
    ] as const) {
      await expect(
        fresh.transition(owner, step(unknown, state, { mediaId: "999", status: "published" })),
      ).rejects.toThrow("PUBLISH_TRANSITION");
    }
  });
  it.each([
    ["container_preparing", false], ["provider_processing", false],
    ["container_preparing", true], ["provider_processing", true],
  ] as const)("I1 durable RPC rejects late media after %s (interrupted=%s) without publish claim", async (phase, interrupted) => {
    let current = (await repo.transition(owner, step(await intent(), "container_preparing"))).intent;
    if (phase === "provider_processing") current = (await repo.transition(owner,
      step(current, "provider_processing", { containerId: "123", status: "ready" }))).intent;
    if (interrupted) current = (await repo.transition(owner,
      step(current, "outcome_unknown", { code: "INTERRUPTED" }))).intent;
    const fresh = new SupabasePublishRepository({ rpc: call, enabled: true, now: () => new Date(clock) });
    await expect((async () => {
      const late = await fresh.recordLateReceipt(owner, {
        intentId: current.id, requestId: randomUUID(),
        target: { connectionId, accountSubject: binding.accountSubject, grantGeneration: 1 },
        receipt: { mediaId: "456" },
      });
      return interrupted ? fresh.transition(owner, step(late, "published", { mediaId: "456", status: "published" })) : late;
    })()).rejects.toThrow("PUBLISH_TRANSITION");
    expect(await repo.getOwned(owner, current.id)).toEqual(current);
  });
  it("persists the exact publish claim once and never accepts it from caller payloads", async () => {
    const c = (await repo.transition(owner, step(await intent(), "container_preparing"))).intent;
    const readClaim = async () => (await db.query(`select publish_claim_request_id,publish_claim_version,
      publish_claim_container_id,publish_claimed_at from private.creator_publish_intents where id=$1`, [c.id])).rows[0];
    expect(await readClaim()).toEqual({ publish_claim_request_id: null, publish_claim_version: null, publish_claim_container_id: null, publish_claimed_at: null });
    const ready = (await repo.transition(owner, step(c, "provider_processing", { containerId: "123", status: "ready" }))).intent;
    const command = step(ready, "publish_requested");
    const posted = (await repo.transition(owner, command)).intent;
    const claim = await readClaim();
    expect(claim).toEqual({ publish_claim_request_id: command.requestId, publish_claim_version: posted.version,
      publish_claim_container_id: "123", publish_claimed_at: new Date(clock) });
    expect(JSON.stringify(posted)).not.toMatch(/publishClaim|publish_claim/);
    clock += 30_000;
    const fresh = new SupabasePublishRepository({ rpc: call, enabled: true, now: () => new Date(clock) });
    expect(await fresh.transition(owner, command)).toMatchObject({ applied: false });
    expect(await readClaim()).toEqual(claim);
    const unknown = (await fresh.transition(owner, step(posted, "outcome_unknown", { code: "INTERRUPTED" }))).intent;
    await integrationCommand(db, "revoke", { id: connectionId, generation: 1 });
    const audit = await fresh.recordLateReceipt(owner, { intentId: unknown.id, requestId: randomUUID(),
      target: { connectionId, accountSubject: binding.accountSubject, grantGeneration: 1 }, receipt: { mediaId: "456" } });
    expect(audit.state).toBe("outcome_unknown"); expect(audit.stoppedAt).not.toBeNull();
    expect(await readClaim()).toEqual(claim);
    await expect(call("creator_publish_command", { p_workspace: ws, p_creator: actor, p_action: "late",
      p_payload: { intentId: unknown.id, requestId: randomUUID(), publishClaimRequestId: randomUUID(),
        target: { connectionId, accountSubject: binding.accountSubject, grantGeneration: 1 }, receipt: { mediaId: "456" } },
      p_now: new Date(clock).toISOString() })).rejects.toThrow("PUBLISH_INVALID");
  });
  it("permits exact known-ID read reconciliation and no publish-request reopening", async () => {
    const c = (await repo.transition(owner, step(await intent(), "container_preparing"))).intent;
    const ready = (
      await repo.transition(
        owner,
        step(c, "provider_processing", { containerId: "123", status: "ready" }),
      )
    ).intent;
    const posted = (await repo.transition(owner, step(ready, "publish_requested"))).intent;
    const u = (
      await repo.transition(owner, step(posted, "outcome_unknown", { code: "PROVIDER_TIMEOUT" }))
    ).intent;
    const late = await repo.recordLateReceipt(owner, {
      intentId: u.id,
      requestId: randomUUID(),
      target: { connectionId, accountSubject: binding.accountSubject, grantGeneration: 1 },
      receipt: { mediaId: "456" },
    });
    await expect(repo.transition(owner, step(late, "publish_requested"))).rejects.toThrow(
      "PUBLISH_TRANSITION",
    );
    expect(
      (
        await repo.transition(
          owner,
          step(late, "published", { mediaId: "456", status: "published" }),
        )
      ).intent.state,
    ).toBe("published");
  });
  it("enforces composite owner/source foreign keys even for direct privileged fixture writes", async () => {
    await preview();
    for (const creatorId of [colleague, other]) {
      await denied(
        `update private.creator_publish_approvals set creator_id='${creatorId}'`,
        "foreign key constraint",
      );
    }
    const i = await intent();
    await denied(
      `update private.creator_publish_intents set creator_id='${colleague}' where id='${i.id}'`,
      "foreign key constraint",
    );
  });
  it("rejects unknown fields/nested receipts at the SQL RPC boundary, bypassing TS validators", async () => {
    const i = await intent();
    for (const payload of [
      { ...step(i, "container_preparing"), image: "data:image/jpeg;base64,AA" },
      { ...step(i, "container_preparing"), receipt: { token: "secret" } },
      { ...step(i, "container_preparing"), receipt: { status: { raw: "secret" } } },
      { ...step(i, "container_preparing"), receipt: { containerId: "https://bad.test" } },
    ])
      await expect(
        call("creator_publish_command", {
          p_workspace: ws,
          p_creator: actor,
          p_action: "transition",
          p_payload: payload,
          p_now: new Date(clock).toISOString(),
        }),
      ).rejects.toThrow("PUBLISH_INVALID");
    expect((await repo.getOwned(owner, i.id)).version).toBe(1);
  });
  it("rejects provider facts before the corresponding provider write", async () => {
    const i = await intent();
    await expect(
      repo.transition(
        owner,
        step(i, "container_preparing", { mediaId: "987", status: "published" }),
      ),
    ).rejects.toThrow("PUBLISH_TRANSITION");
    const c = (await repo.transition(owner, step(i, "container_preparing"))).intent;
    await expect(
      repo.transition(
        owner,
        step(c, "provider_processing", { containerId: "123", mediaId: "456", status: "ready" }),
      ),
    ).rejects.toThrow("PUBLISH_TRANSITION");
  });
  it("source deletion detaches and retains unknown audit without actionable approval", async () => {
    const c = (await repo.transition(owner, step(await intent(), "container_preparing"))).intent;
    await db.query("delete from private.creator_growth_assets where id=$1", [assetId]);
    expect(await repo.getOwned(owner, c.id)).toMatchObject({ state: "outcome_unknown", binding });
    expect((await db.query("select 1 from private.creator_publish_approvals")).rows).toHaveLength(
      0,
    );
    clock += 91 * 86400_000;
    expect(await repo.cleanup(owner, 1)).toMatchObject({ intentsDeleted: 0, heldUnknown: 1 });
  });
  it("memory and SQL execute identical nonce, replay, CAS, receipt and cleanup contracts", async () => {
    const memory = new MemoryPublishDatabase(() => new Date(clock));
    memory.setOwner(owner, "active");
    memory.setSource({
      owner,
      binding,
      available: true,
      grantExpiresAt: "2099-01-01T00:00:00.000Z",
      assetExpiresAt: "2099-01-01T00:00:00.000Z",
      sampleOnly: true,
    });
    const options = () => {
      let id = 1000,
        nonce = 0;
      return {
        enabled: true,
        now: () => new Date(clock),
        idFactory: () => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`,
        nonceFactory: () =>
          createHash("sha256").update(`fixture-nonce-${++nonce}`).digest("base64url"),
      };
    };
    async function scenario(r: PublishRepository) {
      const a = await r.issuePreview(session, binding),
        b = await r.issuePreview(session, binding);
      const command = {
        approvalId: a.approvalId,
        nonce: a.nonce,
        binding,
        requestId: "00000000-0000-4000-8000-000000005001",
      };
      const i = await r.reserve(session, command);
      const replay = await r.reserve(session, command);
      const tab = await r.reserve(session, {
        approvalId: b.approvalId,
        nonce: b.nonce,
        binding,
        requestId: "00000000-0000-4000-8000-000000005002",
      });
      const claim = {
        ...step(i, "container_preparing"),
        requestId: "00000000-0000-4000-8000-000000005003",
      };
      const won = await r.transition(owner, claim),
        duplicate = await r.transition(owner, claim);
      const ready = await r.transition(owner, {
        ...step(won.intent, "provider_processing", { containerId: "123", status: "ready" }),
        requestId: "00000000-0000-4000-8000-000000005004",
      });
      const posted = await r.transition(owner, {
        ...step(ready.intent, "publish_requested"),
        requestId: "00000000-0000-4000-8000-000000005005",
      });
      const u = await r.transition(owner, {
        ...step(posted.intent, "outcome_unknown", { status: "unknown", code: "PROVIDER_TIMEOUT" }),
        requestId: "00000000-0000-4000-8000-000000005006",
      });
      await expect(r.transition(owner, step(u.intent, "publish_requested"))).rejects.toThrow(
        "PUBLISH_TRANSITION",
      );
      return {
        a,
        b,
        i,
        replay,
        tab,
        won,
        duplicate,
        ready,
        posted,
        u,
        cleanup: await r.cleanup(owner),
      };
    }
    const expected = await scenario(
      new MemoryPublishRepository({ ...options(), database: memory }),
    );
    expect(await scenario(new SupabasePublishRepository({ ...options(), rpc: call }))).toEqual(
      expected,
    );
  });
  it("checks every new FK has a leading lookup index and rejects exact duplicates", async () => {
    const catalog = (
      await db.query<{ tablename: string; indexname: string; indexdef: string }>(
        "select tablename,indexname,indexdef from pg_indexes where schemaname='private' and tablename like 'creator_publish_%' order by tablename,indexname",
      )
    ).rows;
    expect(catalog).toHaveLength(20);
    const duplicates = (
      await db.query(`select a.indexrelid::regclass::text a,b.indexrelid::regclass::text b from pg_index a join pg_index b on a.indrelid=b.indrelid and a.indexrelid<b.indexrelid
      where a.indrelid in (select oid from pg_class where relname like 'creator_publish_%' and relkind='r') and a.indkey=b.indkey and a.indclass=b.indclass and a.indcollation=b.indcollation and a.indoption=b.indoption
      and coalesce(a.indexprs::text,'')=coalesce(b.indexprs::text,'') and coalesce(a.indpred::text,'')=coalesce(b.indpred::text,'')`)
    ).rows;
    expect(duplicates).toEqual([]);
    const missing = (
      await db.query(`select conname from pg_constraint c where contype='f' and conrelid in (select oid from pg_class where relname like 'creator_publish_%' and relkind='r')
      and not exists(select 1 from pg_index i where i.indrelid=c.conrelid and i.indisvalid and i.indpred is null
        and (i.indkey::smallint[])[0:cardinality(c.conkey)-1]=array(select x from unnest(c.conkey) x))`)
    ).rows;
    expect(missing).toEqual([]);
    const names = catalog.map((r) => r.indexname);
    expect(names).toEqual(
      expect.arrayContaining([
        "creator_publish_intents_owner_recent",
        "creator_publish_intents_owner_expiry",
        "creator_publish_approvals_owner_expiry",
        "creator_publish_intents_revision",
      ]),
    );
    await writeFile(
      ".superpowers/sdd/2026-11-04-kocmax-instagram-publishing-pilot/task-3-results/index-catalog.json",
      JSON.stringify(catalog, null, 2) + "\n",
    );
  });
  it("private helper grants remain closed and no RLS allow policy is introduced", async () => {
    expect(
      (
        await db.query(
          "select * from pg_policies where schemaname='private' and tablename like 'creator_publish_%'",
        )
      ).rows,
    ).toEqual([]);
    const helpers = (
      await db.query<{ signature: string }>(
        "select p.oid::regprocedure::text signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname like 'creator_publish_%'",
      )
    ).rows;
    expect(helpers).toHaveLength(9);
    for (const role of ["anon", "authenticated", "service_role"])
      for (const helper of helpers) {
        const grant = await db.query<{ allowed: boolean }>(
          "select has_function_privilege($1,$2,'execute') allowed",
          [role, helper.signature],
        );
        expect(grant.rows[0].allowed).toBe(false);
      }
  });
  it("cleanup is bounded and leaves mission/point/XP/badge fixtures byte-for-byte unchanged", async () => {
    await db.query(
      "insert into public.point_transactions(creator_id,workspace_id,type,delta,source_ref) values($1,$2,'points',7,'fixture'),($1,$2,'xp',0,'fixture')",
      [actor, ws],
    );
    await db.query(
      "insert into public.studio_badges(workspace_id,creator_id,source_event) values($1,$2,'synthetic-baseline')",
      [ws, actor],
    );
    const tables = [
      "missions",
      "mission_submissions",
      "mission_work_items",
      "mission_pending_rewards",
      "point_transactions",
      "studio_badges",
    ];
    async function snapshot() {
      return Promise.all(
        tables.map(
          async (t) =>
            (await db.query(`select to_jsonb(t) value from public.${t} t order by id`)).rows,
        ),
      );
    }
    const before = await snapshot();
    await preview();
    await preview();
    const i = await intent();
    await repo.transition(owner, step(i, "cancelled"));
    clock += 91 * 86400_000;
    expect(await repo.cleanup(owner, 1)).toEqual({
      approvalsDeleted: 1,
      intentsDeleted: 1,
      heldUnknown: 0,
    });
    expect((await db.query("select 1 from private.creator_publish_approvals")).rows).toHaveLength(
      2,
    );
    expect(await snapshot()).toEqual(before);
    await repo.cleanup(owner, 100);
    expect((await db.query("select 1 from private.creator_publish_commands")).rows).toHaveLength(0);
    expect(
      (await db.query("select intent_id from private.creator_publish_revisions")).rows,
    ).toEqual([{ intent_id: null }]);
  });
  it("the documented transactional rollback removes only publish objects and restores cleanly", async () => {
    await db.query(
      "insert into public.point_transactions(creator_id,workspace_id,type,delta,source_ref) values($1,$2,'points',7,'fixture'),($1,$2,'xp',0,'fixture')",
      [actor, ws],
    );
    await db.query(
      "insert into public.studio_badges(workspace_id,creator_id,source_event) values($1,$2,'synthetic-baseline')",
      [ws, actor],
    );
    async function rewardSnapshot() {
      return Promise.all(
        ["missions", "mission_submissions", "mission_work_items", "mission_pending_rewards", "point_transactions", "studio_badges"].map(
          async (table) => (await db.query(`select to_jsonb(t) value from public.${table} t order by id`)).rows,
        ),
      );
    }
    const baseline = (
      await db.query(`select p.oid::regprocedure::text signature,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname in ('public','private') and p.proname not like 'creator_publish_%' order by 1`)
    ).rows;
    const tables = (
      await db.query(
        "select schemaname,tablename from pg_tables where schemaname in ('public','private','storage') and tablename not like 'creator_publish_%' order by 1,2",
      )
    ).rows;
    const original = await rewardSnapshot();
    const i = await intent();
    await repo.transition(owner, step(i, "container_preparing"));
    const doc = await readFile(
      "docs/review/kocmax-stage-5/instagram-publish-sql-review.md",
      "utf8",
    );
    const rollback = doc.match(/<!-- TASK3_ROLLBACK_START -->\s*```sql\s*([\s\S]+?)```/)?.[1];
    expect(rollback).toBeTruthy();
    await db.exec("savepoint before_documented_rollback");
    // Execute the exact rollback body inside the test's existing transaction, then restore it.
    await db.exec(rollback!.replace(/^begin;\s*/i, "").replace(/commit;\s*$/i, ""));
    expect(
      (await db.query("select * from pg_tables where tablename like 'creator_publish_%'")).rows,
    ).toEqual([]);
    expect(
      (await db.query("select * from pg_proc where proname like 'creator_publish_%'")).rows,
    ).toEqual([]);
    expect(
      (
        await db.query(`select p.oid::regprocedure::text signature,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname in ('public','private') order by 1`)
      ).rows,
    ).toEqual(baseline);
    expect(
      (
        await db.query(
          "select schemaname,tablename from pg_tables where schemaname in ('public','private','storage') order by 1,2",
        )
      ).rows,
    ).toEqual(tables);
    expect(await rewardSnapshot()).toEqual(original);
    await db.exec(
      "rollback to savepoint before_documented_rollback; release savepoint before_documented_rollback",
    );
    expect(await repo.getOwned(owner, i.id)).toMatchObject({ state: "container_preparing" });
  });
});
