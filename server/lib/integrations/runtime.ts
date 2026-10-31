import { serviceClient } from "../supabase.js";
import { CredentialVault } from "./credentials.js";
import { IntegrationError } from "./policy.js";
import { SupabaseIntegrationRepository } from "./repo.js";
import { IntegrationService } from "./service.js";
import { createMockProviders } from "./mockProviders.js";
import type { Actor, ConnectionRecord } from "./types.js";

let instance: IntegrationService | null = null;
/** Lazy by design: importing routes never creates a client or a provider connection. */
export function getIntegrationService(): IntegrationService | null {
  if (process.env.NODE_ENV === "production" || process.env.INTEGRATIONS_MODE !== "mock") return null;
  instance ??= new IntegrationService(new SupabaseIntegrationRepository(serviceClient()), createMockProviders(), new CredentialVault(crypto.getRandomValues(new Uint8Array(32)), "local-mock-process"));
  return instance;
}
/** A kill switch stops reads, never the owner's local revocation/deletion controls. No external HTTP. */
export async function manageDisabledConnection(actor: Actor, id: string, action: "revoke" | "purge", requestId: string) {
  const repo = new SupabaseIntegrationRepository(serviceClient()), connection = await repo.connection(actor, id);
  if (!connection) throw new IntegrationError("NOT_FOUND", 404);
  const revoked = await repo.command(actor, requestId, "revoke", { id, generation: connection.generation });
  const generation = (revoked.connection as ConnectionRecord).generation;
  await repo.command(actor, crypto.randomUUID(), "revoke_result", { id, generation, provider: "manual_action" });
  return action === "purge" ? repo.command(actor, crypto.randomUUID(), "purge", { id }) : { local: "revoked", provider: "manual_action" };
}
