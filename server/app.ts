import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { GENERIC_ERROR, logServerError } from "./lib/httpErrors.js";
import { workspaceAuth } from "./middleware/workspace.js";
import { workspaceRoutes } from "./routes/workspace.js";
import { meBootstrap, meRoutes } from "./routes/me.js";
import { onboardingRoutes } from "./routes/onboarding.js";
import { walletRoutes } from "./routes/wallet.js";
import { missionRoutes } from "./routes/missions.js";
import { redemptionRoutes } from "./routes/redemption.js";
import { adminRoutes } from "./routes/admin.js";
import { matchRoutes } from "./routes/match.js";
import { notificationRoutes } from "./routes/notifications.js";
import { copilotRoutes } from "./routes/copilot.js";
import { assistantRoutes } from "./routes/assistant.js";
import { publicRoutes } from "./routes/public.js";
import { socialRoutes } from "./routes/social.js";
import { cronRoutes } from "./routes/cron.js";
import { profileMediaRoutes } from "./routes/profileMedia.js";
import { consentRoutes } from "./routes/consents.js";
import { accountRoutes } from "./routes/account.js";
import { contentRoutes } from "./routes/content.js";
import { academyRoutes } from "./routes/academy.js";
import { academyLessonsRoutes } from "./routes/academyLessons.js";
import { brandRoutes } from "./routes/brand.js";
import { campaignRoutes } from "./routes/campaigns.js";
import { activeMissionRoutes } from "./routes/activeMissions.js";
import { studioRoutes } from "./routes/studio.js";
import { createCreatorGrowthRoutes } from "./routes/creatorGrowth.js";
import { createCreatorGrowthPublishRoutes } from "./routes/creatorGrowthPublish.js";
import { createCreatorPilotRoutes, type CreatorPilotRouteDependencies } from "./routes/creatorPilot.js";
import { integrationRoutes } from "./routes/integrations.js";
import { integrationOAuthCallbacks, integrationOAuthRoutes } from "./routes/integrationOAuth.js";
import { integrationNoticeRoutes } from "./routes/integrationNotices.js";
import { mcpSkillRoutes } from "./routes/mcp.js";
import { mcpPilotRoutes } from "./routes/mcpPilot.js";
import { mcpOAuthCallbackRoutes, mcpOAuthRoutes } from "./routes/mcpOAuth.js";
import { studioProposalRoutes } from "./routes/studioProposals.js";

export type Env = {
  Variables: { userId: string; workspaceId: string; jwt: string };
};

export function createApp(options: { creatorPilot?: CreatorPilotRouteDependencies } = {}) {
  const app = new Hono<Env>().basePath("/api");
  app.get("/health", (c) => c.json({ ok: true }));
  // Last resort for unhandled exceptions: structured log, generic JSON body. A malformed JSON
  // request body (c.req.json() SyntaxError) is the client's fault, so it answers 400.
  app.onError((err, c) => {
    if (err instanceof SyntaxError) return c.json({ error: "Malformed JSON body", code: "bad_json" }, 400);
    if (err instanceof HTTPException) return err.getResponse();
    logServerError(c, "internal_error", err instanceof Error ? err.message : String(err));
    return c.json({ error: GENERIC_ERROR, code: "internal_error" }, 500);
  });

  // Unguarded: first-login creator bootstrap (runs before a creator row exists).
  app.route("/me", meBootstrap);

  // Unguarded operator endpoints (own shared-secret middleware, not workspaceAuth).
  app.route("/admin", adminRoutes);
  app.route("/brand", brandRoutes);
  app.route("/public", publicRoutes);
  app.route("/cron", cronRoutes);
  // D0: these surfaces remain inactive; no real coordinator/client is constructed.
  app.route("/integration-oauth", integrationOAuthCallbacks());
  // Read-only MCP pilot server reached by the studio chat over MCP (token + workspace scoped).
  app.route("/mcp-pilot", mcpPilotRoutes());
  // Provider OAuth callback (browser redirect); state row identifies the creator.
  app.route("/mcp-oauth", mcpOAuthCallbackRoutes());
  // No fixture dependencies or live receipt reader are installed in the original application.
  app.route("/integration-notices", integrationNoticeRoutes());

  const guarded = new Hono<Env>();
  guarded.use("*", workspaceAuth);
  guarded.route("/me", meRoutes);
  guarded.route("/me/profile-media", profileMediaRoutes);
  guarded.route("/me/consents", consentRoutes);
  guarded.route("/me/integrations", integrationRoutes());
  guarded.route("/me/integration-oauth", integrationOAuthRoutes());
  guarded.route("/me", accountRoutes);
  guarded.route("/onboarding", onboardingRoutes);
  guarded.route("/wallet", walletRoutes);
  guarded.route("/missions", missionRoutes);
  guarded.route("/my-missions", activeMissionRoutes);
  guarded.route("/campaigns", campaignRoutes);
  guarded.route("/match", matchRoutes);
  guarded.route("/notifications", notificationRoutes);
  guarded.route("/copilot", copilotRoutes);
  guarded.route("/assistant", assistantRoutes());
  guarded.route("/studio", studioRoutes);
  guarded.route("/mcp", mcpSkillRoutes());
  guarded.route("/mcp", mcpOAuthRoutes());
  // Publication is separately guarded and disabled; no service/worker is installed.
  guarded.route("/creator-growth/publish", createCreatorGrowthPublishRoutes());
  // Explicit trusted server injection only; existing entrypoints pass no dependencies.
  guarded.route("/creator-growth/pilot", createCreatorPilotRoutes(options.creatorPilot));
  guarded.route("/creator-growth", createCreatorGrowthRoutes());
  guarded.route("/redemption", redemptionRoutes);
  guarded.route("/social", socialRoutes);
  guarded.route("/workspace", workspaceRoutes);
  guarded.route("/content", contentRoutes);
  guarded.route("/academy", academyRoutes);
  guarded.route("/academy", academyLessonsRoutes);
  app.route("/", guarded);

  return { app, guarded };
}
