import { Hono } from "hono";
import { workspaceAuth } from "./middleware/workspace";

export type Env = {
  Variables: { userId: string; workspaceId: string; jwt: string };
};

export function createApp() {
  const app = new Hono<Env>().basePath("/api");
  app.get("/health", (c) => c.json({ ok: true }));

  const guarded = new Hono<Env>();
  guarded.use("*", workspaceAuth);
  app.route("/", guarded);

  return { app, guarded };
}
