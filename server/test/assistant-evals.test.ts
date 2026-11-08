// Deterministic evaluation harness for the studio assistant loop: stub provider, real loop,
// asserted tool choice/refusals/bounds. No network, no model, runs in CI.
import { describe, expect, it, vi } from "vitest";
import { runAssistant, type AssistantProvider } from "../lib/assistant/chat";
import { STUDIO_TOOL_DEFS } from "../lib/assistant/tools";

const studioContext = { title: "Eval", topic: "creation", sources: [] };
const client = {} as Parameters<typeof runAssistant>[0];

type Reply = { content: string | null; toolCalls: Array<{ id: string; name: string; arguments: string }> };

function provider(...replies: Reply[]): AssistantProvider {
  const chat = vi.fn();
  for (const reply of replies) chat.mockResolvedValueOnce(reply);
  chat.mockResolvedValue({ content: "fallback", toolCalls: [] });
  return { chat, embed: vi.fn() };
}

function run(deps: Parameters<typeof runAssistant>[2]) {
  return runAssistant(client, { query: "eval question", locale: "zh", workspace: "owned", history: [], studioContext }, deps);
}

const toolCall = (name: string, args = "{}") => ({ id: `call_${name}`, name, arguments: args });

describe("studio assistant eval harness", () => {
  it("answers a points question through the points tool only", async () => {
    const runToolFn = vi.fn().mockResolvedValue('{"points":120}');
    const result = await run({ provider: provider({ content: null, toolCalls: [toolCall("get_my_points")] }, { content: "你有 120 積分。", toolCalls: [] }), runToolFn });
    expect(result.toolsUsed).toEqual(["get_my_points"]);
    expect(result.answer).toContain("120");
    expect(runToolFn).toHaveBeenCalledWith("get_my_points", "{}", client, { workspaceId: "owned" });
  });

  it("uses the mission list tool for mission-status questions", async () => {
    const runToolFn = vi.fn().mockResolvedValue('{"missions":[{"status":"approved"}]}');
    const result = await run({ provider: provider({ content: null, toolCalls: [toolCall("get_my_missions", '{"status":"approved"}')] }, { content: "已批核 1 個任務。", toolCalls: [] }), runToolFn });
    expect(result.toolsUsed).toEqual(["get_my_missions"]);
  });

  it("refuses write-like tool names without executing anything", async () => {
    const runToolFn = vi.fn();
    const result = await run({ provider: provider({ content: null, toolCalls: [toolCall("award_points")] }), runToolFn });
    expect(result.limitations).toContain("tool_request_denied");
    expect(runToolFn).not.toHaveBeenCalled();
    expect(result.answer).not.toBe("fallback");
  });

  it("exposes additional MCP skills only as configured and records their use", async () => {
    const runStudioTool = vi.fn().mockResolvedValue("MCP-PAYLOAD");
    const mcpDefs = [{ type: "function" as const, function: { name: "mcp__eval__lookup", description: "Eval lookup", parameters: { type: "object", properties: {}, additionalProperties: false } } }];
    const chat = vi.fn()
      .mockResolvedValueOnce({ content: null, toolCalls: [toolCall("mcp__eval__lookup")] })
      .mockResolvedValueOnce({ content: "技能結果已整理。", toolCalls: [] });
    const result = await run({ provider: { chat, embed: vi.fn() }, runStudioTool, studioToolDefs: mcpDefs });
    expect(runStudioTool).toHaveBeenCalledTimes(1);
    expect(result.toolsUsed).toEqual(["mcp__eval__lookup"]);
    expect(chat.mock.calls[1][0].tools.map((tool: { function: { name: string } }) => tool.function.name)).toContain("mcp__eval__lookup");
  });

  it("keeps the configured tool set bounded and unchanged", () => {
    const names = STUDIO_TOOL_DEFS.map(tool => tool.function.name);
    expect(names).toHaveLength(10);
    expect(names).toContain("get_my_points_history");
    expect(names).toContain("get_my_recent_threads");
    expect(names.every(name => !/award|publish|delete|approve|refund|transfer/.test(name))).toBe(true);
  });

  it("stops a tool loop at the iteration bound with a truthful limitation", async () => {
    const chat = vi.fn().mockResolvedValue({ content: null, toolCalls: [toolCall("get_my_points")] });
    const runToolFn = vi.fn().mockResolvedValue('{"points":1}');
    const result = await run({ provider: { chat, embed: vi.fn() }, runToolFn, maxIterations: 2 });
    expect(result.limitations).toContain("tool_iteration_limit");
    expect(chat).toHaveBeenCalledTimes(3);
    expect(result.toolsUsed).toEqual(["get_my_points"]);
  });
});
