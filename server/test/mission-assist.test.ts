import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assistantRoutes } from "../routes/assistant.js";
import type { Env } from "../app.js";
import { adminRoutes } from "../routes/admin.js";
import type { AssistantProvider } from "../lib/assistant/chat.js";
import fixture from "../../tests/fixtures/assistant-workflow-eval.json";
const io = vi.hoisted(() => ({ makeUserClient: vi.fn(), serviceClient: vi.fn() }));
vi.mock("../lib/supabase.js", () => io);
const id = fixture.ids;
beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.unstubAllEnvs(); });
const body = { message: "Explain", client_request_id: id.request, assist_context: { workspaceId: id.workspace, missionId: id.mission, mode: "explain_brief" } };
function creatorApp() {
  const app = new Hono<Env>();
  app.use("*", async (c, next) => { c.set("userId", id.creator); c.set("workspaceId", id.workspace); c.set("jwt", "offline-session"); await next(); });
  app.route("/assistant", assistantRoutes()); return app;
}
describe("D20 disabled HTTP boundary", () => {
  it("ignores environment/request attempts to enable a real provider before constructing a client", async () => {
    const app = new Hono<Env>();
    app.use("*", async (c, next) => { c.set("userId", id.creator); c.set("workspaceId", id.workspace); c.set("jwt", "synthetic-session"); await next(); });
    app.route("/assistant", assistantRoutes());
    vi.stubEnv("MISSION_ASSIST_ENABLED", "true");
    vi.stubEnv("AI_GATEWAY_API_KEY", "synthetic-never-used");
    const response = await app.request("/assistant/mission-assist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: "Explain", client_request_id: id.request, provider: "live", assist_context: { workspaceId: id.workspace, missionId: id.mission, mode: "explain_brief" } }) });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "assist_disabled", persistence: "not_saved", generation: "not_started" });
    expect(io.makeUserClient).not.toHaveBeenCalled(); expect(io.serviceClient).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
  it.each([
    { ...body, message: "" }, { ...body, message: "😀".repeat(4001) }, { ...body, client_request_id: "invalid" },
    { ...body, assist_context: { ...body.assist_context, role: "workspace_admin" } },
  ])("rejects malformed embedded input as a recoverable 400 before client creation", async invalid => {
    const response = await creatorApp().request("/assistant/mission-assist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(invalid) });
    expect(response.status).toBe(400); expect(await response.json()).toMatchObject({ code: "bad_request", persistence: "not_saved", generation: "not_started" });
    expect(io.makeUserClient).not.toHaveBeenCalled(); expect(io.serviceClient).not.toHaveBeenCalled();
  });
});

describe("D20 actual admin middleware: existing staff and single membership gates", () => {
  it.each([
    ["missing membership", null, "reviewer", 403, "WORKSPACE_MEMBERSHIP_REQUIRED"],
    ["no assigned role", "active", null, 403, "STAFF_CAPABILITY_REQUIRED"],
    ["finance viewer", "active", "finance_viewer", 403, "STAFF_CAPABILITY_REQUIRED"],
    ["reviewer", "active", "reviewer", 503, "assist_disabled"],
    ["operator", "active", "operator", 503, "assist_disabled"],
    ["workspace admin", "active", "workspace_admin", 503, "assist_disabled"],
    ["revoked role", "active", "revoked", 403, "STAFF_CAPABILITY_REQUIRED"],
    ["missing role schema", "active", "schema_missing", 503, "STAFF_CAPABILITY_SCHEMA_REQUIRED"],
  ])("%s cannot bypass the gates or enable generation", async (_, membership, role, status, code) => {
    const mutation = vi.fn(() => { throw new Error("WRITE_FORBIDDEN"); });
    const tables: string[] = [];
    const from = vi.fn((table: string) => {
      tables.push(table); const filters: Record<string, unknown> = {};
      const q = { select: () => q, eq: (key: string, value: unknown) => { filters[key] = value; return q; },
        maybeSingle: async () => {
          if (table === "staff_users") return { data: { user_id: id.creator, active: true, email: "mock@example.invalid" }, error: null };
          if (table === "brand_users") return { data: membership ? { user_id: id.creator, workspace_id: id.workspace, active: true, workspaces: { id: id.workspace, slug: "mock-workspace" } } : null, error: null };
          if (table === "staff_workspace_roles") return { data: role && !["revoked", "schema_missing"].includes(role) ? { user_id: id.creator, workspace_id: id.workspace, active: true, role, revision: 1 } : null, error: role === "schema_missing" ? { code: "42P01" } : null };
          throw new Error(`Unexpected context read: ${table}`);
        }, insert: mutation, update: mutation, delete: mutation, upsert: mutation };
      return q;
    });
    io.makeUserClient.mockReturnValue({ auth: { getUser: async () => ({ data: { user: { id: id.creator } }, error: null }) } });
    io.serviceClient.mockReturnValue({ from, rpc: mutation });
    const app = new Hono().route("/admin", adminRoutes);
    const response = await app.request("/admin/assistant/mission-assist", { method: "POST", headers: { Authorization: "Bearer offline-session", "X-Workspace-Slug": "mock-workspace", "Content-Type": "application/json" }, body: JSON.stringify(body) });
    expect(response.status).toBe(status); expect(await response.json()).toMatchObject({ code });
    expect(mutation).not.toHaveBeenCalled(); expect(tables).not.toContain("missions");
    expect(tables).toContain("brand_users");
  });
});

describe("D20 mock HTTP generation is explicit and never claims persistence", () => {
  it.each([false, true])("returns completed mock metadata or unknown without persisting or rerunning: fail=%s", async fail => {
    const mutations = vi.fn(() => { throw new Error("BUSINESS_WRITE_FORBIDDEN"); });
    const tables: string[] = [];
    const from = vi.fn((table: string) => {
      tables.push(table);
      const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: table === "creators" ? { id: id.creator, workspace_id: id.workspace }
        : { id: id.mission, workspace_id: id.workspace, title: "Synthetic brief", status: "active", description: "Include #ad", updated_at: "2026-10-23T00:00:00Z", requirements: [], key_messages: [], dos: [], donts: [] }, error: null }), insert: mutations, update: mutations, delete: mutations };
      return q;
    });
    io.makeUserClient.mockReturnValue({ from, rpc: mutations });
    const provider: AssistantProvider = { embed: vi.fn(), chat: vi.fn(async () => {
      if (fail) throw new Error("private provider failure text");
      return { content: JSON.stringify({ answerability: "supported", answer: "Include #ad. Ask the reviewer to decide.", sourceRefs: [`mission:${id.mission}`] }), toolCalls: [] };
    }) };
    const app = new Hono<Env>();
    app.use("*", async (c, next) => { c.set("userId", id.creator); c.set("workspaceId", id.workspace); c.set("jwt", "offline-session"); await next(); });
    app.route("/assistant", assistantRoutes(provider));
    const response = await app.request("/assistant/mission-assist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const value = await response.json();
    expect(response.status).toBe(fail ? 503 : 200); expect(value).toMatchObject({ persistence: "not_saved", generation: fail ? "unknown" : "completed", request_id: id.request });
    if (fail) { expect(value.code).toBe("provider_outcome_unknown"); expect(JSON.stringify(value)).not.toContain("private provider failure text"); }
    else { expect(value).toMatchObject({ provider: "mock", basisVersion: { missionId: id.mission, versionId: null }, limitations: expect.arrayContaining(["human_review_required"]) }); expect(value.citations[0].sourceRef).toBe(`mission:${id.mission}`); }
    expect(provider.chat).toHaveBeenCalledTimes(1); expect(provider.embed).not.toHaveBeenCalled();
    expect(tables).toEqual(["creators", "missions"]); expect(mutations).not.toHaveBeenCalled(); expect(io.serviceClient).not.toHaveBeenCalled();
  });
});
