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
  {
    type: "function",
    function: {
      name: "get_my_points_history",
      description: "List the creator's recent point ledger entries (type, delta, balance, description).",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "get_my_earnings_history",
      description: "List the creator's recent cash earnings ledger entries (type, amount, balance, description).",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "get_my_recent_threads",
      description: "List the creator's recent studio discussion threads with title and topic.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "get_my_saved_briefs",
      description: "List the creator's saved private briefs with thread title, version, section count and saved time. Never includes brief text.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "get_my_review_history",
      description: "List the creator's reviewed mission submissions with status, review time, quality rating, points and up to 500 characters of reviewer feedback.",
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
      .select("status, points_awarded, submitted_at, missions(slug, title, mission_type, deadline)");
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

  if (name === "get_my_points_history") {
    const { data, error } = await client.from("point_transactions")
      .select("type,delta,balance_after,description,created_at")
      .order("created_at", { ascending: false }).limit(20);
    if (error) return `error: ${error.message}`;
    return compact(JSON.stringify({ transactions: data ?? [] }));
  }

  if (name === "get_my_earnings_history") {
    const { data, error } = await client.from("earnings_transactions")
      .select("type,amount,balance_after,description,created_at")
      .order("created_at", { ascending: false }).limit(20);
    if (error) return `error: ${error.message}`;
    return compact(JSON.stringify({ transactions: data ?? [] }));
  }

  if (name === "get_my_saved_briefs") {
    const briefs = await client.from("studio_briefs")
      .select("thread_id,version,sections,created_at")
      .order("created_at", { ascending: false }).limit(20);
    if (briefs.error) return `error: ${briefs.error.message}`;
    const rows = (briefs.data ?? []) as Array<{ thread_id?: unknown; version?: unknown; sections?: unknown; created_at?: unknown }>;
    const threadIds = [...new Set(rows.map(row => row.thread_id).filter((id): id is string => typeof id === "string"))];
    const threads = threadIds.length
      ? await client.from("studio_threads").select("id,title").in("id", threadIds)
      : { data: [], error: null };
    if (threads.error) return `error: ${threads.error.message}`;
    const titles = new Map((threads.data ?? []).map(thread => [String((thread as { id?: unknown }).id), String((thread as { title?: unknown }).title ?? "")]));
    const briefsOut = rows.map(row => ({
      thread_title: typeof row.thread_id === "string" ? titles.get(row.thread_id) ?? null : null,
      version: typeof row.version === "number" ? row.version : null,
      section_count: Array.isArray(row.sections) ? row.sections.length : 0,
      created_at: typeof row.created_at === "string" ? row.created_at : null,
    }));
    return compact(JSON.stringify({ briefs: briefsOut }));
  }

  if (name === "get_my_review_history") {
    const { data, error } = await client.from("mission_submissions")
      .select("status, submitted_at, reviewed_at, quality_rating, points_awarded, reviewer_notes, missions(slug, title)")
      .order("reviewed_at", { ascending: false, nullsFirst: false }).limit(20);
    if (error) return "error: " + error.message;
    const rows = (data ?? []) as Array<{ status?: unknown; submitted_at?: unknown; reviewed_at?: unknown; quality_rating?: unknown; points_awarded?: unknown; reviewer_notes?: unknown; missions?: unknown }>;
    const reviews = rows.filter(row => typeof row.reviewed_at === "string").slice(0, 10).map(row => {
      const mission = (Array.isArray(row.missions) ? row.missions[0] : row.missions) as { slug?: unknown; title?: unknown } | null;
      return {
        status: typeof row.status === "string" ? row.status : null,
        mission_title: typeof mission?.title === "string" ? mission.title : null,
        mission_slug: typeof mission?.slug === "string" ? mission.slug : null,
        submitted_at: typeof row.submitted_at === "string" ? row.submitted_at : null,
        reviewed_at: row.reviewed_at,
        quality_rating: typeof row.quality_rating === "number" ? row.quality_rating : null,
        points_awarded: typeof row.points_awarded === "number" ? row.points_awarded : null,
        feedback: typeof row.reviewer_notes === "string" && row.reviewer_notes.trim() ? row.reviewer_notes.trim().slice(0, 500) : null,
      };
    });
    return compact(JSON.stringify({ reviews }));
  }

  if (name === "get_my_recent_threads") {
    const { data, error } = await client.from("studio_threads")
      .select("title,topic,created_at")
      .order("created_at", { ascending: false }).limit(10);
    if (error) return `error: ${error.message}`;
    return compact(JSON.stringify({ threads: data ?? [] }));
  }

  return `unknown tool: ${name}`;
}

/** A3.2 proposal tool: records a brief proposal for explicit creator confirmation; it never writes. */
export const PROPOSAL_TOOL_DEFS: ToolDef[] = [{
  type: "function",
  function: {
    name: "propose_brief",
    description: "Propose a private studio brief with 1-6 short paragraphs. This only records a proposal for the creator to confirm; it does not save, publish or change any data.",
    parameters: {
      type: "object",
      properties: {
        sections: { type: "array", items: { type: "string", maxLength: 3000 }, minItems: 1, maxItems: 6 },
      },
      required: ["sections"],
      additionalProperties: false,
    },
  },
}];
