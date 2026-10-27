/** Public decision facts shared by discovery, matching and onboarding.
 * Keep nullable values as stored; selecting no fact must not invent a promise. */
export const MISSION_LIST_SELECT = "id, slug, title, description, category, mission_type, access_type, points_reward, cash_reward, required_level, platforms, deliverables, effort, deadline, quota, filled, status, creator_workflow_mode, workspaces(name)";

export function serializeMission(value: Record<string, unknown>) {
  const { workspaces, ...mission } = value as Record<string, unknown> & { workspaces?: { name?: string } | null };
  return { ...mission, brand: workspaces?.name ?? null };
}
