import type { StudioSource } from "../../../src/lib/studio/types.js";
import type { IntegrationImport, IntegrationResource, IntegrationConnection, StartConnection } from "../../../src/lib/integrations/types.js";
import { digest, type EncryptedEnvelope } from "./credentials.js";
import type { CredentialStore } from "./keyProvider.js";
import { RepositoryRefreshLease } from "./refreshLease.js";
import { normalizeDriveFile } from "./googleDrive.js";
import { boundedText, CONSENT_VERSION, hasScopes, IntegrationError, requiredScopes, requireRequestId, validateReturnPath, validateSelection } from "./policy.js";
import type { Actor, ConnectionRecord, IntegrationProvider, IntegrationRecord, IntegrationRepository, ProviderGrant, ProviderId, ProviderSnapshot, ResourceRecord, SourceUse, UsePermit } from "./types.js";

export function connectionDTO(row: ConnectionRecord): IntegrationConnection {
  return { id: row.id, provider: row.provider, label: row.label, status: row.status, scopes: [...row.scopes], generation: row.generation, lastSyncAt: row.lastSyncAt, expiresAt: row.expiresAt, lastError: row.lastError, sampleOnly: row.sampleOnly, providerRevocation: row.providerRevocation };
}
export function resourceDTO(row: ResourceRecord): IntegrationResource {
  return { id: row.id, connectionId: row.connectionId, externalId: row.externalId, title: row.title, mimeType: row.mimeType, version: row.version, selected: row.selected, canDownload: row.canDownload, rights: row.rights, availability: row.availability, excerpt: row.excerpt, metrics: row.metrics, observedAt: row.observedAt, fetchedAt: row.fetchedAt, coverage: row.coverage, sampleOnly: row.sampleOnly, ...(row.evidence ? {evidence:row.evidence} : {}) };
}
const refKey = (row: ConnectionRecord) => `${row.workspaceId}:${row.creatorId}:${row.provider}:${row.id}:${row.generation}`;
const PROVIDER_TIMEOUT_MS = 30_000;

/** Protocol adapters can be rehearsed with fixture transports; D0 cannot accept network adapters. */
export class IntegrationService {
  private refreshes = new Map<string, Promise<ProviderGrant>>();
  private controllers = new Map<string, Set<AbortController>>();
  private lease: RepositoryRefreshLease | undefined;
  constructor(private repo: IntegrationRepository, private providers: Record<ProviderId, IntegrationProvider>, private vault: CredentialStore, private clock: () => Date = () => new Date(), private options: {offlineAdapters?:boolean;refreshLease?:RepositoryRefreshLease} = {}) {
    if (Object.values(providers).some(provider => provider.mode !== "mock" && !(options.offlineAdapters && provider.mode === "live_pilot" && provider.sampleOnly === true))) throw new IntegrationError("LIVE_PROVIDER_DISABLED", 503);
    this.lease=options.refreshLease ?? (Object.values(providers).some(provider=>provider.mode==="live_pilot") ? new RepositoryRefreshLease(repo,crypto.randomUUID()) : undefined);
  }
  async list(actor: Actor) { return (await this.repo.list(actor)).map(connectionDTO); }
  private async owned(actor: Actor, id: string, generation?: number, active = true): Promise<ConnectionRecord> {
    const row = await this.repo.connection(actor, id);
    if (!row || row.creatorId !== actor.creatorId || row.workspaceId !== actor.workspaceId) throw new IntegrationError("NOT_FOUND", 404);
    if (active && row.sampleOnly !== true) throw new IntegrationError("LIVE_PROVIDER_DISABLED",503);
    if ((generation !== undefined && row.generation !== generation) || (active && row.status === "revoked")) throw new IntegrationError("STALE_CONNECTION", 409);
    if (active && row.status === "reauth_required") throw new IntegrationError("REAUTH_REQUIRED", 403);
    return row;
  }
  async beginConnection(actor: Actor, provider: ProviderId, sessionBinding: string, returnPath: string): Promise<StartConnection> {
    if (this.providers[provider].mode !== "mock") throw new IntegrationError("OAUTH_REQUIRED",409);
    const state = `${crypto.randomUUID()}${crypto.randomUUID()}`, expiresAt = new Date(this.clock().getTime() + 600000).toISOString();
    const existing = (await this.repo.list(actor)).find(row => row.provider === provider);
    await this.repo.command(actor, crypto.randomUUID(), "start", { stateHash: await digest(state), sessionHash: await digest(sessionBinding), provider, expiresAt, returnPath: validateReturnPath(returnPath), expectedGeneration: existing?.generation ?? 0 });
    return { state, expiresAt, provider, scopes: requiredScopes(provider), sampleOnly: true };
  }
  async completeConnection(actor: Actor, provider: ProviderId, sessionBinding: string, code: string, state: string): Promise<IntegrationConnection> {
    if (this.providers[provider].mode !== "mock") throw new IntegrationError("OAUTH_REQUIRED",409);
    if (typeof state !== "string" || state.length > 200) throw new IntegrationError("OAUTH_STATE_INVALID", 403);
    const claimed = await this.repo.command(actor, crypto.randomUUID(), "consume_state", { stateHash: await digest(state), sessionHash: await digest(sessionBinding), provider });
    const grant = await this.providers[provider].authorize(code, actor, this.clock());
    // Never silently accept more permissions than the manifest advertises.
    if (grant.scopes.some(scope => !requiredScopes(provider).includes(scope))) throw new IntegrationError("UNEXPECTED_SCOPE", 403);
    const existing = (await this.repo.list(actor)).find(row => row.provider === provider);
    const connection: ConnectionRecord = { ...actor, id: existing?.id ?? crypto.randomUUID(), provider, subject: grant.subject, label: grant.label, generation: Number(claimed.expectedGeneration) + 1,
      scopes: grant.scopes, status: hasScopes(provider, grant.scopes) ? "connected" : "partial", expiresAt: grant.expiresAt, lastSyncAt: null, lastError: null, sampleOnly: true, providerRevocation: "not_requested", consentVersion: CONSENT_VERSION };
    const credential = await this.vault.seal(grant, refKey(connection));
    const result = await this.repo.command(actor, crypto.randomUUID(), "connect", { connection, credential, expectedGeneration: claimed.expectedGeneration });
    return connectionDTO(result.connection as ConnectionRecord);
  }
  /** Only a verified server OAuth exchange supplies this grant; HTTP bodies never do. */
  async acceptAuthorizedGrant(actor:Actor,provider:ProviderId,grant:ProviderGrant,expectedGeneration:number):Promise<IntegrationConnection> {
    if(!this.options.offlineAdapters||this.providers[provider].mode!=="live_pilot"||this.providers[provider].sampleOnly!==true)throw new IntegrationError("LIVE_PROVIDER_DISABLED",503);
    if(!Number.isSafeInteger(expectedGeneration)||expectedGeneration<0||typeof grant.subject!=="string"||!grant.subject||grant.subject.length>255||!Array.isArray(grant.scopes)
      ||grant.scopes.some(scope=>!requiredScopes(provider,"live_pilot").includes(scope))||!Number.isFinite(Date.parse(grant.expiresAt))||Date.parse(grant.expiresAt)<=this.clock().getTime())throw new IntegrationError("OAUTH_IDENTITY_INVALID",403);
    const existing=(await this.repo.list(actor)).find(row=>row.provider===provider);
    if(existing&&["pending","manual_action"].includes(existing.providerRevocation))throw new IntegrationError("REVOCATION_PENDING",409);
    const connection:ConnectionRecord={...actor,id:existing?.id??crypto.randomUUID(),provider,subject:grant.subject,label:boundedText(grant.label,160),generation:expectedGeneration+1,
      scopes:[...grant.scopes],status:hasScopes(provider,grant.scopes,"live_pilot")?"connected":"partial",expiresAt:grant.expiresAt,lastSyncAt:null,lastError:null,
      sampleOnly:true,providerRevocation:"not_requested",consentVersion:"kocmax-integrations-offline-adapter-2026-10-31"};
    const result=await this.repo.command(actor,crypto.randomUUID(),"connect",{connection,credential:await this.vault.seal(grant,refKey(connection)),expectedGeneration});
    return connectionDTO(result.connection as ConnectionRecord);
  }
  private async requireReauthentication(row: ConnectionRecord): Promise<never> {
    // The generation guard must win over a late failure from an older grant.
    await this.repo.command({ creatorId: row.creatorId, workspaceId: row.workspaceId }, crypto.randomUUID(), "reauth", { id: row.id, generation: row.generation });
    throw new IntegrationError("REAUTH_REQUIRED", 403);
  }
  private async grant(row: ConnectionRecord): Promise<ProviderGrant> {
    if (!hasScopes(row.provider, row.scopes,this.providers[row.provider].mode)) throw new IntegrationError("SCOPE_REQUIRED", 403);
    const actor = { creatorId: row.creatorId, workspaceId: row.workspaceId };
    const { credential } = await this.repo.command(actor, crypto.randomUUID(), "credentials", { id: row.id, generation: row.generation });
    let grant: ProviderGrant;
    try {
      if (!credential) throw new IntegrationError("CREDENTIAL_UNAVAILABLE", 503);
      grant = await this.vault.open<ProviderGrant>(credential as EncryptedEnvelope, refKey(row));
    } catch { return this.requireReauthentication(row); }
    await this.owned(actor, row.id, row.generation);
    if (Date.parse(grant.expiresAt) > this.clock().getTime() + 30000) return grant;
    if(this.lease) {
      const lease=await this.lease.acquire(actor,row.id,row.generation,60);
      if(lease.status==="busy")throw new IntegrationError("REFRESH_BUSY",409);
      if(lease.status!=="acquired")throw new IntegrationError("REAUTH_REQUIRED",403);
      try {
        const current=await this.vault.open<ProviderGrant>(lease.credential,refKey(row));
        let refreshed=current;
        if(Date.parse(current.expiresAt)<=this.clock().getTime()+30000) {
          let timer:ReturnType<typeof setTimeout>|undefined;
          try { refreshed=await Promise.race([this.providers[row.provider].refresh(current,this.clock()),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new IntegrationError("REAUTH_REQUIRED",403)),PROVIDER_TIMEOUT_MS);})]); }
          finally {clearTimeout(timer);}
        }
        if(refreshed.subject!==row.subject||refreshed.grantProject!==current.grantProject||!hasScopes(row.provider,refreshed.scopes,this.providers[row.provider].mode)
          ||refreshed.scopes.some(scope=>!requiredScopes(row.provider,this.providers[row.provider].mode).includes(scope))||!(Date.parse(refreshed.expiresAt)>this.clock().getTime()))throw new IntegrationError("REAUTH_REQUIRED",403);
        await this.owned(actor,row.id,row.generation);
        await this.lease.commit(actor,row.id,row.generation,lease,await this.vault.seal(refreshed,refKey(row)),refreshed.expiresAt);
        return refreshed;
      } catch(error) {
        await this.lease.abandon(actor,row.id,row.generation,lease).catch(()=>undefined);
        if(error instanceof IntegrationError&&["STALE_CONNECTION","NOT_FOUND"].includes(error.code))throw error;
        throw new IntegrationError("REAUTH_REQUIRED",403);
      }
    }
    const key = refKey(row);
    if (!this.refreshes.has(key)) this.refreshes.set(key, (async () => {
      let refreshed: ProviderGrant;
      try {
        refreshed = await this.providers[row.provider].refresh(grant, this.clock());
        if (refreshed.subject !== row.subject || !hasScopes(row.provider, refreshed.scopes) || refreshed.scopes.some(scope => !requiredScopes(row.provider).includes(scope)) || !(Date.parse(refreshed.expiresAt) > this.clock().getTime())) throw new IntegrationError("REAUTH_REQUIRED", 403);
      } catch { return this.requireReauthentication(row); }
      await this.owned(actor, row.id, row.generation);
      await this.repo.command(actor, crypto.randomUUID(), "update_credentials", { id: row.id, generation: row.generation, credential: await this.vault.seal(refreshed, key), expiresAt: refreshed.expiresAt });
      return refreshed;
    })().finally(() => this.refreshes.delete(key)));
    return this.refreshes.get(key)!;
  }
  private async providerRead(row: ConnectionRecord, grant: ProviderGrant): Promise<ProviderSnapshot[]> {
    const key = refKey(row), controller = new AbortController();
    const controllers = this.controllers.get(key) ?? new Set<AbortController>(); controllers.add(controller); this.controllers.set(key, controllers);
    const abortError = () => controller.signal.reason instanceof IntegrationError ? controller.signal.reason : new IntegrationError("STALE_CONNECTION", 409);
    let rejectAbort!: (error: IntegrationError) => void;
    const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
    const onAbort = () => rejectAbort(abortError());
    controller.signal.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(new IntegrationError("SOURCE_UNAVAILABLE", 503)), PROVIDER_TIMEOUT_MS);
    // Racing attaches a rejection handler even if the provider ignores abort and
    // rejects after the deadline; the late operation can never write a snapshot.
    const read = Promise.resolve().then(async () => {
      const result = await this.providers[row.provider].read(row, grant, this.clock(), controller.signal);
      await this.owned(row, row.id, row.generation);
      if (controller.signal.aborted) throw abortError();
      return result;
    });
    try {
      return await Promise.race([read, aborted]);
    } finally { clearTimeout(timer); controller.signal.removeEventListener("abort", onAbort); controllers.delete(controller); if (!controllers.size) this.controllers.delete(key); }
  }
  private async providerRevoke(provider: ProviderId, grant: ProviderGrant): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new IntegrationError("SOURCE_UNAVAILABLE", 503)), PROVIDER_TIMEOUT_MS);
    });
    try {
      // The race observes late rejection, but only its settled result can update status.
      await Promise.race([Promise.resolve().then(() => this.providers[provider].revoke(grant)), deadline]);
    } finally { clearTimeout(timer); }
  }
  async resources(actor: Actor, id: string): Promise<IntegrationResource[]> {
    await this.owned(actor, id);
    return (await this.repo.resources(actor, id)).map(resourceDTO);
  }
  async syncConnection(actor: Actor, id: string, requestId: string): Promise<{ status: "completed" | "partial"; resources: IntegrationResource[] }> {
    requireRequestId(requestId); const row = await this.owned(actor, id);
    if (row.provider !== "instagram") throw new IntegrationError("SELECT_FILES_FIRST");
    if (!hasScopes(row.provider, row.scopes,this.providers[row.provider].mode)) throw new IntegrationError("SCOPE_REQUIRED", 403);
    const reservation = await this.repo.command(actor, requestId, "reserve_sync", { id, generation: row.generation });
    if (reservation.action === "replay") {
      const result = reservation.result as { status: "completed" | "partial"; resources: ResourceRecord[] };
      return { status: result.status, resources: result.resources.map(resourceDTO) };
    }
    if (reservation.action !== "reserved") throw new IntegrationError("SYNC_PENDING", 409);
    try {
      const snapshots = await this.providerRead(row, await this.grant(row));
      const sampledAt = this.clock().getTime(), cutoff = sampledAt - 30 * 86400000;
      // This is a mock media observation filter, not a metric measurement period.
      const inWindow = snapshots.filter(snapshot => { const observedAt = Date.parse(snapshot.observedAt); return observedAt >= cutoff && observedAt <= sampledAt; });
      const selected = inWindow.slice(0, 50), identities = await this.repo.resourceIdentities(actor, id, selected.map(snapshot => snapshot.resourceId));
      const partial = inWindow.length > 50 || inWindow.length !== snapshots.length || snapshots.some(value => value.coverage.partial);
      const resources: ResourceRecord[] = selected.map(snapshot => ({ ...actor, id: identities.find(value => value.externalId === snapshot.resourceId)?.id ?? crypto.randomUUID(), connectionId: id, externalId: snapshot.resourceId,
        title: snapshot.title, mimeType: "application/instagram-insights", version: snapshot.sourceVersion, selected: true, canDownload: true, rights: "owned", generation: row.generation,
        contentHash: snapshot.contentHash, availability: "available", excerpt: snapshot.excerpt, metrics: snapshot.metrics, observedAt: snapshot.observedAt, fetchedAt: snapshot.fetchedAt, coverage: { ...snapshot.coverage, partial }, sizeBytes: 0, sampleOnly: true, ...(snapshot.evidence?{evidence:snapshot.evidence}:{}) }));
      await this.owned(actor, id, row.generation);
      const result = await this.repo.command(actor, crypto.randomUUID(), "resources", { id, generation: row.generation, resources, lastSyncAt: this.clock().toISOString() });
      const complete = { status: partial ? "partial" as const : "completed" as const, resources: result.resources as ResourceRecord[] };
      await this.repo.command(actor, crypto.randomUUID(), "finish_sync", { id, generation: row.generation, runRequestId: requestId, result: complete });
      return { ...complete, resources: complete.resources.map(resourceDTO) };
    } catch (error) {
      await this.repo.command(actor, crypto.randomUUID(), "fail_sync", { id, generation: row.generation, runRequestId: requestId }).catch(() => undefined);
      if (error instanceof IntegrationError) throw error;
      throw new IntegrationError("SYNC_OUTCOME_UNKNOWN", 503);
    }
  }
  async picker(actor: Actor, id: string) {
    const row = await this.owned(actor, id);
    if (row.provider !== "google_drive") throw new IntegrationError("INVALID_PROVIDER");
    const files = await this.providers.google_drive.files(row, await this.grant(row)); await this.owned(actor, id, row.generation);
    return { sampleOnly: true as const, files: files.map(file => ({ id: file.externalId, title: file.title, mimeType: file.mimeType, rights: file.rights, canDownload: file.canDownload })) };
  }
  /** Dedicated no-store channel only, never returned in normal connection DTOs or queries. */
  async pickerAccessGrant(actor:Actor,id:string,generation:number){
    const row=await this.owned(actor,id,generation);
    if(!this.options.offlineAdapters||row.provider!=="google_drive"||this.providers.google_drive.mode!=="live_pilot")throw new IntegrationError("PILOT_APPROVAL_REQUIRED",503);
    const grant=await this.grant(row);await this.owned(actor,id,generation);
    return {accessToken:grant.accessToken,expiresAt:grant.expiresAt,scopes:[...grant.scopes]};
  }
  async registerSelectedFiles(actor: Actor, id: string, fileIds: string[], requestId: string) {
    validateSelection(fileIds); requireRequestId(requestId); const row = await this.owned(actor, id);
    if (row.provider !== "google_drive") throw new IntegrationError("INVALID_PROVIDER");
    const grant = await this.grant(row), identities = await this.repo.resourceIdentities(actor, id, fileIds), resources: ResourceRecord[] = [];
    const provider = this.providers.google_drive;
    const files = provider.selectedFiles ? await provider.selectedFiles(row,grant,[...fileIds]) : await Promise.all(fileIds.map(externalId=>provider.file(row,grant,externalId)));
    if(files.length!==fileIds.length || new Set(files.map(file=>file.externalId)).size!==fileIds.length || files.some(file=>!fileIds.includes(file.externalId))) throw new IntegrationError("INVALID_SELECTION");
    for (const file of files) {
      const externalId=file.externalId, snapshot = await normalizeDriveFile(file, this.clock());
      resources.push({ ...actor, id: identities.find(value => value.externalId === externalId)?.id ?? crypto.randomUUID(), connectionId: id, externalId,
        title: file.title, mimeType: file.mimeType, version: file.version, selected: true, canDownload: file.canDownload, rights: file.rights, generation: row.generation,
        contentHash: snapshot.contentHash, availability: "available", excerpt: snapshot.excerpt, metrics: {}, observedAt: snapshot.observedAt, fetchedAt: snapshot.fetchedAt,
        coverage: snapshot.coverage, sizeBytes: file.sizeBytes, sampleOnly: true,
        ...(provider.mode==="live_pilot"?{evidence:{apiVersion:"v3",endpoint:"drive/v3/files",measurementPeriod:"document_version"}}:{}) });
    }
    await this.owned(actor, id, row.generation);
    const result = await this.repo.command(actor, requestId, "resources", { id, generation: row.generation, resources, intent: { fileIds } });
    return { resources: (result.resources as ResourceRecord[]).map(resourceDTO) };
  }
  private async revalidate(row: ConnectionRecord, resource: ResourceRecord): Promise<void> {
    if (resource.generation !== row.generation || resource.availability === "revoked" || !resource.selected) throw new IntegrationError("SOURCE_UNAVAILABLE", 403);
    const grant = await this.grant(row);
    let snapshot: ProviderSnapshot | undefined;
    if (row.provider === "google_drive") {
      const file = await this.providers.google_drive.file(row, grant, resource.externalId);
      if (file.rights !== resource.rights) throw new IntegrationError("SOURCE_CHANGED", 409);
      snapshot = await normalizeDriveFile(file, this.clock());
    }
    else snapshot = (await this.providerRead(row, grant)).find(value => value.resourceId === resource.externalId);
    await this.owned(row, row.id, row.generation);
    if (!snapshot || snapshot.sourceVersion !== resource.version || snapshot.contentHash !== resource.contentHash) throw new IntegrationError("SOURCE_CHANGED", 409);
  }
  async importSources(actor: Actor, id: string, input: IntegrationImport) {
    validateSelection(input.resourceIds); requireRequestId(input.requestId); boundedText(input.question, 500);
    if (!Number.isInteger(input.revision) || input.revision < 0 || !input.threadId) throw new IntegrationError("INVALID_INPUT");
    const row = await this.owned(actor, id), resources = await this.repo.resources(actor, id);
    for (const resourceId of input.resourceIds) {
      const resource = resources.find(value => value.id === resourceId);
      if (!resource) throw new IntegrationError("SOURCE_UNAVAILABLE", 403);
      if (input.modelConsent && (!input.processingRights || resource.rights === "unknown")) throw new IntegrationError("SOURCE_PRIVATE", 403);
      await this.revalidate(row, resource);
    }
    return this.repo.command(actor, input.requestId, "import", { ...input, id, generation: row.generation });
  }
  async authorizeSources(actor: Actor, sourceIds: string[], use: SourceUse, commandPayload?: IntegrationRecord): Promise<UsePermit[]> {
    if (!sourceIds.length) return [];
    const unique = [...new Set(sourceIds)]; if (unique.length > 100) throw new IntegrationError("INVALID_SELECTION");
    const result = await this.repo.command(actor, crypto.randomUUID(), "source_refs", { sourceIds: unique });
    if (!Array.isArray(result.sources) || result.sources.length !== unique.length) throw new IntegrationError("NOT_FOUND", 404);
    const sources = (result.sources as StudioSource[]).filter(source => source.integration);
    for (const source of sources) {
      const meta = source.integration!;
      if (source.revoked_at || meta.availability === "revoked") throw new IntegrationError("SOURCE_UNAVAILABLE", 403);
      if (use === "model" && !meta.model_allowed) throw new IntegrationError("MODEL_CONSENT_REQUIRED", 403);
      if (use === "share" && !source.shareable) throw new IntegrationError("SOURCE_PRIVATE", 403);
      const row = await this.owned(actor, meta.connection_id, meta.generation), resource = (await this.repo.resources(actor, row.id)).find(value => value.id === meta.resource_id);
      if (!resource || resource.version !== meta.source_version || resource.contentHash !== meta.content_hash || (resource.snapshotId && resource.snapshotId !== meta.snapshot_id)) throw new IntegrationError("SOURCE_CHANGED", 409);
      if ((use === "model" || use === "share") && resource.rights === "unknown") throw new IntegrationError("SOURCE_PRIVATE", 403);
      await this.revalidate(row, resource);
    }
    if (!sources.length) return [];
    const permitted = await this.repo.command(actor, crypto.randomUUID(), "permit", { sourceIds: sources.map(source => source.id), use, commandPayload });
    return permitted.permits as UsePermit[];
  }
  async revokeConnection(actor: Actor, id: string, requestId: string) {
    requireRequestId(requestId); const row = await this.owned(actor, id, undefined, false);
    let stopped = row;
    if (row.status !== "revoked") {
      // Stop local access before any credential lookup, including expired/reauth grants.
      const result = await this.repo.command(actor, requestId, "revoke", { id, generation: row.generation });
      stopped = result.connection as ConnectionRecord;
      for (const controller of this.controllers.get(refKey(row)) ?? []) controller.abort(new IntegrationError("STALE_CONNECTION", 409));
    }
    if (stopped.providerRevocation === "revoked" || stopped.providerRevocation === "manual_action") return { local: "revoked" as const, provider: stopped.providerRevocation };
    let provider: "revoked" | "pending" | "manual_action" = "manual_action";
    let grant: ProviderGrant | undefined;
    if (stopped.providerRevocation === "pending") {
      let stored: IntegrationRecord = {};
      try { stored = await this.repo.command(actor, crypto.randomUUID(), "revocation_credentials", { id, generation: stopped.generation }); }
      catch (error) {
        // Transient credential failures cannot undo the stop. Ownership and generation
        // failures still propagate, so no later result can touch another grant.
        if (!(error instanceof IntegrationError) || !["REAUTH_REQUIRED", "CREDENTIAL_UNAVAILABLE", "SOURCE_UNAVAILABLE", "INTEGRATIONS_UNAVAILABLE"].includes(error.code)) throw error;
        provider = "pending";
      }
      if (stored.credential && Number.isInteger(stored.credentialGeneration) && stored.credentialGeneration === stopped.generation - 1) {
        try { grant = await this.vault.open<ProviderGrant>(stored.credential as EncryptedEnvelope, refKey({ ...stopped, generation: Number(stored.credentialGeneration) })); }
        catch { provider = "manual_action"; }
      }
    }
    if (grant) {
      try { await this.providerRevoke(row.provider, grant); provider = "revoked"; }
      catch { provider = "pending"; }
    }
    await this.repo.command(actor, crypto.randomUUID(), "revoke_result", { id, generation: stopped.generation, provider });
    return { local: "revoked" as const, provider };
  }
  async purgeConnection(actor: Actor, id: string, requestId: string) {
    requireRequestId(requestId); await this.revokeConnection(actor, id, crypto.randomUUID());
    return this.repo.command(actor, requestId, "purge", { id });
  }
  async exportData(actor: Actor) { return this.repo.command(actor, crypto.randomUUID(), "export", {}); }
  async readSelectedSource(actor: Actor, sourceId: string): Promise<StudioSource> {
    // A tool read does not persist a model response or mint a request-bound model permit.
    await this.authorizeSources(actor, [sourceId], "read");
    const result = await this.repo.command(actor, crypto.randomUUID(), "source_refs", { sourceIds: [sourceId] });
    const source = (result.sources as StudioSource[])[0];
    if (!source?.integration || source.revoked_at || source.integration.availability === "revoked" || !source.integration.model_allowed) throw new IntegrationError("SOURCE_UNAVAILABLE", 403);
    const meta = source.integration, resource = (await this.repo.resources(actor, meta.connection_id)).find(row => row.id === meta.resource_id);
    if (!resource || resource.generation !== meta.generation || resource.version !== meta.source_version || resource.contentHash !== meta.content_hash || (resource.snapshotId && resource.snapshotId !== meta.snapshot_id)) throw new IntegrationError("SOURCE_CHANGED", 409);
    if (resource.rights === "unknown") throw new IntegrationError("SOURCE_PRIVATE", 403);
    if (!resource.selected || resource.availability === "revoked") throw new IntegrationError("SOURCE_UNAVAILABLE", 403);
    await this.owned(actor, meta.connection_id, meta.generation);
    return source;
  }
  async expireData(actor: Actor) { return this.repo.command(actor, crypto.randomUUID(), "expire", { now: this.clock().toISOString() }); }
}
