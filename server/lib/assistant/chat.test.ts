import { describe, it, expect, vi } from "vitest";
import { runAssistant, type AssistantProvider } from "./chat.js";

describe("runAssistant", () => {
  it("runs one tool round then returns the final answer + citations", async () => {
    const rpcRows = [{ chunk_id: "c1", document_id: "d1", title: "積分規則", source_type: "article", source_ref: "points", content: "完成任務獲分。", similarity: 0.9 }];
    const client = { rpc: vi.fn(async () => ({ data: rpcRows, error: null })), from: vi.fn() } as any;

    const provider: AssistantProvider = {
      embed: vi.fn(async () => [[0.1]]),
      chat: vi.fn()
        .mockResolvedValueOnce({ content: null, toolCalls: [{ id: "t1", name: "get_my_points", arguments: "{}" }] })
        .mockResolvedValueOnce({ content: "你有 1250 分。", toolCalls: [] }),
    };
    const runToolFn = vi.fn(async () => JSON.stringify({ points: 1250 }));

    const res = await runAssistant(client, { query: "我有幾多分", locale: "zh-HK", workspace: "demo", history: [] },
      { provider, runToolFn });

    expect(provider.chat).toHaveBeenCalledTimes(2);
    expect(runToolFn).toHaveBeenCalledWith("get_my_points", "{}", client);
    expect(res.answer).toContain("1250");
    expect(res.citations).toEqual([{ title: "積分規則", sourceType: "article", sourceRef: "points" }]);
  });

  it("stops at the iteration cap and returns whatever content exists", async () => {
    const client = { rpc: vi.fn(async () => ({ data: [], error: null })), from: vi.fn() } as any;
    const provider: AssistantProvider = {
      embed: vi.fn(async () => [[0.1]]),
      chat: vi.fn(async () => ({ content: "兜緊圈", toolCalls: [{ id: "t", name: "get_my_points", arguments: "{}" }] })),
    };
    const res = await runAssistant(client, { query: "x", locale: "zh-HK", workspace: "demo", history: [] },
      { provider, runToolFn: vi.fn(async () => "{}"), maxIterations: 2 });
    expect((provider.chat as any).mock.calls.length).toBeLessThanOrEqual(3);
    expect(res.answer).toBe("兜緊圈");
  });
});
