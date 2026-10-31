import type { SupabaseClient } from "@supabase/supabase-js";
import { IntegrationError } from "./policy.js";
import type { Actor, ConnectionRecord, IntegrationRecord, IntegrationRepository, ResourceRecord } from "./types.js";

const statusFor = (code: string) => /NOT_FOUND/.test(code) ? 404 : /RATE_LIMITED/.test(code) ? 429 : /STALE|CHANGED|CONFLICT|PENDING/.test(code) ? 409 : /PRIVATE|UNAVAILABLE|CONSENT|SCOPE|PERMISSION|OAUTH_STATE|REAUTH_REQUIRED/.test(code) ? 403 : 400;
export function databaseFailure(error: {message?: string}): never {
  const code = error.message?.match(/^(NOT_FOUND|INVALID_INPUT|INVALID_SELECTION|INVALID_ACTION|INTEGRATIONS_DISABLED|OAUTH_STATE_INVALID|REAUTH_REQUIRED|STALE_CONNECTION|SCOPE_REQUIRED|SOURCE_UNAVAILABLE|SOURCE_PRIVATE|SOURCE_CHANGED|SOURCE_PERMISSION_REQUIRED|MODEL_CONSENT_REQUIRED|WORKFLOW_STALE|IDEMPOTENCY_CONFLICT|RATE_LIMITED|SYNC_PENDING|ACCOUNT_CHANGE_REQUIRES_REVOCATION|SOURCE_LIMIT)$/)?.[0];
  throw new IntegrationError(code ?? "INTEGRATIONS_UNAVAILABLE", code ? statusFor(code) : 503);
}
export class SupabaseIntegrationRepository implements IntegrationRepository {
  constructor(private client: Pick<SupabaseClient, "from" | "rpc">) {}
  async list(actor: Actor): Promise<ConnectionRecord[]> {
    const result = await this.client.from("integration_connections").select("id,workspace_id,creator_id,provider,generation,status,data")
      .eq("workspace_id", actor.workspaceId).eq("creator_id", actor.creatorId).order("id").limit(10);
    if (result.error) databaseFailure(result.error);
    return (result.data ?? []).map(row => this.connectionRecord(row));
  }
  private connectionRecord(row: Record<string, unknown>): ConnectionRecord {
    return { ...(row.data as ConnectionRecord), id: String(row.id), creatorId: String(row.creator_id), workspaceId: String(row.workspace_id), provider: row.provider as ConnectionRecord["provider"], generation: Number(row.generation), status: row.status as ConnectionRecord["status"] };
  }
  async connection(actor: Actor, id: string): Promise<ConnectionRecord | null> {
    const result = await this.client.from("integration_connections").select("id,workspace_id,creator_id,provider,generation,status,data")
      .eq("id", id).eq("workspace_id", actor.workspaceId).eq("creator_id", actor.creatorId).maybeSingle();
    if (result.error) databaseFailure(result.error);
    return result.data ? this.connectionRecord(result.data) : null;
  }
  async resources(actor: Actor, id: string): Promise<ResourceRecord[]> {
    const connection = await this.connection(actor, id); if (!connection) return [];
    const result = await this.client.from("integration_resources").select("id,connection_id,workspace_id,creator_id,generation,snapshot_id,data")
      .eq("connection_id", id).eq("workspace_id", actor.workspaceId).eq("creator_id", actor.creatorId).eq("generation", connection.generation).order("id").limit(100);
    if (result.error) databaseFailure(result.error);
    return (result.data ?? []).map(row => ({ ...(row.data as ResourceRecord), id: row.id, connectionId: row.connection_id, creatorId: row.creator_id, workspaceId: row.workspace_id, generation: row.generation, snapshotId: row.snapshot_id }));
  }
  async resourceIdentities(actor: Actor, id: string, externalIds: string[]): Promise<Array<Pick<ResourceRecord, "id" | "externalId">>> {
    if (!externalIds.length) return [];
    const selected = [...new Set(externalIds)];
    const result = await this.client.from("integration_resources").select("id,externalId:data->>externalId")
      .eq("connection_id", id).eq("workspace_id", actor.workspaceId).eq("creator_id", actor.creatorId)
      .in("data->>externalId", selected).order("id").limit(selected.length);
    if (result.error) databaseFailure(result.error);
    return (result.data ?? []).map(row => ({ id: String(row.id), externalId: String(row.externalId) }));
  }
  async command(actor: Actor, requestId: string, action: string, payload: IntegrationRecord): Promise<IntegrationRecord> {
    const result = await this.client.rpc("integration_command", { p_workspace: actor.workspaceId, p_creator: actor.creatorId, p_request: requestId, p_action: action, p_payload: payload });
    if (result.error) databaseFailure(result.error);
    return result.data as IntegrationRecord;
  }
}
