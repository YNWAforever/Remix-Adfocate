import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllPages } from "../queryPaging.js";
import { IntegrationError } from "./policy.js";
import { SupabaseIntegrationRepository } from "./repo.js";
import type { Actor } from "./types.js";
import { connectionDTO } from "./service.js";
import type { ConnectionRecord } from "./types.js";

const TABLES = ["integration_connections", "integration_resources", "integration_snapshots", "integration_sync_runs", "integration_events"];
function scrubCredentials(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrubCredentials);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => !/^(access_?token|refresh_?token|ciphertext|credential|credentials|stateHash|sessionHash|authorization)$/i.test(key)).map(([key, item]) => [key, scrubCredentials(item)]));
  return value;
}
const missingTable = (error: unknown) => error && typeof error === "object" && "code" in error && ["42P01", "PGRST205"].includes(String(error.code));

/** Connection management remains discoverable with reads disabled; never loads credentials. */
export async function listManagedConnections(client: Pick<SupabaseClient, "from">, actor: Actor) {
  const result = await client.from("integration_connections").select("id,provider,generation,status,data")
    .eq("creator_id", actor.creatorId).eq("workspace_id", actor.workspaceId).order("id").limit(10);
  if (result.error) { if (missingTable(result.error)) return []; throw new IntegrationError("INTEGRATIONS_UNAVAILABLE", 503); }
  return (result.data ?? []).map(row => connectionDTO({ ...row.data, ...actor, id: row.id, provider: row.provider, generation: row.generation, status: row.status } as ConnectionRecord));
}

export async function exportIntegrationData(client: Pick<SupabaseClient, "from">, actor: Actor, enabled: boolean): Promise<Record<string, unknown[]>> {
  const output: Record<string, unknown[]> = {};
  for (const table of TABLES) {
    const result = await fetchAllPages((from, to) => client.from(table).select("*").eq("creator_id", actor.creatorId).eq("workspace_id", actor.workspaceId).order(table === "integration_sync_runs" ? "request_id" : "id").range(from, to));
    if (result.error) { if (!enabled && missingTable(result.error)) continue; throw new IntegrationError("EXPORT_UNAVAILABLE", 503); }
    output[table] = scrubCredentials(result.data) as unknown[];
  }
  return output;
}

/** Stops local usage before the existing anonymisation transaction; no provider request occurs. */
export async function stopAccountIntegrations(client: Pick<SupabaseClient, "from" | "rpc">, actor: Actor, enabled: boolean) {
  const result = await client.from("integration_connections").select("id,generation,status").eq("creator_id", actor.creatorId).eq("workspace_id", actor.workspaceId);
  if (result.error) { if (!enabled && missingTable(result.error)) return; throw new IntegrationError("DELETION_INCOMPLETE", 503); }
  const repo = new SupabaseIntegrationRepository(client);
  for (const row of result.data ?? []) if (row.status !== "revoked") await repo.command(actor, crypto.randomUUID(), "revoke", { id: row.id, generation: row.generation });
}
