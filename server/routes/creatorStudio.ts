import { Hono, type Context } from "hono";
import type { Env } from "../app.js";
import { CreatorStudioError } from "../lib/creatorStudio/errors.js";
import type { CreatorStudioRepository } from "../lib/creatorStudio/repository.js";

export type CreatorStudioRouteDeps = {
  repositoryForRequest: (context: Context<Env>) => CreatorStudioRepository;
};

const conflictCodes = new Set(["command_conflict", "version_conflict", "invalid_transition", "asset_finalized"]);
const constraintCodes = new Set([
  "command_required", "draft_invalid", "file_not_allowed", "file_too_large", "asset_not_uploaded",
]);

function errorResponse(c: Context<Env>, error: CreatorStudioError) {
  if (error.code === "submission_not_found" || error.code === "work_item_not_found" || error.code === "asset_not_found") {
    return c.json({ error: error.code, code: error.code }, 404);
  }
  if (conflictCodes.has(error.code)) return c.json({ error: error.publicMessage, code: error.code }, 409);
  if (constraintCodes.has(error.code)) return c.json({ error: error.publicMessage, code: error.code }, 422);
  return c.json({ error: error.publicMessage, code: error.code, ...(error.correlationId ? { correlationId: error.correlationId } : {}) }, 500);
}

export function createCreatorStudioRoutes(deps: CreatorStudioRouteDeps): Hono<Env> {
  const routes = new Hono<Env>();

  routes.get("/:submissionId/workspace", async (c) => {
    try {
      const workspace = await deps.repositoryForRequest(c).getWorkspace({
        actorId: c.get("userId"),
        workspaceId: c.get("workspaceId"),
        submissionId: c.req.param("submissionId"),
      });
      if (!workspace) return c.json({ error: "submission_not_found", code: "submission_not_found" }, 404);
      return c.json(workspace);
    } catch (error) {
      if (error instanceof CreatorStudioError) return errorResponse(c, error);
      return c.json({ error: "repository read failed", code: "db_error" }, 500);
    }
  });

  return routes;
}
