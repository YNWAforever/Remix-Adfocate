import {
  createServer,
  request as nodeRequest,
  type IncomingHttpHeaders,
  type RequestOptions,
} from "node:http";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import { createViteApiMiddleware } from "./devApi.js";

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) =>
    new Promise<void>((resolve, reject) => {
      server.closeAllConnections();
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

function rawRequest(
  origin: string,
  path: string,
  options: RequestOptions & { body?: string } = {},
) {
  return new Promise<{
    status: number | undefined;
    statusMessage: string | undefined;
    headers: IncomingHttpHeaders;
    body: string;
  }>((resolve, reject) => {
    const request = nodeRequest(new URL(path, origin), options, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => resolve({
        status: response.statusCode,
        statusMessage: response.statusMessage,
        headers: response.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    request.on("error", reject);
    if (options.body) request.write(options.body);
    request.end();
  });
}

function delay(ms: number) {
  return new Promise<null>((resolve) => setTimeout(() => resolve(null), ms));
}

describe("Vite development API middleware transport contracts", () => {
  it("intercepts exact /api and nested /api paths without swallowing /apix", async () => {
    const app = new Hono();
    app.all("/api", (context) => context.json({ route: "exact" }));
    app.all("/api/*", (context) => context.json({ route: "nested" }));
    const origin = await listen(createViteApiMiddleware(app));

    const [exact, nested, lookalike] = await Promise.all([
      rawRequest(origin, "/api"),
      rawRequest(origin, "/api/health"),
      rawRequest(origin, "/apix"),
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
    const origin = await listen(createViteApiMiddleware(app));

    const response = await rawRequest(origin, "/api/echo?attempt=2&mode=review", {
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
    const origin = await listen(createViteApiMiddleware(app));

    const response = await rawRequest(origin, "/api/cookies");

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
    const origin = await listen(createViteApiMiddleware(app));

    const [head, empty] = await Promise.all([
      rawRequest(origin, "/api/head", { method: "HEAD" }),
      rawRequest(origin, "/api/empty"),
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
    const origin = await listen(createViteApiMiddleware(app));

    const responsePromise = fetch(`${origin}/api/stream`);
    const earlyResponse = await Promise.race([responsePromise, delay(300)]);
    if (earlyResponse === null) {
      releaseTail();
      await responsePromise;
    }
    expect(earlyResponse).not.toBeNull();
    if (earlyResponse === null) return;

    const reader = earlyResponse.body!.getReader();
    const firstChunk = await Promise.race([reader.read(), delay(300)]);
    expect(firstChunk).not.toBeNull();
    if (firstChunk === null) {
      releaseTail();
      return;
    }
    expect(new TextDecoder().decode(firstChunk.value)).toBe("first-");

    releaseTail();
    const secondChunk = await reader.read();
    expect(new TextDecoder().decode(secondChunk.value)).toBe("second");
    expect((await reader.read()).done).toBe(true);
  });

  it("cancels the Fetch body when the client aborts", async () => {
    const encoder = new TextEncoder();
    let closeBody = () => {};
    let bodyClosed = false;
    let markCanceled = () => {};
    const canceled = new Promise<boolean>((resolve) => {
      markCanceled = () => resolve(true);
    });
    const app = new Hono();
    app.get("/api/cancel", () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode("first"));
        closeBody = () => {
          if (bodyClosed) return;
          bodyClosed = true;
          controller.close();
        };
      },
      cancel() {
        bodyClosed = true;
        markCanceled();
      },
    })));
    const origin = await listen(createViteApiMiddleware(app));
    let destroyClient = () => {};
    const firstChunk = new Promise<boolean>((resolve) => {
      const request = nodeRequest(`${origin}/api/cancel`, (response) => {
        response.once("data", () => {
          response.destroy();
          resolve(true);
        });
      });
      request.on("error", () => resolve(false));
      destroyClient = () => request.destroy();
      request.end();
    });

    const receivedFirstChunk = await Promise.race([firstChunk, delay(300)]);
    if (receivedFirstChunk === null) {
      destroyClient();
      closeBody();
    }
    const wasCanceled = await Promise.race([canceled, delay(300)]);
    if (wasCanceled === null) closeBody();

    expect(receivedFirstChunk).toBe(true);
    expect(wasCanceled).toBe(true);
  });

  it("completes an app failure as JSON without hanging the Node response", async () => {
    const app = {
      fetch() {
        throw new Error("loopback failure");
      },
    };
    const origin = await listen(createViteApiMiddleware(app));

    const response = await Promise.race([
      rawRequest(origin, "/api/failure"),
      delay(300),
    ]);

    expect(response).not.toBeNull();
    if (response === null) return;
    expect(response.status).toBe(500);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(JSON.parse(response.body)).toEqual({ error: "loopback failure" });
  });
});
