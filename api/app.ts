import { Hono } from "hono";
import { workspaceAuth } from "./middleware/workspace";
import { workspaceRoutes } from "./routes/workspace";
import { meBootstrap, meRoutes } from "./routes/me";
import { walletRoutes } from "./routes/wallet";
import { missionRoutes } from "./routes/missions";
import { redemptionRoutes } from "./routes/redemption";

export type Env = {
  Variables: { userId: string; workspaceId: string; jwt: string };
};

export function createApp() {
  const app = new Hono<Env>().basePath("/api");
  app.get("/health", (c) => c.json({ ok: true }));

  // Unguarded: first-login creator bootstrap (runs before a creator row exists).
  app.route("/me", meBootstrap);

  const guarded = new Hono<Env>();
  guarded.use("*", workspaceAuth);
  guarded.route("/me", meRoutes);
  guarded.route("/wallet", walletRoutes);
  guarded.route("/missions", missionRoutes);
  guarded.route("/redemption", redemptionRoutes);
  guarded.route("/workspace", workspaceRoutes);
  app.route("/", guarded);

  return { app, guarded };
}
