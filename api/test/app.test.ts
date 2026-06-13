import { describe, it, expect } from "vitest";
import { createApp } from "../app";

describe("hono app", () => {
  it("responds to /api/health", async () => {
    const { app } = createApp();
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
