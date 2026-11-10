// @vitest-environment node
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../app";

const h = vi.hoisted(() => ({ userClient: null as unknown, serviceClient: null as unknown }));
vi.mock("../lib/supabase.js", () => ({
  makeUserClient: () => h.userClient,
  serviceClient: () => h.serviceClient,
}));

import { signProposalToken } from "../lib/assistant/proposalToken";
import { studioProposalRoutes } from "../routes/studioProposals";

const THREAD = "11111111-1111-4111-8111-111111111111";
const CREATOR = "creator-1";
const WORKSPACE = "workspace-1";
const KEY = Buffer.alloc(32, 3).toString("base64");
const sections = ["第一段", "第二段"];

type Row = Record<string, unknown>;
function userClient(thread: Row | null) {
  const from = () => {
    const filters: Row = {};
    const q: Record<string, unknown> = {
      select() { return q; },
      eq(key: string, value: unknown) { filters[key] = value; return q; },
      maybeSingle() {
        return Promise.resolve(thread ? { data: Object.keys(filters).every(key => thread[key] === filters[key]) ? thread : null, error: null } : { data: null, error: null });
      },
    };
    return q;
  };
  return { client: { from } };
}
function serviceClient(rpcResult: { data?: unknown; error?: { message: string } | null } = { data: { ok: true }, error: null }) {
  const inserts: Row[] = [];
  const rpcCalls: Array<{ name: string; args: Row }> = [];
  const from = () => ({ insert: (value: Row) => { inserts.push(value); return { then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve) }; } });
  return {
    client: { from, rpc: (name: string, args: Row) => { rpcCalls.push({ name, args }); return Promise.resolve(rpcResult); } },
    inserts,
    rpcCalls,
  };
}

const app = () => new Hono<Env>()
  .use("*", async (c, next) => { c.set("userId", CREATOR); c.set("workspaceId", WORKSPACE); c.set("jwt", "jwt"); await next(); })
  .route("/studio", studioProposalRoutes());

beforeEach(() => {
  vi.stubEnv("STUDIO_ASSISTANT_PROPOSAL_EXECUTION", "true");
  vi.stubEnv("PROPOSAL_SIGNING_KEY", KEY);
});
afterEach(() => vi.unstubAllEnvs());

function token(overrides: Partial<Parameters<typeof signProposalToken>[0]> = {}) {
  return signProposalToken({ kind: "brief", threadId: THREAD, creatorId: CREATOR, workspaceId: WORKSPACE, requestId: "request:0", content: sections, ...overrides })!;
}
const post = (body: unknown) => app().request("/studio/proposals/execute", { method: "POST", headers: { "content-type": "application/json", Origin: "http://localhost" }, body: JSON.stringify(body) });

describe("studio proposal execution", () => {
  it("is dark unless the execution flag is on", async () => {
    vi.stubEnv("STUDIO_ASSISTANT_PROPOSAL_EXECUTION", "false");
    expect((await post({ token: token(), sections })).status).toBe(404);
  });

  it("rejects invalid, tampered and mismatched proposals", async () => {
    const service = serviceClient();
    h.serviceClient = service.client;
    expect((await post({ token: "nope.nope", sections })).status).toBe(403);
    const otherCreator = token({ creatorId: "someone-else" });
    h.userClient = userClient({ id: THREAD, revision: 2, creator_id: CREATOR, workspace_id: WORKSPACE }).client;
    expect((await post({ token: otherCreator, sections })).status).toBe(403);
    expect((await post({ token: token(), sections: ["changed"] })).status).toBe(400);
    expect(service.inserts).toHaveLength(0);
  });

  it("executes save_brief through studio_command with the signed request id", async () => {
    h.userClient = userClient({ id: THREAD, revision: 4, creator_id: CREATOR, workspace_id: WORKSPACE }).client;
    const service = serviceClient();
    h.serviceClient = service.client;
    const response = await post({ token: token(), sections });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, kind: "brief" });
    expect(service.rpcCalls[0]).toMatchObject({ name: "studio_command" });
    expect(service.rpcCalls[0].args).toMatchObject({
      p_workspace: WORKSPACE, p_creator: CREATOR, p_request: "request:0", p_action: "save_brief",
      p_payload: { threadId: THREAD, revision: 4, sections: sections.map((text, index) => ({ id: `p-request0-${index}`, text, sourceIds: [] })) },
    });
    expect(service.inserts[0]).toMatchObject({ request_id: "request:0", creator_id: CREATOR, workspace_id: WORKSPACE, thread_id: THREAD, kind: "brief", outcome: "executed" });
  });

  it("limits execution to allowlisted creators when configured", async () => {
    h.userClient = userClient({ id: THREAD, revision: 4, creator_id: CREATOR, workspace_id: WORKSPACE }).client;
    const service = serviceClient();
    h.serviceClient = service.client;
    vi.stubEnv("STUDIO_ASSISTANT_PROPOSAL_EXECUTION_CREATORS", "00000000-0000-4000-8000-000000000099");
    expect((await post({ token: token(), sections })).status).toBe(403);
    vi.stubEnv("STUDIO_ASSISTANT_PROPOSAL_EXECUTION_CREATORS", CREATOR);
    expect((await post({ token: token(), sections })).status).toBe(200);
  });

  it("maps stale revisions to a retryable conflict and audits it", async () => {
    h.userClient = userClient({ id: THREAD, revision: 4, creator_id: CREATOR, workspace_id: WORKSPACE }).client;
    const service = serviceClient({ data: null, error: { message: "STALE_BRIEF" } });
    h.serviceClient = service.client;
    const response = await post({ token: token(), sections });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "STALE_BRIEF" });
    expect(service.inserts[0]).toMatchObject({ outcome: "rejected" });
  });
});
