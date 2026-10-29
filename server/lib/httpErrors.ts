import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export const GENERIC_ERROR = "系統暫時未能處理，請稍後再試。 / Something went wrong on our side. Please retry.";

/** Structured server log line; never includes request bodies or tokens. */
export function logServerError(c: Context, code: string, message: string | undefined) {
  console.error(JSON.stringify({ level: "error", code, method: c.req.method, path: c.req.path, message }));
}

/**
 * Database/RPC failure: log the real message server-side, return a stable code and a generic
 * message so Postgres internals (constraint, column and function names) never reach clients.
 */
export function dbError(
  c: Context,
  err: { message?: string } | null | undefined,
  code = "db_error",
  status: ContentfulStatusCode = 500,
) {
  logServerError(c, code, err?.message);
  return c.json({ error: GENERIC_ERROR, code }, status);
}
