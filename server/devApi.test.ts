import { createServer } from "node:http";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import { createViteApiMiddleware } from "./devApi.js";

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) =>
    new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    })));
});

async function listen(handler: ReturnType<typeof createViteApiMiddleware>) {
  const server = createServer((request, response) => {
    handler(request, response, () => {
      response.statusCode = 200;
      response.setHeader("content-type", "text/html");
      response.end("<!doctype html><title>SPA fallback</title>");
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing test server address");
  return `http://127.0.0.1:${address.port}`;
}

describe("Vite development API middleware", () => {
  it("routes /api requests to Hono instead of the SPA fallback", async () => {
    const app = new Hono().basePath("/api");
    app.get("/me", (context) => context.json({ source: "hono" }));
    const origin = await listen(createViteApiMiddleware(app));

    const response = await fetch(`${origin}/api/me`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ source: "hono" });
  });

  it("preserves Vite's SPA fallback for non-API requests", async () => {
    const app = new Hono().basePath("/api");
    const origin = await listen(createViteApiMiddleware(app));

    const response = await fetch(`${origin}/my/submission`);

    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain("SPA fallback");
  });
});
