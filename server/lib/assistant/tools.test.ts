import { describe, it, expect, vi } from "vitest";
import { TOOL_DEFS, runTool } from "./tools.js";

function clientReturning(table: string, rows: unknown) {
  return {
    from: vi.fn((t: string) => {
      expect(t).toBe(table);
      const chain: any = {
        select: () => chain, eq: () => chain, order: () => chain,
        then: (res: any) => Promise.resolve({ data: rows, error: null }).then(res),
      };
      return chain;
    }),
  } as any;
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

  it("returns an error string for an unknown tool", async () => {
    const out = await runTool("definitely_not_a_tool", "{}", {} as any);
    expect(out.toLowerCase()).toContain("unknown tool");
  });
});
