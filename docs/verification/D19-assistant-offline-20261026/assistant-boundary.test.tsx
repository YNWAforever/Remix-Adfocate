// Explicit standalone JSDOM + Hono/API/hook evidence. Auth/session, database and
// provider are scripted mocks. This is not actual Auth/RLS/SQL/browser acceptance.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Hono } from "hono";
import type { Env } from "../../../server/app";
import type { AssistantProvider } from "../../../server/lib/assistant/chat";

const boundary = vi.hoisted(() => {
  const identity = Object.freeze({ transport: "in-process-Hono-and-JSDOM", database: "scripted-memory-fake", provider: "dependency-injected-mock", actualAuth: false, persistent: false, externalNetwork: false });
  if (identity.transport !== "in-process-Hono-and-JSDOM" || identity.persistent || identity.externalNetwork) throw new Error("Offline identity invalid before module/client setup");
  return { identity, fixture: null as null | { user: unknown; store: unknown; sessionReads: number; fakeClientFactories: number } };
});
vi.mock("../../../server/lib/supabase.js", () => ({
  makeUserClient: () => { if (!boundary.fixture) throw new Error("No verified offline fixture"); boundary.fixture.fakeClientFactories++; return boundary.fixture.user; },
  serviceClient: () => { if (!boundary.fixture) throw new Error("No verified offline fixture"); boundary.fixture.fakeClientFactories++; return boundary.fixture.store; },
}));
vi.mock("@/lib/supabase", () => ({ supabase: { auth: { getSession: async () => {
  if (!boundary.fixture) throw new Error("No verified offline fixture");
  boundary.fixture.sessionReads++;
  return { data: { session: { access_token: "offline-fixture-not-a-jwt" } } };
} } } }));

import { assistantRoutes } from "../../../server/routes/assistant";
import { liveProvider } from "../../../server/lib/assistant/chat";
import { AssistantLauncher } from "@/components/assistant/AssistantLauncher";
import { setWorkspaceSlug } from "@/lib/api";

const workspace = "00000000-0000-4000-8000-000000000701";
const creator = "00000000-0000-4000-8000-000000000702";
const conversation = "00000000-0000-4000-8000-000000000703";
const answer = "Synthetic offline answer with a source";
const question = "Synthetic first question";
type Reply = { request_id: string; conversation_id: string; persistence: "saved"; answer: string; citations: { title: string; sourceType: string; sourceRef: string }[] };
type Entry = { signature: string; state: string; message: string; result?: Reply };
type Message = { role: "user" | "assistant"; content: string; conversation_id: string };
type RequestTrace = { method: string; path: string; requestId?: string; status: number };
type HistoryTrace = { projection: string; filters: [string, unknown][]; order: [string, boolean][]; limit: number };
type ChatTrace = { roles: string[]; content: (string | null | undefined)[]; tools: string[] };
const observations: unknown[] = [];
let queryClient: QueryClient | undefined;
let fixture: ReturnType<typeof makeFixture>;
let trace: { requests: RequestTrace[]; rpc: string[]; history: HistoryTrace[]; chats: ChatTrace[]; embedCalls: number; deniedExternalFetch: number; realProviderCalls: number };

function makeFixture() {
  const state = { reserveFailure: "", historyFailure: false, providerFailure: false, lostSaveResponse: false, writeToolAttempt: false,
    entries: new Map<string, Entry>(), messages: [] as Message[], user: {} as unknown, store: {} as unknown, sessionReads: 0, fakeClientFactories: 0 };
  const ok = (data: unknown) => ({ data, error: null });
  const fail = (message: string, code = "P0001") => ({ data: null, error: { message, code } });
  const provider: AssistantProvider = {
    embed: async () => { trace.embedCalls++; return [[0.1, 0.2]]; },
    chat: async opts => {
      trace.chats.push({ roles: opts.messages.map(m => m.role), content: opts.messages.map(m => m.role === "system" ? "[system prompt omitted from public evidence]" : m.content), tools: (opts.tools ?? []).map(t => t.function.name) });
      if (state.providerFailure) throw new Error("Synthetic provider outcome unknown");
      if (state.writeToolAttempt && trace.chats.length === 1) return { content: null, toolCalls: [{ id: "offline-tool", name: "issue_reward_and_grant_admin", arguments: "{}" }] };
      return { content: answer, toolCalls: [] };
    },
  };
  state.store = { rpc: async (name: string, args: Record<string, unknown>) => {
    trace.rpc.push(name);
    expect(args.p_workspace).toBe(workspace); expect(args.p_creator).toBe(creator);
    const id = args.p_request as string, entry = state.entries.get(id);
    if (name === "reserve_assistant_request") {
      if (state.reserveFailure) return fail(state.reserveFailure);
      const signature = JSON.stringify([args.p_message, args.p_locale, args.p_conversation, args.p_context_version]);
      if (entry && entry.signature !== signature) return fail("IDEMPOTENCY_CONFLICT");
      if (entry) return ok(entry.state === "saved" ? { action: "replay", result: entry.result } : { action: "wait" });
      state.entries.set(id, { signature, state: "reserved", message: args.p_message as string }); return ok({ action: "reserved" });
    }
    expect(entry).toBeDefined();
    if (name === "claim_assistant_request") { const claimed = entry!.state === "reserved"; if (claimed) entry!.state = "claimed"; return ok(claimed); }
    if (name === "save_assistant_turn") {
      const result: Reply = { request_id: id, conversation_id: conversation, persistence: "saved", answer: args.p_answer as string, citations: args.p_citations as Reply["citations"] };
      entry!.state = "saved"; entry!.result = result;
      state.messages.push({ role: "user", content: entry!.message, conversation_id: conversation }, { role: "assistant", content: result.answer, conversation_id: conversation });
      if (state.lostSaveResponse) throw new Error("Synthetic saved response lost");
      return ok(result);
    }
    if (name === "mark_assistant_request_unknown") { if (entry!.state !== "saved") entry!.state = "unknown"; return ok(null); }
    throw new Error(`Unexpected RPC in scripted store: ${name}`);
  } };
  state.user = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      trace.rpc.push(name);
      if (name === "match_kb_chunks") return ok([{ chunk_id: "offline-chunk", document_id: "offline-document", title: "Offline source checklist", source_type: "policy", source_ref: "fixture:offline-source", content: "Only source requirements are available; reward and permission changes are unsupported.", similarity: 0.9 }]);
      if (name === "get_assistant_request") {
        expect(args.p_workspace).toBe(workspace);
        const entry = state.entries.get(args.p_request as string);
        return ok(!entry ? null : entry.state === "saved" ? entry.result : { request_id: args.p_request, persistence: "unknown", code: "request_pending" });
      }
      throw new Error(`Unexpected user RPC: ${name}`);
    },
    from: (table: string) => {
      expect(table).toBe("assistant_messages");
      const history: HistoryTrace = { projection: "", filters: [], order: [], limit: 0 };
      const q = {
        select: (projection: string) => { history.projection = projection; return q; },
        eq: (field: string, value: unknown) => { history.filters.push([field, value]); return q; },
        order: (field: string, options: { ascending: boolean }) => { history.order.push([field, options.ascending]); return q; },
        limit: async (limit: number) => {
          history.limit = limit; trace.history.push(history);
          if (state.historyFailure) return fail("Synthetic history read failure");
          const id = history.filters.find(([field]) => field === "conversation_id")?.[1];
          return ok(state.messages.filter(m => m.conversation_id === id).slice(-limit).reverse().map(({ role, content }) => ({ role, content })));
        },
      }; return q;
    },
  };
  return Object.assign(state, { provider });
}

function openPanel() {
  queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}><AssistantLauncher /></QueryClientProvider>);
  const launcher = screen.getByRole("button"); fireEvent.click(launcher);
  return launcher;
}
function send(text: string) {
  fireEvent.change(screen.getByRole("textbox"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: /傳送|送出|發送/ }));
}
const saved = () => screen.findByText("已保存 / Saved");
const retained = (text: string) => expect(screen.getByRole("textbox")).toHaveValue(text);

beforeEach(() => {
  expect(boundary.identity).toEqual({ transport: "in-process-Hono-and-JSDOM", database: "scripted-memory-fake", provider: "dependency-injected-mock", actualAuth: false, persistent: false, externalNetwork: false });
  trace = { requests: [], rpc: [], history: [], chats: [], embedCalls: 0, deniedExternalFetch: 0, realProviderCalls: 0 };
  queryClient = undefined;
  fixture = makeFixture(); boundary.fixture = fixture;
  vi.spyOn(liveProvider, "embed").mockImplementation(async () => { trace.realProviderCalls++; throw new Error("Real provider forbidden"); });
  vi.spyOn(liveProvider, "chat").mockImplementation(async () => { trace.realProviderCalls++; throw new Error("Real provider forbidden"); });
  const app = new Hono<Env>();
  app.use("*", async (c, next) => {
    expect(c.req.header("X-Workspace-Slug")).toBe("offline-single-workspace");
    expect(c.req.header("Authorization")).toBe("Bearer offline-fixture-not-a-jwt");
    c.set("workspaceId", workspace); c.set("userId", creator); c.set("jwt", "offline-fixture-not-a-jwt"); await next();
  });
  app.route("/api/assistant", assistantRoutes(fixture.provider));
  setWorkspaceSlug("offline-single-workspace");
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init: RequestInit = {}) => {
    if (typeof input !== "string" || !input.startsWith("/api/assistant/")) { trace.deniedExternalFetch++; throw new Error("Only in-process assistant request transport is permitted"); }
    const body = typeof init.body === "string" ? JSON.parse(init.body) as { client_request_id?: string } : undefined;
    const response = await app.request(input, init);
    trace.requests.push({ method: init.method ?? "GET", path: input, requestId: body?.client_request_id, status: response.status });
    return response;
  });
});
afterEach(() => {
  cleanup(); queryClient?.clear();
  observations.push({ test: expect.getState().currentTestName, trace, fakeSessionReads: fixture.sessionReads, fakeClientFactories: fixture.fakeClientFactories, scriptedEntries: fixture.entries.size, scriptedMessages: fixture.messages.length });
  expect(trace.deniedExternalFetch).toBe(0); expect(trace.realProviderCalls).toBe(0);
  vi.restoreAllMocks(); vi.unstubAllGlobals(); boundary.fixture = null;
});
afterAll(() => {
  writeFileSync(resolve("docs/verification/D19-assistant-offline-20261026/offline-readback.json"), JSON.stringify({ identity: boundary.identity, observations,
    actualTargetCalls: 0, actualSdkClients: 0, actualAuthSubjectsOrFixtures: 0, physicalSqlCalls: 0, actualProviderCalls: 0,
    scope: "Actual Launcher/Panel/Query hook/apiFetch/Hono route/RAG/tool dispatch with scripted memory Auth/storage and injected mock provider; not DB atomicity, real Auth/RLS, independent-instance quota, browser/device, paid provider quality or pending financial neutrality." }, null, 2) + "\n");
});

describe("offline assistant UI to API boundary with explicit scripted transports", () => {
  it("opens, traps keyboard focus, closes with Escape and reopens without a provider request", () => {
    const launcher = openPanel(); const input = screen.getByRole("textbox"); expect(input).toHaveFocus();
    const close = screen.getByRole("button", { name: /關閉|close/i }); close.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true }); expect(screen.getByRole("button", { name: /傳送|送出|發送/ })).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" }); expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(launcher).toHaveFocus();
    fireEvent.click(launcher); expect(screen.getByRole("textbox")).toHaveFocus(); expect(trace.requests).toEqual([]); expect(trace.chats).toEqual([]);
  });
  it("uses the saved conversation and chronological scoped history for a second question", async () => {
    openPanel(); send(question); await saved(); send("Synthetic second question"); await saved();
    expect(trace.history).toEqual([{ projection: "role, content", filters: [["conversation_id", conversation]], order: [["created_at", false], ["turn_order", false]], limit: 20 }]);
    expect(trace.chats[1].roles).toEqual(["system", "user", "assistant", "user"]);
    expect(trace.chats[1].content.slice(1)).toEqual([question, answer, "Synthetic second question"]);
    expect(fixture.entries.size).toBe(2); expect(fixture.messages).toHaveLength(4); retained("");
    expect(trace.requests.map(r => r.status)).toEqual([200, 200]);
  });
  it("retains a429 input and UUID, then generates once after an explicit successful retry", async () => {
    fixture.reserveFailure = "RATE_LIMITED"; openPanel(); send(question);
    await waitFor(() => expect(trace.requests[0]?.status).toBe(429)); retained(question); expect(trace.chats).toHaveLength(0);
    const id = trace.requests[0].requestId; fixture.reserveFailure = "";
    fireEvent.click(screen.getByRole("button", { name: /傳送|送出|發送/ })); await saved();
    expect(trace.requests.map(r => r.requestId)).toEqual([id, id]); expect(trace.chats).toHaveLength(1); expect(fixture.messages).toHaveLength(2);
    expect(screen.getAllByText(question, { exact: true })).toHaveLength(1);
  });
  it("shows history503, keeps the input and avoids regeneration on same-request pending retry", async () => {
    openPanel(); send(question); await saved(); fixture.historyFailure = true; send("Synthetic history failure question");
    await waitFor(() => expect(trace.requests[1]?.status).toBe(503)); retained("Synthetic history failure question");
    expect(trace.chats).toHaveLength(1); expect(screen.queryByText("已保存 / Saved")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /傳送|送出|發送/ })); await waitFor(() => expect(trace.requests[2]?.status).toBe(202));
    expect(trace.requests[2].requestId).toBe(trace.requests[1].requestId); expect(trace.chats).toHaveLength(1); retained("Synthetic history failure question");
  });
  it("checks an unknown generation outcome without automatically posting or generating again", async () => {
    fixture.providerFailure = true; openPanel(); send(question);
    await waitFor(() => expect(trace.requests[0]?.status).toBe(503)); retained(question);
    fireEvent.click(screen.getByRole("button", { name: /Check request/ })); await waitFor(() => expect(trace.requests).toHaveLength(2));
    expect(trace.requests.map(r => r.method)).toEqual(["POST", "GET"]); expect(trace.requests[1].path).toContain(trace.requests[0].requestId!);
    expect(trace.chats).toHaveLength(1); expect(trace.rpc.filter(n => n === "mark_assistant_request_unknown")).toHaveLength(1); retained(question);
  });
  it("labels a lost save response unconfirmed then replaces it from status without a second generation", async () => {
    fixture.lostSaveResponse = true; openPanel(); send(question);
    await screen.findByText(new RegExp(`Not confirmed saved: ${answer}`)); retained(question);
    expect(screen.queryByText("已保存 / Saved")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Check request/ })); await saved();
    expect(screen.getAllByText(answer, { exact: true })).toHaveLength(1); expect(trace.chats).toHaveLength(1); expect(fixture.messages).toHaveLength(2);
    expect(trace.requests.map(r => r.method)).toEqual(["POST", "GET"]); retained("");
  });
  it("dispatches an unsupported reward/role tool to a denial without a financial or access RPC", async () => {
    fixture.writeToolAttempt = true; openPanel(); send(question); await saved();
    expect(trace.chats).toHaveLength(2); expect(trace.chats[0].tools).toEqual(["get_my_points", "get_my_missions"]);
    expect(trace.chats[1].content).toContain("unknown tool: issue_reward_and_grant_admin");
    expect(trace.rpc).toEqual(["reserve_assistant_request", "claim_assistant_request", "match_kb_chunks", "save_assistant_turn"]);
    expect(screen.getByText("Offline source checklist")).toBeInTheDocument();
  });
  it("keeps the mission assistance default disabled before any scripted DB or provider call", async () => {
    const app = new Hono<Env>();
    app.use("*", async (c, next) => { c.set("workspaceId", workspace); c.set("userId", creator); c.set("jwt", "offline-fixture-not-a-jwt"); await next(); });
    app.route("/assistant", assistantRoutes());
    const response = await app.request("/assistant/mission-assist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_request_id: "00000000-0000-4000-8000-000000000704", message: question, assist_context: { mode: "explain_brief", missionId: "00000000-0000-4000-8000-000000000705" } }) });
    trace.requests.push({ method: "POST", path: "/assistant/mission-assist", requestId: "00000000-0000-4000-8000-000000000704", status: response.status });
    expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ code: "assist_disabled", generation: "not_started" });
    expect(trace.rpc).toEqual([]); expect(trace.chats).toEqual([]); expect(fixture.fakeClientFactories).toBe(0);
  });
});
