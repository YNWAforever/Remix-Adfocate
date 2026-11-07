import type { StudioSource } from "../../../src/lib/studio/types.js";
import { IntegrationError, SYNC_COOLDOWN_MS, validateReturnPath } from "./policy.js";
import type { Actor, ConnectionRecord, IntegrationRecord, IntegrationRepository, ResourceRecord } from "./types.js";
import type { OAuthCallbackBuffer, OAuthStateLookup } from "./repo.js";
import type { EncryptedEnvelope } from "./credentials.js";

type MemoryHooks = {
  importSources?: (actor: Actor, payload: IntegrationRecord, sources: StudioSource[]) => void;
  revokeSources?: (actor: Actor, sourceIds: string[]) => void;
  purgeSources?: (actor: Actor, sourceIds: string[]) => void;
};
const owner = (actor: Actor) => `${actor.workspaceId}:${actor.creatorId}`;
const copy = <T>(value: T): T => structuredClone(value);
const same = (row: Actor, actor: Actor) => owner(row) === owner(actor);
type PilotBinding = Actor & { id: string; connectionId: string; generation: number; provider: string; grantKey: string; apiVersion: string; activated: boolean };
type PilotOAuth = { secret: EncryptedEnvelope | null; ticketHash?: string; code?: EncryptedEnvelope | null; ticketExpiresAt?: number; completed?: boolean };
const hashPattern = /^[a-f0-9]{64}$/;
function envelope(value: unknown): value is EncryptedEnvelope {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return Object.keys(row).length === 3 && ["keyId", "iv", "ciphertext"].every(key => typeof row[key] === "string" && !!row[key]) && JSON.stringify(row).length <= 16384;
}
function safeEvidence(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as IntegrationRecord;
  if (Object.keys(row).some(key => !["apiVersion", "endpoint", "measurementPeriod", "selectionPeriod", "permalink"].includes(key)) || ["apiVersion", "endpoint", "measurementPeriod"].some(key => typeof row[key] !== "string" || !String(row[key]).length || String(row[key]).length > 300)) return false;
  if (row.permalink !== undefined && (typeof row.permalink !== "string" || row.permalink.length > 2000 || !row.permalink.startsWith("https://"))) return false;
  if (row.selectionPeriod !== undefined) {
    const period = row.selectionPeriod as IntegrationRecord;
    if (!period || typeof period !== "object" || Object.keys(period).some(key => !["start", "end"].includes(key)) || ["start", "end"].some(key => typeof period[key] !== "string" || !Number.isFinite(Date.parse(String(period[key]))))) return false;
  }
  return true;
}

/** In-process repository for local examples/tests only; not used by the production entry. */
export class MemoryIntegrationRepository implements IntegrationRepository {
  private connections = new Map<string, ConnectionRecord>();
  private resourceRows = new Map<string, ResourceRecord>();
  private credentials = new Map<string, unknown>();
  private credentialGenerations = new Map<string, number>();
  private revokedAt = new Map<string, number>();
  private states = new Map<string, { actor: Actor; sessionHash: string; provider: string; expiresAt: string; expectedGeneration: number; returnPath: string; used: boolean }>();
  private receipts = new Map<string, { fingerprint: string; result: IntegrationRecord }>();
  private runs = new Map<string, { fingerprint: string; connectionId: string; generation: number; result: IntegrationRecord | null }>();
  private sourceRows = new Map<string, { actor: Actor; source: StudioSource }>();
  private permits = new Map<string, { actor: Actor; sourceId: string; use: string; fingerprint: string; generation: number; expiresAt: number }>();
  private pilotBindings = new Map<string, PilotBinding>();
  private pilotGrants = new Map<string, "active" | "pending" | "manual_action" | "confirmed">();
  private pilotOAuth = new Map<string, PilotOAuth>();
  private credentialVersions = new Map<string, number>();
  private refreshLeases = new Map<string, { leaseId: string; generation: number; credentialVersion: number; expiresAt: number }>();
  private pilotQueue: Promise<unknown> = Promise.resolve();
  private maintenanceLeases = new Map<string, { leaseId: string; expiresAt: number }>();
  constructor(private clock: () => Date = () => new Date(), private hooks: MemoryHooks = {}) {}
  async list(actor: Actor) { return copy([...this.connections.values()].filter(row => same(row, actor))); }
  async connection(actor: Actor, id: string) { const row = this.connections.get(id); return row && same(row, actor) ? copy(row) : null; }
  async resources(actor: Actor, id: string) {
    const connection = await this.connection(actor, id);
    return connection ? copy([...this.resourceRows.values()].filter(row => same(row, actor) && row.connectionId === id && row.generation === connection.generation)) : [];
  }
  async resourceIdentities(actor: Actor, id: string, externalIds: string[]) {
    const selected = new Set(externalIds);
    return [...this.resourceRows.values()].filter(row => same(row, actor) && row.connectionId === id && selected.has(row.externalId))
      .map(row => ({ id: row.id, externalId: row.externalId }));
  }
  private owned(actor: Actor, id: unknown, generation?: unknown, active = true) {
    const connection = this.connections.get(String(id));
    if (!connection || !same(connection, actor)) throw new IntegrationError("NOT_FOUND", 404);
    if ((generation !== undefined && connection.generation !== generation) || (active && connection.status === "revoked")) throw new IntegrationError("STALE_CONNECTION", 409);
    if (active && connection.status === "reauth_required") throw new IntegrationError("REAUTH_REQUIRED", 403);
    return connection;
  }
  /** Mirrors an already-applied canonical Studio revocation, without firing its hooks again. */
  revokeSource(actor: Actor, sourceId: string): void {
    const row = this.sourceRows.get(sourceId);
    if (!row || !same(row.actor, actor)) throw new IntegrationError("NOT_FOUND", 404);
    row.source.revoked_at ??= this.clock().toISOString();
    row.source.shareable = false;
    if (row.source.integration) { row.source.integration.model_allowed = false; row.source.integration.availability = "revoked"; }
    for (const [id, permit] of this.permits) if (same(permit.actor, actor) && permit.sourceId === sourceId) this.permits.delete(id);
  }
  private exclusive<T>(run: () => Promise<T>): Promise<T> {
    const task = this.pilotQueue.then(run);
    this.pilotQueue = task.catch(() => undefined);
    return task;
  }
  private currentBinding(row: ConnectionRecord) {
    return [...this.pilotBindings.values()].find(b => b.connectionId === row.id && b.generation === (row.status === "revoked" ? row.generation - 1 : row.generation) && b.activated);
  }
  private pilotMetadata(binding?: PilotBinding) {
    return { sampleOnly: !binding, mode: binding ? "live_pilot" : "mock", acquisitionMethod: binding ? "provider_api" : "mock", apiVersion: binding?.apiVersion ?? null, claimVerification: "unverified" };
  }
  async lookupOAuthState(stateHash: string, provider: string): Promise<OAuthStateLookup> {
    const state = this.states.get(stateHash), secret = this.pilotOAuth.get(stateHash);
    const current = [...this.connections.values()].find(row => state && same(row, state.actor) && row.provider === provider);
    if (!state || !secret?.secret || secret.completed || state.used || state.provider !== provider || Date.parse(state.expiresAt) <= this.clock().getTime() || (current?.generation ?? 0) !== state.expectedGeneration) throw new IntegrationError("OAUTH_STATE_INVALID", 403);
    return { actor: copy(state.actor), expectedGeneration: state.expectedGeneration, returnPath: state.returnPath, expiresAt: state.expiresAt };
  }
  async bufferOAuthCallback(input: OAuthCallbackBuffer): Promise<{ stored: true }> {
    return this.exclusive(async () => {
      await this.lookupOAuthState(input.stateHash, input.provider);
      const state = this.states.get(input.stateHash)!, row = this.pilotOAuth.get(input.stateHash)!;
      const expiry = Date.parse(input.expiresAt), now = this.clock().getTime();
      if (!hashPattern.test(input.ticketHash) || !envelope(input.code) || !Number.isFinite(expiry) || expiry <= now || expiry > now + 300000 || [...this.pilotOAuth.values()].some(value => value.ticketHash === input.ticketHash)) throw new IntegrationError("OAUTH_STATE_INVALID", 403);
      state.used = true; Object.assign(row, { ticketHash: input.ticketHash, code: copy(input.code), ticketExpiresAt: Math.min(expiry, Date.parse(state.expiresAt)) });
      return { stored: true };
    });
  }
  async command(actor: Actor, requestId: string, action: string, p: IntegrationRecord): Promise<IntegrationRecord> {
    return this.exclusive(() => this.pilotCommand(actor, requestId, action, p));
  }
  private async pilotCommand(actor: Actor, requestId: string, action: string, p: IntegrationRecord): Promise<IntegrationRecord> {
    const now = this.clock().getTime();
    if (action === "pilot_bind") {
      const existing = [...this.connections.values()].find(row => same(row, actor) && row.provider === p.provider);
      if ((existing?.generation ?? 0) + 1 !== p.generation || (existing && existing.id !== p.id)) throw new IntegrationError("STALE_CONNECTION", 409);
      if (!["google_drive", "instagram"].includes(String(p.provider)) || !hashPattern.test(String(p.subjectHash)) || !/^https:\/\/[a-zA-Z0-9.-]+(:[0-9]+)?$/.test(String(p.origin)) || ["environmentId", "databaseProjectId", "providerProjectId", "apiVersion"].some(key => typeof p[key] !== "string" || !String(p[key]).length || String(p[key]).length > 160)) throw new IntegrationError("INVALID_INPUT");
      const grantKey = JSON.stringify([p.provider, p.providerProjectId, p.subjectHash]);
      if (["pending", "manual_action"].includes(this.pilotGrants.get(grantKey) ?? "")) throw new IntegrationError("REVOCATION_PENDING", 409);
      if ([...this.pilotBindings.values()].some(b => b.connectionId === p.id && b.generation === p.generation)) throw new IntegrationError("IDEMPOTENCY_CONFLICT", 409);
      const binding: PilotBinding = { ...actor, id: crypto.randomUUID(), connectionId: String(p.id), generation: Number(p.generation), provider: String(p.provider), grantKey, apiVersion: String(p.apiVersion), activated: false };
      this.pilotBindings.set(binding.id, binding); if (!this.pilotGrants.has(grantKey)) this.pilotGrants.set(grantKey, "active");
      return { bindingId: binding.id };
    }
    if (action === "oauth_start") {
      const expiry = Date.parse(String(p.expiresAt));
      const current = [...this.connections.values()].find(row => same(row, actor) && row.provider === p.provider);
      if (!hashPattern.test(String(p.stateHash)) || !hashPattern.test(String(p.sessionHash)) || !envelope(p.secret) || !Number.isFinite(expiry) || expiry <= now || expiry > now + 600000 || typeof p.returnPath !== "string" || p.returnPath.length > 2048 || validateReturnPath(p.returnPath) !== p.returnPath || !["instagram", "google_drive"].includes(String(p.provider))) throw new IntegrationError("INVALID_INPUT");
      if (p.expectedGeneration !== (current?.generation ?? 0)) throw new IntegrationError("STALE_CONNECTION", 409);
      if (this.states.has(String(p.stateHash))) throw new IntegrationError("IDEMPOTENCY_CONFLICT", 409);
      await this.commandStage4abc(actor, requestId, "start", p);
      this.pilotOAuth.set(String(p.stateHash), { secret: copy(p.secret) }); return {};
    }
    if (action === "oauth_consume" || action === "oauth_complete") {
      const pair = action === "oauth_complete" ? [...this.pilotOAuth].find(([, value]) => value.ticketHash === p.ticketHash) : [String(p.stateHash), this.pilotOAuth.get(String(p.stateHash))] as const;
      const stateHash = pair?.[0], value = pair?.[1], state = stateHash ? this.states.get(stateHash) : undefined;
      const current = [...this.connections.values()].find(row => same(row, actor) && row.provider === p.provider);
      if (!stateHash || !value?.secret || value.completed || !state || !same(state.actor, actor) || state.provider !== p.provider || Date.parse(state.expiresAt) <= now || state.expectedGeneration !== (current?.generation ?? 0)
        || (state.sessionHash !== p.sessionHash && !(action === "oauth_complete" && p.allowRelogin === true)) || (action === "oauth_complete" ? !value.code || (value.ticketExpiresAt ?? 0) <= now : state.used || !!value.ticketHash)) throw new IntegrationError("OAUTH_STATE_INVALID", 403);
      const result = { stateHash, expectedGeneration: state.expectedGeneration, returnPath: state.returnPath, secret: copy(value.secret), ...(action === "oauth_complete" ? { code: copy(value.code) } : {}) };
      state.used = true; value.secret = null; value.code = null; value.completed = true; return result;
    }
    if (["refresh_acquire", "refresh_commit", "refresh_abandon"].includes(action)) {
      if (action !== "refresh_acquire" && (typeof p.leaseId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(p.leaseId)
        || !Number.isInteger(p.credentialVersion) || Number(p.credentialVersion) < 1 || Number(p.credentialVersion) > 2147483647)) throw new IntegrationError("INVALID_INPUT");
      const row = this.owned(actor, p.id, p.generation), lease = this.refreshLeases.get(row.id), version = this.credentialVersions.get(row.id) ?? 1;
      const requireReauth = () => { row.status = "reauth_required"; row.lastError = "REAUTH_REQUIRED"; this.credentials.delete(row.id); this.refreshLeases.delete(row.id); return { status: "reauth_required" }; };
      if (!this.credentials.has(row.id)) throw new IntegrationError("REAUTH_REQUIRED", 403);
      if (action === "refresh_acquire") {
        const seconds = p.leaseSeconds ?? 30;
        if (!Number.isInteger(seconds) || Number(seconds) < 1 || Number(seconds) > 60 || typeof p.holderId !== "string" || !p.holderId.length || p.holderId.length > 160) throw new IntegrationError("INVALID_INPUT");
        if (lease) return lease.expiresAt > now ? { status: "busy" } : requireReauth();
        const next = { leaseId: crypto.randomUUID(), generation: row.generation, credentialVersion: version, expiresAt: now + Number(seconds) * 1000 };
        this.refreshLeases.set(row.id, next);
        return { status: "acquired", leaseId: next.leaseId, credentialVersion: version, credential: copy(this.credentials.get(row.id)), expiresAt: new Date(next.expiresAt).toISOString() };
      }
      if (!lease || lease.leaseId !== p.leaseId || lease.credentialVersion !== p.credentialVersion || lease.credentialVersion !== version || lease.generation !== row.generation || (action === "refresh_commit" && lease.expiresAt <= now)) throw new IntegrationError("REFRESH_LEASE_STALE", 409);
      if (action === "refresh_abandon") return requireReauth();
      if (!envelope(p.credential) || !Number.isFinite(Date.parse(String(p.expiresAt))) || Date.parse(String(p.expiresAt)) <= now) throw new IntegrationError("INVALID_INPUT");
      this.credentials.set(row.id, copy(p.credential)); this.credentialVersions.set(row.id, version + 1); this.refreshLeases.delete(row.id); row.expiresAt = String(p.expiresAt);
      return { credentialVersion: version + 1 };
    }
    if (action === "maintenance_acquire") {
      const prior = this.maintenanceLeases.get(owner(actor));
      if (prior && prior.expiresAt > now) return { status: "busy" };
      const seconds = p.leaseSeconds ?? 30;
      if (!Number.isInteger(seconds) || Number(seconds) < 1 || Number(seconds) > 60) throw new IntegrationError("INVALID_INPUT");
      const next = { leaseId: crypto.randomUUID(), expiresAt: now + Number(seconds) * 1000 }; this.maintenanceLeases.set(owner(actor), next);
      return { status: "acquired", leaseId: next.leaseId, expiresAt: new Date(next.expiresAt).toISOString() };
    }
    if (action === "maintenance") {
      const count = p.batchSize ?? 50, dryRun = p.dryRun !== false, lease = this.maintenanceLeases.get(owner(actor));
      if (!Number.isInteger(count) || Number(count) < 1 || Number(count) > 100) throw new IntegrationError("INVALID_INPUT");
      if (!dryRun && (!lease || lease.leaseId !== p.leaseId || lease.expiresAt <= now)) throw new IntegrationError("MAINTENANCE_LEASE_REQUIRED", 409);
      const candidates = [...this.resourceRows.values()].filter(row => same(row, actor) && ![...this.sourceRows.values()].some(s => s.source.integration?.resource_id === row.id) && (Date.parse(row.fetchedAt) <= now - 30 * 86400000 || (this.revokedAt.has(row.connectionId) && this.revokedAt.get(row.connectionId)! <= now - 86400000)));
      const expiredCredentials = [...this.connections.values()].filter(row => same(row, actor) && row.status === "revoked" && row.providerRevocation === "pending" && (this.revokedAt.get(row.id) ?? now) <= now - 86400000 && this.credentials.has(row.id));
      const expiredStates = [...this.states].filter(([, state]) => same(state.actor, actor) && Date.parse(state.expiresAt) <= now);
      if (!dryRun) {
        for (const row of candidates.slice(0, Number(count))) { this.resourceRows.delete(row.id); }
        if (candidates.length) { for (const key of this.receipts.keys()) if (key.startsWith(`${owner(actor)}:`)) this.receipts.delete(key); for (const key of this.runs.keys()) if (key.startsWith(`${owner(actor)}:`)) this.runs.delete(key); }
        for (const row of expiredCredentials.slice(0, Number(count))) { this.credentials.delete(row.id); row.providerRevocation = "manual_action"; const binding = this.currentBinding(row); if (binding) this.pilotGrants.set(binding.grantKey, "manual_action"); }
        for (const [key] of expiredStates.slice(0, Number(count))) { this.states.delete(key); this.pilotOAuth.delete(key); }
      }
      const owned = [...this.connections.values()].filter(row => same(row, actor));
      return { dryRun, counts: { snapshots: Math.min(candidates.length, Number(count)), credentials: Math.min(expiredCredentials.length, Number(count)), states: Math.min(expiredStates.length, Number(count)), permits: 0, events: 0 }, hasMore: Math.max(candidates.length, expiredCredentials.length, expiredStates.length) > Number(count), pendingRevocations: owned.filter(row => row.providerRevocation === "pending").length, manualAction: owned.filter(row => row.providerRevocation === "manual_action").length };
    }
    if (action === "connect") {
      const data = p.connection as ConnectionRecord;
      const prior = [...this.connections.values()].find(row => same(row, actor) && row.provider === data.provider), previous = prior && this.currentBinding(prior);
      if (previous && ["pending", "manual_action"].includes(this.pilotGrants.get(previous.grantKey) ?? "")) throw new IntegrationError("REVOCATION_PENDING", 409);
      const binding = this.pilotBindings.get(String(p.bindingId));
      if (data.sampleOnly === false && (!binding || !same(binding, actor) || binding.connectionId !== data.id || binding.generation !== data.generation || binding.provider !== data.provider)) throw new IntegrationError("PILOT_BINDING_REQUIRED", 403);
      if (binding && ["pending", "manual_action"].includes(this.pilotGrants.get(binding.grantKey) ?? "")) throw new IntegrationError("REVOCATION_PENDING", 409);
      const result = await this.commandStage4abc(actor, requestId, action, { ...p, connection: { ...data, ...this.pilotMetadata(data.sampleOnly === false ? binding : undefined) } });
      if (data.sampleOnly === false && binding) { binding.activated = true; this.pilotGrants.set(binding.grantKey, "active"); }
      const id = (result.connection as ConnectionRecord).id; this.credentialVersions.set(id, 1); this.refreshLeases.delete(id); return result;
    }
    if (action === "resources") {
      const row = this.owned(actor, p.id, p.generation), binding = this.currentBinding(row);
      if (!Array.isArray(p.resources) || p.resources.some(value => (value as ResourceRecord).sampleOnly !== !binding)) throw new IntegrationError("PILOT_BINDING_REQUIRED", 403);
      if (p.resources.some(value => value.evidence !== undefined && !safeEvidence(value.evidence))) throw new IntegrationError("INVALID_INPUT");
      p = { ...p, resources: p.resources.map(value => ({ ...value, ...this.pilotMetadata(binding) })) };
    }
    if (action === "update_credentials") {
      const row = this.owned(actor, p.id, p.generation);
      if (this.currentBinding(row) || this.refreshLeases.has(row.id)) throw new IntegrationError("REFRESH_LEASE_REQUIRED", 409);
    }
    if (["revoke", "purge", "revoke_result"].includes(action)) {
      // Legacy validation remains first, including malformed-generation handling.
      if (action === "revoke_result" && (!Number.isInteger(p.generation) || Number(p.generation) < 1)) throw new IntegrationError("INVALID_INPUT");
      const row = this.owned(actor, p.id, undefined, false), binding = this.currentBinding(row);
      if (binding && row.provider === "google_drive") {
        const receiptKey = `${owner(actor)}:${requestId}`, fingerprint = JSON.stringify({ action, p }), cached = this.receipts.get(receiptKey);
        if (cached) {
          if (cached.fingerprint !== fingerprint) throw new IntegrationError("IDEMPOTENCY_CONFLICT", 409);
          if (action !== "purge" && (cached.result.connection as ConnectionRecord)?.generation !== row.generation) throw new IntegrationError("STALE_CONNECTION", 409);
          return copy(cached.result);
        }
        if (action !== "purge") this.owned(actor, p.id, p.generation, false);
        // Local cleanup of an old grant must leave subsequent peer grants and leases intact.
        if (row.status === "revoked" && action !== "revoke_result") {
          const result = await this.commandStage4abc(actor, requestId, action, p); this.invalidatePilotState(row); return result;
        }
        if (action === "revoke_result" && (row.status !== "revoked" || !["pending", "revoked", "manual_action"].includes(String(p.provider)))) throw new IntegrationError("STALE_CONNECTION", 409);
        if (action === "revoke_result" && row.providerRevocation === "revoked") return { connection: copy(row) };
        for (const peer of this.connections.values()) if (this.currentBinding(peer)?.grantKey === binding.grantKey) {
          if (action === "revoke_result" && peer.status === "revoked") await this.commandStage4abc(peer, crypto.randomUUID(), action, { id: peer.id, generation: peer.generation, provider: p.provider });
          else if (action !== "revoke_result" && peer.status !== "revoked") await this.commandStage4abc(peer, crypto.randomUUID(), "revoke", { id: peer.id, generation: peer.generation });
          this.invalidatePilotState(peer);
        }
        this.pilotGrants.set(binding.grantKey, action === "revoke_result" ? (p.provider === "revoked" ? "confirmed" : p.provider === "pending" ? "pending" : "manual_action") : this.pilotGrants.get(binding.grantKey) === "confirmed" ? "confirmed" : "pending");
        const result = action === "purge" ? await this.commandStage4abc(actor, requestId, action, { ...p, generation: row.generation }) : { connection: copy(row) };
        this.receipts.set(receiptKey, { fingerprint, result: copy(result) }); return result;
      }
      const result = await this.commandStage4abc(actor, requestId, action, p); this.invalidatePilotState(row); return result;
    }
    return this.commandStage4abc(actor, requestId, action, p);
  }
  private invalidatePilotState(row: ConnectionRecord) {
    this.refreshLeases.delete(row.id);
    for (const [key, state] of this.states) if (same(state.actor, row) && state.provider === row.provider) {
      state.used = true; const pilot = this.pilotOAuth.get(key); if (pilot) { pilot.secret = null; pilot.code = null; pilot.completed = true; }
    }
  }
  private async commandStage4abc(actor: Actor, requestId: string, action: string, p: IntegrationRecord): Promise<IntegrationRecord> {
    const key = `${owner(actor)}:${requestId}`, fingerprint = JSON.stringify({ action, p: action === "resources" && p.intent ? { id: p.id, generation: p.generation, intent: p.intent } : p });
    if (["resources", "import", "credentials", "update_credentials", "reserve_sync", "finish_sync"].includes(action)) this.owned(actor, p.id, p.generation);
    if (action === "reauth") {
      if (!Number.isInteger(p.generation) || Number(p.generation) < 1) throw new IntegrationError("INVALID_INPUT");
      const row = this.owned(actor, p.id, p.generation, false);
      if (row.status === "revoked") throw new IntegrationError("STALE_CONNECTION", 409);
    }
    const cached = this.receipts.get(key);
    const uncached = ["start", "consume_state", "connect", "credentials", "revocation_credentials", "update_credentials", "source_refs", "reserve_sync", "finish_sync", "fail_sync", "export", "expire", "revoke_result"];
    if (cached && !uncached.includes(action)) {
      if (cached.fingerprint !== fingerprint) throw new IntegrationError("IDEMPOTENCY_CONFLICT", 409);
      return copy(cached.result);
    }
    let result: IntegrationRecord = {};
    const now = this.clock();
    if (action === "start") {
      this.states.set(String(p.stateHash), { actor: copy(actor), provider: String(p.provider), sessionHash: String(p.sessionHash), expiresAt: String(p.expiresAt), expectedGeneration: Number(p.expectedGeneration), returnPath: String(p.returnPath), used: false });
    } else if (action === "consume_state") {
      const state = this.states.get(String(p.stateHash));
      if (!state || state.used || !same(state.actor, actor) || state.sessionHash !== p.sessionHash || state.provider !== p.provider || Date.parse(state.expiresAt) <= now.getTime()) throw new IntegrationError("OAUTH_STATE_INVALID", 403);
      state.used = true; result = { expectedGeneration: state.expectedGeneration, returnPath: state.returnPath };
    } else if (action === "connect") {
      const data = copy(p.connection as ConnectionRecord);
      const existing = [...this.connections.values()].find(row => same(row, actor) && row.provider === data.provider);
      if ((existing?.generation ?? 0) !== p.expectedGeneration) throw new IntegrationError("STALE_CONNECTION", 409);
      if (existing && existing.status !== "revoked" && existing.subject !== data.subject) throw new IntegrationError("ACCOUNT_CHANGE_REQUIRES_REVOCATION", 409);
      const connection = { ...data, ...actor, id: existing?.id ?? data.id, generation: (existing?.generation ?? 0) + 1 };
      const revokedSources: string[] = [];
      for (const { source, actor: sourceActor } of this.sourceRows.values()) {
        if (same(sourceActor, actor) && source.integration?.connection_id === connection.id && source.integration.generation !== connection.generation && !source.revoked_at) {
          this.revokeSource(actor, source.id); revokedSources.push(source.id);
        }
      }
      for (const resource of this.resourceRows.values()) if (same(resource, actor) && resource.connectionId === connection.id && resource.generation !== connection.generation) resource.availability = "revoked";
      if (revokedSources.length) this.hooks.revokeSources?.(actor, revokedSources);
      this.connections.set(connection.id, connection); this.credentials.set(connection.id, copy(p.credential)); this.credentialGenerations.set(connection.id, connection.generation); this.revokedAt.delete(connection.id); result = { connection: copy(connection) };
    } else if (action === "reauth") {
      const row = this.owned(actor, p.id, p.generation, false);
      row.status = "reauth_required"; row.lastError = "REAUTH_REQUIRED";
      result = { connection: copy(row) };
    } else if (action === "credentials") result = { credential: copy(this.credentials.get(String(p.id))) };
    else if (action === "revocation_credentials") {
      if (!Number.isInteger(p.generation) || Number(p.generation) < 1) throw new IntegrationError("INVALID_INPUT");
      const row = this.owned(actor, p.id, p.generation, false);
      if (row.status !== "revoked" || row.providerRevocation !== "pending") throw new IntegrationError("STALE_CONNECTION", 409);
      const revokedAt = this.revokedAt.get(row.id), credential = this.credentials.get(row.id), credentialGeneration = this.credentialGenerations.get(row.id);
      result = credential && credentialGeneration === row.generation - 1 && revokedAt !== undefined && now.getTime() < revokedAt + 86400000
        ? { credential: copy(credential), credentialGeneration } : { credential: null, credentialGeneration: null };
    }
    else if (action === "update_credentials") {
      const row = this.owned(actor, p.id, p.generation); this.credentials.set(row.id, copy(p.credential)); this.credentialGenerations.set(row.id, row.generation); row.expiresAt = String(p.expiresAt);
    } else if (action === "reserve_sync") {
      const row = this.owned(actor, p.id, p.generation), prior = this.runs.get(key);
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new IntegrationError("IDEMPOTENCY_CONFLICT", 409);
        return prior.result ? { action: "replay", result: copy(prior.result) } : { action: "pending" };
      }
      if (row.lastSyncAt && now.getTime() - Date.parse(row.lastSyncAt) < SYNC_COOLDOWN_MS) throw new IntegrationError("RATE_LIMITED", 429);
      if ([...this.runs.entries()].some(([runKey, run]) => runKey.startsWith(`${owner(actor)}:`) && run.connectionId === row.id && run.generation === row.generation && !run.result)) throw new IntegrationError("SYNC_PENDING", 409);
      this.runs.set(key, { fingerprint, connectionId: row.id, generation: row.generation, result: null }); return { action: "reserved" };
    } else if (action === "finish_sync") {
      const run = this.runs.get(`${owner(actor)}:${String(p.runRequestId)}`);
      if (!run || run.generation !== p.generation || run.connectionId !== p.id) throw new IntegrationError("NOT_FOUND", 404);
      run.result = copy(p.result as IntegrationRecord);
    } else if (action === "fail_sync") { /* Unknown runs remain reserved; never duplicate an uncertain provider request. */ }
    else if (action === "resources") {
      const connection = this.owned(actor, p.id, p.generation), values = p.resources as ResourceRecord[];
      if (!Array.isArray(values) || values.length > 50) throw new IntegrationError("INVALID_INPUT");
      const revokedSources: string[] = [];
      for (const value of values) {
        const previous = this.resourceRows.get(value.id);
        const sameObservation = !value.evidence || (previous && Date.parse(previous.fetchedAt) === Date.parse(value.fetchedAt) && JSON.stringify(previous.evidence) === JSON.stringify(value.evidence));
        const snapshotId = sameObservation && previous?.contentHash === value.contentHash && previous.version === value.version && previous.rights === value.rights && previous.generation === connection.generation ? previous.snapshotId : crypto.randomUUID();
        if (previous && same(previous, actor) && previous.rights !== value.rights) {
          for (const { source, actor: sourceActor } of this.sourceRows.values()) if (same(sourceActor, actor) && source.integration?.connection_id === connection.id && source.integration.resource_id === value.id && !source.revoked_at) {
            this.revokeSource(actor, source.id); revokedSources.push(source.id);
          }
        }
        const row = { ...copy(value), ...actor, connectionId: connection.id, generation: connection.generation, snapshotId };
        this.resourceRows.set(row.id, row);
      }
      if (revokedSources.length) this.hooks.revokeSources?.(actor, revokedSources);
      if (p.lastSyncAt) connection.lastSyncAt = String(p.lastSyncAt);
      result = { resources: await this.resources(actor, connection.id) };
    } else if (action === "import") {
      const connection = this.owned(actor, p.id, p.generation), ids = p.resourceIds as string[];
      if (!ids?.length || ids.length > 5 || new Set(ids).size !== ids.length || typeof p.question !== "string" || !p.question.trim() || [...p.question].length > 500) throw new IntegrationError("INVALID_INPUT");
      const sources = ids.map(id => {
        const resource = this.resourceRows.get(id);
        if (!resource || !same(resource, actor) || resource.connectionId !== connection.id || resource.generation !== connection.generation || !resource.selected || !resource.canDownload || resource.availability === "revoked") throw new IntegrationError("SOURCE_UNAVAILABLE", 403);
        const existing = [...this.sourceRows.values()].find(row => same(row.actor, actor) && !row.source.revoked_at && row.source.thread_id === p.threadId && row.source.integration?.snapshot_id === resource.snapshotId);
        if (existing) return copy(existing.source);
        const source: StudioSource = { id: crypto.randomUUID(), thread_id: String(p.threadId), title: resource.title, content: p.processingRights === true ? [...(resource.excerpt ?? "資料不足／未驗證")].slice(0, 8000).join("") : "僅保留來源資料及權限提示；未確認內容處理權利。", url: null, kind: "private", shareable: p.processingRights === true && p.shareRights === true && resource.rights !== "unknown", question: String(p.question), platform: connection.provider === "instagram" ? "Instagram（模擬）" : "Google Drive（模擬）", region: resource.coverage.region, language: resource.coverage.language, observed_at: resource.observedAt, revoked_at: null, status: "unverified",
          integration: { connection_id: connection.id, snapshot_id: resource.snapshotId!, resource_id: resource.id, generation: connection.generation, source_version: resource.version, content_hash: resource.contentHash, model_allowed: p.modelConsent === true && p.processingRights === true && resource.rights !== "unknown", provenance: connection.provider, availability: resource.availability, sample_only: resource.sampleOnly, coverage: copy(resource.coverage), ...(resource.evidence ? { evidence: copy(resource.evidence) } : {}) } };
        return source;
      });
      this.hooks.importSources?.(actor, p, sources);
      for (const source of sources) this.sourceRows.set(source.id, { actor: copy(actor), source: copy(source) });
      result = { sources };
    } else if (action === "source_refs") result = { sources: copy((p.sourceIds as string[]).flatMap(id => { const row = this.sourceRows.get(id); return row && same(row.actor, actor) ? [row.source] : []; })) };
    else if (action === "permit") {
      const permits = (p.sourceIds as string[]).map(sourceId => {
        const row = this.sourceRows.get(sourceId), source = row?.source;
        if (!row || !same(row.actor, actor) || !source?.integration || source.revoked_at) throw new IntegrationError("SOURCE_UNAVAILABLE", 403);
        this.owned(actor, source.integration.connection_id, source.integration.generation);
        if (p.use === "model" && !source.integration.model_allowed) throw new IntegrationError("MODEL_CONSENT_REQUIRED", 403);
        if (p.use === "share" && !source.shareable) throw new IntegrationError("SOURCE_PRIVATE", 403);
        const id = crypto.randomUUID(), expiresAt = now.getTime() + 60000;
        this.permits.set(id, { actor: copy(actor), sourceId, use: String(p.use), fingerprint: JSON.stringify(p.commandPayload ?? {}), generation: source.integration.generation, expiresAt });
        return { id, sourceId, snapshotId: source.integration.snapshot_id, generation: source.integration.generation, contentHash: source.integration.content_hash, use: p.use, expiresAt: new Date(expiresAt).toISOString() };
      }); result = { permits };
    } else if (action === "revoke" || action === "purge") {
      const row = this.owned(actor, p.id, p.generation, false);
      if (row.status !== "revoked") { row.status = "revoked"; row.generation++; row.providerRevocation = "pending"; this.revokedAt.set(row.id, now.getTime()); }
      for (const state of this.states.values()) if (same(state.actor, actor) && state.provider === row.provider) state.used = true;
      const sourceIds: string[] = [];
      for (const { source, actor: sourceActor } of this.sourceRows.values()) if (same(sourceActor, actor) && source.integration?.connection_id === row.id) { this.revokeSource(actor, source.id); sourceIds.push(source.id); }
      this.hooks.revokeSources?.(actor, sourceIds);
      for (const resource of this.resourceRows.values()) if (same(resource, actor) && resource.connectionId === row.id) resource.availability = "revoked";
      if (action === "purge") {
        this.hooks.purgeSources?.(actor, sourceIds); for (const id of sourceIds) this.sourceRows.delete(id);
        for (const [id, resource] of this.resourceRows) if (same(resource, actor) && resource.connectionId === row.id) this.resourceRows.delete(id);
        this.credentials.delete(row.id); this.credentialGenerations.delete(row.id); if (row.providerRevocation !== "revoked") row.providerRevocation = "manual_action";
        // Private cached responses can contain derived text; wipe them with their source.
        for (const receiptKey of this.receipts.keys()) if (receiptKey.startsWith(`${owner(actor)}:`)) this.receipts.delete(receiptKey);
        for (const runKey of this.runs.keys()) if (runKey.startsWith(`${owner(actor)}:`)) this.runs.delete(runKey);
        result = { state: "complete" };
      } else result = { connection: copy(row) };
    } else if (action === "revoke_result") {
      if (!Number.isInteger(p.generation) || Number(p.generation) < 1) throw new IntegrationError("INVALID_INPUT");
      const row = this.owned(actor, p.id, p.generation, false);
      if (row.status !== "revoked") throw new IntegrationError("STALE_CONNECTION", 409);
      row.providerRevocation = p.provider as ConnectionRecord["providerRevocation"];
      if (p.provider !== "pending") { this.credentials.delete(row.id); this.credentialGenerations.delete(row.id); }
    } else if (action === "export") result = { connections: await this.list(actor), resources: copy([...this.resourceRows.values()].filter(row => same(row, actor))), sources: copy([...this.sourceRows.values()].filter(row => same(row.actor, actor)).map(row => row.source)) };
    else if (action === "expire") {
      let purged = 0;
      for (const [id, resource] of this.resourceRows) if (same(resource, actor) && Date.parse(resource.fetchedAt) < now.getTime() - 30 * 86400000 && ![...this.sourceRows.values()].some(row => row.source.integration?.resource_id === id)) { this.resourceRows.delete(id); purged++; }
      for (const row of this.connections.values()) if (same(row, actor) && row.status === "revoked" && row.providerRevocation === "pending" && now.getTime() - (this.revokedAt.get(row.id) ?? now.getTime()) >= 86400000) { this.credentials.delete(row.id); this.credentialGenerations.delete(row.id); row.providerRevocation = "manual_action"; }
      if (purged) { for (const receiptKey of this.receipts.keys()) if (receiptKey.startsWith(`${owner(actor)}:`)) this.receipts.delete(receiptKey); for (const runKey of this.runs.keys()) if (runKey.startsWith(`${owner(actor)}:`)) this.runs.delete(runKey); }
      result = { purged };
    } else throw new IntegrationError("INVALID_ACTION");
    if (!uncached.includes(action)) this.receipts.set(key, { fingerprint, result: copy(result) });
    return copy(result);
  }
  /** Test/preview transaction gate: same validation occurs inside studio_command in SQL. */
  consumePermits(actor: Actor, sourceIds: string[], use: string, commandPayload: IntegrationRecord) {
    const selected: string[] = [];
    for (const sourceId of sourceIds) {
      const source = this.sourceRows.get(sourceId)?.source;
      if (!source?.integration) continue;
      this.owned(actor, source.integration.connection_id, source.integration.generation);
      const permit = [...this.permits.entries()].find(([, row]) => same(row.actor, actor) && row.sourceId === sourceId && row.use === use && row.generation === source.integration!.generation && row.expiresAt > this.clock().getTime() && row.fingerprint === JSON.stringify(commandPayload));
      if (!permit) throw new IntegrationError("SOURCE_PERMISSION_REQUIRED", 403);
      selected.push(permit[0]);
    }
    for (const id of selected) this.permits.delete(id);
  }
}
