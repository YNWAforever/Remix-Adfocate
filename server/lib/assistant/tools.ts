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

const missionStatusDef = TOOL_DEFS[1];

/** Studio chat may only read the creator's own account state. Every tool below is read-only:
 * no writes, no approvals, no publication or reward actions can be reached from a model turn. */
export const STUDIO_TOOL_DEFS: ToolDef[] = [
  TOOL_DEFS[0],
  missionStatusDef,
  {
    type: "function",
    function: {
      name: "get_my_mission_requirements",
      description: "Read the frozen requirements for one of the creator's own missions. Pass the mission slug returned by get_my_missions.",
      parameters: {
        type: "object",
        properties: { mission_slug: { type: "string", description: "Mission slug from get_my_missions" } },
        required: ["mission_slug"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_my_earnings",
      description: "Get the creator's available cash earnings balance.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "get_open_missions",
      description: "List currently open missions in the creator's workspace with slug, title, points and deadline.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "get_my_redemptions",
      description: "List the creator's recent reward redemptions and their status.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "get_my_notifications",
      description: "List the creator's latest notifications with their read state.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
];

export type ToolScope = Readonly<{ workspaceId?: string | null }>;

type Client = Pick<SupabaseClient, "from">;

const MAX_TOOL_RESULT_CHARS = 6000;

function compact(value: string): string {
  return value.length > MAX_TOOL_RESULT_CHARS ? `${value.slice(0, MAX_TOOL_RESULT_CHARS)}…[truncated]` : value;
}

function firstRow(data: unknown): Record<string, unknown> | null {
  return Array.isArray(data) ? ((data[0] as Record<string, unknown> | undefined) ?? null) : null;
}

/** Execute a tool with the AUTH-SCOPED client; returns a compact string for the model. */
export async function runTool(name: string, argsJson: string, client: Client, scope?: ToolScope): Promise<string> {
  let args: Record<string, unknown> = {};
  try { args = argsJson ? JSON.parse(argsJson) : {}; } catch { /* ignore bad args */ }

  if (name === "get_my_points") {
    const { data, error } = await client.from("point_balances").select("balance, available_to").limit(1);
    if (error) return `error: ${error.message}`;
    const balance = Number((firstRow(data) as { balance?: number } | null)?.balance ?? 0);
    return JSON.stringify({ points: balance });
  }

  if (name === "get_my_missions") {
    const VALID_STATUSES = new Set(["applied", "joined", "submitted", "under_review", "approved", "rejected", "declined", "expired"]);
    let base = client.from("mission_submissions")
      .select("status, points_awarded, submitted_at, missions(slug, title, mission_type)");
    const status = typeof args.status === "string" && VALID_STATUSES.has(args.status) ? args.status : undefined;
    if (status) base = base.eq("status", status);
    const { data, error } = await base.limit(50);
    if (error) return `error: ${error.message}`;
    return compact(JSON.stringify({ missions: data ?? [] }));
  }

  if (name === "get_my_mission_requirements") {
    const slug = typeof args.mission_slug === "string" ? args.mission_slug.trim() : "";
    if (!slug || slug.length > 200) return JSON.stringify({ error: "mission_slug is required" });
    let query = client.from("missions")
      .select("slug,title,mission_type,description,platforms,deliverables,deadline,requirements,dos,donts,key_messages")
      .eq("slug", slug);
    if (scope?.workspaceId) query = query.eq("workspace_id", scope.workspaceId);
    const { data, error } = await query.limit(1);
    if (error) return `error: ${error.message}`;
    return compact(JSON.stringify({ mission: firstRow(data) }));
  }

  if (name === "get_my_earnings") {
    const { data, error } = await client.from("earnings_balances").select("available").limit(1);
    if (error) return `error: ${error.message}`;
    return JSON.stringify({ available: Number((firstRow(data) as { available?: number | string } | null)?.available ?? 0) });
  }

  if (name === "get_open_missions") {
    let query = client.from("missions")
      .select("slug,title,mission_type,points_reward,deadline,platforms")
      .eq("status", "active");
    if (scope?.workspaceId) query = query.eq("workspace_id", scope.workspaceId);
    const { data, error } = await query.order("deadline", { ascending: true, nullsFirst: false }).limit(20);
    if (error) return `error: ${error.message}`;
    return compact(JSON.stringify({ missions: data ?? [] }));
  }

  if (name === "get_my_redemptions") {
    const { data, error } = await client.from("redemptions")
      .select("code,points_spent,status,created_at,redemption_gifts(name)")
      .order("created_at", { ascending: false }).limit(20);
    if (error) return `error: ${error.message}`;
    return compact(JSON.stringify({ redemptions: data ?? [] }));
  }

  if (name === "get_my_notifications") {
    const { data, error } = await client.from("notifications")
      .select("type,data,read_at,created_at")
      .order("created_at", { ascending: false }).limit(20);
    if (error) return `error: ${error.message}`;
    return compact(JSON.stringify({ notifications: data ?? [] }));
  }

  return `unknown tool: ${name}`;
}
