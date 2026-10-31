import type { SupabaseClient } from "@supabase/supabase-js";
import type { StudioSection, StudioSource } from "../../../src/lib/studio/types.js";
import { IntegrationError, integrationMode } from "./policy.js";
import { getIntegrationService } from "./runtime.js";
import type { IntegrationService } from "./service.js";
import type { Actor, IntegrationRecord, SourceUse } from "./types.js";

export function integrationReadable(provider: "instagram" | "google_drive", env: Record<string, string | undefined> = process.env): boolean {
  return integrationMode(env) === "mock" && env[provider === "instagram" ? "INSTAGRAM_CONNECTIONS_ENABLED" : "DRIVE_CONNECTIONS_ENABLED"] === "true";
}
export async function authorizeIntegrationSources(actor: Actor, sources: StudioSource[], use: SourceUse, commandPayload?: IntegrationRecord, service?: IntegrationService | null) {
  const integrated = sources.filter(source => source.integration);
  if (!integrated.length) return;
  if (integrated.some(source => !integrationReadable(source.integration!.provenance))) throw new IntegrationError("INTEGRATIONS_DISABLED", 403);
  const available = service === undefined ? getIntegrationService() : service;
  if (!available) throw new IntegrationError("INTEGRATIONS_DISABLED", 403);
  await available.authorizeSources(actor, integrated.map(source => source.id), use, commandPayload);
}

/** Resolve the canonical brief for sharing, never source IDs supplied by the client. */
export async function authorizeStudioCommand(client: Pick<SupabaseClient, "from">, actor: Actor, action: string, payload: IntegrationRecord, service?: IntegrationService | null) {
  if (action !== "save_brief" && action !== "share_brief") return;
  let sections = payload.sections as StudioSection[];
  if (action === "share_brief") {
    const brief = await client.from("studio_briefs").select("sections").eq("id", payload.briefId).eq("thread_id", payload.threadId)
      .eq("creator_id", actor.creatorId).eq("workspace_id", actor.workspaceId).maybeSingle();
    if (brief.error) throw new IntegrationError("SOURCE_UNAVAILABLE", 503);
    if (!brief.data) throw new IntegrationError("NOT_FOUND", 404);
    if (!Array.isArray(payload.sectionIds)) throw new IntegrationError("INVALID_SELECTION");
    sections = (brief.data.sections as StudioSection[]).filter(section => (payload.sectionIds as string[]).includes(section.id));
  }
  if (!Array.isArray(sections)) throw new IntegrationError("INVALID_INPUT");
  const ids = new Set(sections.flatMap(section => Array.isArray(section.sourceIds) ? section.sourceIds : []));
  if (!ids.size) return;
  // '*' remains backward compatible when the additive integration column is not installed.
  // Only the explicitly selected rows are passed to the permission service below.
  const sources = await client.from("studio_sources").select("*").eq("thread_id", payload.threadId)
    .eq("creator_id", actor.creatorId).eq("workspace_id", actor.workspaceId).limit(100);
  if (sources.error) throw new IntegrationError("SOURCE_UNAVAILABLE", 503);
  await authorizeIntegrationSources(actor, (sources.data ?? []).filter(source => ids.has(source.id)), action === "share_brief" ? "share" : "save_brief", payload, service);
}

export { redactRevokedIntegrationOutputs } from "../../../src/lib/studio/policy.js";
