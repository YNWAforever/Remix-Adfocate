import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import type { Env } from "../app";
import { workspaceAuth } from "../middleware/workspace";

function appWith() {
  const app = new Hono<Env>();
  app.use("*", workspaceAuth);
  app.get("/probe", (c) => c.json({ workspaceId: c.get("workspaceId"), userId: c.get("userId") }));
  return app;
}

describe("workspaceAuth", () => {
  it("401 when Authorization header is missing", async () => {
    const res = await appWith().request("/probe", { headers: { "X-Workspace-Slug": "demo" } });
    expect(res.status).toBe(401);
  });

  it("400 when X-Workspace-Slug header is missing", async () => {
    const res = await appWith().request("/probe", { headers: { Authorization: "Bearer x" } });
    expect(res.status).toBe(400);
  });
});
