import { once } from "node:events";
import { createServer, request, type IncomingHttpHeaders, type IncomingMessage, type RequestOptions } from "node:http";
import { Duplex } from "node:stream";
import { createViteApiMiddleware } from "../devApi.js";

// Both modes exercise Node's HTTP client and server parser. The default uses
// paired streams instead of binding a port, so restricted runners can use it.
function connectedStreams(): [Duplex, Duplex] {
  const stream = (peer: () => Duplex) => new Duplex({
    read() {},
    write(chunk, _encoding, done) {
      if (peer().destroyed) return done(new Error("HTTP test peer closed"));
      peer().push(chunk);
      done();
    },
    final(done) {
      if (!peer().destroyed) peer().push(null);
      done();
    },
    destroy(error, done) {
      if (!peer().destroyed) peer().destroy();
      done(error);
    },
  });
  const client: Duplex = stream(() => server);
  const server: Duplex = stream(() => client);
  return [client, server];
}

export async function openTestDevApi(app: Parameters<typeof createViteApiMiddleware>[0]) {
  const useTcp = process.env.P5_DEV_API_TCP === "1";
  const middleware = createViteApiMiddleware(app);
  const server = createServer((req, res) => {
    middleware(req, res, () => {
      res.statusCode = 200;
      res.setHeader("content-type", "text/html");
      res.end("<!doctype html><title>SPA fallback</title>");
    });
  });
  const sockets = new Set<Duplex>();
  let port: number | undefined;
  if (useTcp) {
    const listening = once(server, "listening");
    server.listen(0, "127.0.0.1");
    await listening;
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("HTTP test port missing");
    port = address.port;
  }

  const start = (path: string, options: RequestOptions = {}, callback?: (response: IncomingMessage) => void) => {
    const { method, headers } = options;
    if (useTcp) return request({ host: "127.0.0.1", port, path, method, headers, agent: false }, callback);
    return request({
      host: "test-dev-api.invalid", path, method, headers,
      createConnection() {
        const [client, peer] = connectedStreams();
        sockets.add(client);
        client.once("close", () => sockets.delete(client));
        server.emit("connection", peer);
        return client;
      },
    }, callback);
  };
  return {
    start,
    read(path: string, options: RequestOptions & { body?: string } = {}) {
      return new Promise<{
        status: number | undefined;
        statusMessage: string | undefined;
        headers: IncomingHttpHeaders;
        body: string;
      }>((resolve, reject) => {
        const req = start(path, options, res => {
          const chunks: Buffer[] = [];
          res.on("data", chunk => chunks.push(Buffer.from(chunk)));
          res.once("error", reject);
          res.once("end", () => resolve({
            status: res.statusCode,
            statusMessage: res.statusMessage,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          }));
        });
        req.once("error", reject);
        req.end(options.body);
      });
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      if (useTcp) {
        const closed = new Promise<void>((resolve, reject) => {
          server.close(error => error ? reject(error) : resolve());
        });
        server.closeAllConnections();
        await closed;
      }
    },
  };
}
