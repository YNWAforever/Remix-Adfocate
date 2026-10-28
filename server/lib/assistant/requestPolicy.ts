export const MAX_MESSAGE_CODEPOINTS = 4000;
export const NEW_REQUESTS_PER_MINUTE = 5;
export const MAX_INFLIGHT = 1;
export const PROVIDER_TIMEOUT_MS = 30000;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function validateAssistantRequest(body: { message?: unknown; client_request_id?: unknown; conversation_id?: unknown; locale?: unknown }) {
  if (typeof body.message !== "string" || !body.message.trim() || [...body.message].length > MAX_MESSAGE_CODEPOINTS
    || typeof body.client_request_id !== "string" || !UUID.test(body.client_request_id)
    || (body.conversation_id !== undefined && (typeof body.conversation_id !== "string" || !UUID.test(body.conversation_id)))
    || (body.locale !== undefined && !["zh-HK", "en"].includes(String(body.locale)))) throw new Error("bad_request");
  return { message: body.message.trim(), requestId: body.client_request_id,
    conversationId: body.conversation_id as string | undefined, locale: String(body.locale ?? "zh-HK") };
}
export async function withProviderDeadline<T>(run: (signal: AbortSignal) => Promise<T>, timeoutMs = PROVIDER_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const expiry = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("provider_outcome_unknown")); }, timeoutMs); });
  try { return await Promise.race([run(controller.signal), expiry]); }
  finally { clearTimeout(timer!); }
}
