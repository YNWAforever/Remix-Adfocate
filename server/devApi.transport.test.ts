import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import { openTestDevApi } from "./test/devApiTestTransport.js";

const transports: Awaited<ReturnType<typeof openTestDevApi>>[] = [];
afterEach(async () => { await Promise.all(transports.splice(0).map(transport => transport.close())); });

async function open(app: Parameters<typeof openTestDevApi>[0]) {
  const transport = await openTestDevApi(app);
  transports.push(transport);
  return transport;
}

describe("Vite development API middleware transport contracts", () => {
  it("intercepts exact /api and nested /api paths without swallowing /apix", async () => {
    const app = new Hono();
    app.all("/api", (context) => context.json({ route: "exact" }));
    app.all("/api/*", (context) => context.json({ route: "nested" }));
    const transport = await open(app);

    const [exact, nested, lookalike] = await Promise.all([
      transport.read("/api"),
      transport.read("/api/health"),
      transport.read("/apix"),
    ]);

    expect(exact.headers["content-type"]).toContain("application/json");
    expect(JSON.parse(exact.body)).toEqual({ route: "exact" });
    expect(JSON.parse(nested.body)).toEqual({ route: "nested" });
    expect(lookalike.headers["content-type"]).toContain("text/html");
    expect(lookalike.body).toContain("SPA fallback");
  });

  it("forwards method, body, query, authorization, and cookie headers", async () => {
    const app = new Hono();
    app.post("/api/echo", async (context) => context.json({
      method: context.req.method,
      query: new URL(context.req.url).search,
      authorization: context.req.header("authorization"),
      cookie: context.req.header("cookie"),
      body: await context.req.text(),
    }));
    const transport = await open(app);

    const response = await transport.read("/api/echo?attempt=2&mode=review", {
      method: "POST",
      headers: {
        authorization: "Bearer local-fixture-token",
        cookie: "session=local; locale=zh-HK",
        "content-type": "application/json",
      },
      body: JSON.stringify({ proof: "accepted" }),
    });

    expect(JSON.parse(response.body)).toEqual({
      method: "POST",
      query: "?attempt=2&mode=review",
      authorization: "Bearer local-fixture-token",
      cookie: "session=local; locale=zh-HK",
      body: JSON.stringify({ proof: "accepted" }),
    });
  });

  it("preserves duplicate Set-Cookie plus status, statusText, and other headers", async () => {
    const app = new Hono();
    app.get("/api/cookies", () => {
      const headers = new Headers({ "x-bridge": "forwarded" });
      headers.append("set-cookie", "creator=one; Path=/; HttpOnly");
      headers.append("set-cookie", "operator=two; Path=/; SameSite=Lax");
      return new Response("accepted", {
        status: 207,
        statusText: "Bridge Accepted",
        headers,
      });
    });
    const transport = await open(app);

    const response = await transport.read("/api/cookies");

    expect(response.status).toBe(207);
    expect(response.statusMessage).toBe("Bridge Accepted");
    expect(response.headers["x-bridge"]).toBe("forwarded");
    expect(response.headers["set-cookie"]).toEqual([
      "creator=one; Path=/; HttpOnly",
      "operator=two; Path=/; SameSite=Lax",
    ]);
    expect(response.body).toBe("accepted");
  });

  it("completes HEAD and null-body responses without writing a body", async () => {
    const app = {
      fetch(request: Request) {
        return new URL(request.url).pathname === "/api/head"
          ? new Response("must not be sent", {
            status: 202,
            statusText: "Head Accepted",
          })
          : new Response(null, { status: 204 });
      },
    };
    const transport = await open(app);

    const [head, empty] = await Promise.all([
      transport.read("/api/head", { method: "HEAD" }),
      transport.read("/api/empty"),
    ]);

    expect(head.status).toBe(202);
    expect(head.statusMessage).toBe("Head Accepted");
    expect(head.body).toBe("");
    expect(empty.status).toBe(204);
    expect(empty.body).toBe("");
  });

  it("delivers response chunks incrementally instead of buffering the full body", async () => {
    const encoder = new TextEncoder();
    let releaseTail = () => {};
    const app = new Hono();
    app.get("/api/stream", () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode("first-"));
        releaseTail = () => {
          controller.enqueue(encoder.encode("second"));
          controller.close();
        };
      },
    })));
    const transport = await open(app);
    let seeFirst!: (chunk: string) => void;
    let responseFailed!: (error: Error) => void;
    const firstChunk = new Promise<string>((resolve, reject) => { seeFirst = resolve; responseFailed = reject; });
    const body = new Promise<string>((resolve, reject) => {
      const request = transport.start("/api/stream", {}, response => {
        const chunks: Buffer[] = [];
        response.once("error", error => { responseFailed(error); reject(error); });
        response.on("data", chunk => {
          chunks.push(Buffer.from(chunk));
          seeFirst(chunks[0].toString("utf8"));
        });
        response.once("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      });
      request.once("error", error => { responseFailed(error); reject(error); });
      request.end();
    });
    try {
      expect(await firstChunk).toBe("first-");
    } finally {
      releaseTail();
      expect(await body).toBe("first-second");
    }
  });

  it("cancels the Fetch body when the client aborts", async () => {
    const encoder = new TextEncoder();
    let markCanceled = () => {};
    const canceled = new Promise<boolean>((resolve) => {
      markCanceled = () => resolve(true);
    });
    const app = new Hono();
    app.get("/api/cancel", () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode("first"));
      },
      cancel() {
        markCanceled();
      },
    })));
    const transport = await open(app);
    const firstChunk = new Promise<string>((resolve, reject) => {
      const request = transport.start("/api/cancel", {}, response => {
        response.once("error", reject);
        response.once("data", chunk => {
          resolve(Buffer.from(chunk).toString("utf8"));
          response.destroy();
        });
      });
      request.once("error", reject);
      request.end();
    });
    expect(await firstChunk).toBe("first");
    expect(await canceled).toBe(true);
  });

  it("completes an app failure as JSON without hanging the Node response", async () => {
    const app = {
      fetch() {
        throw new Error("loopback failure");
      },
    };
    const transport = await open(app);
    const response = await transport.read("/api/failure");
    expect(response.status).toBe(500);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(JSON.parse(response.body)).toEqual({ error: "loopback failure" });
  });
});
