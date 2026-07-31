import { Hono, type Context } from "hono";
import {
  RewardHandoffError,
  createRewardHandoffRepository,
  normalizeListFilters,
  rewardHandoffStatus,
  validateBackfillPayload,
  validateCancellationPayload,
  validateCompletionPayload,
  validateSettingsPayload,
  validateUuid,
  type AdminRewardHandoffRepository,
} from "../lib/activeMission/rewardHandoff.js";
import { serviceClient } from "../lib/supabase.js";
import type { AdminEnv, StaffIdentity } from "../lib/staffAuth.js";

type IdentityProvider = (context: Context<AdminEnv>) => Pick<StaffIdentity, "userId">;

async function body(context: Context<AdminEnv>) {
  return context.req.json<unknown>().catch(() => ({}));
}

function requestContext(context: Context<AdminEnv>, identity: IdentityProvider) {
  const staff = identity(context);
  if (!staff?.userId) {
    throw new RewardHandoffError("NOT_AUTHENTICATED", "A staff user session is required");
  }
  const workspaceSlug = context.req.header("X-Workspace-Slug")?.trim();
  if (!workspaceSlug) {
    throw new RewardHandoffError("VALIDATION_FAILED", "X-Workspace-Slug is required");
  }
  return { operatorId: staff.userId, workspaceSlug };
}

function routeError(context: Context<AdminEnv>, error: unknown) {
  if (error instanceof RewardHandoffError) {
    const status = rewardHandoffStatus(error.code);
    return context.json({
      error: error.code === "FORBIDDEN"
        ? "forbidden"
        : error.code === "UNKNOWN"
          ? "Reward handoff request failed"
          : error.message,
      code: error.code,
    }, status);
  }
  console.error("[adminRewardHandoffs]", error);
  return context.json({ error: "Reward handoff request failed", code: "UNKNOWN" }, 500);
}

export function createAdminRewardHandoffRoutes(
  injectedRepository?: AdminRewardHandoffRepository,
  identity: IdentityProvider = (context) => context.get("staff"),
) {
  const routes = new Hono<AdminEnv>();
  const repository = () => injectedRepository ?? createRewardHandoffRepository(serviceClient());

  routes.get("/active-missions/:workflowId/completion", async (context) => {
    try {
      const request = requestContext(context, identity);
      const workflowId = validateUuid(context.req.param("workflowId"), "workflowId");
      return context.json(await repository().getCompletion({ workflowId, ...request }));
    } catch (error) {
      return routeError(context, error);
    }
  });

  routes.post("/active-missions/:workflowId/reward-contract", async (context) => {
    try {
      const request = requestContext(context, identity);
      const workflowId = validateUuid(context.req.param("workflowId"), "workflowId");
      const input = validateBackfillPayload(await body(context));
      return context.json(await repository().backfillRewardContract({
        workflowId,
        ...request,
        ...input,
      }));
    } catch (error) {
      return routeError(context, error);
    }
  });

  routes.post("/active-missions/:workflowId/completion", async (context) => {
    try {
      const request = requestContext(context, identity);
      const workflowId = validateUuid(context.req.param("workflowId"), "workflowId");
      const input = validateCompletionPayload(await body(context));
      return context.json(await repository().approveCompletion({
        workflowId,
        ...request,
        ...input,
      }));
    } catch (error) {
      return routeError(context, error);
    }
  });

  routes.post("/active-missions/:workflowId/reward-handoff/cancel", async (context) => {
    try {
      const request = requestContext(context, identity);
      const workflowId = validateUuid(context.req.param("workflowId"), "workflowId");
      const input = validateCancellationPayload(await body(context));
      return context.json(await repository().cancelRewardHandoff({
        workflowId,
        ...request,
        ...input,
      }));
    } catch (error) {
      return routeError(context, error);
    }
  });

  routes.get("/reward-handoffs", async (context) => {
    try {
      const request = requestContext(context, identity);
      const filters = normalizeListFilters({
        due: context.req.query("due"),
        component: context.req.query("component"),
        status: context.req.query("status"),
      });
      return context.json(await repository().listRewardHandoffs({ ...request, ...filters }));
    } catch (error) {
      return routeError(context, error);
    }
  });

  routes.put("/reward-handoffs/settings", async (context) => {
    try {
      const request = requestContext(context, identity);
      const input = validateSettingsPayload(await body(context));
      return context.json(await repository().updateSettings({ ...request, ...input }));
    } catch (error) {
      return routeError(context, error);
    }
  });

  return routes;
}

export const adminRewardHandoffRoutes = createAdminRewardHandoffRoutes();
