import { Hono, type Context } from "hono";
import { randomUUID } from "node:crypto";
import type { Env } from "../app.js";
import { CreatorStudioError } from "../lib/creatorStudio/errors.js";
import type { CreatorStudioRepository } from "../lib/creatorStudio/repository.js";
import { isStrictHttpUrl } from "../lib/creatorStudio/types.js";
import { recordCreatorStudioEvent, type CreatorStudioMetricsSink } from "../lib/creatorStudio/metrics.js";
import type {
  CreateUploadGrantInput,
  FinalizeAssetInput,
  SaveDraftInput,
  SubmitWorkItemInput,
} from "../lib/creatorStudio/types.js";

export type CreatorStudioRouteDeps = {
  repositoryForRequest: (context: Context<Env>) => CreatorStudioRepository;
  metricsSink?: CreatorStudioMetricsSink;
};

const conflictCodes = new Set(["command_conflict", "version_conflict", "invalid_transition", "asset_finalized"]);
const constraintCodes = new Set([
  "command_required", "draft_invalid", "file_not_allowed", "file_too_large", "asset_not_uploaded",
]);
const safeWorkspaceReadError = "Unable to load Creator Studio workspace";

type JsonRecord = Record<string, unknown>;

const invalidCommand = (message = "Invalid Creator Studio command") => new CreatorStudioError("draft_invalid", message);
const isRecord = (value: unknown): value is JsonRecord => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const hasOnlyKeys = (value: JsonRecord, allowed: string[]) => Object.keys(value).every((key) => allowed.includes(key));
async function requestJson(c: Context<Env>): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw invalidCommand();
  }
}

function commandId(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 128) throw invalidCommand();
  return value;
}

function expectedVersion(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 0) throw invalidCommand();
  return value as number;
}

function parsePatch(value: unknown): SaveDraftInput["patch"] {
  if (!isRecord(value) || !hasOnlyKeys(value, ["caption", "external_url", "checklist"])) throw invalidCommand();
  if (value.caption !== undefined && typeof value.caption !== "string") throw invalidCommand();
  if (value.external_url !== undefined && value.external_url !== null) {
    if (typeof value.external_url !== "string" || !isStrictHttpUrl(value.external_url)) throw invalidCommand();
  }
  if (value.checklist !== undefined) {
    if (!isRecord(value.checklist) || !Object.values(value.checklist).every((entry) => typeof entry === "boolean")) {
      throw invalidCommand();
    }
  }
  return {
    ...(value.caption === undefined ? {} : { caption: value.caption }),
    ...(value.external_url === undefined ? {} : { externalUrl: value.external_url as string | null }),
    ...(value.checklist === undefined ? {} : { checklist: value.checklist as Record<string, boolean> }),
  };
}

function parseSaveDraft(value: unknown): SaveDraftInput {
  if (!isRecord(value) || !hasOnlyKeys(value, ["command_id", "expected_version", "patch"])) throw invalidCommand();
  return { commandId: commandId(value.command_id), expectedVersion: expectedVersion(value.expected_version), patch: parsePatch(value.patch) };
}

function parseUploadGrant(value: unknown): CreateUploadGrantInput {
  if (!isRecord(value) || !hasOnlyKeys(value, ["command_id", "file_name", "mime_type", "byte_size"])) throw invalidCommand();
  if (typeof value.file_name !== "string" || !value.file_name.trim() || value.file_name.length > 255
    || typeof value.mime_type !== "string" || !Number.isInteger(value.byte_size)) throw invalidCommand();
  return { commandId: commandId(value.command_id), fileName: value.file_name, mimeType: value.mime_type, byteSize: value.byte_size as number };
}

function parseFinalize(value: unknown): FinalizeAssetInput {
  if (!isRecord(value) || !hasOnlyKeys(value, ["command_id", "byte_size", "mime_type", "checksum_sha256"])) throw invalidCommand();
  if (typeof value.mime_type !== "string" || !Number.isInteger(value.byte_size)
    || (value.checksum_sha256 !== null && (typeof value.checksum_sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(value.checksum_sha256)))) {
    throw invalidCommand();
  }
  return {
    commandId: commandId(value.command_id), byteSize: value.byte_size as number, mimeType: value.mime_type,
    checksumSha256: value.checksum_sha256 as string | null,
  };
}

function parseSubmit(value: unknown): SubmitWorkItemInput {
  if (!isRecord(value) || !hasOnlyKeys(value, ["command_id", "expected_version"])) throw invalidCommand();
  return { commandId: commandId(value.command_id), expectedVersion: expectedVersion(value.expected_version) };
}

function safeDatabaseError(c: Context<Env>, correlationId = randomUUID()) {
  return c.json({ error: safeWorkspaceReadError, code: "db_error", correlationId }, 500);
}

function errorResponse(c: Context<Env>, error: CreatorStudioError) {
  if (error.code === "submission_not_found" || error.code === "work_item_not_found" || error.code === "asset_not_found") {
    return c.json({ error: error.code, code: error.code }, 404);
  }
  if (conflictCodes.has(error.code)) return c.json({ error: error.publicMessage, code: error.code }, 409);
  if (constraintCodes.has(error.code)) return c.json({ error: error.publicMessage, code: error.code }, 422);
  return safeDatabaseError(c, error.correlationId);
}

export function createCreatorStudioRoutes(deps: CreatorStudioRouteDeps): Hono<Env> {
  const routes = new Hono<Env>();

  const requestContext = (c: Context<Env>) => ({
    actorId: c.get("userId"),
    workspaceId: c.get("workspaceId"),
    submissionId: c.req.param("submissionId"),
  });

  const record = (
    name: "workspace_opened" | "changes_viewed",
    c: Context<Env>,
    workItemId?: string,
  ) => recordCreatorStudioEvent({
    name,
    workspaceId: c.get("workspaceId"),
    submissionId: c.req.param("submissionId"),
    ...(workItemId ? { workItemId } : {}),
    createdAt: new Date().toISOString(),
  }, deps.metricsSink);

  const runCommand = async <T>(c: Context<Env>, command: () => Promise<{ value: T; replayed: boolean }>) => {
    try {
      const result = await command();
      return c.json({ ...(result.value as Record<string, unknown>), replayed: result.replayed });
    } catch (error) {
      if (error instanceof CreatorStudioError) return errorResponse(c, error);
      const correlationId = randomUUID();
      console.error("Creator Studio route command failed", { correlationId, error });
      return safeDatabaseError(c, correlationId);
    }
  };

  routes.get("/:submissionId/workspace", async (c) => {
    try {
      const workspace = await deps.repositoryForRequest(c).getWorkspace({
        actorId: c.get("userId"),
        workspaceId: c.get("workspaceId"),
        submissionId: c.req.param("submissionId"),
      });
      if (!workspace) return c.json({ error: "submission_not_found", code: "submission_not_found" }, 404);
      record("workspace_opened", c);
      for (const item of workspace.workItems) {
        if (item.reviewFeedback.status === "available" && item.reviewFeedback.value.some((feedback) => feedback.state === "changes_requested")) {
          record("changes_viewed", c, item.id);
        }
      }
      return c.json(workspace);
    } catch (error) {
      if (error instanceof CreatorStudioError) return errorResponse(c, error);
      const correlationId = randomUUID();
      console.error("Creator Studio route read failed", { correlationId, error });
      return safeDatabaseError(c, correlationId);
    }
  });

  routes.patch("/:submissionId/work-items/:workItemId/draft", async (c) => runCommand(c, async () => {
    const input = parseSaveDraft(await requestJson(c));
    return deps.repositoryForRequest(c).saveDraft(requestContext(c), c.req.param("workItemId"), input);
  }));

  routes.post("/:submissionId/work-items/:workItemId/assets/upload-grant", async (c) => runCommand(c, async () => {
    const input = parseUploadGrant(await requestJson(c));
    return deps.repositoryForRequest(c).createUploadGrant(requestContext(c), c.req.param("workItemId"), input);
  }));

  routes.post("/:submissionId/work-items/:workItemId/assets/:assetId/finalize", async (c) => runCommand(c, async () => {
    const input = parseFinalize(await requestJson(c));
    return deps.repositoryForRequest(c).finalizeAsset(requestContext(c), c.req.param("workItemId"), c.req.param("assetId"), input);
  }));

  routes.post("/:submissionId/work-items/:workItemId/submit", async (c) => runCommand(c, async () => {
    const input = parseSubmit(await requestJson(c));
    return deps.repositoryForRequest(c).submitWorkItem(requestContext(c), c.req.param("workItemId"), input);
  }));

  return routes;
}
