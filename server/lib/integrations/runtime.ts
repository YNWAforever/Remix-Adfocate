import { serviceClient } from "../supabase.js";
import { CredentialVault } from "./credentials.js";
import { IntegrationError } from "./policy.js";
import { SupabaseIntegrationRepository } from "./repo.js";
import { IntegrationService } from "./service.js";
import { createMockProviders } from "./mockProviders.js";
import type { Actor, ConnectionRecord } from "./types.js";
import { PRODUCT_HOSTING_PROJECT_IDS, PRODUCT_SUPABASE_PROJECT_REF } from "./pilotPolicy.js";

let instance: IntegrationService | null = null;
/** A pilot stage can only close this D0 factory. It cannot authorize a real provider. */
export function getIntegrationRuntimeStage(env: Record<string, string | undefined> = process.env): "D0" | "D1" | "disabled" {
  // Absence retains the original product's D0 fixture/local-management contract.
  // A dedicated pilot entry must enforce its own required D1 package marker.
  return env.INTEGRATIONS_PILOT_STAGE === undefined || env.INTEGRATIONS_PILOT_STAGE === "D0" ? "D0"
    : env.INTEGRATIONS_PILOT_STAGE === "D1" ? "D1" : "disabled";
}
function productDatabaseConfigured() {
  try { return new URL(process.env.SUPABASE_URL ?? "").hostname.toLowerCase() === `${PRODUCT_SUPABASE_PROJECT_REF}.supabase.co`; }
  catch { return false; }
}
/** Lazy by design: importing routes never creates a client or a provider connection. */
export function getIntegrationService(): IntegrationService | null {
  if (getIntegrationRuntimeStage() !== "D0" || productDatabaseConfigured() || PRODUCT_HOSTING_PROJECT_IDS.includes(process.env.VERCEL_PROJECT_ID ?? "")
    || process.env.NODE_ENV === "production" || process.env.INTEGRATIONS_MODE !== "mock") return null;
  instance ??= new IntegrationService(new SupabaseIntegrationRepository(serviceClient()), createMockProviders(), new CredentialVault(crypto.getRandomValues(new Uint8Array(32)), "local-mock-process"));
  return instance;
}
/** A kill switch stops reads, never the owner's local revocation/deletion controls. No external HTTP. */
export async function manageDisabledConnection(actor: Actor, id: string, action: "revoke" | "purge", requestId: string) {
  if (getIntegrationRuntimeStage() !== "D0") throw new IntegrationError("PILOT_APPROVAL_REQUIRED", 503);
  const repo = new SupabaseIntegrationRepository(serviceClient()), connection = await repo.connection(actor, id);
  if (!connection) throw new IntegrationError("NOT_FOUND", 404);
  const revoked = await repo.command(actor, requestId, "revoke", { id, generation: connection.generation });
  const generation = (revoked.connection as ConnectionRecord).generation;
  await repo.command(actor, crypto.randomUUID(), "revoke_result", { id, generation, provider: "manual_action" });
  return action === "purge" ? repo.command(actor, crypto.randomUUID(), "purge", { id }) : { local: "revoked", provider: "manual_action" };
}
