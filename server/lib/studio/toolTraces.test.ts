// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readRequestToolDetails, readToolTraces } from "./toolTraces";

type Row = Record<string, unknown>;

function store(tables: Record<string, Row[]>) {
  const from = (table: string) => {
    const filters: Array<[string, unknown]> = [];
    const apply = () => (tables[table] ?? []).filter(row => filters.every(([key, value]) => {
      if (Array.isArray(value)) return value.includes(row[key]);
      return row[key] === value;
    }));
    const q: Record<string, unknown> = {
      select() { return q; },
      eq(key: string, value: unknown) { filters.push([key, value]); return q; },
      order() { return q; },
      limit() { return q; },
      in(key: string, value: unknown[]) { filters.push([key, value]); return q; },
      then(resolve: (value: unknown) => unknown) {
        return Promise.resolve({ data: apply(), error: null }).then(resolve);
      },
    };
    return q;
  };
  return { from } as unknown as Parameters<typeof readToolTraces>[0];
}

const REQUEST = "11111111-1111-4111-8111-111111111111";

describe("readToolTraces", () => {
  it("annotates each tool with its MCP server and audit outcome", async () => {
    const traces = await readToolTraces(store({
      assistant_tool_traces: [{
        answer_hash: "hash-1",
        conversation_id: "conv-1",
        request_id: REQUEST,
        tools: ["mcp__hasdata__hasdata_tiktok_search_getTikTokSearch", "get_my_points"],
      }],
      mcp_call_audit: [
        { request_id: REQUEST, server_name: "hasdata", tool_name: "hasdata_tiktok_search_getTikTokSearch", outcome: "ok", duration_ms: 900 },
        { request_id: REQUEST, server_name: "workspace_missions", tool_name: "get_my_points", outcome: "mcp_tool_error", duration_ms: 12 },
      ],
    }), "conv-1");
    const trace = traces.get("hash-1");
    expect(trace?.tools).toEqual(["mcp__hasdata__hasdata_tiktok_search_getTikTokSearch", "get_my_points"]);
    expect(trace?.details[0]).toEqual({
      tool: "mcp__hasdata__hasdata_tiktok_search_getTikTokSearch",
      server: "hasdata",
      outcome: "ok",
      duration_ms: 900,
    });
    expect(trace?.details[1]).toEqual({ tool: "get_my_points", server: null, outcome: "mcp_tool_error", duration_ms: 12 });
  });

  it("labels the live reply's tools from its own request audit rows", async () => {
    const details = await readRequestToolDetails(store({
      mcp_call_audit: [{ request_id: REQUEST, server_name: "hasdata", tool_name: "tiktok_search", outcome: "mcp_timeout", duration_ms: 15000 }],
    }), REQUEST, ["mcp__hasdata__tiktok_search", "get_my_points"]);
    expect(details[0]).toEqual({ tool: "mcp__hasdata__tiktok_search", server: "hasdata", outcome: "mcp_timeout", duration_ms: 15000 });
    expect(details[1]).toEqual({ tool: "get_my_points", server: null, outcome: null, duration_ms: null });
  });

  it("keeps tool names when audit rows are missing", async () => {
    const traces = await readToolTraces(store({
      assistant_tool_traces: [{ answer_hash: "hash-2", conversation_id: "conv-2", request_id: null, tools: ["mcp__mysocial__search_tiktok"] }],
      mcp_call_audit: [],
    }), "conv-2");
    expect(traces.get("hash-2")?.details[0]).toEqual({
      tool: "mcp__mysocial__search_tiktok",
      server: "mysocial",
      outcome: null,
      duration_ms: null,
    });
  });
});
