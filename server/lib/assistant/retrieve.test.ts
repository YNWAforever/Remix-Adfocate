import { describe, it, expect, vi } from "vitest";
import { retrieveContext } from "./retrieve.js";

describe("retrieveContext", () => {
  it("embeds the query and maps RPC rows above the threshold", async () => {
    const embed = vi.fn(async () => [[0.1, 0.2]]);
    const rpc = vi.fn(async () => ({
      data: [
        { chunk_id: "c1", document_id: "d1", title: "積分", source_type: "article", source_ref: "points", content: "...", similarity: 0.82 },
        { chunk_id: "c2", document_id: "d2", title: "雜項", source_type: "article", source_ref: "x", content: "...", similarity: 0.10 },
      ],
      error: null,
    }));
    const client = { rpc } as unknown as Parameters<typeof retrieveContext>[0];
    const out = await retrieveContext(client, { query: "我有幾多分", locale: "zh-HK", workspace: "demo" }, { embed, minSimilarity: 0.2 });
    expect(embed).toHaveBeenCalledWith(["我有幾多分"]);
    expect(out.map((c) => c.title)).toEqual(["積分"]); // c2 dropped by threshold
    expect(rpc).toHaveBeenCalledWith("match_kb_chunks", expect.objectContaining({ filter_locale: "zh-HK" }));
  });

  it("returns [] when embedding throws (graceful degrade)", async () => {
    const embed = vi.fn(async () => { throw new Error("gateway down"); });
    const client = { rpc: vi.fn() } as unknown as Parameters<typeof retrieveContext>[0];
    const out = await retrieveContext(client, { query: "x", locale: "zh-HK", workspace: "demo" }, { embed });
    expect(out).toEqual([]);
  });
});
