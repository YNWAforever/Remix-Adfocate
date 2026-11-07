import { Hono, type Context } from "hono";
import type { Env } from "../app.js";
import { publishActorFromVerifiedSession } from "../lib/creatorGrowth/publishSession.js";
import type { PublishService, PublishPreview, PublishStatus } from "../lib/creatorGrowth/publishService.js";

export type CreatorGrowthPublishDependencies = Readonly<{
  service: Pick<PublishService, "prepare" | "approve" | "getOwned" | "reconcile">;
}>;

type JsonObject = Record<string, unknown>;
const MAX_COMMAND_BYTES = 8_192;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isId = (value: unknown): value is string => typeof value === "string" && uuidPattern.test(value);
const isHash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const isNonce = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{32,128}$/.test(value);
const isSubject = (value: unknown): value is string => typeof value === "string" && /^[1-9][0-9]{0,63}$/.test(value);
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const isCode = (value: unknown): value is string => typeof value === "string" && /^[A-Z][A-Z0-9_]{0,79}$/.test(value);
const isTime = (value: unknown): value is string => typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value));
const object = (value: unknown): value is JsonObject => !!value && typeof value === "object" && !Array.isArray(value);
function text(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length <= max && !/data:image\/|blob:|\bBearer\s+/i.test(value)
    && [...value].every((char) => { const cp = char.codePointAt(0)!; return cp >= 32 && cp !== 127 || cp === 9 || cp === 10 || cp === 13; });
}
class CommandError extends Error {
  constructor(readonly code: "PUBLISH_INVALID" | "PUBLISH_LIMIT" | "PUBLISH_DISABLED" | "PUBLISH_UNAVAILABLE") { super(code); }
}
const invalid = (): never => { throw new CommandError("PUBLISH_INVALID"); };
const unavailable = (): never => { throw new CommandError("PUBLISH_UNAVAILABLE"); };
function exactKeys(body: JsonObject, allowed: string[], required = allowed): void {
  if (Object.keys(body).some((key) => !allowed.includes(key)) || required.some((key) => !(key in body))) invalid();
}

async function command(context: Context<Env>): Promise<JsonObject> {
  if (context.req.header("Content-Type")?.split(";")[0].trim().toLowerCase() !== "application/json") invalid();
  const reader = context.req.raw.body?.getReader();
  if (!reader) return invalid();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_COMMAND_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new CommandError("PUBLISH_LIMIT");
      }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!object(value)) return invalid();
    return value;
  } catch { return invalid(); }
}

/** Projection rejects invalid fields and discards internal/extra fields. */
function previewDto(value: unknown): PublishPreview {
  if (!object(value) || !isId(value.draftId) || !isNumber(value.draftRevision) || !isId(value.assetId)
    || !isHash(value.imageSha256) || !text(value.caption, 16_384) || !isSubject(value.accountSubject)
    || !text(value.accountLabel, 120) || typeof value.eligible !== "boolean" || value.sampleOnly !== true
    || !object(value.disclosure)) return unavailable();
  const d = value.disclosure;
  if (typeof d.sponsored !== "boolean" || typeof d.platformLabelRequired !== "boolean" || typeof d.brandTagRequired !== "boolean" || !text(d.captionText, 2_000)) return unavailable();
  let mission: PublishPreview["mission"] = null;
  if (value.mission !== null) {
    const m = value.mission;
    if (!object(m) || typeof m.kind !== "string" || !["active", "legacy"].includes(m.kind) || !isId(m.submissionId) || !isId(m.workItemId)
      || !(m.approvedVersionId === null || isId(m.approvedVersionId)) || !isNumber(m.instructionRevision)
      || !(m.state === null || text(m.state, 64))) return unavailable();
    mission = { kind: m.kind as "active" | "legacy", submissionId: m.submissionId, workItemId: m.workItemId,
      approvedVersionId: m.approvedVersionId, instructionRevision: m.instructionRevision, state: m.state };
  }
  if (!(value.missionBasisVersionId === null || isId(value.missionBasisVersionId))
    || !(value.reason === undefined || isCode(value.reason))
    || !(value.fallback === undefined || value.fallback === "manual_proof")) return unavailable();
  if (value.eligible) {
    if (!isId(value.approvalId) || !isNonce(value.nonce) || !isHash(value.fingerprint) || !isTime(value.expiresAt)) return unavailable();
  } else if (value.approvalId !== null || value.nonce !== null || value.fingerprint !== null || value.expiresAt !== null) return unavailable();
  return {
    draftId: value.draftId, draftRevision: value.draftRevision, assetId: value.assetId, imageSha256: value.imageSha256,
    caption: value.caption, accountSubject: value.accountSubject, accountLabel: value.accountLabel,
    disclosure: { sponsored: d.sponsored, captionText: d.captionText, platformLabelRequired: d.platformLabelRequired, brandTagRequired: d.brandTagRequired },
    mission, missionBasisVersionId: value.missionBasisVersionId, eligible: value.eligible,
    ...(value.reason === undefined ? {} : { reason: value.reason }),
    ...(value.fallback === undefined ? {} : { fallback: value.fallback }),
    approvalId: value.approvalId as string | null, nonce: value.nonce as string | null,
    fingerprint: value.fingerprint as string | null, expiresAt: value.expiresAt as string | null, sampleOnly: true,
  };
}

const states = new Set(["creator_approved", "container_preparing", "provider_processing", "publish_requested", "published", "failed", "outcome_unknown", "cancelled", "invalidated"]);
function statusDto(value: unknown): PublishStatus {
  if (!object(value) || !isId(value.id) || typeof value.state !== "string" || !states.has(value.state) || !isNumber(value.version)
    || !isSubject(value.accountSubject) || !(value.providerContainerId === null || isSubject(value.providerContainerId))
    || !(value.providerMediaId === null || isSubject(value.providerMediaId)) || value.permalink !== null
    || typeof value.stopped !== "boolean" || !isTime(value.updatedAt) || value.sampleOnly !== true) return unavailable();
  return { id: value.id, state: value.state as PublishStatus["state"], version: value.version, accountSubject: value.accountSubject,
    providerContainerId: value.providerContainerId, providerMediaId: value.providerMediaId, permalink: null,
    stopped: value.stopped, updatedAt: value.updatedAt, sampleOnly: true };
}

function safeError(context: Context<Env>, error: unknown): Response {
  const code = object(error) && typeof error.code === "string" ? error.code : "PUBLISH_UNAVAILABLE";
  if (code === "PUBLISH_SESSION_REQUIRED") return context.json({ code, error: "請重新登入，再查看這份預覽。" }, 401);
  if (code === "PUBLISH_DISABLED") return context.json({ code, error: "發佈功能尚未啟用。" }, 503);
  if (code === "PUBLISH_DENIED") return context.json({ code, error: "目前未能開啟這份私人內容。" }, 403);
  if (code === "PUBLISH_INVALID") return context.json({ code, error: "請重新開啟預覽，再確認內容。" }, 400);
  if (code === "PUBLISH_LIMIT") return context.json({ code, error: "這個請求太大，請重新開啟預覽。" }, 413);
  if (["PUBLISH_STALE", "PUBLISH_APPROVAL_INVALID", "PUBLISH_CONFLICT", "PUBLISH_CAS", "PUBLISH_TRANSITION", "PUBLISH_GRANT_INVALID", "PUBLISH_PREVIEW_CHANGED"].includes(code)) {
    return context.json({ code, error: "內容或授權已更新，請重新確認預覽。" }, 409);
  }
  return context.json({ code: "PUBLISH_UNAVAILABLE", error: "暫時未能處理，請稍後查看狀態。" }, 503);
}

/** Must be mounted under workspaceAuth. No execute endpoint or model tool exists. */
export function createCreatorGrowthPublishRoutes(deps?: CreatorGrowthPublishDependencies): Hono<Env> {
  const routes = new Hono<Env>();
  const actor = (c: Context<Env>) => publishActorFromVerifiedSession({ workspaceId: c.get("workspaceId"), creatorId: c.get("userId"), verifiedJwt: c.get("jwt") });
  const service = () => { if (!deps) throw new CommandError("PUBLISH_DISABLED"); return deps.service; };
  routes.use("*", async (c, next) => {
    c.header("Cache-Control", "private, no-store"); c.header("Pragma", "no-cache");
    c.header("Referrer-Policy", "no-referrer"); c.header("X-Content-Type-Options", "nosniff");
    actor(c); await next();
  });
  routes.onError((error, c) => safeError(c, error));
  routes.post("/preview", async (c) => {
    const active = service(); const body = await command(c); exactKeys(body, ["draftId"]);
    if (!isId(body.draftId)) return invalid();
    return c.json(previewDto(await active.prepare(actor(c), body.draftId)));
  });
  routes.post("/approve", async (c) => {
    const active = service(); const body = await command(c); exactKeys(body, ["draftId", "approvalId", "nonce", "fingerprint"]);
    const requestId = c.req.header("Idempotency-Key");
    // This explicit UI intent marker is not authentication or proof of humanity.
    // Authority comes from verified session + the durable one-use approval record.
    if (c.req.header("X-Creator-Confirmation") !== "exact-preview-v1" || !isId(requestId)
      || !isId(body.draftId) || !isId(body.approvalId) || !isNonce(body.nonce) || !isHash(body.fingerprint)) return invalid();
    return c.json(statusDto(await active.approve(actor(c), { draftId: body.draftId, approvalId: body.approvalId, nonce: body.nonce, fingerprint: body.fingerprint, requestId })));
  });
  routes.get("/:intentId", async (c) => {
    const active = service(); const intentId = c.req.param("intentId"); if (!isId(intentId)) return invalid();
    return c.json(statusDto(await active.getOwned(actor(c), intentId)));
  });
  routes.post("/:intentId/reconcile", async (c) => {
    const active = service(); const intentId = c.req.param("intentId"); if (!isId(intentId)) return invalid();
    exactKeys(await command(c), []);
    return c.json(statusDto(await active.reconcile(actor(c), intentId)));
  });
  return routes;
}
