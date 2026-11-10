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
  it("streams content deltas and assembles tool calls", async () => {
    process.env.AI_GATEWAY_API_KEY = "test";
    const sse = [
      'data: {"choices":[{"delta":{"content":"H"}}]}',
      '',
      'data: {"choices":[{"delta":{"content":"i"}}]}',
      '',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"t1","function":{"name":"get_my_points","arguments":"{\\"a\\":1}"}}]}}]}',
      '',
      'data: [DONE]',
      '',
    ].join("\n");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } })));
    const deltas: string[] = [];
    const res = await chatComplete({ messages: [{ role: "user", content: "x" }], onDelta: (text) => { deltas.push(text); } });
    expect(deltas.join("")).toBe("Hi");
    expect(res.content).toBe("Hi");
    expect(res.toolCalls).toEqual([{ id: "t1", name: "get_my_points", arguments: '{"a":1}' }]);
  });

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
