import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { enhanceRationales, enhanceHooks, type RationaleItem } from "./llm";
import type { Hook } from "./hookGen";

const items: RationaleItem[] = [{ id: "m1", title: "美妝任務", category: "美妝", rationale: "啱你嘅美妝範疇", locked: false }];

function mockFetch(impl: () => Promise<Response> | Response) {
  vi.stubGlobal("fetch", vi.fn(impl));
}
function jsonResponse(content: string, ok = true) {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: ok ? 200 : 500 });
}

beforeEach(() => { process.env.AI_GATEWAY_API_KEY = "test-key"; });
afterEach(() => { vi.unstubAllGlobals(); delete process.env.AI_GATEWAY_API_KEY; });

describe("enhanceRationales", () => {
  it("returns null and never calls fetch when no key is set", async () => {
    delete process.env.AI_GATEWAY_API_KEY;
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect(await enhanceRationales(items)).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it("returns null on an empty item list without calling fetch", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect(await enhanceRationales([])).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it("parses a JSON map from the model content", async () => {
    mockFetch(() => jsonResponse(JSON.stringify({ m1: "啱你！美妝之選" })));
    expect(await enhanceRationales(items)).toEqual({ m1: "啱你！美妝之選" });
  });

  it("tolerates a ```json fenced response", async () => {
    mockFetch(() => jsonResponse("```json\n{\"m1\":\"快手賺分\"}\n```"));
    expect(await enhanceRationales(items)).toEqual({ m1: "快手賺分" });
  });

  it("returns null on a non-2xx response", async () => {
    mockFetch(() => jsonResponse("{}", false));
    expect(await enhanceRationales(items)).toBeNull();
  });

  it("returns null on malformed content", async () => {
    mockFetch(() => jsonResponse("not json at all"));
    expect(await enhanceRationales(items)).toBeNull();
  });

  it("returns null (never throws) when fetch rejects", async () => {
    mockFetch(() => Promise.reject(new Error("aborted")));
    await expect(enhanceRationales(items)).resolves.toBeNull();
  });
});

const hookItems: Hook[] = [
  { angle: "問題式", text: "a" }, { angle: "好奇式", text: "b" }, { angle: "優惠式", text: "c" },
  { angle: "體驗式", text: "d" }, { angle: "對比式", text: "e" },
];
const hookInput = { hooks: hookItems, platform: "instagram" as const, title: "T", category: "美容", description: null };
const hooksJson = (texts: string[]) => JSON.stringify(hookItems.map((h, i) => ({ angle: h.angle, text: texts[i] })));

describe("enhanceHooks", () => {
  it("returns null and never calls fetch when no key is set", async () => {
    delete process.env.AI_GATEWAY_API_KEY;
    const f = vi.fn(); vi.stubGlobal("fetch", f);
    expect(await enhanceHooks(hookInput)).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it("returns null on empty hooks without calling fetch", async () => {
    const f = vi.fn(); vi.stubGlobal("fetch", f);
    expect(await enhanceHooks({ ...hookInput, hooks: [] })).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it("parses a valid 5-item array (same angles) into rewritten hooks", async () => {
    mockFetch(() => jsonResponse(hooksJson(["A", "B", "C", "D", "E"])));
    const out = await enhanceHooks(hookInput);
    expect(out).toEqual([
      { angle: "問題式", text: "A" }, { angle: "好奇式", text: "B" }, { angle: "優惠式", text: "C" },
      { angle: "體驗式", text: "D" }, { angle: "對比式", text: "E" },
    ]);
  });

  it("tolerates a ```json fenced array", async () => {
    mockFetch(() => jsonResponse("```json\n" + hooksJson(["A", "B", "C", "D", "E"]) + "\n```"));
    expect((await enhanceHooks(hookInput))![0]).toEqual({ angle: "問題式", text: "A" });
  });

  it("returns null on a non-2xx response", async () => {
    mockFetch(() => jsonResponse(hooksJson(["A", "B", "C", "D", "E"]), false));
    expect(await enhanceHooks(hookInput)).toBeNull();
  });

  it("returns null on malformed content", async () => {
    mockFetch(() => jsonResponse("not json"));
    expect(await enhanceHooks(hookInput)).toBeNull();
  });

  it("returns null when the array length differs", async () => {
    mockFetch(() => jsonResponse(JSON.stringify([{ angle: "問題式", text: "A" }])));
    expect(await enhanceHooks(hookInput)).toBeNull();
  });

  it("returns null when an angle does not match", async () => {
    mockFetch(() => jsonResponse(hooksJson(["A", "B", "C", "D", "E"]).replace("好奇式", "亂噏式")));
    expect(await enhanceHooks(hookInput)).toBeNull();
  });

  it("returns null (never throws) when fetch rejects", async () => {
    mockFetch(() => Promise.reject(new Error("aborted")));
    await expect(enhanceHooks(hookInput)).resolves.toBeNull();
  });
});
