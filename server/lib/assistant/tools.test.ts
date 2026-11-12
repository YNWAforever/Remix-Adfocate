import { describe, it, expect, vi } from "vitest";
import { TOOL_DEFS, runTool } from "./tools.js";

interface ChainMock {
  select: () => ChainMock;
  eq: () => ChainMock;
  order: () => ChainMock;
  limit: () => ChainMock;
  then: (res: (value: { data: unknown; error: null }) => unknown) => Promise<unknown>;
}

function clientReturning(table: string, rows: unknown) {
  return {
    from: vi.fn((t: string) => {
      expect(t).toBe(table);
      const chain: ChainMock = {
        select: () => chain, eq: () => chain, order: () => chain, limit: () => chain,
        then: (res) => Promise.resolve({ data: rows, error: null }).then(res),
      };
      return chain;
    }),
  } as unknown as Parameters<typeof runTool>[2];
}

describe("assistant tools", () => {
  it("exposes get_my_points and get_my_missions definitions", () => {
    const names = TOOL_DEFS.map((t) => t.function.name);
    expect(names).toContain("get_my_points");
    expect(names).toContain("get_my_missions");
  });

  it("get_my_points reads point_balances", async () => {
    const client = clientReturning("point_balances", [{ balance: 1250, available_to: null }]);
    const out = await runTool("get_my_points", "{}", client);
    expect(out).toContain("1250");
  });

  it("get_my_saved_briefs lists titles and section counts without brief text", async () => {
    const tables: Record<string, unknown> = {
      studio_briefs: [{ thread_id: "t1", version: 2, sections: [{ text: "secret body" }], created_at: "2026-11-11T00:00:00Z" }],
      studio_threads: [{ id: "t1", title: "Skincare brief" }],
    };
    const from = vi.fn((table: string) => {
      const chain: Record<string, unknown> = {
        select: () => chain, eq: () => chain, in: () => chain, order: () => chain, limit: () => chain,
        then: (res: (value: { data: unknown; error: null }) => unknown) => Promise.resolve({ data: tables[table], error: null }).then(res),
      };
      return chain;
    });
    const out = await runTool("get_my_saved_briefs", "{}", { from } as unknown as Parameters<typeof runTool>[2]);
    expect(out).toContain("Skincare brief");
    expect(out).toContain('"section_count":1');
    expect(out).not.toContain("secret body");
  });

  it("get_my_review_history includes reviewed feedback and skips unreviewed rows", async () => {
    const client = clientReturning("mission_submissions", [
      { status: "rejected", reviewed_at: "2026-11-01T00:00:00Z", quality_rating: 3, points_awarded: 0,
        reviewer_notes: "x".repeat(700), missions: { slug: "tea", title: "Tea mission" } },
      { status: "submitted", reviewed_at: null, reviewer_notes: "pending note", missions: { slug: "tea", title: "Tea mission" } },
    ]);
    const out = await runTool("get_my_review_history", "{}", client);
    const body = JSON.parse(out) as { reviews: Array<{ mission_title: string; feedback: string }> };
    expect(body.reviews).toHaveLength(1);
    expect(body.reviews[0].mission_title).toBe("Tea mission");
    expect(body.reviews[0].feedback).toHaveLength(500);
    expect(out).not.toContain("pending note");
  });

  it("get_my_wallet_ledger merges point and cash entries newest first", async () => {
    const tables: Record<string, unknown> = {
      point_transactions: [{ type: "mission_reward", delta: 50, balance_after: 150, description: "Mission", created_at: "2026-11-10T00:00:00Z" }],
      earnings_transactions: [{ type: "payout", amount: 10, balance_after: 20, description: "Payout", created_at: "2026-11-11T00:00:00Z" }],
    };
    const from = vi.fn((table: string) => {
      const chain: Record<string, unknown> = {
        select: () => chain, order: () => chain, limit: () => chain,
        then: (res: (value: { data: unknown; error: null }) => unknown) => Promise.resolve({ data: tables[table], error: null }).then(res),
      };
      return chain;
    });
    const body = JSON.parse(await runTool("get_my_wallet_ledger", "{}", { from } as unknown as Parameters<typeof runTool>[2])) as { entries: Array<{ kind: string }> };
    expect(body.entries.map(entry => entry.kind)).toEqual(["cash", "points"]);
  });

  it("returns an error string for an unknown tool", async () => {
    const out = await runTool("definitely_not_a_tool", "{}", {} as unknown as Parameters<typeof runTool>[2]);
    expect(out.toLowerCase()).toContain("unknown tool");
  });
});
