// Deterministic provider-shaped evals: recorded HasData/MySocial payloads through the real
// assistant loop with a stub model. No network, no model, no provider credits.
import { describe, expect, it, vi } from "vitest";
import { runAssistant, type AssistantProvider } from "../lib/assistant/chat";

const client = {} as Parameters<typeof runAssistant>[0];
const studioContext = { title: "Provider eval", topic: "performance", sources: [] };
const defs = (name: string) => [{ type: "function" as const, function: { name, description: "eval skill", parameters: { type: "object", properties: {}, additionalProperties: false } } }];

type Reply = { content: string | null; toolCalls: Array<{ id: string; name: string; arguments: string }> };
function scripted(...replies: Reply[]): { provider: AssistantProvider; chat: ReturnType<typeof vi.fn> } {
  const chat = vi.fn();
  for (const reply of replies) chat.mockResolvedValueOnce(reply);
  chat.mockResolvedValue({ content: "fallback", toolCalls: [] });
  return { provider: { chat, embed: vi.fn() }, chat };
}
const call = (name: string, args = "{}") => ({ id: `call_${name}_${Math.random()}`, name, arguments: args });

function run(deps: Parameters<typeof runAssistant>[2]) {
  return runAssistant(client, { query: "eval provider question", locale: "zh", workspace: "owned", history: [], studioContext }, deps);
}

// Shaped like a HasData TikTok search result: public post URL, counts, caption.
const HASDATA_TIKTOK = JSON.stringify({
  searchResults: [{
    aweme_id: "7391234567890123456",
    desc: "skincare routine for humid weather #skincare",
    share_url: "https://www.tiktok.com/@eval.creator/video/7391234567890123456",
    statistics: { play_count: 182000, digg_count: 9400, comment_count: 310 },
    author: { unique_id: "eval.creator", nickname: "Eval Creator" },
  }],
});

describe("provider-shaped skill evals", () => {
  it("forwards a HasData post URL and counts as untrusted tool data", async () => {
    const runStudioTool = vi.fn().mockResolvedValue(HASDATA_TIKTOK);
    const { provider, chat } = scripted(
      { content: null, toolCalls: [call("mcp__hasdata__hasdata_tiktok_search_getTikTokSearch", '{"keyword":"skincare"}')] },
      { content: "找到 1 條公開影片，互動數為 9,400。", toolCalls: [] },
    );
    const result = await run({ provider, runStudioTool, studioToolDefs: defs("mcp__hasdata__hasdata_tiktok_search_getTikTokSearch") });
    expect(result.toolsUsed).toEqual(["mcp__hasdata__hasdata_tiktok_search_getTikTokSearch"]);
    const followUp = chat.mock.calls[1][0].messages as Array<{ role: string; content: string }>;
    const toolMessage = followUp.find(message => message.role === "tool");
    expect(toolMessage?.content).toContain("https://www.tiktok.com/@eval.creator/video/7391234567890123456");
    expect(toolMessage?.content).toContain("182000");
    expect(followUp.find(message => message.role === "system")?.content.toLowerCase()).toContain("untrusted");
  });

  it("treats a MySocial plan-limit error as unavailable data, not as zero results", async () => {
    const error = "error: MCP tool error: Creator Universe is not available for this connection";
    const runStudioTool = vi.fn().mockResolvedValue(error);
    const { provider, chat } = scripted(
      { content: null, toolCalls: [call("mcp__mysocial__search_tiktok", '{"query":"skincare"}')] },
      { content: "這個技能在此連線不可用；沒有可確認的數據。", toolCalls: [] },
    );
    await run({ provider, runStudioTool, studioToolDefs: defs("mcp__mysocial__search_tiktok") });
    const followUp = chat.mock.calls[1][0].messages as Array<{ role: string; content: string }>;
    expect(followUp.find(message => message.role === "tool")?.content).toBe(error);
    expect(followUp.find(message => message.role === "system")?.content).toContain("say the data is unavailable");
  });

  it("forwards a provider timeout to the model instead of retrying invisibly", async () => {
    const runStudioTool = vi.fn().mockResolvedValue("error: mcp_timeout");
    const { provider, chat } = scripted(
      { content: null, toolCalls: [call("mcp__hasdata__hasdata_tiktok_search_getTikTokSearch", '{"keyword":"skincare"}')] },
      { content: "供應商查詢逾時，暫時沒有可報告的數據。", toolCalls: [] },
    );
    await run({ provider, runStudioTool, studioToolDefs: defs("mcp__hasdata__hasdata_tiktok_search_getTikTokSearch") });
    const followUp = chat.mock.calls[1][0].messages as Array<{ role: string; content: string }>;
    expect(followUp.find(message => message.role === "tool")?.content).toBe("error: mcp_timeout");
  });
});
