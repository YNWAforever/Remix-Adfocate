import type { EncryptedEnvelope } from "./credentials.js";
import type { Actor, IntegrationRepository } from "./types.js";

export type AcquiredRefreshLease = { status: "acquired"; leaseId: string; credentialVersion: number; credential: EncryptedEnvelope; expiresAt: string };
export type RefreshLeaseResult = AcquiredRefreshLease | { status: "busy" | "reauth_required" };

/** Each worker uses the repository fence; there is no process-local lock or retry. */
export class RepositoryRefreshLease {
  constructor(private repo: IntegrationRepository, private holderId: string) {}
  async acquire(actor: Actor, id: string, generation: number, leaseSeconds = 30): Promise<RefreshLeaseResult> {
    return await this.repo.command(actor, crypto.randomUUID(), "refresh_acquire", { id, generation, holderId: this.holderId, leaseSeconds }) as RefreshLeaseResult;
  }
  async commit(actor: Actor, id: string, generation: number, lease: Pick<AcquiredRefreshLease, "leaseId" | "credentialVersion">, credential: EncryptedEnvelope, expiresAt: string): Promise<{ credentialVersion: number }> {
    return await this.repo.command(actor, crypto.randomUUID(), "refresh_commit", { id, generation, leaseId: lease.leaseId, credentialVersion: lease.credentialVersion, credential, expiresAt }) as { credentialVersion: number };
  }
  async abandon(actor: Actor, id: string, generation: number, lease: Pick<AcquiredRefreshLease, "leaseId" | "credentialVersion">): Promise<{ status: "reauth_required" }> {
    return await this.repo.command(actor, crypto.randomUUID(), "refresh_abandon", { id, generation, leaseId: lease.leaseId, credentialVersion: lease.credentialVersion }) as { status: "reauth_required" };
  }
}
