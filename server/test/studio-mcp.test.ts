// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { runAssistant, type AssistantProvider } from "../lib/assistant/chat";
import { buildMcpToolDefs, type McpServerConfig } from "../lib/mcp/policy";

const server: McpServerConfig = {
  name: "fixture",
  url: "http://127.0.0.1:1/mcp",
  timeoutMs: 1000,
  headers: {},
  tools: [{ name: "lookup_note", description: "Read one note", inputSchema: { type: "object", properties: { id: { type: "string" } } } }],
};
const studioContext = { title: "Test", topic: "creation", sources: [] };

describe("studio loop with MCP skills", () => {
  it("runs an allowlisted MCP skill and records it", async () => {
    const runStudioTool = vi.fn().mockResolvedValue("NOTE-42");
    const chat = vi.fn()
      .mockResolvedValueOnce({ content: null, toolCalls: [{ id: "t1", name: "mcp__fixture__lookup_note", arguments: '{"id":"42"}' }] })
      .mockResolvedValueOnce({ content: "Note 42 says hi.", toolCalls: [] });
    const provider: AssistantProvider = { chat, embed: vi.fn() };
    const result = await runAssistant({} as Parameters<typeof runAssistant>[0], { query: "Read note 42", locale: "zh", workspace: "owned", history: [], studioContext }, {
      provider,
      studioToolDefs: buildMcpToolDefs([server]),
      runStudioTool,
    });
    expect(runStudioTool).toHaveBeenCalledWith("mcp__fixture__lookup_note", '{"id":"42"}', undefined);
    expect(result.answer).toContain("Note 42");
    expect(result.toolsUsed).toEqual(["mcp__fixture__lookup_note"]);
    const toolMessage = chat.mock.calls[1][0].messages.find((message: { role: string }) => message.role === "tool");
    expect(toolMessage.content).toBe("NOTE-42");
    expect(chat.mock.calls[1][0].tools.map((definition: { function: { name: string } }) => definition.function.name)).toContain("mcp__fixture__lookup_note");
    const system = chat.mock.calls[0][0].messages.find((message: { role: string }) => message.role === "system");
    expect(system.content).toContain("Extra skills may be available");
  });

  it("refuses MCP names outside the allowlist without executing them", async () => {
    const runStudioTool = vi.fn();
    const provider: AssistantProvider = {
      chat: vi.fn().mockResolvedValue({ content: "done", toolCalls: [{ id: "t1", name: "mcp__fixture__delete_everything", arguments: "{}" }] }),
      embed: vi.fn(),
    };
    const result = await runAssistant({} as Parameters<typeof runAssistant>[0], { query: "delete", locale: "zh", workspace: "owned", history: [], studioContext }, {
      provider,
      studioToolDefs: buildMcpToolDefs([server]),
      runStudioTool,
    });
    expect(result.limitations).toContain("tool_request_denied");
    expect(result.answer).not.toBe("done");
    expect(runStudioTool).not.toHaveBeenCalled();
  });

  it("keeps built-in tools working when MCP skills are present", async () => {
    const runToolFn = vi.fn().mockResolvedValue('{"points":120}');
    const runStudioTool = vi.fn();
    const provider: AssistantProvider = {
      chat: vi.fn()
        .mockResolvedValueOnce({ content: null, toolCalls: [{ id: "t1", name: "get_my_points", arguments: "{}" }] })
        .mockResolvedValueOnce({ content: "You have 120 points.", toolCalls: [] }),
      embed: vi.fn(),
    };
    const result = await runAssistant({} as Parameters<typeof runAssistant>[0], { query: "points?", locale: "en", workspace: "owned", history: [], studioContext }, {
      provider,
      runToolFn,
      studioToolDefs: buildMcpToolDefs([server]),
      runStudioTool,
    });
    expect(runToolFn).toHaveBeenCalled();
    expect(runStudioTool).not.toHaveBeenCalled();
    expect(result.toolsUsed).toEqual(["get_my_points"]);
  });
});
