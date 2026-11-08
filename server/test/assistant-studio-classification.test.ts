// @vitest-environment node
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../app.js";
import type { AssistantProvider } from "../lib/assistant/chat.js";

const clients = vi.hoisted(() => ({ user: null as unknown, store: null as unknown }));
vi.mock("../lib/supabase.js", () => ({ makeUserClient: () => clients.user, serviceClient: () => clients.store }));
import { assistantRoutes } from "../routes/assistant.js";

const creator = "11111111-1111-4111-8111-111111111111";
const workspace = "22222222-2222-4222-8222-222222222222";
const conversation = "33333333-3333-4333-8333-333333333333";
const requestId = "44444444-4444-4444-8444-444444444444";
const derivative = "synthetic OFFLINE PROVIDER-DERIVED HISTORY";
type Row = Record<string, unknown>;

function setup(options: { studio?: boolean; classificationError?: boolean; rejectSave?: boolean; sources?: Row[] } = {}) {
  const reads: { table: string; filters: Row }[] = [];
  const rows: Record<string, Row[]> = {
    studio_threads: options.studio ? [{ id: "thread", conversation_id: conversation, creator_id: creator, workspace_id: workspace, title: "Offline plan", topic: "creation", mission_id: null }] : [],
    studio_sources: options.sources ?? [],
    assistant_messages: [{ conversation_id: conversation, role: "assistant", content: options.studio ? derivative : "My manual planning history" }],
    assistant_requests: [],
  };
  const from = (table: string) => {
    if (!(table in rows)) throw new Error(`Unexpected table ${table}`);
    const read = { table, filters: {} as Row }; reads.push(read);
    let single = false;
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { read.filters[key] = value; return query; },
      order: () => query,
      limit: () => query,
      maybeSingle: () => { single = true; return query; },
      then: (resolve: (value: unknown) => unknown) => {
        const matches = rows[table].filter(row => Object.entries(read.filters).every(([key, value]) => row[key] === value));
        return Promise.resolve({ data: single ? matches[0] ?? null : matches, error: table === "studio_threads" && options.classificationError ? { message: "offline classification failure" } : null }).then(resolve);
      },
    };
    return query;
  };
  const rpc = vi.fn(async (name: string, input: Row) => {
    if (name === "reserve_assistant_request") return { data: { action: "reserved" }, error: null };
    if (name === "claim_assistant_request") return { data: true, error: null };
    if (name === "save_assistant_turn") return options.rejectSave
      ? { data: null, error: { code: "P0001", message: "SOURCE_UNAVAILABLE" } }
      : { data: { answer: input.p_answer, citations: input.p_citations, persistence: "saved", conversation_id: conversation, request_id: requestId }, error: null };
    if (name === "mark_assistant_request_unknown") return { data: null, error: null };
    throw new Error(`Unexpected RPC ${name}`);
  });
  clients.store = { from, rpc };
  clients.user = { from, rpc: async () => ({ data: [], error: null }) };
  const chat = vi.fn<AssistantProvider["chat"]>(async () => ({ content: "Offline proposal", toolCalls: [] }));
  const embed = vi.fn<AssistantProvider["embed"]>(async () => [[0]]);
  const app = new Hono<Env>().use("*", async (c, next) => {
    c.set("jwt", "synthetic"); c.set("userId", creator); c.set("workspaceId", workspace); await next();
  }).route("/assistant", assistantRoutes({ chat, embed }));
  const send = (existing = true) => app.request("/assistant/chat", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "Continue the plan", locale: "en", client_request_id: requestId, ...(existing ? { conversation_id: conversation } : {}), allowExternalAI: true, studioContext: { sources: [] } }),
  });
  return { send, chat, embed, reads, rpc };
}

afterEach(() => vi.unstubAllEnvs());

describe("Studio conversation classification before assistant egress", () => {
  it.each([undefined, "false"])("blocks retained Studio history before the injected model when STUDIO_THREADS=%s, even if SQL would reject saving", async flag => {
    vi.stubEnv("STUDIO_THREADS", flag);
    const { send, chat, embed, reads, rpc } = setup({ studio: true, rejectSave: true });
    const response = await send();
    // The real runAssistant must never receive this history through general chat.
    expect(JSON.stringify(chat.mock.calls)).not.toContain(derivative);
    expect(chat).not.toHaveBeenCalled();
    expect(embed).not.toHaveBeenCalled();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "studio_disabled", persistence: "not_saved", generation: "not_started" });
    expect(reads).toEqual([{ table: "studio_threads", filters: { conversation_id: conversation, creator_id: creator, workspace_id: workspace } }]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("fails closed when Studio classification is unavailable", async () => {
    vi.stubEnv("STUDIO_THREADS", "false");
    const { send, chat, embed, reads, rpc } = setup({ classificationError: true });
    const response = await send();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "studio_unavailable" });
    expect(chat).not.toHaveBeenCalled(); expect(embed).not.toHaveBeenCalled();
    expect(reads.some(read => read.table === "assistant_messages")).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([undefined, "false", "true"])("preserves an ordinary manual conversation when STUDIO_THREADS=%s", async flag => {
    vi.stubEnv("STUDIO_THREADS", flag);
    const { send, chat, embed } = setup();
    const response = await send();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ answer: "Offline proposal", persistence: "saved" });
    expect(chat).toHaveBeenCalledOnce(); expect(embed).toHaveBeenCalledOnce();
    expect(JSON.stringify(chat.mock.calls[0])).toContain("My manual planning history");
  });

  it("preserves new manual chat without querying Studio", async () => {
    vi.stubEnv("STUDIO_THREADS", "false");
    const { send, chat, reads } = setup();
    expect((await send(false)).status).toBe(200);
    expect(chat).toHaveBeenCalledOnce(); expect(reads).toEqual([]);
  });

  it("keeps enabled manual Studio sources on the existing scoped assistant path", async () => {
    vi.stubEnv("STUDIO_THREADS", "true");
    const { send, chat, embed, reads } = setup({ studio: true, sources: [{ id: "manual-source", thread_id: "thread", creator_id: creator, workspace_id: workspace, title: "My note", content: "My own source text", status: "unverified", revoked_at: null }] });
    const response = await send();
    expect(response.status).toBe(200);
    expect(chat).toHaveBeenCalledOnce(); expect(embed).not.toHaveBeenCalled();
    expect(chat.mock.calls[0][0].tools?.map((tool: { function: { name: string } }) => tool.function.name)).toEqual(["get_my_points","get_my_missions","get_my_mission_requirements","get_my_earnings","get_open_missions","get_my_redemptions","get_my_notifications","get_my_points_history","get_my_earnings_history","get_my_recent_threads"]);
    expect(JSON.stringify(chat.mock.calls[0])).toContain("My own source text");
    expect(JSON.stringify(chat.mock.calls[0])).not.toContain(derivative);
    expect(reads.some(read => read.table === "assistant_messages")).toBe(false);
  });
});
