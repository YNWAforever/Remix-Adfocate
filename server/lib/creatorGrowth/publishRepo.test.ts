// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  MemoryPublishDatabase,
  MemoryPublishRepository,
  SupabasePublishRepository,
  type PublishActor,
  type PublishBinding,
  type PublishIntent,
  type TransitionPublishInput,
} from "./publishRepo.js";

const owner = {
  workspaceId: "00000000-0000-4000-8000-000000000001",
  creatorId: "00000000-0000-4000-8000-000000000011",
};
const actor: PublishActor = { ...owner, sessionHash: "a".repeat(64) };
const binding: PublishBinding = {
  draftId: "00000000-0000-4000-8000-000000000021",
  draftRevision: 1,
  assetId: "00000000-0000-4000-8000-000000000031",
  imageSha256: "b".repeat(64),
  captionSha256: createHash("sha256").update("private caption").digest("hex"),
  connectionId: "00000000-0000-4000-8000-000000000041",
  accountSubject: "123456789",
  grantGeneration: 1,
  fingerprint: "c".repeat(64),
};
let database: MemoryPublishDatabase;
let repo: MemoryPublishRepository;
let time: number;
const source = (changes: Partial<PublishBinding> = {}) => ({
  owner,
  binding: { ...binding, ...changes },
  available: true,
  grantExpiresAt: "2099-01-01T00:00:00.000Z",
  assetExpiresAt: "2099-01-01T00:00:00.000Z",
  sampleOnly: true,
});
async function approval() {
  const preview = await repo.issuePreview(actor, binding);
  return { approvalId: preview.approvalId, nonce: preview.nonce, binding, requestId: randomUUID() };
}
async function intent() {
  return repo.reserve(actor, await approval());
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
describe("offline publish repository", () => {
  beforeEach(() => {
    time = Date.parse("2026-11-04T12:00:00.000Z");
    database = new MemoryPublishDatabase();
    database.setOwner(owner, "active");
    database.setSource(source());
    repo = new MemoryPublishRepository({ database, enabled: true, now: () => new Date(time) });
  });
  it("defaults disabled including injected Supabase RPC", async () => {
    let calls = 0;
    for (const r of [
      new MemoryPublishRepository({ database }),
      new SupabasePublishRepository({
        rpc: async () => {
          calls++;
          return {};
        },
      }),
    ]) {
      await expect(r.issuePreview(actor, binding)).rejects.toThrow("PUBLISH_DISABLED");
    }
    expect(calls).toBe(0);
  });
  it("requires a session-bound server nonce; fingerprint alone is insufficient", async () => {
    const a = await approval();
    await expect(repo.reserve(actor, { ...a, nonce: "" })).rejects.toThrow("PUBLISH_INVALID");
    await expect(repo.reserve({ ...actor, sessionHash: "d".repeat(64) }, a)).rejects.toThrow(
      "PUBLISH_APPROVAL_INVALID",
    );
    const i = await repo.reserve(actor, a);
    expect(i.state).toBe("creator_approved");
    expect(JSON.stringify(i)).not.toMatch(/private caption|nonce|sessionHash/);
  });
  it("replays a complete request across instances with original ID/times; changed binding conflicts", async () => {
    const a = await approval();
    const first = await repo.reserve(actor, a);
    time += 60_000;
    const next = new MemoryPublishRepository({
      database,
      enabled: true,
      now: () => new Date(time),
    });
    expect(await next.reserve(actor, a)).toEqual(first);
    await expect(
      next.reserve(actor, { ...a, binding: { ...binding, fingerprint: "d".repeat(64) } }),
    ).rejects.toThrow("PUBLISH_CONFLICT");
    await expect(next.reserve(actor, { ...a, requestId: randomUUID() })).rejects.toThrow(
      "PUBLISH_APPROVAL_INVALID",
    );
  });
  it("two valid tabs reserve one intent and two workers get one provider-write claim", async () => {
    const inputs = await Promise.all([approval(), approval()]);
    const intents = await Promise.all(inputs.map((a) => repo.reserve(actor, a)));
    expect(intents[0]).toEqual(intents[1]);
    const command = step(intents[0], "container_preparing");
    const claims = await Promise.allSettled([
      repo.transition(owner, command),
      repo.transition(owner, { ...command, requestId: randomUUID() }),
    ]);
    expect(claims.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(await repo.transition(owner, command)).toMatchObject({
      applied: false,
      intent: { state: "container_preparing" },
    });
  });
  it("rejects expired previews without changing state", async () => {
    const a = await approval();
    time += 5 * 60_000;
    await expect(repo.reserve(actor, a)).rejects.toThrow("PUBLISH_APPROVAL_INVALID");
  });
  it.each([
    "draftRevision",
    "imageSha256",
    "captionSha256",
    "accountSubject",
    "grantGeneration",
  ] as const)("rejects edited canonical %s", async (field) => {
    const a = await approval();
    const value =
      typeof binding[field] === "number" ? 2 : field === "accountSubject" ? "9999" : "d".repeat(64);
    database.setSource(source({ [field]: value }));
    await expect(repo.reserve(actor, a)).rejects.toThrow("PUBLISH_STALE");
  });
  it.each(["suspended", "deleted"] as const)(
    "denies %s owners including replay",
    async (status) => {
      const a = await approval();
      const i = await repo.reserve(actor, a);
      database.setOwner(owner, status);
      await expect(repo.getOwned(owner, i.id)).rejects.toThrow("PUBLISH_DENIED");
      await expect(repo.reserve(actor, a)).rejects.toThrow("PUBLISH_DENIED");
    },
  );
  it("denies same-workspace and cross-workspace owner reads and nonce use", async () => {
    const a = await approval();
    const i = await repo.reserve(actor, a);
    for (const other of [
      { ...owner, creatorId: randomUUID() },
      { workspaceId: randomUUID(), creatorId: randomUUID() },
    ]) {
      database.setOwner(other, "active");
      await expect(repo.getOwned(other, i.id)).rejects.toThrow("PUBLISH_DENIED");
      await expect(repo.reserve({ ...other, sessionHash: actor.sessionHash }, a)).rejects.toThrow(
        /PUBLISH_(STALE|APPROVAL_INVALID)/,
      );
    }
  });
  it("never reopens interrupted create or publish without a known provider receipt", async () => {
    const initial = await intent();
    const claim = await repo.transition(owner, step(initial, "container_preparing"));
    const unknown = await repo.transition(
      owner,
      step(claim.intent, "outcome_unknown", { code: "INTERRUPTED", status: "unknown" }),
    );
    await expect(
      repo.transition(owner, step(unknown.intent, "container_preparing")),
    ).rejects.toThrow("PUBLISH_TRANSITION");
    await expect(repo.transition(owner, step(unknown.intent, "publish_requested"))).rejects.toThrow(
      "PUBLISH_TRANSITION",
    );
    await expect(
      repo.transition(
        owner,
        step(unknown.intent, "published", { mediaId: "999", status: "published" }),
      ),
    ).rejects.toThrow("PUBLISH_TRANSITION");
    expect((await repo.reserve(actor, await approval())).id).toBe(initial.id);
  });
  it("requires a known ready container before publish CAS", async () => {
    const c = (await repo.transition(owner, step(await intent(), "container_preparing"))).intent;
    await expect(repo.transition(owner, step(c, "publish_requested"))).rejects.toThrow(
      "PUBLISH_TRANSITION",
    );
    const p = (
      await repo.transition(
        owner,
        step(c, "provider_processing", {
          containerId: "123",
          status: "processing",
          sampleOnly: true,
        }),
      )
    ).intent;
    await expect(repo.transition(owner, step(p, "publish_requested"))).rejects.toThrow(
      "PUBLISH_TRANSITION",
    );
    const ready = (
      await repo.transition(
        owner,
        step(p, "provider_processing", { containerId: "123", status: "ready" }),
      )
    ).intent;
    const claimed = (await repo.transition(owner, step(ready, "publish_requested"))).intent;
    expect(
      (
        await repo.transition(
          owner,
          step(claimed, "published", { mediaId: "456", status: "published" }),
        )
      ).intent.state,
    ).toBe("published");
  });
  it("canonical revoke stops in-flight work while retaining a target-bound late receipt", async () => {
    const c = (await repo.transition(owner, step(await intent(), "container_preparing"))).intent;
    database.setSource({ ...source(), available: false });
    const stopped = await repo.getOwned(owner, c.id);
    expect(stopped).toMatchObject({ state: "outcome_unknown", version: c.version + 1 });
    expect(stopped.stoppedAt).not.toBeNull();
    const input = {
      intentId: c.id,
      requestId: randomUUID(),
      target: binding,
      receipt: { containerId: "123", status: "processing" as const },
    };
    // Strict target shape intentionally excludes other approved binding fields.
    const target = {
      connectionId: binding.connectionId,
      accountSubject: binding.accountSubject,
      grantGeneration: binding.grantGeneration,
    };
    expect(await repo.recordLateReceipt(owner, { ...input, target })).toMatchObject({
      state: "outcome_unknown",
      lateReceipt: { containerId: "123" },
    });
    await expect(
      repo.recordLateReceipt(owner, { ...input, target: { ...target, grantGeneration: 2 } }),
    ).rejects.toThrow("PUBLISH_CONFLICT");
  });
  it("rejects unbounded or fabricated receipt fields without persisting them", async () => {
    const c = (await repo.transition(owner, step(await intent(), "container_preparing"))).intent;
    for (const receipt of [
      { token: "secret" },
      { containerId: "https://bad.test" },
      { status: { raw: "data:image/png;base64,x" } },
      { code: "raw exception text" },
    ]) {
      await expect(
        repo.transition(owner, step(c, "provider_processing", receipt as never)),
      ).rejects.toThrow("PUBLISH_INVALID");
    }
    expect((await repo.getOwned(owner, c.id)).version).toBe(c.version);
  });
  it("bounded cleanup removes expired approvals and terminal metadata but holds external uncertainty", async () => {
    await approval();
    const i = await intent();
    await repo.transition(owner, step(i, "cancelled"));
    const otherBinding = { ...binding, draftRevision: 2 };
    database.setSource(source({ draftRevision: 2 }));
    const p = await repo.issuePreview(actor, otherBinding);
    const u = await repo.reserve(actor, {
      approvalId: p.approvalId,
      nonce: p.nonce,
      binding: otherBinding,
      requestId: randomUUID(),
    });
    await repo.transition(owner, step(u, "container_preparing"));
    time += 91 * 86400_000;
    const result = await repo.cleanup(owner, 100);
    expect(result).toMatchObject({ intentsDeleted: 1, heldUnknown: 1 });
    expect((await repo.getOwned(owner, u.id)).state).toBe("container_preparing");
  });
  it("cannot publish the same source revision again after terminal receipt cleanup", async () => {
    const i = await intent();
    await repo.transition(owner, step(i, "cancelled"));
    time += 91 * 86400_000;
    expect((await repo.cleanup(owner)).intentsDeleted).toBe(1);
    await expect(repo.reserve(actor, await approval())).rejects.toThrow("PUBLISH_CONFLICT");
  });
  it("rejects provider facts before a provider write claim", async () => {
    const i = await intent();
    await expect(
      repo.transition(
        owner,
        step(i, "container_preparing", { mediaId: "987", status: "published" }),
      ),
    ).rejects.toThrow("PUBLISH_TRANSITION");
  });
  it("does not allow a poll to invent a media receipt before publish is requested", async () => {
    const c = (await repo.transition(owner, step(await intent(), "container_preparing"))).intent;
    await expect(
      repo.transition(
        owner,
        step(c, "provider_processing", { containerId: "123", mediaId: "456", status: "ready" }),
      ),
    ).rejects.toThrow("PUBLISH_TRANSITION");
  });
  it("rejects non-scalar undefined fields and preserves canonical DTO ownership", async () => {
    const i = await intent();
    await expect(
      repo.transition(owner, step(i, "cancelled", { status: undefined })),
    ).rejects.toThrow("PUBLISH_INVALID");
    const unsafe = new SupabasePublishRepository({
      enabled: true,
      rpc: async () => ({ ...i, owner: actor }),
    });
    await expect(unsafe.getOwned(owner, i.id)).rejects.toThrow("PUBLISH_UNAVAILABLE");
  });
  it("never returns raw transport errors or arbitrary exception text", async () => {
    const remote = new SupabasePublishRepository({
      enabled: true,
      rpc: async () => {
        throw new Error("secret-token data:image/png;base64,raw");
      },
    });
    await expect(remote.getOwned(owner, randomUUID())).rejects.toMatchObject({
      code: "PUBLISH_UNAVAILABLE",
      message: "PUBLISH_UNAVAILABLE",
    });
  });
  it("replays a write claim after revoke only as applied:false and the stopped current state", async () => {
    const i = await intent();
    const command = step(i, "container_preparing");
    await repo.transition(owner, command);
    database.setSource({ ...source(), available: false });
    expect(await repo.transition(owner, command)).toMatchObject({
      applied: false,
      intent: { state: "outcome_unknown" },
    });
  });
  it.each([
    ["container_preparing", false], ["provider_processing", false],
    ["container_preparing", true], ["provider_processing", true],
  ] as const)("I1 rejects late media evidence after %s (interrupted=%s) without a publish claim", async (phase, interrupted) => {
    let current = (await repo.transition(owner, step(await intent(), "container_preparing"))).intent;
    if (phase === "provider_processing") current = (await repo.transition(owner,
      step(current, "provider_processing", { containerId: "123", status: "ready" }))).intent;
    if (interrupted) current = (await repo.transition(owner,
      step(current, "outcome_unknown", { code: "INTERRUPTED" }))).intent;
    const fresh = new MemoryPublishRepository({ database, enabled: true, now: () => new Date(time) });
    await expect((async () => {
      const late = await fresh.recordLateReceipt(owner, {
        intentId: current.id, requestId: randomUUID(),
        target: { connectionId: binding.connectionId, accountSubject: binding.accountSubject, grantGeneration: 1 },
        receipt: { mediaId: "456" },
      });
      // Reproduce the full review trace, including false published promotion from CREATE-unknown.
      return interrupted ? fresh.transition(owner, step(late, "published", { mediaId: "456", status: "published" })) : late;
    })()).rejects.toThrow("PUBLISH_TRANSITION");
    expect(await repo.getOwned(owner, current.id)).toEqual(current);
  });
  it("reconciles only a known media ID; stopped late receipts never revive the state", async () => {
    const c = (await repo.transition(owner, step(await intent(), "container_preparing"))).intent;
    const ready = (
      await repo.transition(
        owner,
        step(c, "provider_processing", { containerId: "123", status: "ready" }),
      )
    ).intent;
    const posting = (await repo.transition(owner, step(ready, "publish_requested"))).intent;
    const u = (
      await repo.transition(owner, step(posting, "outcome_unknown", { code: "PROVIDER_TIMEOUT" }))
    ).intent;
    const late = await repo.recordLateReceipt(owner, {
      intentId: u.id,
      requestId: randomUUID(),
      target: {
        connectionId: binding.connectionId,
        accountSubject: binding.accountSubject,
        grantGeneration: 1,
      },
      receipt: { mediaId: "456" },
    });
    await expect(
      repo.transition(owner, step(late, "published", { mediaId: "999", status: "published" })),
    ).rejects.toThrow("PUBLISH_CONFLICT");
    expect(
      (
        await repo.transition(
          owner,
          step(late, "published", { mediaId: "456", status: "published" }),
        )
      ).intent.state,
    ).toBe("published");
  });
});
