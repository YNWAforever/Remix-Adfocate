import { FIXTURE_WORKSPACE_SLUG } from "./helpers";
import { fixtureName } from "./helpers";
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { makeCreator, cleanup, hasSupabaseEnv } from "./helpers";
import { assistantRoutes } from "../routes/assistant";
import type { AssistantProvider } from "../lib/assistant/chat";

const stub: AssistantProvider = {
  embed: async () => [[0.1]],
  chat: async () => ({ content: "你好，完成任務可獲積分。", toolCalls: [] }),
};

// Build the app with the stubbed provider by temporarily swapping the assistant route.
// We reconstruct the guarded sub-app via createApp() but override the assistant routes
// with the stub variant — achieved by building a fresh app and replacing the route.
// Simplest approach: build a custom app that mirrors production middleware but injects stub.
import { Hono } from "hono";
import { workspaceAuth } from "../middleware/workspace";
import type { Env } from "../app";

function testApp() {
  const app = new Hono<Env>().basePath("/api");
  app.get("/health", (c) => c.json({ ok: true }));
  const guarded = new Hono<Env>();
  guarded.use("*", workspaceAuth);
  guarded.route("/assistant", assistantRoutes(stub));
  app.route("/", guarded);
  return app;
}

function req(app: ReturnType<typeof testApp>, path: string, jwt: string, init: RequestInit = {}) {
  return app.request(`/api${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${jwt}`,
      "X-Workspace-Slug": FIXTURE_WORKSPACE_SLUG,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

process.env.ADMIN_SECRET = process.env.ADMIN_SECRET || "test-admin-secret";

const suite = hasSupabaseEnv ? describe : describe.skip;

suite("assistant chat route", () => {
  let a: { userId: string; jwt: string };
  let b: { userId: string; jwt: string };

  beforeAll(async () => {
    await cleanup();
    a = await makeCreator(fixtureName("assist-a@test.local"));
    b = await makeCreator(fixtureName("assist-b@test.local"));
  });
  afterAll(cleanup);

  it("answers and persists a conversation", async () => {
    const app = testApp();
    const res = await req(app, "/assistant/chat", a.jwt, {
      method: "POST",
      body: JSON.stringify({ client_request_id: randomUUID(), message: "點樣賺積分？" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.answer).toContain("積分");
    expect(json.conversation_id).toBeTruthy();
    expect(json.persistence).toBe("saved");
  });

  it("does not leak another creator's conversations", async () => {
    const app = testApp();
    const made = await (
      await req(app, "/assistant/chat", a.jwt, {
        method: "POST",
        body: JSON.stringify({ client_request_id: randomUUID(), message: "hi" }),
      })
    ).json();
    const listB = await (await req(app, "/assistant/conversations", b.jwt)).json();
    expect(listB.conversations.find((x: { id: string }) => x.id === made.conversation_id)).toBeUndefined();
  });
});
