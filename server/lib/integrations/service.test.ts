// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntegrationService } from "./service.js";
import { MemoryIntegrationRepository } from "./memoryRepo.js";
import { createMockProviders } from "./mockProviders.js";
import { CredentialVault } from "./credentials.js";
import { IntegrationError } from "./policy.js";
import type { Actor, ProviderId, ProviderSnapshot } from "./types.js";
import type { StudioSource } from "../../../src/lib/studio/types.js";

const actor:Actor={workspaceId:"00000000-0000-4000-8000-000000000001",creatorId:"00000000-0000-4000-8000-000000000011"};
const other={...actor,creatorId:"00000000-0000-4000-8000-000000000012"};
let now:Date,repo:MemoryIntegrationRepository,service:IntegrationService,providers:ReturnType<typeof createMockProviders>;
beforeEach(()=>{now=new Date("2026-10-31T10:00:00Z");repo=new MemoryIntegrationRepository(()=>now);providers=createMockProviders();service=new IntegrationService(repo,providers,new CredentialVault(new Uint8Array(32).fill(7),"mock-key"),()=>now);});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
async function connect(provider:ProviderId="instagram",code="allow") {const start=await service.beginConnection(actor,provider,"session","/studio");return service.completeConnection(actor,provider,"session",code,start.state);}

async function importedDrive() {
  const connection = await connect("google_drive");
  const { resources } = await service.registerSelectedFiles(actor, connection.id, ["mock-owned-brief"], crypto.randomUUID());
  const input = { threadId: crypto.randomUUID(), revision: 0, resourceIds: [resources[0].id], question: "Which opening?", modelConsent: true, processingRights: true, shareRights: true, requestId: crypto.randomUUID() };
  const result = await service.importSources(actor, connection.id, input);
  return { connection, resource: resources[0], input, source: (result.sources as StudioSource[])[0] };
}

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("owner-scoped mock integration lifecycle",()=>{
  it("uses state once, binds the session/owner and expires after ten minutes",async()=>{
    const start=await service.beginConnection(actor,"instagram","session","https://evil.test");
    await expect(service.completeConnection(other,"instagram","session","allow",start.state)).rejects.toThrow("OAUTH_STATE_INVALID");
    await expect(service.completeConnection(actor,"instagram","other-session","allow",start.state)).rejects.toThrow("OAUTH_STATE_INVALID");
    const connection=await service.completeConnection(actor,"instagram","session","allow",start.state);
    expect(connection.sampleOnly).toBe(true);expect(JSON.stringify(connection)).not.toMatch(/accessToken|refreshToken/);
    await expect(service.completeConnection(actor,"instagram","session","allow",start.state)).rejects.toThrow("OAUTH_STATE_INVALID");
    const expired=await service.beginConnection(actor,"google_drive","session","/connections");now=new Date(now.getTime()+600_001);
    await expect(service.completeConnection(actor,"google_drive","session","allow",expired.state)).rejects.toThrow("OAUTH_STATE_INVALID");
  });
  it("keeps declined grants disconnected and partial grants explicit",async()=>{
    await expect(connect("instagram","deny")).rejects.toThrow("AUTHORIZATION_DECLINED");expect(await service.list(actor)).toEqual([]);
    const partial=await connect("instagram","partial");expect(partial.status).toBe("partial");
    await expect(service.syncConnection(actor,partial.id,crypto.randomUUID())).rejects.toThrow("SCOPE_REQUIRED");
  });
  it("isolates owners and workspaces even for guessed resource IDs",async()=>{
    const connection=await connect();
    for(const intruder of [other,{...actor,workspaceId:"00000000-0000-4000-8000-000000000002"}]){
      expect(await service.list(intruder)).toEqual([]);
      await expect(service.resources(intruder,connection.id)).rejects.toThrow("NOT_FOUND");
      await expect(service.revokeConnection(intruder,connection.id,crypto.randomUUID())).rejects.toThrow("NOT_FOUND");
    }
  });
  it("syncs once per request and keeps the 60-minute cooldown without granting rewards",async()=>{
    const connection=await connect(), request=crypto.randomUUID(), spy=vi.spyOn(providers.instagram,"read");
    const first=await service.syncConnection(actor,connection.id,request);
    expect(first.resources.length).toBeGreaterThan(0);expect(first.resources[0].coverage.region).toBeNull();
    expect(await service.syncConnection(actor,connection.id,request)).toEqual(first);expect(spy).toHaveBeenCalledTimes(1);
    await expect(service.syncConnection(actor,connection.id,crypto.randomUUID())).rejects.toThrow("RATE_LIMITED");
    expect(JSON.stringify(await service.exportData(actor))).not.toMatch(/accessToken|refreshToken|mock-refresh|ciphertext/);
  });
  it("selects only supported files and does not trust Picker payloads",async()=>{
    const connection=await connect("google_drive");const files=await service.picker(actor,connection.id);
    expect(files.files.length).toBeGreaterThan(0);
    await expect(service.registerSelectedFiles(actor,connection.id,["not-selected-or-owned"],crypto.randomUUID())).rejects.toThrow("SOURCE_UNAVAILABLE");
    const result=await service.registerSelectedFiles(actor,connection.id,[files.files[0].id],crypto.randomUUID());
    expect(result.resources).toHaveLength(1);expect(result.resources[0].selected).toBe(true);
    await expect(service.registerSelectedFiles(actor,connection.id,Array(6).fill(files.files[0].id),crypto.randomUUID())).rejects.toThrow("INVALID_SELECTION");
  });
  it("replays the same file-selection intent after response loss without timestamp conflicts",async()=>{
    const connection=await connect("google_drive"),request=crypto.randomUUID();
    const first=await service.registerSelectedFiles(actor,connection.id,["mock-owned-brief"],request);
    now=new Date(now.getTime()+10000);
    expect(await service.registerSelectedFiles(actor,connection.id,["mock-owned-brief"],request)).toEqual(first);
    await expect(service.registerSelectedFiles(actor,connection.id,["mock-shot-list"],request)).rejects.toThrow("IDEMPOTENCY_CONFLICT");
  });
  it("blocks late provider responses and old OAuth callbacks after revocation",async()=>{
    const connection=await connect(), stale=await service.beginConnection(actor,"instagram","session","/connections");
    let resolve!:()=>void;const gate=new Promise<void>(r=>{resolve=r;});const original=providers.instagram.read.bind(providers.instagram);
    vi.spyOn(providers.instagram,"read").mockImplementation(async(...args)=>{await gate;return original(...args);});
    const pending=service.syncConnection(actor,connection.id,crypto.randomUUID()).catch(error=>error);
    await new Promise(r=>setTimeout(r,20));await service.revokeConnection(actor,connection.id,crypto.randomUUID());resolve();
    await expect(pending).resolves.toMatchObject({code:"STALE_CONNECTION"});
    await expect(service.completeConnection(actor,"instagram","session","allow",stale.state)).rejects.toThrow("OAUTH_STATE_INVALID");
    expect((await service.list(actor))[0].status).toBe("revoked");
  });
  it("revocation remains locally final if the provider is unavailable and reconnect never revives old grants",async()=>{
    const connection=await connect("google_drive");vi.spyOn(providers.google_drive,"revoke").mockRejectedValue(new Error("offline"));
    expect(await service.revokeConnection(actor,connection.id,crypto.randomUUID())).toMatchObject({local:"revoked",provider:"pending"});
    await expect(service.picker(actor,connection.id)).rejects.toThrow("STALE_CONNECTION");
    const renewed=await connect("google_drive");expect(renewed.generation).toBeGreaterThan(connection.generation);
    expect(await service.resources(actor,renewed.id)).toEqual([]);
  });

  it.each(["unknown", "licensed"] as const)("rejects changed Drive rights (%s) even when version and content are unchanged", async rights => {
    const { connection, input, source } = await importedDrive();
    await expect(service.authorizeSources(actor, [source.id], "share", { draft: "before change" })).resolves.toHaveLength(1);
    const original = providers.google_drive.file.bind(providers.google_drive);
    vi.spyOn(providers.google_drive, "file").mockImplementation(async (...args) => ({ ...await original(...args), rights }));
    await expect(service.importSources(actor, connection.id, { ...input, requestId: crypto.randomUUID() })).rejects.toThrow("SOURCE_CHANGED");
    for (const use of ["model", "save_brief", "share"] as const) {
      await expect(service.authorizeSources(actor, [source.id], use, { draft: "after change" })).rejects.toThrow("SOURCE_CHANGED");
    }
  });

  it("marks credential decryption failure as reauth_required and blocks further active reads", async () => {
    const connection = await connect("google_drive");
    service = new IntegrationService(repo, providers, new CredentialVault(new Uint8Array(32).fill(8), "mock-key"), () => now);
    const files = vi.spyOn(providers.google_drive, "files"), commands = vi.spyOn(repo, "command");
    await expect(service.picker(actor, connection.id)).rejects.toThrow("REAUTH_REQUIRED");
    expect((await service.list(actor))[0]).toMatchObject({ status: "reauth_required", lastError: "REAUTH_REQUIRED", generation: connection.generation });
    expect(commands.mock.calls.find(([, , action]) => action === "reauth")?.[3]).toEqual({ id: connection.id, generation: connection.generation });
    await expect(service.resources(actor, connection.id)).rejects.toThrow("REAUTH_REQUIRED");
    await expect(service.picker(actor, connection.id)).rejects.toThrow("REAUTH_REQUIRED");
    expect(files).not.toHaveBeenCalled();
    expect(JSON.stringify(await service.list(actor))).not.toMatch(/ciphertext|accessToken|refreshToken/);
  });

  it("marks a refresh failure for reauthentication and permits local revocation afterward", async () => {
    const connection = await connect("google_drive");
    now = new Date(now.getTime() + 3600_000);
    vi.spyOn(providers.google_drive, "refresh").mockRejectedValue(new Error("private provider failure"));
    await expect(service.picker(actor, connection.id)).rejects.toThrow("REAUTH_REQUIRED");
    expect((await service.list(actor))[0]).toMatchObject({ status: "reauth_required", lastError: "REAUTH_REQUIRED" });
    await expect(service.revokeConnection(actor, connection.id, crypto.randomUUID())).resolves.toMatchObject({ local: "revoked" });
    expect((await service.list(actor))[0].status).toBe("revoked");
  });

  it("does not let an old refresh failure mark a reconnected generation as reauth_required", async () => {
    const connection = await connect("google_drive"), entered = deferred<void>(), refresh = deferred<never>();
    now = new Date(now.getTime() + 3600_000);
    vi.spyOn(providers.google_drive, "refresh").mockImplementation(() => { entered.resolve(); return refresh.promise; });
    const pending = service.picker(actor, connection.id).catch(error => error);
    await entered.promise;
    const renewed = await connect("google_drive");
    refresh.reject(new Error("late refresh failure"));
    await expect(pending).resolves.toMatchObject({ code: "STALE_CONNECTION" });
    expect((await service.list(actor))[0]).toMatchObject({ status: "connected", lastError: null, generation: renewed.generation });
  });

  it("visibly revokes old sources, disables AI and sharing, and notifies hooks on reconnect", async () => {
    const revokeSources = vi.fn();
    repo = new MemoryIntegrationRepository(() => now, { revokeSources });
    service = new IntegrationService(repo, providers, new CredentialVault(new Uint8Array(32).fill(7), "mock-key"), () => now);
    const { source, connection } = await importedDrive();
    const payload = { text: "old private draft" };
    await service.authorizeSources(actor, [source.id], "share", payload);
    const renewed = await connect("google_drive");
    expect(renewed.generation).toBeGreaterThan(connection.generation);
    const refs = await repo.command(actor, crypto.randomUUID(), "source_refs", { sourceIds: [source.id] });
    expect(refs.sources).toEqual([expect.objectContaining({ id: source.id, revoked_at: now.toISOString(), shareable: false, integration: expect.objectContaining({ model_allowed: false, availability: "revoked", generation: connection.generation }) })]);
    expect(revokeSources).toHaveBeenCalledTimes(1);
    expect(revokeSources).toHaveBeenCalledWith(actor, [source.id]);
    expect((await service.exportData(actor)).resources).toEqual([expect.objectContaining({ availability: "revoked" })]);
    expect(() => repo.consumePermits(actor, [source.id], "share", payload)).toThrow();
    await expect(service.readSelectedSource(actor, source.id)).rejects.toThrow("SOURCE_UNAVAILABLE");
  });

  it.each(["resolve", "reject"] as const)("bounds a provider ignoring abort and safely handles its late %s", async settlement => {
    const connection = await connect();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const entered = deferred<void>(), read = deferred<[]>();
    let signal: AbortSignal | undefined;
    vi.spyOn(providers.instagram, "read").mockImplementation((_row, _grant, _now, value) => { signal = value; entered.resolve(); return read.promise; });
    let settled = false;
    const outcome = service.syncConnection(actor, connection.id, crypto.randomUUID()).then(value => { settled = true; return value; }, error => { settled = true; return error; });
    await entered.promise;
    await vi.advanceTimersByTimeAsync(29_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(signal?.aborted).toBe(true);
    expect(settled).toBe(true);
    await expect(outcome).resolves.toMatchObject({ code: "SOURCE_UNAVAILABLE", status: 503 });
    expect(vi.getTimerCount()).toBe(0);
    if (settlement === "resolve") read.resolve([]); else read.reject(new Error("late ignored-abort failure"));
    await vi.advanceTimersByTimeAsync(0);
    expect(await service.resources(actor, connection.id)).toEqual([]);
    expect((await service.list(actor))[0].lastSyncAt).toBeNull();
  });

  it.each(["resolve", "reject"] as const)("fences a delayed revoke %s across reconnect and a second revoke", async settlement => {
    const connection = await connect("google_drive"), entered = deferred<void>(), oldRevoke = deferred<void>();
    vi.spyOn(providers.google_drive, "revoke")
      .mockImplementationOnce(() => { entered.resolve(); return oldRevoke.promise; })
      .mockImplementationOnce(async () => { if (settlement === "resolve") throw new Error("new revoke pending"); });
    const oldResult = service.revokeConnection(actor, connection.id, crypto.randomUUID()).catch(error => error);
    await entered.promise;
    const renewed = await connect("google_drive");
    await service.revokeConnection(actor, renewed.id, crypto.randomUUID());
    const current = (await service.list(actor))[0];
    expect(current).toMatchObject({ generation: 4, status: "revoked", providerRevocation: settlement === "resolve" ? "pending" : "revoked" });
    if (settlement === "resolve") oldRevoke.resolve(); else oldRevoke.reject(new Error("old revoke failed late"));
    await expect(oldResult).resolves.toMatchObject({ code: "STALE_CONNECTION" });
    expect((await service.list(actor))[0]).toEqual(current);
  });

  it("filters mock observation times inclusively to 30 days, caps at 50 and labels the subset partial", async () => {
    const connection = await connect();
    const snapshot = (id: string, observedAt: string): ProviderSnapshot => ({ resourceId: id, title: id, sourceVersion: "mock-v1", contentHash: id, fetchedAt: now.toISOString(), observedAt, period: null, coverage: { region: null, language: null, partial: false }, metrics: {}, excerpt: "Mock observation" });
    const cutoff = now.getTime() - 30 * 86400_000;
    vi.spyOn(providers.instagram, "read").mockResolvedValue([
      snapshot("too-old", new Date(cutoff - 1).toISOString()), snapshot("boundary", new Date(cutoff).toISOString()),
      snapshot("future", new Date(now.getTime() + 1).toISOString()), snapshot("invalid-time", "invalid"),
      ...Array.from({ length: 51 }, (_, i) => snapshot(`current-${i}`, now.toISOString())),
    ]);
    const result = await service.syncConnection(actor, connection.id, crypto.randomUUID());
    expect(result.status).toBe("partial"); expect(result.resources).toHaveLength(50);
    expect(result.resources.map(row => row.externalId)).toContain("boundary");
    expect(result.resources.map(row => row.externalId)).not.toEqual(expect.arrayContaining(["too-old", "future", "invalid-time"]));
    for (const resource of result.resources) {
      expect(Date.parse(resource.observedAt)).toBeGreaterThanOrEqual(cutoff);
      expect(Date.parse(resource.observedAt)).toBeLessThanOrEqual(now.getTime());
      expect(resource.coverage.partial).toBe(true);
    }
  });

  it("does not revive prior sharing or model consent when a selected file is registered again with changed rights", async () => {
    const { connection, source } = await importedDrive();
    const original = providers.google_drive.file.bind(providers.google_drive);
    vi.spyOn(providers.google_drive, "file").mockImplementation(async (...args) => ({ ...await original(...args), rights: "unknown" }));
    await service.registerSelectedFiles(actor, connection.id, ["mock-owned-brief"], crypto.randomUUID());
    for (const use of ["model", "save_brief", "share"] as const) await expect(service.authorizeSources(actor, [source.id], use)).rejects.toThrow("SOURCE_UNAVAILABLE");
  });

  it("retries pending mock revocation with the original credential generation without revoking locally twice", async () => {
    const connection = await connect("google_drive");
    const revoke = vi.spyOn(providers.google_drive, "revoke").mockRejectedValueOnce(new Error("temporary mock failure")).mockResolvedValueOnce();
    await expect(service.revokeConnection(actor, connection.id, crypto.randomUUID())).resolves.toEqual({ local: "revoked", provider: "pending" });
    const generation = (await service.list(actor))[0].generation;
    await expect(service.revokeConnection(actor, connection.id, crypto.randomUUID())).resolves.toEqual({ local: "revoked", provider: "revoked" });
    expect(revoke).toHaveBeenCalledTimes(2);
    expect(revoke.mock.calls[1][0]).toEqual(revoke.mock.calls[0][0]);
    expect((await service.list(actor))[0]).toMatchObject({ generation, status: "revoked", providerRevocation: "revoked" });
  });

  it("requires manual action after the pending credential deadline, without another provider call", async () => {
    const connection = await connect("google_drive"), revoke = vi.spyOn(providers.google_drive, "revoke").mockRejectedValue(new Error("offline"));
    await service.revokeConnection(actor, connection.id, crypto.randomUUID());
    now = new Date(now.getTime() + 24 * 3600_000);
    await expect(service.revokeConnection(actor, connection.id, crypto.randomUUID())).resolves.toEqual({ local: "revoked", provider: "manual_action" });
    expect(revoke).toHaveBeenCalledTimes(1);
    expect((await service.list(actor))[0]).toMatchObject({ generation: 2, providerRevocation: "manual_action" });
  });

  it.each(["resolve", "reject"] as const)("times out a pending provider revoke and safely ignores its late %s", async settlement => {
    const connection = await connect("google_drive"), entered = deferred<void>(), revoke = deferred<void>();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.spyOn(providers.google_drive, "revoke").mockImplementation(() => { entered.resolve(); return revoke.promise; });
    const commands = vi.spyOn(repo, "command");
    let settled = false;
    const outcome = service.revokeConnection(actor, connection.id, crypto.randomUUID()).then(value => { settled = true; return value; }, error => { settled = true; return error; });
    await entered.promise;
    expect((await service.list(actor))[0]).toMatchObject({ generation: 2, status: "revoked", providerRevocation: "pending" });
    await expect(service.picker(actor, connection.id)).rejects.toThrow("STALE_CONNECTION");
    await vi.advanceTimersByTimeAsync(29_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
    await expect(outcome).resolves.toEqual({ local: "revoked", provider: "pending" });
    expect(vi.getTimerCount()).toBe(0);
    if (settlement === "resolve") revoke.resolve(); else revoke.reject(new Error("late mock revoke failure"));
    await vi.advanceTimersByTimeAsync(0);
    expect(commands.mock.calls.filter(([, , action]) => action === "revoke_result").map(([, , , payload]) => payload)).toEqual([{ id: connection.id, generation: 2, provider: "pending" }]);
    expect((await service.list(actor))[0]).toMatchObject({ generation: 2, status: "revoked", providerRevocation: "pending" });
  });

  it.each(["revoke", "purge"] as const)("locally %ss a reauth-required connection before any credential read", async action => {
    const connection = await connect("google_drive");
    await repo.command(actor, crypto.randomUUID(), "reauth", { id: connection.id, generation: connection.generation });
    const original = repo.command.bind(repo), calls: string[] = [];
    vi.spyOn(repo, "command").mockImplementation(async (...args) => {
      calls.push(args[2]);
      if (args[2] === "credentials") throw new IntegrationError("SOURCE_UNAVAILABLE", 403);
      if (args[2] === "revocation_credentials") expect((await repo.connection(actor, connection.id))?.status).toBe("revoked");
      return original(...args);
    });
    const result = action === "revoke" ? await service.revokeConnection(actor, connection.id, crypto.randomUUID()) : await service.purgeConnection(actor, connection.id, crypto.randomUUID());
    expect(result).toMatchObject(action === "revoke" ? { local: "revoked", provider: "revoked" } : { state: "complete" });
    expect(calls[0]).toBe("revoke"); expect(calls).not.toContain("credentials");
    expect((await repo.connection(actor, connection.id))?.generation).toBe(2);
  });

  it("keeps local revocation and purge available when the bounded credential lookup is unavailable", async () => {
    const connection = await connect("google_drive"), original = repo.command.bind(repo);
    vi.spyOn(repo, "command").mockImplementation(async (...args) => {
      if (args[2] === "revocation_credentials") throw new IntegrationError("SOURCE_UNAVAILABLE", 403);
      return original(...args);
    });
    const revoke = vi.spyOn(providers.google_drive, "revoke");
    await expect(service.revokeConnection(actor, connection.id, crypto.randomUUID())).resolves.toEqual({ local: "revoked", provider: "pending" });
    await expect(service.purgeConnection(actor, connection.id, crypto.randomUUID())).resolves.toEqual({ state: "complete" });
    expect(revoke).not.toHaveBeenCalled();
  });

  it.each(["NOT_FOUND", "STALE_CONNECTION"])("does not swallow %s during a bounded revocation credential read", async code => {
    const connection = await connect("google_drive"), original = repo.command.bind(repo);
    vi.spyOn(repo, "command").mockImplementation(async (...args) => {
      if (args[2] === "revocation_credentials") throw new IntegrationError(code, code === "NOT_FOUND" ? 404 : 409);
      return original(...args);
    });
    await expect(service.revokeConnection(actor, connection.id, crypto.randomUUID())).rejects.toThrow(code);
  });

  it.each(["google_drive", "instagram"] as const)("reuses persisted %s resource IDs after reconnect without returning old-generation content", async provider => {
    const connection = await connect(provider);
    const read = () => provider === "google_drive"
      ? service.registerSelectedFiles(actor, connection.id, ["mock-owned-brief"], crypto.randomUUID())
      : service.syncConnection(actor, connection.id, crypto.randomUUID());
    const before = await read();
    await service.revokeConnection(actor, connection.id, crypto.randomUUID());
    const renewed = await connect(provider);
    expect(await service.resources(actor, renewed.id)).toEqual([]);
    const after = await read();
    expect(after.resources.map(row => row.id)).toEqual(before.resources.map(row => row.id));
    expect((await repo.resources(actor, renewed.id)).every(row => row.generation === renewed.generation)).toBe(true);
  });

  it("reads an AI-consented source without minting an unbound model persistence permit", async () => {
    const { source } = await importedDrive(), original = repo.command.bind(repo);
    const commands = vi.spyOn(repo, "command").mockImplementation(async (...args) => {
      if (args[2] === "permit" && args[3].use === "model" && !(args[3].commandPayload as { requestId?: string } | undefined)?.requestId) throw new IntegrationError("INVALID_INPUT");
      return original(...args);
    });
    await expect(service.readSelectedSource(actor, source.id)).resolves.toMatchObject({ id: source.id, content: source.content, integration: { model_allowed: true } });
    expect(commands.mock.calls.filter(([, , action]) => action === "permit").map(([, , , payload]) => payload.use)).toEqual(["read"]);
  });

  it("keeps AI consent mandatory when reading a selected private source", async () => {
    const { connection, input } = await importedDrive();
    const result = await service.importSources(actor, connection.id, { ...input, threadId: crypto.randomUUID(), modelConsent: false, shareRights: false, requestId: crypto.randomUUID() });
    const source = (result.sources as StudioSource[])[0];
    await expect(service.readSelectedSource(actor, source.id)).rejects.toThrow();
  });
});
