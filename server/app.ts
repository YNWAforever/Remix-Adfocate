import { Hono } from "hono";
import { workspaceAuth } from "./middleware/workspace.js";
import { workspaceRoutes } from "./routes/workspace.js";
import { meBootstrap, meRoutes } from "./routes/me.js";
import { onboardingRoutes } from "./routes/onboarding.js";
import { walletRoutes } from "./routes/wallet.js";
import { missionRoutes } from "./routes/missions.js";
import { redemptionRoutes } from "./routes/redemption.js";
import { adminRoutes } from "./routes/admin.js";
import { matchRoutes } from "./routes/match.js";
import { copilotRoutes } from "./routes/copilot.js";
import { publicRoutes } from "./routes/public.js";
import { socialRoutes } from "./routes/social.js";

export type Env = {
  Variables: { userId: string; workspaceId: string; jwt: string };
};

export function createApp() {
  const app = new Hono<Env>().basePath("/api");
  app.get("/health", (c) => c.json({ ok: true }));

  // Unguarded: first-login creator bootstrap (runs before a creator row exists).
  app.route("/me", meBootstrap);

  // Unguarded operator endpoints (own shared-secret middleware, not workspaceAuth).
  app.route("/admin", adminRoutes);
  app.route("/public", publicRoutes);

  const guarded = new Hono<Env>();
  guarded.use("*", workspaceAuth);
  guarded.route("/me", meRoutes);
  guarded.route("/onboarding", onboardingRoutes);
  guarded.route("/wallet", walletRoutes);
  guarded.route("/missions", missionRoutes);
  guarded.route("/match", matchRoutes);
  guarded.route("/copilot", copilotRoutes);
  guarded.route("/redemption", redemptionRoutes);
  guarded.route("/social", socialRoutes);
  guarded.route("/workspace", workspaceRoutes);
  app.route("/", guarded);

  return { app, guarded };
}
