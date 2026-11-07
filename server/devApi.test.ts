import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import { openTestDevApi } from "./test/devApiTestTransport.js";

const transports: Awaited<ReturnType<typeof openTestDevApi>>[] = [];
afterEach(async () => { await Promise.all(transports.splice(0).map(transport => transport.close())); });

async function open(app: Hono) {
  const transport = await openTestDevApi(app);
  transports.push(transport);
  return transport;
}

describe("Vite development API middleware", () => {
  it("routes /api requests to Hono instead of the SPA fallback", async () => {
    const app = new Hono().basePath("/api");
    app.get("/me", (context) => context.json({ source: "hono" }));
    const transport = await open(app);
    const response = await transport.read("/api/me");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(JSON.parse(response.body)).toEqual({ source: "hono" });
  });

  it("preserves Vite's SPA fallback for non-API requests", async () => {
    const app = new Hono().basePath("/api");
    const transport = await open(app);
    const response = await transport.read("/my/submission");

    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("SPA fallback");
  });
});
