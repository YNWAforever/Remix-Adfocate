import type { IncomingMessage, ServerResponse } from "node:http";

type FetchApp = {
  fetch(request: Request): Response | Promise<Response>;
};

async function requestBody(request: IncomingMessage): Promise<ArrayBuffer | undefined> {
  if (request.method === "GET" || request.method === "HEAD") return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Uint8Array.from(Buffer.concat(chunks)).buffer;
}

export function createViteApiMiddleware(app: FetchApp) {
  return (
    request: IncomingMessage,
    response: ServerResponse,
    next: () => void,
  ) => {
    const pathname = new URL(request.url ?? "/", "http://vite.local").pathname;
    if (pathname !== "/api" && !pathname.startsWith("/api/")) {
      next();
      return;
    }

    void (async () => {
      try {
        const origin = `http://${request.headers.host ?? "127.0.0.1"}`;
        const fetchResponse = await app.fetch(new Request(
          new URL(request.url ?? "/api", origin),
          {
            method: request.method,
            headers: request.headers as HeadersInit,
            body: await requestBody(request),
          },
        ));
        response.statusCode = fetchResponse.status;
        response.statusMessage = fetchResponse.statusText;
        fetchResponse.headers.forEach((value, name) => response.setHeader(name, value));
        response.end(Buffer.from(await fetchResponse.arrayBuffer()));
      } catch (error) {
        response.statusCode = 500;
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({
          error: error instanceof Error ? error.message : "Local API request failed",
        }));
      }
    })();
  };
}
