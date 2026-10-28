import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { Env } from "../app";
const h = vi.hoisted(() => ({ generate: vi.fn(), client: null as unknown, saved: null as unknown, saveFailure: false, quota: false }));
vi.mock("../lib/supabase.js", () => ({ makeUserClient: () => h.client, serviceClient: () => h.client }));
vi.mock("../lib/assistant/chat.js", () => ({ runAssistant: h.generate }));
import { assistantRoutes } from "../routes/assistant";
const requestId = "00000000-0000-4000-8000-000000000001";
const conversationId = "00000000-0000-4000-8000-000000000002";
function fakeClient() {
  const client = { rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === "reserve_assistant_request") return h.quota ? { data: null, error: { message: "RATE_LIMITED" } } : { data: h.saved ? { action: "replay", result: h.saved } : { action: "reserved", request_id: requestId }, error: null };
    if (name === "claim_assistant_request") return { data: true, error: null };
    if (name === "save_assistant_turn") {
      if (h.saveFailure) return { data: null, error: { code: "23514", message: "injected persistence fault" } };
      h.saved = { request_id: requestId, conversation_id: conversationId, answer: args.p_answer, citations: args.p_citations, persistence: "saved" };
      return { data: h.saved, error: null };
    }
    return { data: null, error: null };
  }), from(table: string) {
    let insert = false;
    const q = { select() { return q; }, eq() { return q; }, order() { return q; }, limit() { return q; }, update() { return q; },
      insert() { insert = true; return q; }, single: async () => ({ data: { id: conversationId }, error: null }),
      maybeSingle: async () => ({ data: { id: conversationId }, error: null }),
      then(resolve: (value: unknown) => unknown) { return Promise.resolve({ data: [], error: insert && table === "assistant_messages" && h.saveFailure ? { message: "injected persistence fault" } : null }).then(resolve); },
    }; return q;
  } }; return client;
}
const app = new Hono<Env>();
app.use("*", async (c, next) => { c.set("jwt", "synthetic"); c.set("userId", "creator"); c.set("workspaceId", "workspace"); await next(); });
app.route("/assistant", assistantRoutes());
const send = (message = "Synthetic request") => app.request("/assistant/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message, client_request_id: requestId }) });
describe("assistant durable response boundary (offline transport)", () => {
  beforeEach(() => { vi.clearAllMocks(); h.saved = null; h.saveFailure = false; h.quota = false; h.generate.mockResolvedValue({ answer: "Synthetic answer", citations: [] }); h.client = fakeClient(); });
  it("does not call a generated answer saved when the turn transaction fails", async () => {
    h.saveFailure = true;
    const body = await (await send()).json();
    expect(body.persistence).toBe("failed"); expect(body.answer).toBe("Synthetic answer");
  });
  it("replays the same request without a second generation", async () => {
    const first = await (await send()).json(); const second = await (await send()).json();
    expect(first).toMatchObject({ persistence: "saved", request_id: requestId }); expect(second).toEqual(first);
    expect(h.generate).toHaveBeenCalledTimes(1);
  });
  it("rejects 4001 Unicode code points before starting a generation", async () => {
    expect((await send("😀".repeat(4001))).status).toBe(400); expect(h.generate).not.toHaveBeenCalled();
  });
  it("honors a shared-store quota rejection before generation", async () => {
    h.quota = true; expect((await send()).status).toBe(429); expect(h.generate).not.toHaveBeenCalled();
  });
});
