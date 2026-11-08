import { Hono } from "hono";
import type { Env } from "../app.js";
import { serviceClient } from "../lib/supabase.js";
import { sourceInput } from "../../src/lib/studio/policy.js";
import { dbError } from "../lib/httpErrors.js";
import { authorizeStudioCommand, redactRevokedIntegrationOutputs } from "../lib/integrations/evidence.js";
import { answerFingerprint, readToolTraces } from "../lib/studio/toolTraces.js";
import { IntegrationError } from "../lib/integrations/policy.js";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const studioRoutes = new Hono<Env>();
studioRoutes.use("*", async (c, next) => {
  c.header("Cache-Control", "private, no-store");
  if (process.env.STUDIO_THREADS !== "true") return c.json({ code: "studio_disabled", error: "工作室尚未開放" }, 404);
  await next();
});
studioRoutes.get("/threads", async c => {
  const page = Math.floor(Math.max(0, Math.min(1000, Number(c.req.query("page")) || 0)));
  const result = await serviceClient().from("studio_threads").select("id,title,topic,mission_id,conversation_id,revision,created_at")
    .eq("creator_id", c.get("userId")).eq("workspace_id", c.get("workspaceId")).order("created_at", { ascending: false }).order("id").range(page * 30, page * 30 + 29);
  if (result.error) return dbError(c, result.error, "studio_unavailable", 503);
  return c.json({ threads: result.data, nextPage: result.data.length === 30 ? page + 1 : null });
});
studioRoutes.get("/threads/:id", async c => {
  const id = c.req.param("id");
  if (!uuid.test(id)) return c.json({ code: "not_found" }, 404);
  const client = serviceClient(), creator = c.get("userId"), workspace = c.get("workspaceId");
  const thread = await client.from("studio_threads").select("id,title,initial_prompt,topic,mission_id,conversation_id,revision,created_at")
    .eq("id", id).eq("creator_id", creator).eq("workspace_id", workspace).maybeSingle();
  if (thread.error) return dbError(c, thread.error, "studio_unavailable", 503);
  if (!thread.data) return c.json({ code: "not_found" }, 404);
  const [sources, briefs, shares, messages] = await Promise.all([
    client.from("studio_sources").select("*").eq("thread_id", id).eq("creator_id", creator).eq("workspace_id", workspace).order("created_at", { ascending: false }).limit(100),
    client.from("studio_briefs").select("id,thread_id,version,sections,created_at").eq("thread_id", id).eq("creator_id", creator).eq("workspace_id", workspace).order("version", { ascending: false }).limit(20),
    client.from("studio_shares").select("id,brief_id,submission_id,work_item_id,section_ids,draft_revision,created_at").eq("thread_id", id).eq("creator_id", creator).eq("workspace_id", workspace).order("created_at", { ascending: false }).limit(20),
    client.from("assistant_messages").select("id,role,content,created_at").eq("conversation_id", thread.data.conversation_id).order("created_at", { ascending: false }).order("turn_order", { ascending: false }).limit(100),
  ]);
  const error = [sources, briefs, shares, messages].find(result => result.error)?.error;
  if (error) return dbError(c, error, "studio_unavailable", 503);
  const traces = await readToolTraces(client, thread.data.conversation_id);
  const withTools = (messages.data?.reverse() ?? []).map(message => {
    if (message.role !== "assistant" || typeof message.content !== "string") return message;
    const tools = traces.get(answerFingerprint(message.content));
    return tools?.length ? { ...message, tools } : message;
  });
  return c.json(redactRevokedIntegrationOutputs({ thread: thread.data, sources: sources.data ?? [], briefs: briefs.data ?? [], shares: shares.data, messages: withTools,
    limits: { sources: 100, versions: 20, messages: 100 } }));
});
studioRoutes.get("/badges", async c => {
  const result = await serviceClient().from("studio_badges").select("id,badge_key,policy_version,source_event,created_at")
    .eq("creator_id", c.get("userId")).eq("workspace_id", c.get("workspaceId")).order("created_at", { ascending: false });
  if (result.error) return dbError(c, result.error, "studio_unavailable", 503);
  return c.json({ badges: result.data });
});
studioRoutes.post("/commands", async c => {
  const raw = await c.req.text();
  if (raw.length > 64_000) return c.json({ code: "INVALID_INPUT", error: "內容太長" }, 400);
  let input: { requestId: string; action: string; payload: Record<string, unknown> };
  try {
    input = JSON.parse(raw);
    if (!uuid.test(input.requestId) || !["create_thread", "add_source", "revoke_source", "save_brief", "share_brief"].includes(input.action) || !input.payload || Array.isArray(input.payload) || typeof input.payload !== "object") throw new Error();
    if (input.action === "add_source") input.payload = { ...input.payload, ...sourceInput(input.payload) };
  } catch { return c.json({ code: "INVALID_INPUT", error: "請檢查內容與來源權限" }, 400); }
  try { await authorizeStudioCommand(serviceClient(), {creatorId:c.get("userId"),workspaceId:c.get("workspaceId")}, input.action, input.payload); }
  catch(error) { const known=error instanceof IntegrationError?error:new IntegrationError("SOURCE_UNAVAILABLE",503);return c.json({code:known.code,error:"來源權限尚未確認，請保留草稿並重新檢查。"},known.status as 400|403|404|409|503); }
  const result = await serviceClient().rpc("studio_command", { p_workspace: c.get("workspaceId"), p_creator: c.get("userId"), p_request: input.requestId, p_action: input.action, p_payload: input.payload });
  if (result.error) {
    const code = result.error.message;
    if (["WORKFLOW_STALE", "STALE_BRIEF", "IDEMPOTENCY_CONFLICT", "WRONG_STATE"].includes(code)) return c.json({ code, error: "版本已變更，請保留草稿並重新確認" }, 409);
    if (code === "NOT_FOUND") return c.json({ code, error: "找不到這份內容" }, 404);
    if (["SOURCE_PRIVATE", "SOURCE_UNAVAILABLE", "SOURCE_LINEAGE_REQUIRED", "SOURCE_PERMISSION_REQUIRED", "MODEL_CONSENT_REQUIRED"].includes(code)) return c.json({ code, error: "來源未獲分享授權或已撤銷，請重新整理相關段落" }, 403);
    if (["INVALID_INPUT", "INVALID_SELECTION", "INVALID_ACTION", "INVALID_SOURCE", "UNSUPPORTED_COVERAGE", "SOURCE_LIMIT"].includes(code) || ["22P02", "23514", "23502"].includes(result.error.code)) return c.json({ code: "INVALID_INPUT", error: "請檢查內容、項目及來源（每個討論最多 100 項來源）" }, 400);
    return dbError(c, result.error, "studio_unavailable", 503);
  }
  return c.json({ result: result.data });
});
