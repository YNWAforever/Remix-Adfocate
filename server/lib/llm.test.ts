import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { enhanceRationales, type RationaleItem } from "./llm";

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

  it("returns null on an empty item list", async () => {
    expect(await enhanceRationales([])).toBeNull();
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
