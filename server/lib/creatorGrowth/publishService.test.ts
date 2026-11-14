// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryPublishDatabase, MemoryPublishRepository, PublishRepositoryError, type PublishBinding } from "./publishRepo.js";
import { MockInstagramPublisher, type MockPublisherOptions } from "./instagramPublisher.js";
import { MockNativeInstagramAdapter } from "./instagramNativeAdapter.js";
import { MockMediaLease } from "./mediaLease.js";
import { validatePublishDraft } from "./publishPolicy.js";
import { PublishService, type PublishServiceDependencies, type ResolvedPublishDraft } from "./publishService.js";
import { Hono } from "hono";
import type { Env } from "../../app.js";
import { createCreatorGrowthPublishRoutes } from "../../routes/creatorGrowthPublish.js";

const owner = { workspaceId: "00000000-0000-4000-8000-000000000001", creatorId: "00000000-0000-4000-8000-000000000011" };
const actor = { ...owner, sessionHash: "a".repeat(64) };
const draftId = "00000000-0000-4000-8000-000000000021";
const assetId = "00000000-0000-4000-8000-000000000031";
const target = { connectionId: "00000000-0000-4000-8000-000000000041", accountSubject: "123456789", grantGeneration: 1 };
const bytes = new Uint8Array([255, 216, 255, 217]); // Explicit synthetic fixture, no real user's image.
const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const dtoPrivateFixture = {
  token: "SECRET-publish-dto-canary-a923557c-7c4b-422c-a6db",
  storageUrl: "https://private.invalid/publish-fixture/a923557c",
  missionProof: "PRIVATE-mission-proof-canary-f5161e99-58eb-4c0a",
};
const dtoPrivateValues = [...Object.values(dtoPrivateFixture), actor.sessionHash, bytes, Array.from(bytes)];
function expectSafePublishDtos(value: unknown, privateValues: readonly unknown[]) {
  function visit(current: unknown) {
    for (const privateValue of privateValues) {
      expect(current).not.toEqual(privateValue);
      if (typeof current === "string" && typeof privateValue === "string") expect(current).not.toContain(privateValue);
    }
    if (current === null || typeof current !== "object") return;
    for (const [key, child] of Object.entries(current)) {
      const words = key.replace(/([A-Z])([A-Z][a-z])/g, "$1_$2").replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase().split(/[^a-z0-9]+/);
      expect(words.some(word => ["secret", "token", "bytes", "points", "xp"].includes(word))).toBe(false);
      expect(["storageurl", "sessionhash", "missionproof"].includes(words.join(""))).toBe(false);
      visit(child);
    }
  }
  visit(value);
}

function fixture(options: Partial<MockPublisherOptions> = {}) {
  let time = Date.parse("2026-11-04T12:00:00.000Z");
  const now = () => new Date(time);
  const resolved: ResolvedPublishDraft = {
    draft: { id: draftId, revision: 1, owner: { ...owner }, accountSubject: target.accountSubject,
      imageSha256: sha(bytes), rightsConfirmed: true, caption: "Synthetic caption 🌱",
      asset: { mime: "image/jpeg", byteSize: bytes.length, width: 400, height: 400, validated: true },
      disclosure: { sponsored: false, captionText: "", platformLabelRequired: false, brandTagRequired: false } },
    assetId, connectionId: target.connectionId, accountLabel: "@synthetic_creator", sourceKind: "synthetic-fixture", sampleOnly: true,
    grant: { subject: target.accountSubject, appId: "987", generation: 1, status: "active",
      scopes: ["instagram_business_basic", "instagram_business_content_publish"], expiresAt: "2099-01-01T00:00:00.000Z" },
    basis: null,
    // Synthetic metadata/limits, expressly NOT claimed Meta limits or live contract.
    contract: { evidence: "synthetic", appId: "987", apiVersion: "v26.0", login: "instagram_login",
      authorizeHost: "www.instagram.com", graphHost: "graph.instagram.com", tokenSubjectKind: "instagram_user",
      profileSubjectKind: "professional_account", publishScope: "instagram_business_content_publish",
      supportsPaidPartnershipLabel: false, supportsBrandTag: false,
      revoke: { method: "DELETE", path: "/fixture/revoke", tokenKind: "instagram_user", successRule: "fixture_success" },
      noticeIdentityRule: "synthetic-app-and-subject-binding", sourceUrls: ["https://example.invalid/synthetic-contract"], checkedAt: now().toISOString(),
      limits: { version: "fixture-v1", apiVersion: "v26.0", mime: "image/jpeg", maxBytes: 1024,
        minWidth: 100, maxWidth: 1000, minHeight: 100, maxHeight: 1000, minAspectRatio: 0.5, maxAspectRatio: 2, maxCaptionCodePoints: 100 } },
  };
  const database = new MemoryPublishDatabase();
  database.setOwner(owner, "active");
  const binding = (): PublishBinding => ({ draftId, draftRevision: resolved.draft.revision, assetId: resolved.assetId,
    imageSha256: resolved.draft.imageSha256, captionSha256: sha(resolved.draft.caption), connectionId: resolved.connectionId,
    accountSubject: resolved.draft.accountSubject, grantGeneration: resolved.grant.generation,
    fingerprint: validatePublishDraft(resolved.draft, resolved.grant, resolved.basis, resolved.contract, now()).fingerprint ?? "f".repeat(64) });
  const sync = () => database.setSource({ owner, binding: binding(), available: resolved.grant.status === "active",
    grantExpiresAt: resolved.grant.expiresAt, assetExpiresAt: "2099-01-01T00:00:00.000Z", sampleOnly: true });
  sync();
  const repo = new MemoryPublishRepository({ database, enabled: true, now });
  const publisher = new MockInstagramPublisher({ target, ...options });
  const lease = new MockMediaLease({ now, authorize: async b => resolved.grant.status === "active"
    && b.grantGeneration === resolved.grant.generation && b.fingerprint === binding().fingerprint,
    loadAsset: async () => ({ ...owner, assetId, imageSha256: sha(bytes), bytes, mime: "image/jpeg", sourceKind: "synthetic-fixture", sampleOnly: true, validated: true }) });
  const resolveDraft = vi.fn(async () => structuredClone(resolved));
  const deps: PublishServiceDependencies = { enabled: true, repo, publisher, lease, resolveDraft, now,
    operationTimeoutMs: 100, inFlightTimeoutMs: 1000, mediaTtlMs: 1000 };
  const service = new PublishService(deps);
  const approve = async (s = service) => {
    const p = await s.prepare(actor, draftId);
    return s.approve(actor, { draftId, approvalId: p.approvalId!, nonce: p.nonce!, fingerprint: p.fingerprint!, requestId: randomUUID() });
  };
  const revoke = () => { resolved.grant.status = "revoked"; sync(); };
  return { service, deps, resolved, database, repo, publisher, lease, resolveDraft, binding, sync, approve, revoke, advance: (ms: number) => { time += ms; } };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

function mission(f: ReturnType<typeof fixture>) {
  f.resolved.draft.mission = { kind: "active", submissionId: "submission-a", workItemId: "work-a", approvedVersionId: "version-a", instructionRevision: 2 };
  f.resolved.basis = { owner, submissionId: "submission-a", workItemId: "work-a", state: "approved_to_publish", approvedVersionId: "version-a",
    approvedCaption: f.resolved.draft.caption, approvedAssetHashes: [f.resolved.draft.imageSha256], expectedAccount: target.accountSubject,
    requiredDisclosures: [], disclosureRequirements: { sponsored: false, platformLabelRequired: false, brandTagRequired: false }, instructionRevision: 2 };
  f.sync();
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("mock-only publish service approval", () => {
  it("runs the native-shaped mock through durable approval and keeps its receipt synthetic", async () => {
    const f = fixture();
    const adapter = new MockNativeInstagramAdapter({ target, enabled: true });
    const service = new PublishService({ ...f.deps, publisher: adapter });
    const intent = await f.approve(service);
    const result = await service.execute(owner, intent.id);
    expect(result).toMatchObject({ state: "published", sampleOnly: true, permalink: null });
    await service.execute(owner, intent.id);
    expect(adapter.callCounts().publish).toBe(1);
  });
  it("denies by default before any dependency call, including explicit false", async () => {
    const f = fixture();
    for (const s of [new PublishService(), new PublishService({ ...f.deps, enabled: false })]) {
      await expect(s.prepare(actor, draftId)).rejects.toThrow("PUBLISH_DISABLED");
      await expect(s.execute(owner, randomUUID())).rejects.toThrow("PUBLISH_DISABLED");
    }
    expect(f.resolveDraft).not.toHaveBeenCalled();
    expect(f.publisher.callCounts()).toEqual({ create: 0, status: 0, publish: 0, lookup: 0 });
  });

  it("returns exact safe preview and durable one-use approval without executing", async () => {
    const f = fixture();
    const p = await f.service.prepare(actor, draftId);
    expect(p).toMatchObject({ eligible: true, sampleOnly: true, caption: "Synthetic caption 🌱", accountLabel: "@synthetic_creator",
      accountSubject: "123456789", draftId, draftRevision: 1, assetId, mission: null, missionBasisVersionId: null });
    expect(p.nonce).toBeTruthy(); expect(p.approvalId).toBeTruthy(); expect(p.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    const input = { draftId, approvalId: p.approvalId!, nonce: p.nonce!, fingerprint: p.fingerprint!, requestId: randomUUID() };
    const status = await f.service.approve(actor, input);
    expect(status).toMatchObject({ state: "creator_approved", sampleOnly: true, permalink: null });
    expect(await new PublishService(f.deps).approve(actor, input)).toEqual(status);
    expect(f.publisher.callCounts()).toEqual({ create: 0, status: 0, publish: 0, lookup: 0 });
    await expect(f.service.approve(actor, { ...input, requestId: randomUUID() })).rejects.toThrow("PUBLISH_APPROVAL_INVALID");
  });

  it.each(["expired", "session", "caption", "image", "grant", "mission", "asset", "connection"])("rejects %s drift after preview", async kind => {
    const f = fixture();
    const p = await f.service.prepare(actor, draftId);
    let currentActor = actor;
    if (kind === "expired") f.advance(300_000);
    if (kind === "session") currentActor = { ...actor, sessionHash: "b".repeat(64) };
    if (kind === "caption") f.resolved.draft.caption += " changed";
    if (kind === "image") f.resolved.draft.imageSha256 = "c".repeat(64);
    if (kind === "grant") f.resolved.grant.generation++;
    if (kind === "mission") f.resolved.draft.mission = { kind: "active", submissionId: "s", workItemId: "w", approvedVersionId: "v", instructionRevision: 1 };
    if (kind === "asset") f.resolved.assetId = randomUUID();
    if (kind === "connection") f.resolved.connectionId = randomUUID();
    if (!["expired", "session"].includes(kind)) f.sync();
    await expect(f.service.approve(currentActor, { draftId, approvalId: p.approvalId!, nonce: p.nonce!, fingerprint: p.fingerprint!, requestId: randomUUID() })).rejects.toThrow(/PUBLISH_(STALE|APPROVAL_INVALID|CONFLICT)/);
    expect(f.publisher.callCounts().create).toBe(0);
  });

  it("keeps manual fallback with null contract, empty caption, and no approval", async () => {
    const f = fixture(); f.resolved.contract = null; f.resolved.draft.caption = ""; f.resolved.draft.disclosure.sponsored = true;
    const p = await f.service.prepare(actor, draftId);
    expect(p).toMatchObject({ eligible: false, reason: "PUBLISH_PROTOCOL_UNVERIFIED", fallback: "manual_proof", approvalId: null, nonce: null, expiresAt: null, fingerprint: null });
    expect(f.publisher.callCounts().create).toBe(0);
  });

  it.each(["caption", "revision", "instructions", "account", "disclosure"])("rejects original mission %s changes while approve re-reads", async change => {
    const f = fixture(); mission(f);
    const p = await f.service.prepare(actor, draftId);
    expect(p.mission).toMatchObject({ approvedVersionId: "version-a", instructionRevision: 2, state: "approved_to_publish" });
    if (change === "caption") f.resolved.basis!.approvedCaption = "new approved caption";
    if (change === "revision") f.resolved.basis!.approvedVersionId = "version-b";
    if (change === "instructions") f.resolved.basis!.instructionRevision++;
    if (change === "account") f.resolved.basis!.expectedAccount = "999999";
    if (change === "disclosure") f.resolved.basis!.requiredDisclosures = ["#ad"];
    await expect(f.service.approve(actor, { draftId, approvalId: p.approvalId!, nonce: p.nonce!, fingerprint: p.fingerprint!, requestId: randomUUID() })).rejects.toMatchObject({ code: "PUBLISH_STALE" });
    expect(f.publisher.callCounts().create).toBe(0);
  });

  it("rejects extra client facts, malformed input and owned-ID substitution", async () => {
    const f = fixture(); const p = await f.service.prepare(actor, draftId);
    const input = { draftId, approvalId: p.approvalId!, nonce: p.nonce!, fingerprint: p.fingerprint!, requestId: randomUUID() };
    for (const patch of [{ grant: f.resolved.grant }, { mission: {} }, { nonce: "" }, { requestId: "SECRET" }, { draftId: randomUUID() }]) {
      await expect(f.service.approve(actor, { ...input, ...patch })).rejects.toMatchObject({ code: expect.stringMatching(/^PUBLISH_(INVALID|DENIED)$/) });
    }
    const i = await f.service.approve(actor, input);
    for (const other of [{ ...owner, creatorId: randomUUID() }, { ...owner, workspaceId: randomUUID() }]) {
      f.database.setOwner(other, "active");
      await expect(f.service.prepare({ ...other, sessionHash: actor.sessionHash }, draftId)).rejects.toMatchObject({ code: "PUBLISH_DENIED" });
      await expect(f.service.getOwned(other, i.id)).rejects.toMatchObject({ code: "PUBLISH_DENIED" });
      await expect(f.service.execute(other, i.id)).rejects.toMatchObject({ code: "PUBLISH_DENIED" });
      await expect(f.service.reconcile(other, i.id)).rejects.toMatchObject({ code: "PUBLISH_DENIED" });
    }
  });

  it("gives no approval to non-synthetic sources or verified/live capabilities and retains mission fallback", async () => {
    const f = fixture(); mission(f); f.resolved.contract!.evidence = "verified";
    expect(await f.service.prepare(actor, draftId)).toMatchObject({ eligible: false, fallback: "manual_proof", nonce: null });
    f.resolved.contract!.evidence = "synthetic"; f.resolved.sourceKind = "user-upload";
    expect(await f.service.prepare(actor, draftId)).toMatchObject({ eligible: false, nonce: null });
    f.resolved.sourceKind = "synthetic-fixture"; f.resolved.sampleOnly = false;
    expect(await f.service.prepare(actor, draftId)).toMatchObject({ eligible: false, nonce: null });
  });

  it("bounds unrecognized error codes even when injected dependencies throw repository errors", async () => {
    const f = fixture(); f.resolveDraft.mockRejectedValue(new PublishRepositoryError("SECRET https://private.invalid" as never));
    await expect(f.service.prepare(actor, draftId)).rejects.toMatchObject({ code: "PUBLISH_UNAVAILABLE", message: "PUBLISH_UNAVAILABLE" });
  });

  it.each(["preview", "reserve"])("rechecks authority after durable %s await", async boundary => {
    const f = fixture();
    if (boundary === "preview") {
      const original = f.repo.issuePreview.bind(f.repo);
      vi.spyOn(f.repo, "issuePreview").mockImplementation(async (...args) => { const r = await original(...args); f.revoke(); return r; });
      await expect(f.service.prepare(actor, draftId)).rejects.toMatchObject({ code: "PUBLISH_STALE" });
    } else {
      const original = f.repo.reserve.bind(f.repo);
      vi.spyOn(f.repo, "reserve").mockImplementation(async (...args) => { const r = await original(...args); f.revoke(); return r; });
      await expect(f.approve()).rejects.toMatchObject({ code: "PUBLISH_STALE" });
    }
    expect(f.publisher.callCounts()).toEqual({ create: 0, status: 0, publish: 0, lookup: 0 });
  });

  it("does not return an already expired approval after a delayed preview write", async () => {
    const f = fixture(); const issue = f.repo.issuePreview.bind(f.repo);
    vi.spyOn(f.repo, "issuePreview").mockImplementation(async (...args) => { const p = await issue(...args); f.advance(300_000); return p; });
    await expect(f.service.prepare(actor, draftId)).rejects.toMatchObject({ code: "PUBLISH_STALE" });
  });
});

describe("durable worker orchestration", () => {
  it("two services, repository instances and valid tabs produce one intent, one create and one publish", async () => {
    const f = fixture();
    const second = new PublishService({ ...f.deps, repo: new MemoryPublishRepository({ database: f.database, enabled: true, now: f.deps.now }) });
    const [a, b] = await Promise.all([f.approve(), f.approve(second)]);
    expect(a.id).toBe(b.id);
    await Promise.all([f.service.execute(owner, a.id), second.execute(owner, b.id)]);
    expect(await f.service.getOwned(owner, a.id)).toMatchObject({ state: "published", sampleOnly: true, permalink: null,
      providerMediaId: "91000000000000001", providerContainerId: "90000000000000001" });
    await second.execute(owner, a.id);
    expect(f.publisher.callCounts()).toEqual({ create: 1, status: 1, publish: 1, lookup: 1 });
  });

  it.each(["processing", "failed"] as const)("distinguishes container %s without publishing", async containerState => {
    const f = fixture({ containerState }); const i = await f.approve();
    expect((await f.service.execute(owner, i.id)).state).toBe(containerState === "processing" ? "provider_processing" : "failed");
    await f.service.execute(owner, i.id);
    expect(f.publisher.callCounts().create).toBe(1); expect(f.publisher.callCounts().publish).toBe(0);
  });

  it.each(["timeout_before_accept", "timeout_after_accept"] as const)("keeps %s unknown without any second POST or guessed lookup", async publishOutcome => {
    const f = fixture({ publishOutcome }); const i = await f.approve();
    expect((await f.service.execute(owner, i.id)).state).toBe("outcome_unknown");
    await f.service.execute(owner, i.id); await f.service.reconcile(owner, i.id);
    expect(f.publisher.callCounts()).toEqual({ create: 1, status: 1, publish: 1, lookup: 0 });
  });

  it.each(["container_preparing", "publish_requested"] as const)("waits for bounded %s interruption then unknown without retry", async state => {
    const f = fixture(); const i = await f.approve();
    let raw = await f.repo.getOwned(owner, i.id);
    const step = async (nextState: typeof raw.state, receipt = {}) => {
      raw = (await f.repo.transition(owner, { intentId: raw.id, expectedVersion: raw.version, expectedState: raw.state,
        nextState, fingerprint: raw.binding.fingerprint, requestId: randomUUID(), receipt })).intent;
    };
    await step("container_preparing");
    if (state === "publish_requested") { await step("provider_processing", { containerId: "123456", status: "ready", sampleOnly: true }); await step(state); }
    expect((await f.service.execute(owner, i.id)).state).toBe(state);
    f.advance(1001);
    expect((await new PublishService(f.deps).execute(owner, i.id)).state).toBe("outcome_unknown");
    expect(f.publisher.callCounts()).toEqual({ create: 0, status: 0, publish: 0, lookup: 0 });
  });

  it("requires exact media ID and subject lookup; reconciliation only reads", async () => {
    const f = fixture(); const lookup = f.publisher.getPublishedMedia.bind(f.publisher);
    const spy = vi.spyOn(f.publisher, "getPublishedMedia").mockImplementation(async (t, id) => ({ ...await lookup(t, id), accountSubject: "999999" }));
    const i = await f.approve(); expect((await f.service.execute(owner, i.id)).state).toBe("outcome_unknown");
    spy.mockImplementation(lookup);
    expect((await f.service.reconcile(owner, i.id)).state).toBe("published");
    expect(f.publisher.callCounts()).toEqual({ create: 1, status: 1, publish: 1, lookup: 2 });
  });

  it.each(["lease", "create", "status", "publish", "lookup"])("stops on revoke during %s await and retains old-target late receipt", async boundary => {
    const f = fixture(); let handle = "";
    const open = f.lease.open.bind(f.lease);
    vi.spyOn(f.lease, "open").mockImplementation(async (...args) => { const r = await open(...args); handle = r.handle; if (boundary === "lease") f.revoke(); return r; });
    const methods = { create: "createImageContainer", status: "getContainerStatus", publish: "publishContainer", lookup: "getPublishedMedia" } as const;
    if (boundary !== "lease") {
      const method = methods[boundary as keyof typeof methods];
      const original = f.publisher[method].bind(f.publisher) as (...args: unknown[]) => Promise<unknown>;
      vi.spyOn(f.publisher, method).mockImplementation((async (...args: unknown[]) => { const r = await original(...args); f.revoke(); return r; }) as never);
    }
    const i = await f.approve(); const status = await f.service.execute(owner, i.id);
    expect(status.state).not.toBe("published"); expect(status.stopped).toBe(true);
    const counts = f.publisher.callCounts();
    expect(counts.create).toBe(boundary === "lease" ? 0 : 1);
    expect(counts.publish).toBe(["publish", "lookup"].includes(boundary) ? 1 : 0);
    expect(counts.lookup).toBe(boundary === "lookup" ? 1 : 0);
    if (["publish", "lookup"].includes(boundary)) expect((await f.repo.getOwned(owner, i.id)).lateReceipt.mediaId).toBe("91000000000000001");
    f.resolved.grant.status = "active"; f.resolved.grant.generation++; f.resolved.draft.accountSubject = "777777"; f.resolved.grant.subject = "777777"; f.sync();
    await f.service.execute(owner, i.id); await f.service.reconcile(owner, i.id);
    expect(f.publisher.callCounts()).toEqual(counts); expect(await f.lease.read(handle)).toBeNull();
  });

  it("returns safe DTOs and bounded errors without a network transport", async () => {
    const fetch = vi.fn(() => { throw new Error("NETWORK_FORBIDDEN"); }); vi.stubGlobal("fetch", fetch);
    const f = fixture();
    Object.assign(f.resolved, { ...dtoPrivateFixture, bytes, sessionHash: actor.sessionHash, points: 12345, XP: 67890 });
    const open = vi.spyOn(f.lease, "open");
    const p = await f.service.prepare(actor, draftId); const i = await f.approve();
    const done = await f.service.execute(owner, i.id);
    expect(open).toHaveBeenCalledTimes(1);
    const lease = await open.mock.results[0]!.value;
    expect(lease.handle).toMatch(/^mock-lease:/);
    expectSafePublishDtos([p, i, done], [...dtoPrivateValues, lease.handle]);
    f.resolveDraft.mockRejectedValue(new Error(`${dtoPrivateFixture.token} ${dtoPrivateFixture.storageUrl}`));
    await expect(f.service.prepare(actor, draftId)).rejects.toThrow(/^PUBLISH_UNAVAILABLE$/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("allows XP inside an actual public approval nonce without treating it as a financial field", async () => {
    const f = fixture(), nonce = `XPEC${"a".repeat(39)}`;
    const repo = new MemoryPublishRepository({ database: f.database, enabled: true, now: f.deps.now, nonceFactory: () => nonce });
    const service = new PublishService({ ...f.deps, repo });
    const preview = await service.prepare(actor, draftId);
    expect(preview.nonce).toBe(nonce);
    expectSafePublishDtos(preview, dtoPrivateValues);
  });

  it.each(["SECRET", "token", "access_token", "storageUrl", "storage_url", "bytes", "sessionHash", "missionProof", "points", "pointsAwarded", "XP", "xp_awarded", "creatorXP"])("rejects a nested private DTO field %s even when its value is unrelated", key => {
    expect(() => expectSafePublishDtos({ nonce: `XPEC${"a".repeat(39)}`, nested: [{ [key]: "unrelated-placeholder" }] }, dtoPrivateValues)).toThrow();
  });

  it.each(dtoPrivateValues.map((value, index) => ({ value, index })))("rejects exact private fixture value $index under an otherwise public field", ({ value }) => {
    expect(() => expectSafePublishDtos({ nested: [{ caption: value }] }, dtoPrivateValues)).toThrow();
  });

  it("rejects the complete private token or lease capability embedded in a public string", () => {
    const handle = `mock-lease:${"b".repeat(43)}`;
    for (const value of [dtoPrivateFixture.token, handle]) {
      expect(() => expectSafePublishDtos({ caption: `prefix ${value} suffix` }, [...dtoPrivateValues, handle])).toThrow();
    }
  });

  it.each(["container", "publish"])("retains returned %s ID when receipt persistence fails without replaying writes", async boundary => {
    const f = fixture(); const i = await f.approve(); const transition = f.repo.transition.bind(f.repo);
    let failed = false;
    vi.spyOn(f.repo, "transition").mockImplementation(async (o, command) => {
      if (!failed && (boundary === "container" ? command.nextState === "provider_processing" : command.receipt?.mediaId)) {
        failed = true; throw new Error("SECRET storage failure");
      }
      return transition(o, command);
    });
    expect((await f.service.execute(owner, i.id)).state).toBe("outcome_unknown");
    const persisted = await f.repo.getOwned(owner, i.id);
    expect(persisted.lateReceipt).toMatchObject(boundary === "container" ? { containerId: "90000000000000001" } : { mediaId: "91000000000000001" });
    await f.service.execute(owner, i.id);
    if (boundary === "publish") expect((await f.service.reconcile(owner, i.id)).state).toBe("published");
    expect(f.publisher.callCounts().create).toBe(1); expect(f.publisher.callCounts().publish).toBe(boundary === "publish" ? 1 : 0);
  });

  it("closes the synthetic lease when stop wins during the ready CAS", async () => {
    const f = fixture(); const i = await f.approve(); const transition = f.repo.transition.bind(f.repo);
    const close = vi.spyOn(f.lease, "close");
    vi.spyOn(f.repo, "transition").mockImplementation(async (o, command) => {
      const result = await transition(o, command);
      if (command.nextState === "publish_requested") f.revoke();
      return result;
    });
    expect((await f.service.execute(owner, i.id)).stopped).toBe(true);
    // open itself calls close; the stop must cause another close after the handle exists.
    expect(close.mock.calls.length).toBeGreaterThan(1);
    expect(f.publisher.callCounts().publish).toBe(0);
  });

  it("never uses expired grant after an awaited readiness check", async () => {
    const f = fixture(); const i = await f.approve(); const status = f.publisher.getContainerStatus.bind(f.publisher);
    vi.spyOn(f.publisher, "getContainerStatus").mockImplementation(async (...args) => {
      const r = await status(...args); f.resolved.grant.expiresAt = f.deps.now().toISOString(); return r;
    });
    expect((await f.service.execute(owner, i.id)).state).toBe("outcome_unknown");
    expect(f.publisher.callCounts().publish).toBe(0);
  });

  it.each(["lease", "create", "status"])("revalidates mission during %s await even without repository source update", async boundary => {
    const f = fixture(); mission(f); const i = await f.approve();
    const drift = () => { f.resolved.basis!.instructionRevision++; };
    if (boundary === "lease") {
      const original = f.lease.open.bind(f.lease);
      vi.spyOn(f.lease, "open").mockImplementation(async (...args) => { const r = await original(...args); drift(); return r; });
    } else if (boundary === "create") {
      const original = f.publisher.createImageContainer.bind(f.publisher);
      vi.spyOn(f.publisher, "createImageContainer").mockImplementation(async (...args) => { const r = await original(...args); drift(); return r; });
    } else {
      const original = f.publisher.getContainerStatus.bind(f.publisher);
      vi.spyOn(f.publisher, "getContainerStatus").mockImplementation(async (...args) => { const r = await original(...args); drift(); return r; });
    }
    expect((await f.service.execute(owner, i.id)).state).toBe("outcome_unknown");
    expect(f.publisher.callCounts().publish).toBe(0);
  });

  it("a late publish acceptance after deadline is audited and exact-ID reconciled with no second write", async () => {
    vi.useFakeTimers();
    const f = fixture(); const i = await f.approve(); const gate = deferred<void>(); const started = deferred<void>();
    const publish = f.publisher.publishContainer.bind(f.publisher);
    vi.spyOn(f.publisher, "publishContainer").mockImplementation(async (...args) => { const r = await publish(...args); started.resolve(); await gate.promise; return r; });
    const work = f.service.execute(owner, i.id); await started.promise;
    await vi.advanceTimersByTimeAsync(101);
    expect((await work).state).toBe("outcome_unknown");
    const audit = deferred<void>(); const late = f.repo.recordLateReceipt.bind(f.repo);
    vi.spyOn(f.repo, "recordLateReceipt").mockImplementation(async (...args) => { const r = await late(...args); audit.resolve(); return r; });
    gate.resolve(); await audit.promise;
    expect((await new PublishService(f.deps).reconcile(owner, i.id)).state).toBe("published");
    expect(f.publisher.callCounts()).toEqual({ create: 1, status: 1, publish: 1, lookup: 1 });
  });

  it("does not re-create after an actual create timeout; late container only becomes audit", async () => {
    vi.useFakeTimers();
    const f = fixture(); const i = await f.approve(); const gate = deferred<void>(); const started = deferred<void>();
    const create = f.publisher.createImageContainer.bind(f.publisher);
    vi.spyOn(f.publisher, "createImageContainer").mockImplementation(async (...args) => { const r = await create(...args); started.resolve(); await gate.promise; return r; });
    const work = f.service.execute(owner, i.id); await started.promise; await vi.advanceTimersByTimeAsync(101);
    expect((await work).state).toBe("outcome_unknown");
    const audit = deferred<void>(); const late = f.repo.recordLateReceipt.bind(f.repo);
    vi.spyOn(f.repo, "recordLateReceipt").mockImplementation(async (...args) => { const r = await late(...args); audit.resolve(); return r; });
    gate.resolve(); await audit.promise;
    await new PublishService(f.deps).execute(owner, i.id); await f.service.reconcile(owner, i.id);
    expect((await f.repo.getOwned(owner, i.id)).lateReceipt.containerId).toBe("90000000000000001");
    expect(f.publisher.callCounts()).toEqual({ create: 1, status: 0, publish: 0, lookup: 0 });
  });

  it.each([undefined, { mediaId: "https://private.invalid", sampleOnly: true }, { mediaId: "12345", sampleOnly: false }])("malformed publish result stays unknown: %j", async response => {
    const f = fixture(); const i = await f.approve();
    vi.spyOn(f.publisher, "publishContainer").mockResolvedValue(response as never);
    expect((await f.service.execute(owner, i.id)).state).toBe("outcome_unknown");
    await f.service.reconcile(owner, i.id); expect(f.publisher.callCounts().lookup).toBe(0);
  });

  it("processing may poll repeatedly but becomes unknown at its injected deadline", async () => {
    const f = fixture({ containerState: "processing" }); const i = await f.approve();
    await f.service.execute(owner, i.id); f.advance(1001);
    expect((await f.service.execute(owner, i.id)).state).toBe("outcome_unknown");
    expect(f.publisher.callCounts()).toEqual({ create: 1, status: 1, publish: 0, lookup: 0 });
  });

  it("two workers polling the same ready container still make one publish claim", async () => {
    const f = fixture(); const i = await f.approve();
    vi.spyOn(f.publisher, "getContainerStatus").mockResolvedValueOnce({ state: "processing", sampleOnly: true });
    expect((await f.service.execute(owner, i.id)).state).toBe("provider_processing");
    const second = new PublishService({ ...f.deps, repo: new MemoryPublishRepository({ database: f.database, enabled: true, now: f.deps.now }) });
    await Promise.all([f.service.execute(owner, i.id), second.execute(owner, i.id)]);
    expect((await second.getOwned(owner, i.id)).state).toBe("published");
    expect(f.publisher.callCounts().create).toBe(1); expect(f.publisher.callCounts().publish).toBe(1);
  });

  it.each(["null", "disabled"])("has zero provider and lease calls with %s capability at execution", async kind => {
    const f = fixture(); const i = await f.approve(); const open = vi.spyOn(f.lease, "open");
    if (kind === "null") {
      f.resolved.contract = null;
      expect((await f.service.execute(owner, i.id)).state).toBe("invalidated");
    } else {
      const service = new PublishService({ ...f.deps, publisher: { ...f.publisher, mode: "disabled" } as never });
      await expect(service.execute(owner, i.id)).rejects.toMatchObject({ code: "PUBLISH_PROTOCOL_UNVERIFIED" });
    }
    expect(open).not.toHaveBeenCalled(); expect(f.publisher.callCounts()).toEqual({ create: 0, status: 0, publish: 0, lookup: 0 });
  });

  it("late acceptance after revoke/reconnect is held against original target and never looked up using new grant", async () => {
    vi.useFakeTimers(); const f = fixture(); const i = await f.approve(); const gate = deferred<void>(); const started = deferred<void>();
    const publish = f.publisher.publishContainer.bind(f.publisher);
    vi.spyOn(f.publisher, "publishContainer").mockImplementation(async (...args) => { const r = await publish(...args); started.resolve(); await gate.promise; return r; });
    const work = f.service.execute(owner, i.id); await started.promise;
    f.revoke(); f.resolved.grant.status = "active"; f.resolved.grant.generation = 2;
    f.resolved.grant.subject = "777777"; f.resolved.draft.accountSubject = "777777"; f.sync();
    await vi.advanceTimersByTimeAsync(101);
    expect((await work).stopped).toBe(true);
    const audit = deferred<void>(); const late = f.repo.recordLateReceipt.bind(f.repo);
    const spy = vi.spyOn(f.repo, "recordLateReceipt").mockImplementation(async (...args) => { const r = await late(...args); audit.resolve(); return r; });
    gate.resolve(); await audit.promise;
    expect(spy).toHaveBeenCalledWith(owner, expect.objectContaining({ target, receipt: { mediaId: "91000000000000001", sampleOnly: true } }));
    expect((await f.service.reconcile(owner, i.id)).state).toBe("outcome_unknown");
    expect(f.publisher.callCounts()).toEqual({ create: 1, status: 1, publish: 1, lookup: 0 });
  });

  it("interrupted response after persisted container can resume polling without creating again", async () => {
    const f = fixture(); const i = await f.approve(); const transition = f.repo.transition.bind(f.repo); let lost = false;
    let handle = ""; const open = f.lease.open.bind(f.lease);
    vi.spyOn(f.lease, "open").mockImplementation(async (...args) => { const r = await open(...args); handle = r.handle; return r; });
    vi.spyOn(f.repo, "transition").mockImplementation(async (...args) => {
      const result = await transition(...args);
      if (!lost && args[1].nextState === "provider_processing") { lost = true; throw new Error("lost response"); }
      return result;
    });
    expect((await f.service.execute(owner, i.id)).state).toBe("provider_processing");
    expect(await f.lease.read(handle)).toMatchObject({ bytes, sampleOnly: true });
    expect((await new PublishService(f.deps).execute(owner, i.id)).state).toBe("published");
    expect(f.publisher.callCounts().create).toBe(1); expect(f.publisher.callCounts().publish).toBe(1);
  });

  it("pending create from another worker stays pending before deadline, then late result cannot resume it", async () => {
    const f = fixture(); const i = await f.approve(); const gate = deferred<void>(); const started = deferred<void>();
    const create = f.publisher.createImageContainer.bind(f.publisher);
    vi.spyOn(f.publisher, "createImageContainer").mockImplementation(async (...args) => { const r = await create(...args); started.resolve(); await gate.promise; return r; });
    const work = f.service.execute(owner, i.id); await started.promise;
    const second = new PublishService(f.deps);
    expect((await second.execute(owner, i.id)).state).toBe("container_preparing");
    f.advance(1001); expect((await second.execute(owner, i.id)).state).toBe("outcome_unknown");
    gate.resolve(); expect((await work).state).toBe("outcome_unknown");
    expect(f.publisher.callCounts()).toEqual({ create: 1, status: 0, publish: 0, lookup: 0 });
    expect((await f.repo.getOwned(owner, i.id)).lateReceipt.containerId).toBe("90000000000000001");
  });

  it("never publishes on wrong media ID even when lookup subject matches", async () => {
    const f = fixture(); const i = await f.approve(); const lookup = f.publisher.getPublishedMedia.bind(f.publisher);
    vi.spyOn(f.publisher, "getPublishedMedia").mockImplementation(async (...args) => ({ ...await lookup(...args), mediaId: "777777" }));
    expect((await f.service.execute(owner, i.id)).state).toBe("outcome_unknown");
    expect((await f.service.reconcile(owner, i.id)).state).toBe("outcome_unknown");
    expect(f.publisher.callCounts().publish).toBe(1);
  });

  it.each(["create", "status", "publish"])("honors the persisted deadline after a slow %s await", async boundary => {
    const f = fixture(); const i = await f.approve();
    const methods = { create: "createImageContainer", status: "getContainerStatus", publish: "publishContainer" } as const;
    const method = methods[boundary as keyof typeof methods];
    const original = f.publisher[method].bind(f.publisher) as (...args: unknown[]) => Promise<unknown>;
    vi.spyOn(f.publisher, method).mockImplementation((async (...args: unknown[]) => { const r = await original(...args); f.advance(1001); return r; }) as never);
    expect((await f.service.execute(owner, i.id)).state).toBe("outcome_unknown");
    expect(f.publisher.callCounts().publish).toBe(boundary === "publish" ? 1 : 0);
    expect(f.publisher.callCounts().lookup).toBe(0);
  });
});

describe("real service and guarded route integration (synthetic auth context only)", () => {
  it("previews/approves/status through the route; worker alone executes; refreshed access uses same session", async () => {
    const f = fixture(); const app = new Hono<Env>(); let session = "00000000-0000-4000-8000-000000000071"; let tokenRotation = 1;
    app.use("*", async (c, next) => {
      // Trusted-context fixture only, deliberately not a claim of JWT/Auth verification.
      c.set("workspaceId", owner.workspaceId); c.set("userId", owner.creatorId);
      c.set("jwt", `${Buffer.from('{"alg":"RS256"}').toString("base64url")}.${Buffer.from(JSON.stringify({ sub: owner.creatorId, session_id: session, iat: tokenRotation })).toString("base64url")}.synthetic`);
      await next();
    });
    app.route("/publish", createCreatorGrowthPublishRoutes({ service: f.service }));
    const post = (path: string, body: unknown, headers = {}) => app.request(`/publish${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
    const previewResponse = await post("/preview", { draftId }); expect(previewResponse.status).toBe(200);
    const p = await previewResponse.json(); tokenRotation++;
    const body = { draftId, approvalId: p.approvalId, nonce: p.nonce, fingerprint: p.fingerprint };
    const headers = { "Idempotency-Key": randomUUID(), "X-Creator-Confirmation": "exact-preview-v1" };
    const approvedResponse = await post("/approve", body, headers); expect(approvedResponse.status).toBe(200);
    const approved = await approvedResponse.json(); expect(approved.state).toBe("creator_approved");
    expect((await post("/approve", body, headers)).status).toBe(200);
    expect(f.publisher.callCounts().publish).toBe(0);
    expect((await post(`/${approved.id}/execute`, {})).status).toBe(404);
    await f.service.execute(owner, approved.id);
    const status = await app.request(`/publish/${approved.id}`); expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({ state: "published", sampleOnly: true, permalink: null });
    session = randomUUID(); expect((await post("/approve", body, headers)).status).toBe(409);
    expect(f.publisher.callCounts().publish).toBe(1);
  });
});

describe("service review fix round 1", () => {
  it.each(["create", "publish", "lookup"] as const)("I-1: rechecks grant expiry after the final owned read before %s", async action => {
    const f = fixture();
    f.resolved.grant.expiresAt = new Date(f.deps.now().getTime() + 10).toISOString(); f.sync();
    const i = await f.approve();
    const delayed = deferred<void>(), release = deferred<void>();
    const read = f.repo.getOwned.bind(f.repo), open = f.lease.open.bind(f.lease);
    const pendingState = action === "create" ? "container_preparing" : action === "publish" ? "publish_requested" : "outcome_unknown";
    let leaseOpened = false, matchingReads = 0;
    vi.spyOn(f.lease, "open").mockImplementation(async (...args) => { const result = await open(...args); leaseOpened = true; return result; });
    vi.spyOn(f.repo, "getOwned").mockImplementation(async (...args) => {
      const result = await read(...args);
      // current() brackets resolution with two owned reads. Delay the second
      // response, after policy passed, without changing the persisted intent.
      if (leaseOpened && result.state === pendingState && ++matchingReads === 2) {
        delayed.resolve(); await release.promise;
        expect((await read(...args)).version).toBe(result.version);
      }
      return result;
    });
    const work = f.service.execute(owner, i.id);
    await delayed.promise; f.advance(11); release.resolve();
    expect((await work).state).toBe("outcome_unknown");
    expect(f.publisher.callCounts()).toEqual({
      create: action === "create" ? 0 : 1, status: action === "create" ? 0 : 1,
      publish: action === "lookup" ? 1 : 0, lookup: 0,
    });
    expect(f.deps.now().getTime() - Date.parse(i.updatedAt)).toBeLessThan(f.deps.inFlightTimeoutMs!);
  });

  it.each([
    ["suspended", "create"], ["suspended", "status"], ["suspended", "publish"],
    ["deleted", "create"], ["deleted", "status"], ["deleted", "publish"],
  ] as const)("I-2: closes the actual lease for an owner %s during %s even though reads are denied", async (ownerState, action) => {
    const f = fixture(); const i = await f.approve();
    const delayed = deferred<void>(), release = deferred<void>();
    const methods = { create: "createImageContainer", status: "getContainerStatus", publish: "publishContainer" } as const;
    const method = methods[action];
    const original = f.publisher[method].bind(f.publisher) as (...args: unknown[]) => Promise<unknown>;
    vi.spyOn(f.publisher, method).mockImplementation((async (...args: unknown[]) => {
      const result = await original(...args); delayed.resolve(); await release.promise; return result;
    }) as never);
    const close = vi.spyOn(f.lease, "close");
    const work = f.service.execute(owner, i.id);
    const denied = expect(work).rejects.toMatchObject({ code: "PUBLISH_DENIED", message: "PUBLISH_DENIED" });
    await delayed.promise; f.database.setOwner(owner, ownerState); release.resolve();
    await denied;
    await expect(f.repo.getOwned(owner, i.id)).rejects.toMatchObject({ code: "PUBLISH_DENIED" });
    // A real close result of 1 proves removal of the open record, rather than
    // mistaking open()'s initial no-op close (0) or denied reads for cleanup.
    expect(close.mock.results.filter(result => result.type === "return" && result.value === 1)).toHaveLength(1);
    expect(close).toHaveBeenCalledWith(owner, i.id);
    const counts = f.publisher.callCounts();
    expect(counts).toEqual({ create: 1, status: action === "create" ? 0 : 1, publish: action === "publish" ? 1 : 0, lookup: 0 });
    await expect(f.service.execute(owner, i.id)).rejects.toMatchObject({ code: "PUBLISH_DENIED" });
    expect(f.publisher.callCounts()).toEqual(counts);
  });

  it.each(["getOwned", "reconcile"] as const)("I-2: %s closes a previously opened lease on owner denial without more provider calls", async method => {
    const f = fixture({ containerState: "processing" }); const i = await f.approve();
    expect((await f.service.execute(owner, i.id)).state).toBe("provider_processing");
    const close = vi.spyOn(f.lease, "close"), counts = f.publisher.callCounts();
    f.database.setOwner(owner, "suspended");
    await expect(f.service[method](owner, i.id)).rejects.toMatchObject({ code: "PUBLISH_DENIED" });
    expect(close).toHaveBeenCalledWith(owner, i.id);
    expect(close.mock.results.filter(result => result.type === "return" && result.value === 1)).toHaveLength(1);
    expect(f.publisher.callCounts()).toEqual(counts);
  });

  it("I-2: bounds a cleanup error on the owner-denial path", async () => {
    const f = fixture({ containerState: "processing" }); const i = await f.approve();
    await f.service.execute(owner, i.id); f.database.setOwner(owner, "suspended");
    vi.spyOn(f.lease, "close").mockImplementationOnce(() => { throw new Error("PRIVATE local lease failure"); });
    await expect(f.service.getOwned(owner, i.id)).rejects.toMatchObject({ code: "PUBLISH_UNAVAILABLE", message: "PUBLISH_UNAVAILABLE" });
    expect(f.publisher.callCounts()).toEqual({ create: 1, status: 1, publish: 0, lookup: 0 });
  });
});
