import { createHash } from "node:crypto";
import type { PublishActor } from "./publishRepo.js";

export class PublishSessionError extends Error {
  readonly code = "PUBLISH_SESSION_REQUIRED";
  constructor() { super("PUBLISH_SESSION_REQUIRED"); this.name = "PublishSessionError"; }
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const validId = (value: unknown): value is string => typeof value === "string" && uuid.test(value);

/**
 * Use ONLY after workspaceAuth has verified this exact JWT through auth.getUser.
 * This is a projection of verified claims, NOT JWT signature/authentication logic.
 * A stable Supabase session_id keeps refresh within one session from breaking a
 * preview, while a new login receives a different session binding. No raw token
 * or session identifier is stored in the publication repository.
 */
export function publishActorFromVerifiedSession(identity: Readonly<{
  workspaceId: string; creatorId: string; verifiedJwt: string;
}>): PublishActor {
  try {
    if (!validId(identity.workspaceId) || !validId(identity.creatorId)
      || typeof identity.verifiedJwt !== "string" || identity.verifiedJwt.length > 16_384) throw new PublishSessionError();
    const parts = identity.verifiedJwt.split(".");
    if (parts.length !== 3 || !parts.every((part) => part.length > 0 && /^[A-Za-z0-9_-]+$/.test(part))) throw new PublishSessionError();
    const claims: unknown = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (!claims || typeof claims !== "object" || Array.isArray(claims)) throw new PublishSessionError();
    const { sub, session_id: sessionId } = claims as Record<string, unknown>;
    if (sub !== identity.creatorId || !validId(sessionId)) throw new PublishSessionError();
    const sessionHash = createHash("sha256")
      .update(["kocmax:publish-session:v1", identity.workspaceId, identity.creatorId, sessionId].join("\0"))
      .digest("hex");
    return { workspaceId: identity.workspaceId, creatorId: identity.creatorId, sessionHash };
  } catch {
    // Parsing errors may contain request bytes; never return their diagnostics.
    throw new PublishSessionError();
  }
}
