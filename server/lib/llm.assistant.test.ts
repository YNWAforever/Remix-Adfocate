import { describe, it, expect, vi, afterEach } from "vitest";
import { embedTexts, chatComplete } from "./llm.js";

afterEach(() => vi.restoreAllMocks());

function mockFetchOnce(body: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })));
}

describe("embedTexts", () => {
  it("returns one vector per input", async () => {
    process.env.AI_GATEWAY_API_KEY = "test";
    mockFetchOnce({ data: [{ embedding: [0.1, 0.2] }, { embedding: [0.3, 0.4] }] });
    const out = await embedTexts(["a", "b"]);
    expect(out).toEqual([[0.1, 0.2], [0.3, 0.4]]);
  });
});

describe("chatComplete", () => {
  it("returns content and tool calls from the gateway", async () => {
    process.env.AI_GATEWAY_API_KEY = "test";
    mockFetchOnce({
      choices: [{ message: {
        content: "hi",
        tool_calls: [{ id: "t1", function: { name: "get_my_points", arguments: "{}" } }],
      } }],
    });
    const res = await chatComplete({ messages: [{ role: "user", content: "x" }] });
    expect(res.content).toBe("hi");
    expect(res.toolCalls[0]).toEqual({ id: "t1", name: "get_my_points", arguments: "{}" });
  });
});
