import type { ContentfulStatusCode } from "hono/utils/http-status";
import { Hono } from "hono";
import type { Env } from "../app.js";
import { ActiveMissionError, statusFor } from "../lib/activeMission/errors.js";
import {
  validateFinalizeInput,
  validateSubmitInput,
  validateUploadGrantInput,
} from "../lib/activeMission/creatorActions.js";
import { validateProofEvidenceFinalizeInput, validateProofEvidenceUploadInput } from "../lib/activeMission/publicationProof.js";
import {
  createActiveMissionRepository,
  type ActiveMissionOwner,
  type ActiveMissionRepository,
  type DraftSaveInput,
} from "../lib/activeMission/repo.js";
import { serviceClient } from "../lib/supabase.js";

function errorResponse(c: Parameters<Parameters<Hono<Env>["onError"]>[0]>[1], error: unknown) {
  if (error instanceof ActiveMissionError) {
    const details = error.details && typeof error.details === "object" && !Array.isArray(error.details)
      ? error.details as Record<string, unknown>
      : {};
    return c.json(
      { error: error.message, code: error.code, ...details },
      statusFor(error.code) as ContentfulStatusCode,
    );
  }
  return c.json({ error: "Active mission request failed", code: "UNKNOWN" }, 500);
}

export function createActiveMissionRoutes(injectedRepository?: ActiveMissionRepository) {
  const routes = new Hono<Env>();
  const repository = () => injectedRepository ?? createActiveMissionRepository(serviceClient());
  const owner = (c: { req: { param(name: string): string }; get(name: "userId" | "workspaceId"): string }): ActiveMissionOwner => ({
    submissionId: c.req.param("submissionId"),
    creatorId: c.get("userId"),
    workspaceId: c.get("workspaceId"),
  });

  routes.get("/:submissionId/workspace", async (c) => {
    try {
      return c.json(await repository().getWorkspace(owner(c)));
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  routes.patch("/:submissionId/work-items/:workItemId/draft", async (c) => {
    try {
      let input: DraftSaveInput;
      try {
        input = await c.req.json<DraftSaveInput>();
      } catch {
        throw new ActiveMissionError("VALIDATION_FAILED", "Request body must be valid JSON");
      }
      if (input === null || typeof input !== "object" || Array.isArray(input)) {
        throw new ActiveMissionError("VALIDATION_FAILED", "Request body must be a JSON object");
      }

      const draft = await repository().saveDraft({
        ...owner(c),
        workItemId: c.req.param("workItemId"),
      }, input);
      return c.json({ draft });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  routes.post("/:submissionId/publication/:workItemId/assets/upload-grant", async (c) => {
    try {
      const body = await c.req.json().catch(() => { throw new ActiveMissionError("VALIDATION_FAILED", "Request body must be valid JSON"); });
      const result = await (repository() as any).createProofEvidenceUploadGrant({ ...owner(c), workItemId: c.req.param("workItemId") }, validateProofEvidenceUploadInput(body));
      return c.json(result);
    } catch (error) { return errorResponse(c, error); }
  });

  routes.post("/:submissionId/publication/:workItemId/assets/:assetId/finalize", async (c) => {
    try {
      const body = await c.req.json().catch(() => { throw new ActiveMissionError("VALIDATION_FAILED", "Request body must be valid JSON"); });
      const asset = await (repository() as any).finalizeProofEvidence({ ...owner(c), workItemId: c.req.param("workItemId"), assetId: c.req.param("assetId") }, validateProofEvidenceFinalizeInput(body));
      return c.json({ asset });
    } catch (error) { return errorResponse(c, error); }
  });

  routes.post("/:submissionId/work-items/:workItemId/assets/upload-grant", async (c) => {
    try {
      const body = await c.req.json().catch(() => { throw new ActiveMissionError("VALIDATION_FAILED", "Request body must be valid JSON"); });
      const result = await repository().createUploadGrant(
        { ...owner(c), workItemId: c.req.param("workItemId") },
        validateUploadGrantInput(body),
      );
      return c.json(result);
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  routes.post("/:submissionId/work-items/:workItemId/assets/:assetId/finalize", async (c) => {
    try {
      const body = await c.req.json().catch(() => { throw new ActiveMissionError("VALIDATION_FAILED", "Request body must be valid JSON"); });
      const asset = await repository().finalizeAsset(
        { ...owner(c), workItemId: c.req.param("workItemId"), assetId: c.req.param("assetId") },
        validateFinalizeInput(body),
      );
      return c.json({ asset });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  routes.post("/:submissionId/work-items/:workItemId/submit", async (c) => {
    try {
      const body = await c.req.json().catch(() => { throw new ActiveMissionError("VALIDATION_FAILED", "Request body must be valid JSON"); });
      const input = validateSubmitInput(body, c.req.header("Idempotency-Key"));
      const result = await repository().submitDraft(
        { ...owner(c), workItemId: c.req.param("workItemId") },
        input,
      );
      return c.json(result);
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  routes.post("/:submissionId/fulfillment/received", async (c) => {
    try {
      const workflow = await repository().receiveFulfillment(owner(c));
      return c.json({ workflow });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  return routes;
}

export const activeMissionRoutes = createActiveMissionRoutes();
