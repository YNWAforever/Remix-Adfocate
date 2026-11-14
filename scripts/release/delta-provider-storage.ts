import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ProviderRehearsalFailure,
  requireProviderFact,
  type ProviderActor,
  type ProviderCaseResult,
  type ProviderRehearsalRuntime,
} from "./delta-provider-contracts";
import { createProviderJourneyFixture } from "./delta-provider-journey-fixtures";

// Imported modules are inert. Only the owned runtime can provide HTTP/SQL capabilities.
const MAX_BYTES = 20_971_520;
const MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4", "video/quicktime", "video/webm"].sort();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FAILURE_CODES = new Set([
  "STORAGE_SCOPE_INVALID", "STORAGE_HTTP_REQUIRED", "STORAGE_SESSION", "STORAGE_BUCKET_PROFILE",
  "STORAGE_FIXTURE", "STORAGE_GRANT", "STORAGE_DENIAL", "STORAGE_UPLOAD", "STORAGE_FINALIZE",
  "STORAGE_CONTENT", "STORAGE_VALIDATION", "STORAGE_PROVIDER_MIME", "STORAGE_PROVIDER_SIZE",
  "STORAGE_CLEANUP", "STORAGE_REQUEST_FAILED",
]);
type Row = Record<string, unknown>;
type BucketKind = "draft" | "proof";
type Fixture = Pick<Awaited<ReturnType<typeof createProviderJourneyFixture>>, "submissionId" | "workflowId" | "workItemId" | "instructionRevision" | "creatorId">;
type Grant = { id: string; path: string; token: string };
type CleanupObject = { bucket: string; path: string; owner: ProviderActor };

function row(value: unknown): Row {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}
function loopbackOrigin(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" && parsed.hostname === "127.0.0.1" && parsed.port !== ""
      && parsed.origin === value && parsed.username === ""
      && parsed.pathname === "/" && parsed.search === "" && parsed.hash === "";
  } catch { return false; }
}
function requireScope(runtime: ProviderRehearsalRuntime) {
  requireProviderFact(loopbackOrigin(runtime.apiOrigin) && loopbackOrigin(runtime.appOrigin)
    && UUID.test(runtime.runId) && /^[a-f0-9]{40}$/i.test(runtime.sourceCommit)
    && UUID.test(runtime.workspaceId) && UUID.test(runtime.otherWorkspaceId)
    && runtime.workspaceId !== runtime.otherWorkspaceId
    && UUID.test(runtime.actors.creator.id) && UUID.test(runtime.actors.otherCreator.id)
    && runtime.actors.creator.id !== runtime.actors.otherCreator.id, "STORAGE_SCOPE_INVALID");
}
async function http<T>(runtime: ProviderRehearsalRuntime, operation: () => PromiseLike<T>): Promise<T> {
  const before = runtime.httpRequests;
  const result = await operation();
  requireProviderFact(runtime.httpRequests > before, "STORAGE_HTTP_REQUIRED");
  return result;
}
async function json(response: Response): Promise<Row> {
  // Local response contents and signed tokens remain private, including parse failures.
  const text = await response.text();
  requireProviderFact(text.length <= 65_536, "STORAGE_GRANT");
  return row(JSON.parse(text));
}
function basePath(kind: BucketKind, fixture: Fixture) {
  return kind === "draft"
    ? `/api/my-missions/${fixture.submissionId}/work-items/${fixture.workItemId}/assets`
    : `/api/my-missions/${fixture.submissionId}/publication/${fixture.workItemId}/assets`;
}
function mutation(kind: BucketKind, fixture: Fixture) {
  return kind === "proof" ? { expectedState: "approved_to_publish", expectedRevision: fixture.instructionRevision } : {};
}
async function post(runtime: ProviderRehearsalRuntime, owner: ProviderActor, path: string, body: Row, key = randomUUID()) {
  return http(runtime, () => runtime.request(owner, path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": key, "X-Workspace-Slug": runtime.workspaceSlug },
    body: JSON.stringify(body),
  }));
}
async function grant(runtime: ProviderRehearsalRuntime, kind: BucketKind, fixture: Fixture, cleanup: CleanupObject[]): Promise<Grant> {
  const key = randomUUID();
  const response = await post(runtime, runtime.actors.creator, `${basePath(kind, fixture)}/upload-grant`, {
    ...mutation(kind, fixture), fileName: "provider-synthetic.png", contentType: "image/png", sizeBytes: png().byteLength,
  }, key);
  requireProviderFact(response.ok, "STORAGE_GRANT");
  const body = await json(response), asset = row(body.asset), upload = row(body.upload);
  const id = asset.id, path = asset.storageObjectPath, token = body.token;
  const suffix = kind === "draft" ? `${String(id)}.png` : `proof-evidence/${key}.png`;
  const expected = `${runtime.actors.creator.id}/${fixture.workflowId}/${fixture.workItemId}/${suffix}`;
  requireProviderFact(typeof id === "string" && UUID.test(id) && path === expected
    && typeof token === "string" && token.length > 0 && token.length <= 8192
    && asset.uploadState === "pending" && asset.contentType === "image/png" && asset.sizeBytes === png().byteLength
    && upload.path === path && upload.token === token && upload.upsert === false
    && typeof body.expiresInSeconds === "number" && body.expiresInSeconds > 0 && body.expiresInSeconds <= 600, "STORAGE_GRANT");
  // A provider-returned path is never trusted as an arbitrary cleanup target.
  cleanup.push({ bucket: bucket(kind), path, owner: runtime.actors.creator });
  return { id, path, token };
}
function bucket(kind: BucketKind) { return kind === "draft" ? "mission-draft-assets" : "mission-publication-proof-assets"; }
function png(): Buffer { return Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jx1kAAAAASUVORK5CYII=", "base64"); }
function digest(value: Uint8Array | string) { return createHash("sha256").update(value).digest("hex"); }

function storageError(error: unknown) {
  const value = row(error);
  const statusCode = typeof value.statusCode === "string" ? value.statusCode : "";
  const numericCode = /^\d{3}$/.test(statusCode) ? Number(statusCode) : null;
  const status = numericCode ?? (typeof value.status === "number" ? value.status : null);
  const code = typeof value.code === "string" ? value.code : typeof value.error === "string" ? value.error : statusCode;
  const message = typeof value.message === "string" && value.message.length <= 4096 ? value.message : "";
  return { status, code, message };
}
function denied(error: unknown, read = false): boolean {
  if (!error) return false;
  const detail = storageError(error);
  if (["InvalidJWT", "InvalidSignature", "SignatureDoesNotMatch"].includes(detail.code)
    || /(?:invalid|expired).*(?:jwt|signature)|jwt.*(?:invalid|expired)/i.test(detail.message)) return false;
  if (detail.status === 403) return true;
  // Storage deliberately conceals unreadable objects. An existing owner-readable object
  // is established first, so this cannot count a nonexistent fixture as isolation.
  return read && ((detail.status === 404 && ["NoSuchKey", "not_found", "404"].includes(detail.code))
    || (detail.status === 400 && /^(?:object not found|the resource was not found|not found)$/i.test(detail.message)));
}
function mimeRejected(error: unknown): boolean {
  if (!error) return false;
  const detail = storageError(error);
  return (detail.status === 400 || detail.status === 415)
    && (detail.code === "InvalidMimeType" || /mime(?: type)?.*(?:not supported|not allowed|invalid)/i.test(detail.message));
}
function sizeRejected(error: unknown): boolean {
  if (!error) return false;
  const detail = storageError(error);
  return (detail.status === 400 || detail.status === 413)
    && (detail.code === "EntityTooLarge" || /(?:maximum allowed size|maximum file size|payload too large|request entity too large)/i.test(detail.message));
}
async function verifyBytes(runtime: ProviderRehearsalRuntime, client: SupabaseClient, kind: BucketKind, object: Grant, bytes: Uint8Array) {
  const downloaded = await http(runtime, () => client.storage.from(bucket(kind)).download(object.path));
  requireProviderFact(!downloaded.error && downloaded.data && downloaded.data.size === bytes.byteLength, "STORAGE_CONTENT");
  const received = Buffer.from(await downloaded.data.arrayBuffer());
  try { requireProviderFact(received.equals(bytes), "STORAGE_CONTENT"); }
  finally { received.fill(0); }
}
async function finalize(runtime: ProviderRehearsalRuntime, kind: BucketKind, fixture: Fixture, object: Grant, bytes: Uint8Array) {
  const response = await post(runtime, runtime.actors.creator, `${basePath(kind, fixture)}/${object.id}/finalize`, {
    ...mutation(kind, fixture), checksum: digest(bytes),
  });
  requireProviderFact(response.ok, "STORAGE_FINALIZE");
  const asset = row((await json(response)).asset);
  requireProviderFact(asset.id === object.id && asset.storageObjectPath === object.path
    && asset.uploadState === (kind === "draft" ? "ready" : "finalized")
    && asset.sizeBytes === bytes.byteLength && asset.contentType === "image/png", "STORAGE_FINALIZE");
}
async function checkBucket(runtime: ProviderRehearsalRuntime, kind: BucketKind) {
  const result = await http(runtime, () => runtime.service.storage.getBucket(bucket(kind)));
  const config = row(result.data);
  requireProviderFact(!result.error && config.id === bucket(kind) && config.public === false
    && config.file_size_limit === MAX_BYTES && Array.isArray(config.allowed_mime_types)
    && JSON.stringify([...config.allowed_mime_types].sort()) === JSON.stringify(MIME_TYPES), "STORAGE_BUCKET_PROFILE");
}
async function ownerIsolation(runtime: ProviderRehearsalRuntime, kind: BucketKind, fixture: Fixture, cleanup: CleanupObject[]) {
  const before = runtime.httpRequests, object = await grant(runtime, kind, fixture, cleanup), bytes = png();
  try {
    // Neither negative receives the signed bearer token. Both target the SAME vacant
    // granted path subsequently uploaded by its legitimate owner with the same bytes.
    for (const client of [runtime.anonymous, runtime.actors.otherCreator.client]) {
      const result = await http(runtime, () => client.storage.from(bucket(kind)).upload(object.path, bytes, { contentType: "image/png", upsert: false }));
      requireProviderFact(result.data === null && denied(result.error), "STORAGE_DENIAL");
    }
    const uploaded = await http(runtime, () => runtime.actors.creator.client.storage.from(bucket(kind)).upload(object.path, bytes, { contentType: "image/png", upsert: false }));
    requireProviderFact(!uploaded.error && uploaded.data?.path === object.path, "STORAGE_UPLOAD");
    await finalize(runtime, kind, fixture, object, bytes);
    await verifyBytes(runtime, runtime.actors.creator.client, kind, object, bytes);
    for (const client of [runtime.anonymous, runtime.actors.otherCreator.client]) {
      const result = await http(runtime, () => client.storage.from(bucket(kind)).download(object.path));
      requireProviderFact(result.data === null && denied(result.error, true), "STORAGE_DENIAL");
    }
    // The denied reads must leave the established owned object intact.
    await verifyBytes(runtime, runtime.actors.creator.client, kind, object, bytes);
    return runtime.record(`storage.${kind}.owner-access-isolation`, { bucket: bucket(kind), objectHash: digest(object.path), contentHash: digest(bytes), anonymousWriteDenied: true, otherOwnerWriteDenied: true, anonymousReadDenied: true, otherOwnerReadDenied: true, ownerReadEqual: true }, before);
  } finally { bytes.fill(0); }
}
async function signedUpload(runtime: ProviderRehearsalRuntime, kind: BucketKind, fixture: Fixture, cleanup: CleanupObject[]) {
  const before = runtime.httpRequests, object = await grant(runtime, kind, fixture, cleanup), bytes = png();
  try {
    // Signed upload tokens are bearer capabilities, not an assertion of uploader identity.
    const result = await http(runtime, () => runtime.actors.creator.client.storage.from(bucket(kind)).uploadToSignedUrl(object.path, object.token, bytes, { contentType: "image/png", upsert: false }));
    requireProviderFact(!result.error && result.data?.path === object.path, "STORAGE_UPLOAD");
    await finalize(runtime, kind, fixture, object, bytes);
    await verifyBytes(runtime, runtime.actors.creator.client, kind, object, bytes);
    return runtime.record(`storage.${kind}.signed-upload`, { bucket: bucket(kind), objectHash: digest(object.path), contentHash: digest(bytes), grantIssuedOverAppHttp: true, signedUpload: true, finalized: true, ownerReadEqual: true }, before);
  } finally { bytes.fill(0); }
}
async function constraints(runtime: ProviderRehearsalRuntime, kind: BucketKind, fixture: Fixture, cleanup: CleanupObject[]) {
  const before = runtime.httpRequests;
  for (const invalid of [{ contentType: "application/octet-stream", sizeBytes: png().byteLength }, { contentType: "image/png", sizeBytes: MAX_BYTES + 1 }]) {
    const response = await post(runtime, runtime.actors.creator, `${basePath(kind, fixture)}/upload-grant`, {
      ...mutation(kind, fixture), fileName: "provider-synthetic.png", ...invalid,
    });
    const body = await json(response);
    requireProviderFact(response.status === 400 && body.code === "VALIDATION_FAILED", "STORAGE_VALIDATION");
  }
  const object = await grant(runtime, kind, fixture, cleanup), bytes = png();
  try {
    const mime = await http(runtime, () => runtime.actors.creator.client.storage.from(bucket(kind)).uploadToSignedUrl(object.path, object.token, bytes, { contentType: "application/octet-stream", upsert: false }));
    requireProviderFact(mime.data === null && mimeRejected(mime.error), "STORAGE_PROVIDER_MIME");
    const oversized = Buffer.alloc(MAX_BYTES + 1);
    let size;
    try {
      size = await http(runtime, () => runtime.actors.creator.client.storage.from(bucket(kind)).uploadToSignedUrl(object.path, object.token, oversized, { contentType: "image/png", upsert: false }));
    } finally { oversized.fill(0); }
    requireProviderFact(size.data === null && sizeRejected(size.error), "STORAGE_PROVIDER_SIZE");
    // Success on the SAME path/token proves earlier failures were MIME/size enforcement,
    // rather than a missing grant, invalid ownership, consumed token or wrong fixture.
    const valid = await http(runtime, () => runtime.actors.creator.client.storage.from(bucket(kind)).uploadToSignedUrl(object.path, object.token, bytes, { contentType: "image/png", upsert: false }));
    requireProviderFact(!valid.error && valid.data?.path === object.path, "STORAGE_UPLOAD");
    await finalize(runtime, kind, fixture, object, bytes);
    await verifyBytes(runtime, runtime.actors.creator.client, kind, object, bytes);
    return runtime.record(`storage.${kind}.mime-size-enforcement`, { bucket: bucket(kind), objectHash: digest(object.path), configuredLimit: MAX_BYTES, appMimeDenied: true, appSizeDenied: true, providerMimeDenied: true, providerSizeDenied: true, sameGrantValidUpload: true, ownerReadEqual: true }, before);
  } finally { bytes.fill(0); }
}
async function cleanupObjects(runtime: ProviderRehearsalRuntime, objects: readonly CleanupObject[]) {
  try {
    for (const object of objects) {
      await runtime.assertOwned();
      const result = await http(runtime, () => runtime.service.storage.from(object.bucket).remove([object.path]));
      requireProviderFact(!result.error, "STORAGE_CLEANUP");
      const absent = await http(runtime, () => object.owner.client.storage.from(object.bucket).download(object.path));
      requireProviderFact(absent.data === null && denied(absent.error, true), "STORAGE_CLEANUP");
    }
  } catch { throw new ProviderRehearsalFailure("STORAGE_CLEANUP"); }
}

/** Real provider cases only when invoked by the owned local runtime; unit mocks are not evidence. */
export async function runProviderStorage(runtime: ProviderRehearsalRuntime): Promise<ProviderCaseResult[]> {
  const cleanup: CleanupObject[] = [];
  try {
    requireScope(runtime);
    await runtime.assertOwned();
    for (const actor of [runtime.actors.creator, runtime.actors.otherCreator]) {
      const session = await http(runtime, () => actor.client.auth.getUser());
      requireProviderFact(!session.error && session.data.user?.id === actor.id, "STORAGE_SESSION");
    }
    const results: ProviderCaseResult[] = [];
    for (const kind of ["draft", "proof"] as const) {
      await checkBucket(runtime, kind);
      const fixture = await createProviderJourneyFixture(runtime, { mode: "active_workspace", state: kind === "draft" ? "drafting" : "approved_to_publish" });
      requireProviderFact(UUID.test(fixture.submissionId) && UUID.test(fixture.workflowId) && UUID.test(fixture.workItemId)
        && fixture.creatorId === runtime.actors.creator.id && fixture.instructionRevision === 0, "STORAGE_FIXTURE");
      results.push(await ownerIsolation(runtime, kind, fixture, cleanup));
      results.push(await signedUpload(runtime, kind, fixture, cleanup));
      results.push(await constraints(runtime, kind, fixture, cleanup));
    }
    return results;
  } catch (error) {
    if (error instanceof ProviderRehearsalFailure && FAILURE_CODES.has(error.code)) throw error;
    throw new ProviderRehearsalFailure("STORAGE_REQUEST_FAILED");
  } finally {
    // All object mutations remain scoped; outer runtime cleanup also destroys a partial stack.
    await cleanupObjects(runtime, cleanup);
  }
}
