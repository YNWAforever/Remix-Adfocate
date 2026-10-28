import { afterEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ context: null as null | { origins: string[] } }));
vi.mock("../../scripts/audit/local-targets.mjs", () => ({ b2ExecutionContext: () => state.context }));
const original = globalThis.fetch;
afterEach(() => { globalThis.fetch = original; vi.resetModules(); state.context = null; });
describe("B2 process origin binding", () => {
  it("permits only selected web/API origins and rejects old targets, DB ports and public URLs before delegate", async () => {
    state.context = { origins: ["http://127.0.0.1:56800", "http://127.0.0.1:56821"] };
    const delegate = vi.fn(async () => new Response("unit")); globalThis.fetch = delegate;
    // @ts-expect-error Native audit process preload.
    await import("../../scripts/audit/deny-external-fetch.mjs");
    for (const origin of state.context.origins) expect((await fetch(origin + "/health")).status).toBe(200);
    for (const origin of ["http://127.0.0.1:56421", "http://127.0.0.1:56521", "http://127.0.0.1:56822", "https://127.0.0.1:56821", "https://example.test", "http://localhost:56821"]) await expect(fetch(origin)).rejects.toThrow(/disabled|origin/i);
    expect(delegate).toHaveBeenCalledTimes(2);
  });
});
