import type { SupabaseClient } from "@supabase/supabase-js";
import type { Actor, IntegrationRepository } from "./types.js";
import type { OAuthStore, OAuthStateRecord } from "./oauth.js";
import { databaseFailure } from "./repo.js";

/** Durable service-only store; neither importing nor constructing it creates a client. */
export class RepositoryOAuthStore implements OAuthStore {
  constructor(private repo:IntegrationRepository,private client:Pick<SupabaseClient,"rpc">){}
  async start(actor:Actor,record:Omit<OAuthStateRecord,"actor">) {
    await this.repo.command(actor,crypto.randomUUID(),"oauth_start",record);
  }
  async callback(input:Parameters<OAuthStore["callback"]>[0]) {
    const result=await this.client.rpc("integration_oauth_callback",{p_state_hash:input.stateHash,p_provider:input.provider,p_ticket_hash:input.ticketHash,p_code:input.code,p_expires_at:input.ticketExpiresAt});
    if(result.error)databaseFailure(result.error);
  }
  async complete(actor:Actor,input:Parameters<OAuthStore["complete"]>[1]) {
    return await this.repo.command(actor,crypto.randomUUID(),"oauth_complete",input) as Awaited<ReturnType<OAuthStore["complete"]>>;
  }
}
