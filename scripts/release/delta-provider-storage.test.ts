// @vitest-environment node
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderRehearsalFailure, type ProviderRehearsalRuntime } from "./delta-provider-contracts";
import { runProviderStorage } from "./delta-provider-storage";
import type { ProviderJourneyFixture } from "./delta-provider-journey-fixtures";

// These are explicitly synthetic unit HTTP adapters, NOT provider acceptance evidence.
const shared = vi.hoisted(() => ({ fixture: vi.fn() }));
vi.mock("./delta-provider-journey-fixtures", () => ({ createProviderJourneyFixture: shared.fixture }));
const API = "http://127.0.0.1:54321", APP = "http://127.0.0.1:54322";
const PRIVATE = "synthetic-private-response-never-export";
const MAX = 20_971_520;
const MIMES = ["image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4", "video/quicktime", "video/webm"];
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
type Call = { kind: string; actor: string; path: string; signed?: boolean; contentType?: string; byteLength?: number };
type Rejection = { status: number; code?: string; message?: string };
interface Options {
  bucket?: Record<string, unknown>;
  mime?: Rejection;
  size?: Rejection;
  readError?: Rejection;
  metadataStatus?: number;
  metadataCode?: string;
  grantPath?: string;
  foreignWrite?: boolean;
  ownerUploadFails?: boolean;
  corruptDownload?: boolean;
  signingFails?: boolean;
  noHttpFor?: string;
  removeFails?: boolean;
  removeNoop?: boolean;
  cleanupOwnershipFails?: boolean;
  sessionMismatch?: boolean;
  thrownPrivate?: "sdk" | "app" | "body";
}
function response(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } }); }
function rejection(value: Rejection) { return response({ ...(value.code ? { code: value.code } : {}), message: value.message ?? PRIVATE }, value.status); }
function bytes(init: RequestInit | undefined): Uint8Array {
  const body = init?.body;
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  throw new Error("Unexpected synthetic upload body");
}
function fixture(options: Options = {}) {
  let counter = 0, grantCount = 0, assertions = 0;
  const calls: Call[] = [], records: { name: string; facts: unknown }[] = [];
  const objects = new Map<string, Buffer>();
  const grants = new Map<string, { id: string; token: string; size: number; kind: string; finalized: boolean }>();
  const actorIds = { creator: id(1), otherCreator: id(2), operator: id(3), reviewer: id(4), staff: id(5), revoked: id(6), noMembership: id(7) };
  const register = (call: Call) => { calls.push(call); if (options.noHttpFor !== call.kind) counter++; };
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    if (url.origin !== API) throw new Error("Synthetic fetch refused an external target");
    const actor = new Headers(init?.headers).get("Authorization")?.replace("Bearer unit-", "") ?? "anonymous";
    if (url.pathname === "/auth/v1/user") {
      register({ kind: "auth", actor, path: url.pathname });
      return response({ id: options.sessionMismatch ? id(999) : actorIds[actor as keyof typeof actorIds], email: "synthetic@example.test", aud: "authenticated", app_metadata: {}, user_metadata: {} });
    }
    if (url.pathname.startsWith("/storage/v1/bucket/")) {
      register({ kind: "bucket", actor, path: url.pathname });
      const name = decodeURIComponent(url.pathname.slice("/storage/v1/bucket/".length));
      return response({ id: name, name, public: false, file_size_limit: MAX, allowed_mime_types: MIMES, ...options.bucket });
    }
    if (options.thrownPrivate === "sdk") throw new Error(PRIVATE);
    const signed = url.pathname.startsWith("/storage/v1/object/upload/sign/");
    if ((init?.method === "POST" || init?.method === "PUT") && url.pathname.includes("/object/")) {
      const marker = signed ? "/storage/v1/object/upload/sign/" : "/storage/v1/object/";
      const path = decodeURIComponent(url.pathname.slice(marker.length));
      const data = bytes(init), contentType = new Headers(init?.headers).get("content-type") ?? "";
      register({ kind: "upload", actor, path, signed, contentType, byteLength: data.byteLength });
      const grant = grants.get(path);
      if (!grant) return rejection({ status: 403, code: "AccessDenied" });
      if (signed && (options.signingFails || url.searchParams.get("token") !== grant.token)) return rejection({ status: 403, code: "InvalidSignature" });
      if (!signed && actor !== "creator" && !options.foreignWrite) return rejection({ status: 403, code: "AccessDenied" });
      if (!MIMES.includes(contentType)) return rejection(options.mime ?? { status: 400, code: "InvalidMimeType", message: "mime type application/octet-stream is not supported" });
      if (data.byteLength > MAX) return rejection(options.size ?? { status: 413, code: "EntityTooLarge", message: "The object exceeded the maximum allowed size" });
      if (options.ownerUploadFails && actor === "creator") return rejection({ status: 503, code: "InternalError" });
      if (objects.has(path)) return rejection({ status: 409, code: "ResourceAlreadyExists" });
      objects.set(path, Buffer.from(data));
      return response({ Id: id(3000 + grantCount), Key: path });
    }
    if (init?.method === "DELETE") {
      const name = url.pathname.slice("/storage/v1/object/".length);
      register({ kind: "remove", actor, path: name });
      if (options.removeFails) throw new Error(PRIVATE);
      const body = JSON.parse(String(init.body)) as { prefixes: string[] };
      const removed = body.prefixes.map(path => ({ name: path }));
      if (!options.removeNoop) for (const path of body.prefixes) { const value = objects.get(`${name}/${path}`); value?.fill(0); objects.delete(`${name}/${path}`); }
      return response(removed);
    }
    const marker = "/storage/v1/object/";
    if (url.pathname.startsWith(marker)) {
      const path = decodeURIComponent(url.pathname.slice(marker.length));
      register({ kind: "download", actor, path });
      if (options.readError && actor !== "creator") return rejection(options.readError);
      const data = objects.get(path), grant = grants.get(path);
      if (actor !== "creator" || !data || !grant?.finalized) return rejection({ status: 404, code: "NoSuchKey", message: "Object not found" });
      return new Response(new Uint8Array(options.corruptDownload ? Buffer.alloc(data.byteLength, 99) : data), { headers: { "content-type": "image/png" } });
    }
    throw new Error("Unexpected synthetic SDK route");
  };
  const client = (name: string) => createClient(API, "unit-anonymous-key", {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer unit-${name}` }, fetch },
  });
  const actors = Object.fromEntries(Object.entries(actorIds).map(([name, actorId]) => [name, { id: actorId, email: "synthetic@example.test", client: client(name), accessToken: `unit-${name}` }])) as unknown as ProviderRehearsalRuntime["actors"];
  const runtime: ProviderRehearsalRuntime = {
    runId: id(99), sourceCommit: "a".repeat(40), apiOrigin: API, appOrigin: APP, workspaceId: id(100), otherWorkspaceId: id(101), workspaceSlug: "synthetic-unit-workspace",
    anonKey: "unit-anonymous-key", service: client("service"), anonymous: client("anonymous"), actors,
    get httpRequests() { return counter; },
    async assertOwned() { assertions++; if (options.cleanupOwnershipFails && records.length === 6) throw new Error(PRIVATE); },
    async sql() { throw new Error("Synthetic Storage unit adapter must not execute SQL"); },
    async expiredSignedAccessToken() { throw new Error("Storage cases must not mint an Auth token"); },
    async request(actor, path, init) {
      if (options.thrownPrivate === "app") throw new Error(PRIVATE);
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const kind = path.includes("/publication/") ? "proof" : "draft", name = kind === "draft" ? "mission-draft-assets" : "mission-publication-proof-assets";
      if (path.endsWith("/upload-grant")) {
        register({ kind: "app-grant", actor: "creator", path });
        if (body.contentType !== "image/png" || Number(body.sizeBytes) > MAX) return response({ code: options.metadataCode ?? "VALIDATION_FAILED" }, options.metadataStatus ?? 400);
        grantCount++;
        const asset = id(2000 + grantCount), work = kind === "draft" ? id(1002) : id(1005), workflow = kind === "draft" ? id(1001) : id(1004);
        const suffix = kind === "draft" ? `${asset}.png` : `proof-evidence/${new Headers(init?.headers).get("Idempotency-Key")}.png`;
        const objectPath = options.grantPath ?? `${actor!.id}/${workflow}/${work}/${suffix}`, token = `unit-private-grant-${asset}`;
        grants.set(`${name}/${objectPath}`, { id: asset, token, size: Number(body.sizeBytes), kind, finalized: false });
        if (options.thrownPrivate === "body") return { ok: true, text: async () => { throw new Error(PRIVATE); } } as unknown as Response;
        return response({ asset: { id: asset, storageObjectPath: objectPath, uploadState: "pending", contentType: "image/png", sizeBytes: body.sizeBytes }, token, expiresInSeconds: 600, upload: { path: objectPath, token, upsert: false } });
      }
      register({ kind: "app-finalize", actor: "creator", path });
      const assetId = path.split("/").at(-2), entry = [...grants.entries()].find(([, item]) => item.id === assetId);
      if (!entry || !objects.has(entry[0])) return response({ code: "WRONG_STATE" }, 409);
      entry[1].finalized = true;
      return response({ asset: { id: assetId, storageObjectPath: entry[0].slice(name.length + 1), uploadState: kind === "draft" ? "ready" : "finalized", sizeBytes: entry[1].size, contentType: "image/png" } });
    },
    record(name, facts, before) {
      if (counter <= before) throw new ProviderRehearsalFailure("unit-no-http");
      records.push({ name, facts });
      return { name, status: "passed", evidenceSha256: createHash("sha256").update(JSON.stringify(facts)).digest("hex"), actualHttpRequests: counter - before };
    },
  };
  shared.fixture.mockImplementation(async (_runtime, requested) => {
    const proof = requested.state === "approved_to_publish";
    return { missionId: id(proof ? 1006 : 1003), missionSlug: "synthetic-unit", submissionId: id(proof ? 1003 : 1000), workflowId: id(proof ? 1004 : 1001), workItemId: id(proof ? 1005 : 1002), instructionRevision: 0, creatorId: actors.creator.id, creator: actors.creator } as ProviderJourneyFixture;
  });
  return { runtime, calls, records, objects, grants, get assertions() { return assertions; } };
}
async function failure(promise: Promise<unknown>, code: string) {
  const caught = await promise.then(() => null, error => error as Error & { code?: string });
  expect(caught).toBeInstanceOf(ProviderRehearsalFailure);
  expect(caught?.code).toBe(code);
  expect(caught?.message).toBe("Provider rehearsal held");
  expect(caught?.stack).not.toContain(PRIVATE);
  expect(caught).not.toHaveProperty("cause");
}
beforeEach(() => { shared.fixture.mockReset(); });

describe("Storage rehearsal module with real SDK serialization and synthetic HTTP only", () => {
  it("runs both bucket matrices, proves same-object ownership and same-token constraints, and removes exact run objects", async () => {
    const f = fixture(), results = await runProviderStorage(f.runtime);
    expect(results.map(result => result.name)).toEqual(["storage.draft.owner-access-isolation", "storage.draft.signed-upload", "storage.draft.mime-size-enforcement", "storage.proof.owner-access-isolation", "storage.proof.signed-upload", "storage.proof.mime-size-enforcement"]);
    expect(results.every(result => result.actualHttpRequests > 0 && /^[a-f0-9]{64}$/.test(result.evidenceSha256))).toBe(true);
    expect(shared.fixture.mock.calls.map(call => call[1])).toEqual([{ mode: "active_workspace", state: "drafting" }, { mode: "active_workspace", state: "approved_to_publish" }]);
    const unsigned = f.calls.filter(call => call.kind === "upload" && !call.signed);
    for (const prefix of ["mission-draft-assets", "mission-publication-proof-assets"]) {
      const set = unsigned.filter(call => call.path.startsWith(prefix));
      expect(set.map(call => call.actor)).toEqual(["anonymous", "otherCreator", "creator"]);
      expect(new Set(set.map(call => call.path)).size).toBe(1);
      const oversize = f.calls.find(call => call.kind === "upload" && call.path.startsWith(prefix) && call.byteLength === MAX + 1)!;
      const sameObject = f.calls.filter(call => call.kind === "upload" && call.path === oversize.path);
      expect(sameObject.map(call => [call.contentType, call.byteLength])).toEqual([["application/octet-stream", 68], ["image/png", MAX + 1], ["image/png", 68]]);
      expect(sameObject.every(call => call.signed)).toBe(true);
    }
    expect(f.calls.filter(call => call.kind === "remove")).toHaveLength(6);
    expect(f.objects.size).toBe(0);
    expect(f.assertions).toBeGreaterThanOrEqual(7);
    expect(JSON.stringify(results)).not.toContain("unit-private-grant");
    expect(JSON.stringify(f.records)).not.toContain("unit-private-grant");
  });
  it.each([
    { public: true }, { file_size_limit: MAX + 1 }, { file_size_limit: String(MAX) },
    { allowed_mime_types: ["image/png"] }, { allowed_mime_types: [...MIMES, "text/html"] },
  ])("holds on bucket policy/configuration drift %j without creating a fixture", async bucket => {
    const f = fixture({ bucket }); await failure(runProviderStorage(f.runtime), "STORAGE_BUCKET_PROFILE");
    expect(shared.fixture).not.toHaveBeenCalled(); expect(f.records).toEqual([]);
  });
  it.each(["https://mhkoayftiuojxlrkollf.supabase.co", "http://example.test:54321", "http://127.0.0.1:54321/private", "http://unit@127.0.0.1:54321", "http://127.0.0.1:54321/"])("refuses arbitrary API origin %s before any SDK/fixture call", async origin => {
    const f = fixture(); await failure(runProviderStorage({ ...f.runtime, apiOrigin: origin }), "STORAGE_SCOPE_INVALID");
    expect(f.calls).toEqual([]); expect(shared.fixture).not.toHaveBeenCalled();
  });
  it.each(["http://127.0.0.1:54322/private", "https://example.test"])("refuses an unowned app origin %s before HTTP", async appOrigin => {
    const f = fixture(); await failure(runProviderStorage({ ...f.runtime, appOrigin }), "STORAGE_SCOPE_INVALID"); expect(f.calls).toEqual([]);
  });
  it.each(["submissionId", "workflowId", "workItemId", "creatorId", "instructionRevision"])("rejects malformed shared fixture field %s before any grant", async field => {
    const f = fixture(), sample = await shared.fixture(f.runtime, { mode: "active_workspace", state: "drafting" });
    shared.fixture.mockResolvedValue({ ...sample, [field]: field === "instructionRevision" ? 1 : "unowned-fixture" });
    await failure(runProviderStorage(f.runtime), "STORAGE_FIXTURE");
    expect(f.calls.some(call => call.kind === "app-grant")).toBe(false);
  });
  it("accepts the provider's documented legacy validation messages without widening error classes", async () => {
    const f = fixture({ mime: { status: 400, message: "mime type application/octet-stream is not supported" }, size: { status: 400, message: "The object exceeded the maximum allowed size" } });
    expect(await runProviderStorage(f.runtime)).toHaveLength(6); expect(f.objects.size).toBe(0);
  });
  it("requires actual provider identity before ownership assertions", async () => {
    const f = fixture({ sessionMismatch: true }); await failure(runProviderStorage(f.runtime), "STORAGE_SESSION");
    expect(shared.fixture).not.toHaveBeenCalled(); expect(f.records).toEqual([]);
  });
  it.each(["auth", "bucket", "upload"])("does not count a local SDK result without new HTTP for %s", async noHttpFor => {
    const f = fixture({ noHttpFor }); await failure(runProviderStorage(f.runtime), "STORAGE_HTTP_REQUIRED");
    expect(f.records).toEqual([]); expect(f.objects.size).toBe(0);
  });
  it("fails if a foreign unsigned upload actually succeeds; cleanup still removes it", async () => {
    const f = fixture({ foreignWrite: true }); await failure(runProviderStorage(f.runtime), "STORAGE_DENIAL");
    expect(f.records).toEqual([]); expect(f.objects.size).toBe(0);
  });
  it("does not turn owner upload failure into a passing denial case", async () => {
    const f = fixture({ ownerUploadFails: true }); await failure(runProviderStorage(f.runtime), "STORAGE_UPLOAD");
    expect(f.records).toEqual([]); expect(f.calls.filter(call => call.kind === "remove")).toHaveLength(1);
  });
  it("requires exact owner retrieval equality, not merely a successful response", async () => {
    const f = fixture({ corruptDownload: true }); await failure(runProviderStorage(f.runtime), "STORAGE_CONTENT");
    expect(f.records).toEqual([]); expect(f.objects.size).toBe(0);
  });
  it.each([{ status: 401, code: "InvalidJWT" }, { status: 403, code: "InvalidSignature" }, { status: 403, code: "InvalidJWT" }, { status: 500, code: "InternalError" }, { status: 503 }, { status: 400, message: "unrelated validation" }])("refuses unrelated read errors as isolation evidence %j", async readError => {
    const f = fixture({ readError }); await failure(runProviderStorage(f.runtime), "STORAGE_DENIAL"); expect(f.records).toEqual([]);
  });
  it.each([{ metadataStatus: 401 }, { metadataStatus: 422 }, { metadataCode: "WRONG_STATE" }])("requires application MIME/size validation, not some other denial %j", async option => {
    const f = fixture(option); await failure(runProviderStorage(f.runtime), "STORAGE_VALIDATION");
    expect(f.records).toHaveLength(2); expect(f.objects.size).toBe(0);
  });
  it.each([{ status: 403, code: "AccessDenied" }, { status: 401, code: "InvalidJWT" }, { status: 503 }, { status: 400, message: "invalid unrelated field" }])("does not accept authentication/unrelated failure as provider MIME enforcement %j", async mime => {
    const f = fixture({ mime }); await failure(runProviderStorage(f.runtime), "STORAGE_PROVIDER_MIME");
    expect(f.records).toHaveLength(2); expect(f.objects.size).toBe(0);
  });
  it.each([{ status: 403, code: "InvalidSignature" }, { status: 401, code: "InvalidJWT" }, { status: 503 }, { status: 400, message: "invalid unrelated field" }])("does not accept authentication/unrelated failure as provider size enforcement %j", async size => {
    const f = fixture({ size }); await failure(runProviderStorage(f.runtime), "STORAGE_PROVIDER_SIZE");
    expect(f.records).toHaveLength(2); expect(f.objects.size).toBe(0);
  });
  it("holds if the signed capability never permits a positive upload", async () => {
    const f = fixture({ signingFails: true }); await failure(runProviderStorage(f.runtime), "STORAGE_UPLOAD");
    expect(f.records).toHaveLength(1); expect(f.objects.size).toBe(0);
  });
  it("rejects an unowned grant path and never uses it as a cleanup target", async () => {
    const f = fixture({ grantPath: `${id(999)}/unowned.png` }); await failure(runProviderStorage(f.runtime), "STORAGE_GRANT");
    expect(f.calls.filter(call => call.kind === "remove")).toEqual([]);
  });
  it.each(["sdk", "app", "body"] as const)("redacts private %s exceptions and does not retain a cause", async thrownPrivate => {
    const f = fixture({ thrownPrivate }); await failure(runProviderStorage(f.runtime), thrownPrivate === "sdk" ? "STORAGE_CLEANUP" : "STORAGE_REQUEST_FAILED"); expect(f.records).toEqual([]);
  });
  it("checks current ownership before every service cleanup mutation", async () => {
    const f = fixture({ cleanupOwnershipFails: true }); await failure(runProviderStorage(f.runtime), "STORAGE_CLEANUP");
    expect(f.calls.filter(call => call.kind === "remove")).toEqual([]);
  });
  it("sanitizes cleanup failures instead of returning passed evidence", async () => {
    const f = fixture({ removeFails: true }); await failure(runProviderStorage(f.runtime), "STORAGE_CLEANUP");
  });
  it("verifies removal through an actual owner read instead of trusting an empty remove response", async () => {
    const f = fixture({ removeNoop: true }); await failure(runProviderStorage(f.runtime), "STORAGE_CLEANUP"); expect(f.objects.size).toBe(6);
  });
});
