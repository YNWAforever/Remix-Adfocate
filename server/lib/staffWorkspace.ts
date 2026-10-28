import type { SupabaseClient } from "@supabase/supabase-js";
import type { StaffIdentity } from "./staffAuth.js";

export type AuthorizedWorkspace = { workspaceId: string; workspaceSlug: string; userId: string };
export class StaffWorkspaceError extends Error {
  constructor(public code: "WORKSPACE_MEMBERSHIP_REQUIRED" | "WORKSPACE_UNAVAILABLE" | "NOT_FOUND", public status: 403 | 404 | 503) {
    super(code);
  }
}

/** One active membership per user is the current schema contract. No enrolment or grants. */
export async function requireStaffWorkspace(client: SupabaseClient, staff: StaffIdentity, requested = ""): Promise<AuthorizedWorkspace> {
  if (!staff?.userId || staff.viaSecret || staff.active === false) {
    throw new StaffWorkspaceError("WORKSPACE_MEMBERSHIP_REQUIRED", 403);
  }
  const { data, error } = await client.from("brand_users")
    .select("user_id, workspace_id, active, workspaces!brand_users_workspace_id_fkey!inner(id, slug)")
    .eq("user_id", staff.userId).eq("active", true).maybeSingle();
  if (error) throw new StaffWorkspaceError("WORKSPACE_UNAVAILABLE", 503);
  if (!data) throw new StaffWorkspaceError("WORKSPACE_MEMBERSHIP_REQUIRED", 403);
  const workspace = Array.isArray(data.workspaces) ? data.workspaces[0] : data.workspaces;
  if (!workspace || workspace.id !== data.workspace_id || typeof workspace.slug !== "string") {
    throw new StaffWorkspaceError("WORKSPACE_UNAVAILABLE", 503);
  }
  if (requested && requested !== data.workspace_id && requested !== workspace.slug) {
    throw new StaffWorkspaceError("NOT_FOUND", 404);
  }
  return { workspaceId: data.workspace_id, workspaceSlug: workspace.slug, userId: staff.userId };
}

export async function assertStaffResource(client: SupabaseClient, scope: AuthorizedWorkspace, table: string, id: string) {
  const { data, error } = await client.from(table).select("workspace_id").eq("id", id).maybeSingle();
  if (error) throw new StaffWorkspaceError("WORKSPACE_UNAVAILABLE", 503);
  if (!data || data.workspace_id !== scope.workspaceId) throw new StaffWorkspaceError("NOT_FOUND", 404);
}
