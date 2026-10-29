import type { SupabaseClient } from "@supabase/supabase-js";
import type { StaffIdentity } from "./staffAuth.js";
import type { AuthorizedWorkspace } from "./staffWorkspace.js";

export const STAFF_CAPABILITIES = ["creator.read", "creator.review", "application.review", "submission.review", "proof.review", "mission.manage", "completion.approve", "reward.read", "reward.settings", "access.manage"] as const;
export type StaffCapability = typeof STAFF_CAPABILITIES[number];
export type StaffWorkspaceRole = "workspace_admin" | "operator" | "reviewer" | "finance_viewer";
export type PlatformRole = "content_editor";
export type PlatformCapability = "content.manage";
export const ROLE_CAPABILITIES: Readonly<Record<StaffWorkspaceRole, readonly StaffCapability[]>> = {
  workspace_admin: STAFF_CAPABILITIES,
  operator: ["creator.read", "creator.review", "application.review", "submission.review", "proof.review", "completion.approve", "reward.read"],
  reviewer: ["creator.read", "submission.review", "proof.review"],
  finance_viewer: ["reward.read"],
};
export type WorkspaceAccess = { role: StaffWorkspaceRole; capabilities: readonly StaffCapability[]; revision: number };
export type StaffAccessSnapshot = {
  workspace: { id:string; slug:string; role:StaffWorkspaceRole|null; capabilities:readonly StaffCapability[]; revision:number|null } | null;
  platformCapabilities: readonly PlatformCapability[];
  scopeStatus: string|null;
};
export class StaffCapabilityError extends Error {
  constructor(public code: "STAFF_CAPABILITY_REQUIRED" | "STAFF_CAPABILITY_SCHEMA_REQUIRED" | "STAFF_CAPABILITY_UNAVAILABLE" | "STAFF_ROUTE_NOT_ALLOWED", public status: 403 | 503) { super(code); }
}
function databaseError(error: unknown): never {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  throw new StaffCapabilityError(["42P01", "PGRST205", "42883", "PGRST202"].includes(code) ? "STAFF_CAPABILITY_SCHEMA_REQUIRED" : "STAFF_CAPABILITY_UNAVAILABLE", 503);
}
/** Scope must come from the live staff and single-workspace membership gates. No JWT role or cache. */
export async function readWorkspaceAccess(client: SupabaseClient, scope: AuthorizedWorkspace): Promise<WorkspaceAccess | null> {
  let result;
  try { result = await client.from("staff_workspace_roles").select("user_id,workspace_id,role,active,revision").eq("user_id", scope.userId).eq("workspace_id", scope.workspaceId).eq("active", true).maybeSingle(); }
  catch (error) { databaseError(error); }
  if (result.error) databaseError(result.error);
  const row = result.data;
  if (!row || !row.active || row.user_id !== scope.userId || row.workspace_id !== scope.workspaceId || !Object.hasOwn(ROLE_CAPABILITIES, row.role)) return null;
  return { role: row.role as StaffWorkspaceRole, capabilities: ROLE_CAPABILITIES[row.role as StaffWorkspaceRole], revision: row.revision };
}
export async function requireCapability(client: SupabaseClient, scope: AuthorizedWorkspace, capability: StaffCapability | readonly StaffCapability[]): Promise<WorkspaceAccess> {
  const access = await readWorkspaceAccess(client, scope), wanted = typeof capability === "string" ? [capability] : capability;
  if (!access || !wanted.some(cap => access.capabilities.includes(cap))) throw new StaffCapabilityError("STAFF_CAPABILITY_REQUIRED", 403);
  return access;
}
export async function readPlatformCapabilities(client: SupabaseClient, staff: StaffIdentity): Promise<PlatformCapability[]> {
  if (!staff.userId || staff.active === false || staff.viaSecret) return [];
  let result;
  try { result = await client.from("staff_platform_roles").select("user_id,role,active").eq("user_id", staff.userId).eq("role", "content_editor").eq("active", true).maybeSingle(); }
  catch (error) { databaseError(error); }
  if (result.error) databaseError(result.error);
  return result.data?.user_id === staff.userId && result.data.active && result.data.role === "content_editor" ? ["content.manage"] : [];
}
export async function requirePlatformCapability(client: SupabaseClient, staff: StaffIdentity, capability: PlatformCapability) {
  if (!(await readPlatformCapabilities(client, staff)).includes(capability)) throw new StaffCapabilityError("STAFF_CAPABILITY_REQUIRED", 403);
}

type Requirement = { kind: "identity" | "membership" | "platform" | "deny" } | { kind: "workspace"; anyOf: readonly StaffCapability[] };
/** The mapping is exhaustive for mounted admin routes; new paths default to deny. */
export function staffRouteRequirement(method: string, path: string): Requirement {
  const workspace = (...anyOf: StaffCapability[]): Requirement => ({ kind: "workspace", anyOf });
  const identity: Requirement = { kind: "identity" }, platform: Requirement = { kind: "platform" };
  const rules: readonly [string, readonly string[], Requirement][] = [
    ["GET", ["me", "access"], identity],
    ["GET", ["workspaces"], { kind: "membership" }],
    ["GET", ["academy", "academy/:id", "academy/:id/lessons", "content", "content/:id", "content-categories", "content-tags"], platform],
    ["POST", ["academy", "academy/:id/publish", "academy/:id/unpublish", "academy/:id/archive", "academy/:id/lessons", "academy/:id/lessons/:lessonId/publish", "academy/:id/lessons/:lessonId/archive", "content", "content/:id/publish", "content/:id/unpublish", "content/:id/archive", "content/:id/schedule", "content/media"], platform],
    ["PATCH", ["academy/:id", "academy/:id/lessons/:lessonId", "content/:id"], platform],
    ["DELETE", ["academy/:id", "content/:id"], platform],
    ["GET", ["staff-access"], workspace("access.manage")],
    ["PUT", ["staff-access/:userId"], workspace("access.manage")],
    ["POST", ["brand-invites"], workspace("access.manage")],
    ["GET", ["creators/review", "creators/:id", "creators/:id/publication-proofs", "missions", "missions/:id", "missions/:id/activity", "missions/:id/shortlist", "campaigns", "campaigns/:id", "campaigns/:id/leaderboard", "engaged", "insights", "radar"], workspace("creator.read")],
    ["POST", ["creators/:id/review", "creators/:id/notes", "missions/:id/shortlist", "social/:id/verify"], workspace("creator.review")],
    ["PATCH", ["missions/:id/shortlist/:creatorId"], workspace("creator.review")],
    ["GET", ["applications"], workspace("application.review")],
    ["POST", ["applications/:id/accept", "applications/:id/decline"], workspace("application.review")],
    ["GET", ["submissions"], workspace("submission.review")],
    ["POST", ["assistant/mission-assist"], workspace("submission.review")],
    ["POST", ["submissions/:id/approve", "submissions/:id/reject", "submissions/:id/request-correction"], workspace("submission.review")],
    ["GET", ["active-missions/queue", "active-missions/:workflowId"], workspace("submission.review", "proof.review", "completion.approve")],
    ["POST", ["active-missions/:workflowId/work-items/:workItemId/start-review", "active-missions/:workflowId/work-items/:workItemId/request-revision", "active-missions/:workflowId/work-items/:workItemId/grant-revision", "active-missions/:workflowId/work-items/:workItemId/approve-to-publish", "active-missions/:workflowId/work-items/:workItemId/publication-setup"], workspace("submission.review")],
    ["PUT", ["active-missions/:workflowId/work-items/:workItemId/publication-instructions"], workspace("submission.review")],
    ["POST", ["active-missions/:workflowId/work-items/:workItemId/proof-review/start", "active-missions/:workflowId/work-items/:workItemId/proof-review/corrections", "active-missions/:workflowId/work-items/:workItemId/proof-review/verify", "active-missions/:workflowId/work-items/:workItemId/proofs/:attemptId/metadata-refresh"], workspace("proof.review")],
    ["GET", ["active-missions/:workflowId/completion"], workspace("completion.approve")],
    ["POST", ["active-missions/:workflowId/completion", "active-missions/:workflowId/reward-contract", "active-missions/:workflowId/reward-handoff/cancel", "active-missions/:workflowId/fulfillment/shipped", "reward-handoffs/:id/notifications/retry"], workspace("completion.approve")],
    ["GET", ["reward-handoffs"], workspace("reward.read")],
    ["PUT", ["reward-handoffs/settings"], workspace("reward.settings")],
    ["POST", ["reward-handoffs/:id/settle"], workspace("reward.settings")],
    ["POST", ["gifts/:id/codes"], workspace("reward.settings")],
    ["POST", ["missions", "missions/:id/publish", "missions/:id/close", "missions/:id/duplicate", "campaigns", "campaigns/:id/publish", "campaigns/:id/missions", "campaigns/:id/close", "campaigns/:id/settle"], workspace("mission.manage")],
    ["PATCH", ["missions/:id", "campaigns/:id"], workspace("mission.manage")],
    ["DELETE", ["missions/:id", "campaigns/:id/missions/:missionId"], workspace("mission.manage")],
  ];
  const parts = path.split("/").filter(Boolean), verb = method === "HEAD" ? "GET" : method;
  for (const [allowedMethod, paths, requirement] of rules) {
    if (verb !== allowedMethod) continue;
    for (const pattern of paths) {
      const segments = pattern.split("/");
      if (segments.length === parts.length && segments.every((part, i) => part.startsWith(":") || part === parts[i])) return requirement;
    }
  }
  return { kind: "deny" };
}
