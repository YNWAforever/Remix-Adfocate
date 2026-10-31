import type { StudioSource } from "../../../src/lib/studio/types.js";
import { IntegrationError, SYNC_COOLDOWN_MS } from "./policy.js";
import type { Actor, ConnectionRecord, IntegrationRecord, IntegrationRepository, ResourceRecord } from "./types.js";

type MemoryHooks = {
  importSources?: (actor: Actor, payload: IntegrationRecord, sources: StudioSource[]) => void;
  revokeSources?: (actor: Actor, sourceIds: string[]) => void;
  purgeSources?: (actor: Actor, sourceIds: string[]) => void;
};
const owner = (actor: Actor) => `${actor.workspaceId}:${actor.creatorId}`;
const copy = <T>(value: T): T => structuredClone(value);
const same = (row: Actor, actor: Actor) => owner(row) === owner(actor);

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
  async command(actor: Actor, requestId: string, action: string, p: IntegrationRecord): Promise<IntegrationRecord> {
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
        const snapshotId = previous?.contentHash === value.contentHash && previous.version === value.version && previous.rights === value.rights && previous.generation === connection.generation ? previous.snapshotId : crypto.randomUUID();
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
          integration: { connection_id: connection.id, snapshot_id: resource.snapshotId!, resource_id: resource.id, generation: connection.generation, source_version: resource.version, content_hash: resource.contentHash, model_allowed: p.modelConsent === true && p.processingRights === true && resource.rights !== "unknown", provenance: connection.provider, availability: resource.availability, sample_only: true, coverage: copy(resource.coverage) } };
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
