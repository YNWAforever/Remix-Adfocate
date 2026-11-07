import { Hono, type Context } from "hono";
import type { Env } from "../app.js";
import { handleMetaNotice, type MetaNoticeDependencies } from "../lib/integrations/metaNotice.js";
import { IntegrationError } from "../lib/integrations/policy.js";

/** Server repository port, scoped by trusted composition to the configured app/target.
 * Missing/unrecognized receipts return null; never infer completion from absent data.
 * Deliberately no private-table/SQL fallback or default implementation.
 */
export interface IntegrationReceiptRepository {
  readReceipt(confirmationCode: string): Promise<{ status: "pending" | "completed" } | null>;
}
/** Offline composition only; supplying these dependencies is not live admission. */
export type IntegrationNoticeFixture = {
  origin: string;
  providerProjectId: string;
  notice: MetaNoticeDependencies;
  receipts?: IntegrationReceiptRepository;
  now?: () => Date;
};

const MAX_FORM_BYTES = 16 * 1024;
// D0's repository issues 128-bit hex confirmation codes. Never interpret account IDs as receipts.
const receiptCode = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{32}$/.test(value);
const receiptStatus = (value: unknown): value is "pending" | "completed" => value === "pending" || value === "completed";
const fail = (code: string, status: number): never => { throw new IntegrationError(code, status); };

async function signedForm(c: Context<Env>): Promise<string> {
  if (!/^application\/x-www-form-urlencoded(?:\s*;\s*charset=utf-8)?$/i.test(c.req.header("Content-Type") ?? "")) return fail("UNSUPPORTED_MEDIA_TYPE", 415);
  const length = c.req.header("Content-Length");
  if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > MAX_FORM_BYTES)) return fail("PAYLOAD_TOO_LARGE", 413);
  const reader = c.req.raw.body?.getReader();
  if (!reader) return fail("INVALID_INPUT", 400);
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_FORM_BYTES) { await reader.cancel(); return fail("PAYLOAD_TOO_LARGE", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let raw: string;
  try {
    raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    // URLSearchParams tolerates broken percent escapes/UTF-8; this protocol boundary must not.
    decodeURIComponent(raw.replace(/\+/g, " "));
  } catch { return fail("INVALID_INPUT", 400); }
  const form = new URLSearchParams(raw), fields = [...form];
  if (fields.length !== 1 || fields[0][0] !== "signed_request" || !fields[0][1]) return fail("INVALID_INPUT", 400);
  return fields[0][1];
}

/** Public protocol fixtures only. D1/default composition never installs a network adapter. */
export function integrationNoticeRoutes(deps: { fixture?: IntegrationNoticeFixture } = {}) {
  const app = new Hono<Env>();
  const fixture = deps.fixture;
  let origin: string | null = null;
  try {
    const url = new URL(fixture?.origin ?? "");
    if (url.protocol === "https:" && url.origin === fixture?.origin && !url.username && !url.password
      && fixture.providerProjectId && fixture.providerProjectId.length <= 255) origin = url.origin;
  } catch { /* Missing/invalid composition remains disabled. */ }
  app.onError((error, c) => {
    // No raw provider/repository messages, payloads or URLs enter logs or public errors.
    const allowed: Record<string, 400 | 403 | 413 | 415 | 503> = {
      INVALID_INPUT: 400, PAYLOAD_TOO_LARGE: 413, UNSUPPORTED_MEDIA_TYPE: 415,
      PROVIDER_NOTICE_INVALID: 403, PROVIDER_IDENTITY_MAPPING_REQUIRED: 503,
    };
    const code = error instanceof IntegrationError && Object.hasOwn(allowed, error.code) ? error.code : "INTEGRATION_NOTICES_UNAVAILABLE";
    return c.json({ code }, allowed[code] ?? 503);
  });
  app.use("*", async (c, next) => {
    c.header("Cache-Control", "private, no-store"); c.header("Referrer-Policy", "no-referrer");
    c.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    c.header("X-Content-Type-Options", "nosniff"); c.header("X-Robots-Tag", "noindex, nofollow");
    if (!fixture || !origin) return c.json({ code: "INTEGRATION_NOTICES_DISABLED" }, 503);
    if (new URL(c.req.url).origin !== origin || (c.req.header("Origin") !== undefined && c.req.header("Origin") !== origin)
      || (c.req.method === "POST" && c.req.header("Sec-Fetch-Site") === "cross-site")) return c.json({ code: "ORIGIN_DENIED" }, 403);
    await next();
  });
  const notice = (kind: "deauthorization" | "deletion") => async (c: Context<Env>) => {
    const result = await handleMetaNotice(await signedForm(c), kind, {
      ...fixture!.notice,
      async resolveBinding(id) {
        const binding = await fixture!.notice.resolveBinding(id);
        return binding?.providerProjectId === fixture!.providerProjectId ? binding : null;
      },
    }, fixture!.now?.() ?? new Date());
    if (!result || !receiptCode(result.confirmationCode) || !receiptStatus(result.status)) return fail("INVALID_RECEIPT_RESULT", 503);
    return c.json({ url: `${origin}/integration-deletion/${result.confirmationCode}`, confirmation_code: result.confirmationCode });
  };
  app.post("/instagram/deauthorize", notice("deauthorization"));
  app.post("/instagram/delete", notice("deletion"));
  app.get("/deletion/:receipt", async c => {
    const receipt = c.req.param("receipt");
    if (!receiptCode(receipt)) return c.json({ code: "INVALID_INPUT" }, 400);
    if (!fixture!.receipts) return c.json({ code: "RECEIPT_STATUS_UNAVAILABLE" }, 503);
    const result = await fixture!.receipts.readReceipt(receipt);
    if (result === null) return c.json({ code: "RECEIPT_NOT_FOUND" }, 404);
    if (!result || !receiptStatus(result.status)) return fail("INVALID_RECEIPT_RESULT", 503);
    return c.json({ status: result.status });
  });
  return app;
}
