import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolDef } from "../llm.js";

export const TOOL_DEFS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "get_my_points",
      description: "Get the current creator's points balance.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "get_my_missions",
      description: "List the creator's missions and their statuses. Optionally filter by status.",
      parameters: {
        type: "object",
        properties: { status: { type: "string", enum: ["applied", "joined", "submitted", "under_review", "approved", "rejected", "declined", "expired"] } },
        additionalProperties: false,
      },
    },
  },
];

type Client = Pick<SupabaseClient, "from">;

/** Execute a tool with the AUTH-SCOPED client; returns a compact string for the model. */
export async function runTool(name: string, argsJson: string, client: Client): Promise<string> {
  let args: Record<string, unknown> = {};
  try { args = argsJson ? JSON.parse(argsJson) : {}; } catch { /* ignore bad args */ }

  if (name === "get_my_points") {
    const { data, error } = await client.from("point_balances").select("balance, available_to");
    if (error) return `error: ${error.message}`;
    const balance = (data?.[0] as { balance?: number })?.balance ?? 0;
    return JSON.stringify({ points: balance });
  }

  if (name === "get_my_missions") {
    const VALID_STATUSES = new Set(["applied", "joined", "submitted", "under_review", "approved", "rejected", "declined", "expired"]);
    const base = client.from("mission_submissions")
      .select("status, points_awarded, submitted_at, missions(slug, title, mission_type)");
    const status = typeof args.status === "string" && VALID_STATUSES.has(args.status) ? args.status : undefined;
    const q = status ? base.eq("status", status) : base;
    const { data, error } = await q;
    if (error) return `error: ${error.message}`;
    return JSON.stringify({ missions: data ?? [] });
  }

  return `unknown tool: ${name}`;
}
