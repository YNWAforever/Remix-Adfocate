import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  CREATOR_GROWTH_STORAGE_BUCKET,
  GrowthRepositoryError,
  assertGrowthId,
  assertGrowthMutationContext,
  assertGrowthOwner,
  type GrowthAnalysisInput,
  type GrowthAnalysisRecord,
  type GrowthAssetInput,
  type GrowthAssetRecord,
  type GrowthCleanupResult,
  type GrowthConsentInput,
  type GrowthConsentRecord,
  type GrowthDraftInput,
  type GrowthDraftRecord,
  type GrowthDraftStatusInput,
  type GrowthEventInput,
  type GrowthEventRecord,
  type GrowthMediaSourceInput,
  type GrowthMediaSourceRecord,
  type GrowthMutationContext,
  type GrowthOwner,
  type GrowthOwnerExport,
  type GrowthPurgeReceipt,
  type GrowthRepository,
  type GrowthRouteCommand,
  type GrowthRouteCommandInput,
  type GrowthRoutePlan,
  type GrowthRetentionResult,
  type GrowthSkillInvocationInput,
  type GrowthSkillInvocationRecord,
  type GrowthStorageCleanupRecord,
} from "./repository.js";

type MemoryOwner = Readonly<{
  owner: GrowthOwner;
  status: "active" | "suspended" | "deleted";
}>;

type MemoryConnection = Readonly<{
  owner: GrowthOwner;
  id: string;
  generation: number;
  status: "connected" | "partial" | "reauth_required" | "revoked";
}>;

type MemoryThread = Readonly<{
  owner: GrowthOwner;
  id: string;
}>;

type MemoryRepositoryOptions = Readonly<{
  owners: readonly MemoryOwner[];
  connections: readonly MemoryConnection[];
  threads: readonly MemoryThread[];
  now?: () => Date;
  idFactory?: () => string;
  storageRemover?: (objectPath: string) => Promise<void>;
}>;

type InternalAsset = Readonly<{
  record: GrowthAssetRecord;
  storagePath: string;
}>;

type QueuedCleanup = GrowthStorageCleanupRecord &
  Readonly<{
    createdAt: string;
    maxAttempts: number;
  }>;

type CommandReceipt = Readonly<{
  action: string;
  payloadHash: string;
  entityId: string | null;
  resultHint: Readonly<Record<string, number | string | null>>;
  expiresAt: string;
}>;

type RetainedCommandReceipt = CommandReceipt &
  Readonly<{
    owner: GrowthOwner;
  }>;

type MutationState = Readonly<{
  entityId: string | null;
  resultHint?: Readonly<Record<string, number | string | null>>;
}>;

const MAX_CANONICAL_SKILL_SOURCES = 12;

function ownerKey(owner: GrowthOwner): string {
  return `${owner.workspaceId}:${owner.creatorId}`;
}

function scopedKey(owner: GrowthOwner, id: string): string {
  return `${ownerKey(owner)}:${id}`;
}

function connectionKey(owner: GrowthOwner, id: string): string {
  return scopedKey(owner, id);
}

function addHours(value: string, hours: number): string {
  return new Date(new Date(value).getTime() + hours * 60 * 60 * 1000).toISOString();
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function addMilliseconds(value: string, milliseconds: number): string {
  return new Date(new Date(value).getTime() + milliseconds).toISOString();
}

function sameTimestamp(left: unknown, right: unknown): boolean {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const leftTime = new Date(left).getTime();
  const rightTime = new Date(right).getTime();
  return Number.isFinite(leftTime) &&
    Number.isFinite(rightTime) &&
    leftTime === rightTime;
}

function extensionForMime(mime: GrowthAssetInput["mime"]): string {
  return mime === "image/jpeg" ? "jpg" : mime === "image/png" ? "png" : "webp";
}

function storagePath(owner: GrowthOwner, asset: GrowthAssetInput): string {
  return `${owner.workspaceId}/${owner.creatorId}/${asset.threadId}/${asset.id}.${extensionForMime(asset.mime)}`;
}

export class MemoryGrowthRepository implements GrowthRepository {
  private readonly owners = new Map<string, MemoryOwner>();
  private readonly connections = new Map<string, MemoryConnection>();
  private readonly threads = new Map<string, MemoryThread>();
  private readonly assets = new Map<string, InternalAsset>();
  private readonly physicalStorage = new Map<string, Uint8Array>();
  private readonly mediaSources = new Map<string, GrowthMediaSourceRecord>();
  private readonly consents = new Map<string, GrowthConsentRecord>();
  private readonly analyses = new Map<string, GrowthAnalysisRecord>();
  private readonly skills = new Map<string, GrowthSkillInvocationRecord>();
  private readonly drafts = new Map<string, GrowthDraftRecord>();
  private readonly events = new Map<string, GrowthEventRecord>();
  private readonly cleanup = new Map<string, QueuedCleanup>();
  private readonly routeCommands = new Map<string, GrowthRouteCommand & { input: GrowthRouteCommandInput; invalidatedAt: string | null; expiresAt: string }>();
  private readonly commandReceipts = new Map<string, RetainedCommandReceipt>();
  private readonly now: () => Date;
  private readonly idFactory: () => string;
  private readonly storageRemover: (objectPath: string) => Promise<void>;

  constructor(options: MemoryRepositoryOptions) {
    for (const entry of options.owners) {
      assertGrowthOwner(entry.owner);
      this.owners.set(ownerKey(entry.owner), Object.freeze({ ...entry }));
    }
    for (const entry of options.connections) {
      assertGrowthOwner(entry.owner);
      this.connections.set(
        connectionKey(entry.owner, entry.id),
        Object.freeze({ ...entry }),
      );
    }
    for (const entry of options.threads) {
      assertGrowthOwner(entry.owner);
      this.threads.set(scopedKey(entry.owner, entry.id), Object.freeze({ ...entry }));
    }
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? randomUUID;
    this.storageRemover = options.storageRemover ?? (async (objectPath) => {
      this.physicalStorage.delete(objectPath);
    });
  }

  private requireOwner(owner: GrowthOwner, allowSuspended = false): void {
    assertGrowthOwner(owner);
    const entry = this.owners.get(ownerKey(owner));
    if (entry === undefined) {
      throw new GrowthRepositoryError(
        "NOT_ACTIVE_CREATOR",
        "The creator is not active in this workspace.",
      );
    }
    if (
      entry.status === "deleted" ||
      (!allowSuspended && entry.status !== "active")
    ) {
      throw new GrowthRepositoryError(
        "NOT_ACTIVE_CREATOR",
        "The creator is not active in this workspace.",
      );
    }
  }

  private previousReceipt(
    owner: GrowthOwner,
    context: GrowthMutationContext,
    action: string,
    payload: unknown,
  ): CommandReceipt | null {
    assertGrowthMutationContext(context);
    const key = scopedKey(owner, context.idempotencyKey);
    const receipt = this.commandReceipts.get(key);
    if (receipt === undefined) return null;
    if (new Date(receipt.expiresAt).getTime() <= this.now().getTime()) {
      this.commandReceipts.delete(key);
      throw new GrowthRepositoryError(
        "IDEMPOTENCY_EXPIRED",
        "The idempotency context has expired.",
      );
    }
    if (receipt.action !== action || receipt.payloadHash !== digest(payload)) {
      throw new GrowthRepositoryError(
        "IDEMPOTENCY_CONFLICT",
        "The idempotency context belongs to a different command.",
      );
    }
    return receipt;
  }

  private rememberReceipt(
    owner: GrowthOwner,
    context: GrowthMutationContext,
    action: string,
    payload: unknown,
    state: MutationState,
  ): void {
    assertGrowthMutationContext(context);
    const receipt = Object.freeze({
      owner: clone(owner),
      action,
      payloadHash: digest(payload),
      entityId: state.entityId,
      resultHint: Object.freeze({ ...(state.resultHint ?? {}) }),
      expiresAt: addHours(this.now().toISOString(), 90 * 24),
    });
    this.commandReceipts.set(
      scopedKey(owner, context.idempotencyKey),
      receipt,
    );
  }

  private requireConnection(
    owner: GrowthOwner,
    connectionId: string | null | undefined,
    generation: number | null | undefined,
  ): void {
    if (connectionId == null && generation == null) {
      return;
    }
    if (
      connectionId == null ||
      generation == null ||
      !Number.isInteger(generation) ||
      generation <= 0
    ) {
      throw new GrowthRepositoryError(
        "GENERATION_REVOKED",
        "A current connection generation is required.",
      );
    }
    const entry = this.connections.get(connectionKey(owner, connectionId));
    if (
      entry === undefined ||
      entry.generation !== generation ||
      (entry.status !== "connected" && entry.status !== "partial")
    ) {
      throw new GrowthRepositoryError(
        "GENERATION_REVOKED",
        "The connection generation is no longer current.",
      );
    }
  }

  private requireThread(owner: GrowthOwner, threadId: string): void {
    if (!this.threads.has(scopedKey(owner, threadId))) {
      throw new GrowthRepositoryError("NOT_FOUND", "Thread not found.");
    }
  }

  private requireSameThread(
    owner: GrowthOwner,
    expectedThreadId: string,
    actualThreadId: string,
    label: string,
  ): void {
    if (expectedThreadId !== actualThreadId) {
      throw new GrowthRepositoryError(
        "SOURCE_INVALIDATED",
        `${label} belongs to a different thread.`,
      );
    }
  }

  private requireAsset(owner: GrowthOwner, assetId: string | null | undefined): InternalAsset {
    if (assetId == null) {
      throw new GrowthRepositoryError("NOT_FOUND", "Asset not found.");
    }
    const asset = this.assets.get(scopedKey(owner, assetId));
    if (asset === undefined) {
      throw new GrowthRepositoryError("NOT_FOUND", "Asset not found.");
    }
    if (asset.record.uploadState !== "uploaded") {
      throw new GrowthRepositoryError(
        "STORAGE_UNAVAILABLE",
        "Asset upload is incomplete.",
      );
    }
    return asset;
  }

  private requireAnalysis(
    owner: GrowthOwner,
    analysisId: string | null | undefined,
  ): GrowthAnalysisRecord {
    if (analysisId == null) {
      throw new GrowthRepositoryError("NOT_FOUND", "Analysis not found.");
    }
    const analysis = this.analyses.get(scopedKey(owner, analysisId));
    if (analysis === undefined) {
      throw new GrowthRepositoryError("NOT_FOUND", "Analysis not found.");
    }
    if (analysis.invalidatedAt !== null) {
      throw new GrowthRepositoryError(
        "SOURCE_INVALIDATED",
        "The analysis source has been invalidated.",
      );
    }
    return analysis;
  }

  private requireUsableAnalysisSource(
    owner: GrowthOwner,
    source: GrowthMediaSourceRecord,
    analysisAssetId: string,
  ): void {
    if (source.rights !== "allowed") {
      throw new GrowthRepositoryError(
        "SOURCE_INVALIDATED",
        "The media source does not grant analysis rights.",
      );
    }
    if (source.sourceKind === "creator_upload") {
      if (source.assetId == null || source.assetId !== analysisAssetId) {
        throw new GrowthRepositoryError(
          "SOURCE_INVALIDATED",
          "Creator-upload provenance does not match the analysis asset.",
        );
      }
      this.requireAsset(owner, source.assetId);
      return;
    }
    if (
      source.visibility !== "public" ||
      source.matchStatus !== "matched"
    ) {
      throw new GrowthRepositoryError(
        "SOURCE_INVALIDATED",
        "The media source is not a verified public match.",
      );
    }
    if (source.sourceKind === "official_instagram") {
      this.requireConnection(owner, source.connectionId, source.generation);
    }
  }

  private requireCanonicalSkillSources(
    owner: GrowthOwner,
    threadId: string,
    assetId: string,
    mediaSourceIds: readonly string[],
  ): readonly GrowthMediaSourceRecord[] {
    if (
      !Array.isArray(mediaSourceIds) ||
      mediaSourceIds.length > MAX_CANONICAL_SKILL_SOURCES ||
      new Set(mediaSourceIds).size !== mediaSourceIds.length
    ) {
      throw new GrowthRepositoryError(
        "SOURCE_INVALIDATED",
        "Canonical skill sources are invalid or duplicated.",
      );
    }
    const sources: GrowthMediaSourceRecord[] = [];
    const claimKeys = new Set<string>();
    for (const mediaSourceId of mediaSourceIds) {
      assertGrowthId(mediaSourceId, "media source");
      const source = this.mediaSources.get(scopedKey(owner, mediaSourceId));
      if (
        source === undefined ||
        source.invalidatedAt !== null ||
        source.revokedAt !== null
      ) {
        throw new GrowthRepositoryError(
          "SOURCE_INVALIDATED",
          "A canonical skill source is unavailable.",
        );
      }
      this.requireSameThread(owner, threadId, source.threadId, "Media source");
      if (source.assetId != null && source.assetId !== assetId) {
        throw new GrowthRepositoryError(
          "SOURCE_INVALIDATED",
          "A canonical skill source names another asset.",
        );
      }
      this.requireUsableAnalysisSource(owner, source, assetId);
      const claimKey = `${source.sourceKind}:${source.sourceRef}`;
      if (claimKeys.has(claimKey)) {
        throw new GrowthRepositoryError(
          "SOURCE_INVALIDATED",
          "Canonical skill sources contain duplicate claims.",
        );
      }
      claimKeys.add(claimKey);
      sources.push(source);
    }
    return Object.freeze(sources);
  }

  private validateSkillReport(
    invocation: GrowthSkillInvocationInput,
    analysis: GrowthAnalysisRecord,
    asset: InternalAsset,
    mediaSources: readonly GrowthMediaSourceRecord[],
  ): void {
    const invalid = (message: string): never => {
      throw new GrowthRepositoryError("SOURCE_INVALIDATED", message);
    };
    const report = invocation.report;
    const assetId = asset.record.id;
    const assetSha256 = asset.record.sha256;
    const observation = report.observation as unknown;
    if (
      observation === null ||
      typeof observation !== "object" ||
      Array.isArray(observation)
    ) {
      invalid("The report observation must be an object.");
    }
    const observationRecord = observation as Readonly<Record<string, unknown>>;
    if (
      typeof observationRecord.assetId !== "string" ||
      typeof observationRecord.sha256 !== "string" ||
      typeof observationRecord.sourceKind !== "string" ||
      typeof observationRecord.sampleOnly !== "boolean" ||
      typeof observationRecord.availability !== "string" ||
      typeof observationRecord.captionAlignment !== "string" ||
      !Array.isArray(observationRecord.objects) ||
      !Array.isArray(observationRecord.visibleText) ||
      !Array.isArray(observationRecord.composition) ||
      !Array.isArray(observationRecord.uncertainties) ||
      (
        observationRecord.reason !== null &&
        typeof observationRecord.reason !== "string"
      )
    ) {
      invalid("The report observation fields are invalid.");
    }
    if (
      typeof report.sampleOnly !== "boolean" ||
      typeof invocation.result.sampleOnly !== "boolean"
    ) {
      invalid("Report and result sample flags must be booleans.");
    }
    const canonicalObservation = analysis.result.observation;
    const expectedObservation = {
      ...canonicalObservation,
      reason: canonicalObservation.reason ?? null,
      sourceKind: asset.record.sourceKind,
      assetId,
      sha256: assetSha256,
    };
    if (!isDeepStrictEqual(observationRecord, expectedObservation)) {
      invalid("The report observation differs from the canonical analysis.");
    }
    if (
      observationRecord.assetId !== assetId ||
      observationRecord.sha256 !== assetSha256 ||
      observationRecord.sourceKind !== asset.record.sourceKind ||
      observationRecord.sampleOnly !== asset.record.sampleOnly
    ) {
      invalid("The report observation does not match the canonical asset.");
    }

    const officialSources = new Map<string, GrowthMediaSourceRecord>();
    const publicSources = new Map<string, GrowthMediaSourceRecord>();
    for (const source of mediaSources) {
      const values = source.sourceKind === "official_instagram"
        ? officialSources
        : source.sourceKind === "public_image_mock"
          ? publicSources
          : null;
      values?.set(source.sourceRef, source);
    }

    const citationKeys = new Set<string>();
    const claimedSourceIds = new Set<string>();
    for (const citation of report.citations) {
      const key = `${citation.sourceKind}:${citation.sourceRef}`;
      if (citationKeys.has(key)) invalid("The report contains duplicate citations.");
      citationKeys.add(key);
      if (
        citation.sourceKind === "official_metrics" &&
        !officialSources.has(citation.sourceRef)
      ) {
        invalid("An official citation is outside the canonical source list.");
      }
      if (
        citation.sourceKind === "official_metrics" &&
        officialSources.has(citation.sourceRef)
      ) {
        const source = officialSources.get(citation.sourceRef)!;
        if (
          typeof citation.sampleOnly !== "boolean" ||
          citation.sampleOnly !== source.sampleOnly ||
          !sameTimestamp(citation.observedAt, source.observedAt)
        ) {
          invalid("An official citation does not match its canonical source.");
        }
        claimedSourceIds.add(source.id);
      }
      if (
        citation.sourceKind === "public_image_mock" &&
        !publicSources.has(citation.sourceRef)
      ) {
        invalid("A public-image citation is outside the canonical source list.");
      }
      if (
        citation.sourceKind === "public_image_mock" &&
        publicSources.has(citation.sourceRef)
      ) {
        const source = publicSources.get(citation.sourceRef)!;
        if (
          typeof citation.sampleOnly !== "boolean" ||
          citation.sampleOnly !== source.sampleOnly ||
          !sameTimestamp(citation.observedAt, source.observedAt)
        ) {
          invalid("A public citation does not match its canonical source.");
        }
        claimedSourceIds.add(source.id);
      }
      if (
        citation.sourceKind === "self_upload_manual" &&
        citation.sourceRef !== `asset:${assetId}`
      ) {
        invalid("The self-upload citation does not match the canonical asset.");
      }
    }

    const requireCitation = (
      sourceKind: "official_metrics" | "public_image_mock" | "self_upload_manual",
      sourceRef: string,
    ): void => {
      if (!citationKeys.has(`${sourceKind}:${sourceRef}`)) {
        invalid("Report provenance is missing its canonical citation.");
      }
    };
    const requireOfficial = (sourceRef: string): void => {
      if (!officialSources.has(sourceRef)) {
        invalid("An official source reference is not canonical.");
      }
      requireCitation("official_metrics", sourceRef);
    };

    const officialProvenanceRefs = new Set<string>();
    for (const provenance of report.provenance.officialMetrics) {
      if (officialProvenanceRefs.has(provenance.sourceRef)) {
        invalid("Official provenance contains duplicate claims.");
      }
      officialProvenanceRefs.add(provenance.sourceRef);
      requireOfficial(provenance.sourceRef);
      const source = officialSources.get(provenance.sourceRef)!;
      if (
        typeof provenance.sampleOnly !== "boolean" ||
        provenance.sampleOnly !== source.sampleOnly ||
        !sameTimestamp(provenance.observedAt, source.observedAt)
      ) {
        invalid("Official provenance does not match its canonical source.");
      }
      claimedSourceIds.add(source.id);
    }
    for (const metric of report.metrics) {
      if (
        (metric.status === "available" || metric.value !== null) &&
        metric.sourceRef === null
      ) {
        invalid("An available metric is missing its canonical source.");
      }
      if (metric.sourceRef !== null) {
        requireOfficial(metric.sourceRef);
        if (!officialProvenanceRefs.has(metric.sourceRef)) {
          invalid("An available metric is missing official provenance.");
        }
        claimedSourceIds.add(officialSources.get(metric.sourceRef)!.id);
      }
    }
    for (const metric of report.period.metrics) {
      requireOfficial(metric.sourceRef);
      if (!officialProvenanceRefs.has(metric.sourceRef)) {
        invalid("A metric period is missing official provenance.");
      }
      claimedSourceIds.add(officialSources.get(metric.sourceRef)!.id);
    }

    const publicProvenance = report.provenance.publicImageMock;
    if (publicProvenance !== null) {
      const source = publicSources.get(publicProvenance.sourceRef);
      if (source === undefined) {
        throw new GrowthRepositoryError(
          "SOURCE_INVALIDATED",
          "Public-image provenance is outside the canonical chain.",
        );
      }
      if (
        publicProvenance.assetId !== assetId ||
        publicProvenance.sha256 !== assetSha256 ||
        typeof publicProvenance.sampleOnly !== "boolean" ||
        publicProvenance.sampleOnly !== source.sampleOnly ||
        !sameTimestamp(publicProvenance.observedAt, source.observedAt)
      ) {
        invalid("Public-image provenance is outside the canonical chain.");
      }
      requireCitation("public_image_mock", publicProvenance.sourceRef);
      claimedSourceIds.add(source.id);
    }

    const selfProvenance = report.provenance.selfUploadManual;
    if (selfProvenance !== null) {
      if (
        selfProvenance.assetId !== assetId ||
        selfProvenance.sha256 !== assetSha256 ||
        selfProvenance.sourceKind !== asset.record.sourceKind ||
        selfProvenance.sourceRef !== `asset:${assetId}`
      ) {
        invalid("Self-upload provenance does not match the canonical asset.");
      }
      requireCitation("self_upload_manual", selfProvenance.sourceRef);
    }

    if (new Set(invocation.result.sourceRefs).size !== invocation.result.sourceRefs.length) {
      invalid("Result source references contain duplicates.");
    }
    for (const sourceRef of invocation.result.sourceRefs) {
      if (
        !citationKeys.has(`official_metrics:${sourceRef}`) &&
        !citationKeys.has(`public_image_mock:${sourceRef}`) &&
        !citationKeys.has(`self_upload_manual:${sourceRef}`) &&
        !sourceRef.startsWith("native:") &&
        !sourceRef.startsWith("curated:")
      ) {
        invalid("A result source reference is not a canonical citation.");
      }
    }

    if (
      claimedSourceIds.size !== mediaSources.length ||
      mediaSources.some((source) => !claimedSourceIds.has(source.id))
    ) {
      invalid("Canonical media-source IDs do not equal the claimed source set.");
    }
    const canonicalSampleOnly =
      asset.record.sampleOnly ||
      mediaSources.some((source) => source.sampleOnly);
    if (
      report.sampleOnly !== canonicalSampleOnly ||
      invocation.result.sampleOnly !== canonicalSampleOnly
    ) {
      invalid("Report and result sample flags do not match canonical sources.");
    }

    if (
      analysis.assetId !== assetId ||
      analysis.threadId !== invocation.threadId ||
      analysis.invalidatedAt !== null
    ) {
      invalid("The skill analysis is outside the canonical chain.");
    }
  }

  private queueCleanup(
    owner: GrowthOwner,
    objectPath: string,
    reason: GrowthStorageCleanupRecord["reason"],
    timestamp: string,
  ): Readonly<{ item: QueuedCleanup; inserted: boolean }> {
    const existing = [...this.cleanup.values()].find(
      (item) =>
        item.bucket === CREATOR_GROWTH_STORAGE_BUCKET &&
        item.objectPath === objectPath,
    );
    if (existing !== undefined) {
      return Object.freeze({ item: existing, inserted: false });
    }
    const item: QueuedCleanup = Object.freeze({
      id: this.idFactory(),
      bucket: CREATOR_GROWTH_STORAGE_BUCKET,
      objectPath,
      reason,
      state: "queued" as const,
      availableAt: timestamp,
      completedAt: null,
      attempts: 0,
      leaseToken: null,
      leaseExpiresAt: null,
      lastError: null,
      createdAt: timestamp,
      maxAttempts: 5,
    });
    this.cleanup.set(scopedKey(owner, item.id), item);
    return Object.freeze({ item, inserted: true });
  }

  private deleteReceiptsForEntity(
    owner: GrowthOwner,
    entityIds: ReadonlySet<string>,
  ): void {
    for (const [key, receipt] of this.commandReceipts) {
      if (
        key.startsWith(`${ownerKey(owner)}:`) &&
        receipt.entityId !== null &&
        entityIds.has(receipt.entityId)
      ) {
        this.commandReceipts.delete(key);
      }
    }
  }

  async routeCommand(
    owner: GrowthOwner,
    input: GrowthRouteCommandInput,
    context: GrowthMutationContext,
    plan?: GrowthRoutePlan,
  ): Promise<GrowthRouteCommand> {
    this.requireOwner(owner);
    assertGrowthMutationContext(context);
    this.requireThread(owner, input.threadId);
    if (
      !/^[a-f0-9]{64}$/.test(input.requestHash) ||
      !["analyse", "skills", "media/select"].includes(input.operation)
    ) {
      throw new GrowthRepositoryError(
        "INVALID_IDEMPOTENCY_CONTEXT",
        "Invalid command.",
      );
    }
    const key = scopedKey(owner, context.idempotencyKey);
    let state = this.routeCommands.get(key);
    if (
      state &&
      (state.input.requestHash !== input.requestHash ||
        state.input.operation !== input.operation ||
        state.input.threadId !== input.threadId)
    ) {
      throw new GrowthRepositoryError(
        "IDEMPOTENCY_CONFLICT",
        "The command has changed.",
      );
    }
    if (state?.invalidatedAt)
      throw new GrowthRepositoryError("SOURCE_INVALIDATED", "Command invalidated.");
    if (state && Date.parse(state.expiresAt) <= this.now().getTime())
      throw new GrowthRepositoryError("IDEMPOTENCY_EXPIRED", "Command expired.");
    // Recheck the ORIGINAL binding, not new caller-selected metadata on replay.
    const binding = state?.input ?? input;
    this.requireConnection(owner, binding.connectionId, binding.generation);
    if (binding.assetId) {
      const asset = this.requireAsset(owner, binding.assetId);
      this.requireSameThread(owner, binding.threadId, asset.record.threadId, "Asset");
    }
    if (binding.analysisId) {
      const analysis = this.requireAnalysis(owner, binding.analysisId);
      this.requireSameThread(owner, binding.threadId, analysis.threadId, "Analysis");
    }
    if (binding.mediaSourceIds.length) {
      this.requireCanonicalSkillSources(
        owner,
        binding.threadId,
        binding.assetId ?? "",
        binding.mediaSourceIds,
      );
    }
    if (!state) {
      const startedAt = this.now().toISOString();
      state = {
        input: clone(input),
        startedAt,
        plan: null,
        invalidatedAt: null,
        expiresAt: addHours(startedAt, 90 * 24),
      };
    }
    if (plan && state.plan === null) {
      if (
        plan.operation !== binding.operation ||
        Buffer.byteLength(JSON.stringify(plan)) > 262144
      )
        throw new GrowthRepositoryError("SOURCE_INVALIDATED", "Invalid preparation.");
      state = { ...state, plan: clone(plan) };
    }
    this.routeCommands.set(key, state);
    return clone({ startedAt: state.startedAt, plan: state.plan });
  }

  async putAsset(
    owner: GrowthOwner,
    asset: GrowthAssetInput,
    context: GrowthMutationContext,
  ): Promise<GrowthAssetRecord> {
    this.requireOwner(owner);
    const receipt = this.previousReceipt(owner, context, "put_asset", {
      id: asset.id,
      threadId: asset.threadId,
      sha256: asset.sha256,
      mime: asset.mime,
      byteSize: asset.byteSize,
      width: asset.width,
      height: asset.height,
      sourceKind: asset.sourceKind,
      sampleOnly: asset.sampleOnly,
      fixtureId: asset.fixtureId ?? null,
    });
    if (receipt?.entityId !== null && receipt?.entityId !== undefined) {
      return clone(this.requireAsset(owner, receipt.entityId).record);
    }
    assertGrowthId(asset.id, "asset");
    assertGrowthId(asset.threadId, "thread");
    if ((asset.sourceKind === "synthetic-fixture") !== asset.sampleOnly) {
      throw new GrowthRepositoryError(
        "SOURCE_INVALIDATED",
        "Asset source kind and sample status are inconsistent.",
      );
    }
    this.requireThread(owner, asset.threadId);
    const createdAt = asset.createdAt ?? this.now().toISOString();
    const path = storagePath(owner, asset);
    const record = Object.freeze({
      id: asset.id,
      threadId: asset.threadId,
      sha256: asset.sha256,
      mime: asset.mime,
      byteSize: asset.byteSize,
      width: asset.width,
      height: asset.height,
      rightsConfirmed: true as const,
      sourceKind: asset.sourceKind,
      sampleOnly: asset.sampleOnly,
      fixtureId: asset.fixtureId ?? null,
      uploadState: "uploaded" as const,
      createdAt,
      expiresAt: addHours(createdAt, 24),
    });
    this.assets.set(scopedKey(owner, asset.id), { record, storagePath: path });
    this.physicalStorage.set(path, Uint8Array.from(asset.bytes));
    this.rememberReceipt(owner, context, "put_asset", {
      id: asset.id,
      threadId: asset.threadId,
      sha256: asset.sha256,
      mime: asset.mime,
      byteSize: asset.byteSize,
      width: asset.width,
      height: asset.height,
      sourceKind: asset.sourceKind,
      sampleOnly: asset.sampleOnly,
      fixtureId: asset.fixtureId ?? null,
    }, { entityId: asset.id });
    return clone(record);
  }

  async getAssetBytes(owner: GrowthOwner, assetId: string): Promise<Uint8Array> {
    this.requireOwner(owner);
    const asset = this.requireAsset(owner, assetId);
    const content = this.physicalStorage.get(asset.storagePath);
    if (content === undefined) {
      throw new GrowthRepositoryError("STORAGE_UNAVAILABLE", "Asset bytes are unavailable.");
    }
    return Uint8Array.from(content);
  }

  async saveMediaSource(
    owner: GrowthOwner,
    source: GrowthMediaSourceInput,
    context: GrowthMutationContext,
  ): Promise<GrowthMediaSourceRecord> {
    this.requireOwner(owner);
    const receipt = this.previousReceipt(
      owner,
      context,
      "save_media_source",
      source,
    );
    if (receipt?.entityId !== null && receipt?.entityId !== undefined) {
      const existing = this.mediaSources.get(scopedKey(owner, receipt.entityId));
      if (
        existing === undefined ||
        existing.invalidatedAt !== null ||
        existing.revokedAt !== null
      ) {
        throw new GrowthRepositoryError(
          "SOURCE_INVALIDATED",
          "The saved media source has been invalidated.",
        );
      }
      return clone(existing);
    }
    this.requireThread(owner, source.threadId);
    if (source.sourceKind === "creator_upload" && source.assetId == null) {
      throw new GrowthRepositoryError("NOT_FOUND", "Creator-upload provenance requires an asset.");
    }
    if (source.sourceKind === "official_instagram" && source.connectionId == null) {
      throw new GrowthRepositoryError(
        "GENERATION_REVOKED",
        "Official media requires a connection generation.",
      );
    }
    if (source.assetId != null) {
      const asset = this.requireAsset(owner, source.assetId);
      this.requireSameThread(owner, source.threadId, asset.record.threadId, "Asset");
    }
    this.requireConnection(owner, source.connectionId, source.generation);
    const record = Object.freeze({
      ...clone(source),
      assetId: source.assetId ?? null,
      connectionId: source.connectionId ?? null,
      generation: source.generation ?? null,
      createdAt: source.createdAt ?? this.now().toISOString(),
      invalidatedAt: null,
      revokedAt: null,
    });
    this.mediaSources.set(scopedKey(owner, source.id), record);
    this.rememberReceipt(owner, context, "save_media_source", source, {
      entityId: source.id,
    });
    return clone(record);
  }

  async saveConsent(
    owner: GrowthOwner,
    consent: GrowthConsentInput,
    context: GrowthMutationContext,
  ): Promise<GrowthConsentRecord> {
    this.requireOwner(owner);
    const receipt = this.previousReceipt(owner, context, "save_consent", consent);
    if (receipt?.entityId !== null && receipt?.entityId !== undefined) {
      const existing = this.consents.get(scopedKey(owner, receipt.entityId));
      if (
        existing === undefined ||
        existing.revokedAt !== null ||
        new Date(existing.expiresAt).getTime() <= this.now().getTime()
      ) {
        throw new GrowthRepositoryError(
          "SOURCE_INVALIDATED",
          "The saved consent has been invalidated.",
        );
      }
      return clone(existing);
    }
    this.requireConnection(owner, consent.connectionId, consent.generation);
    const record = Object.freeze({
      ...clone(consent),
      connectionId: consent.connectionId ?? null,
      generation: consent.generation ?? null,
      revokedAt: null,
    });
    this.consents.set(scopedKey(owner, consent.id), record);
    this.rememberReceipt(owner, context, "save_consent", consent, {
      entityId: consent.id,
    });
    return clone(record);
  }

  async saveAnalysis(
    owner: GrowthOwner,
    analysis: GrowthAnalysisInput,
    context: GrowthMutationContext,
  ): Promise<GrowthAnalysisRecord> {
    this.requireOwner(owner);
    const receipt = this.previousReceipt(owner, context, "save_analysis", analysis);
    if (receipt?.entityId !== null && receipt?.entityId !== undefined) {
      const existing = this.requireAnalysis(owner, receipt.entityId);
      return clone(existing);
    }
    this.requireThread(owner, analysis.threadId);
    const asset = this.requireAsset(owner, analysis.assetId);
    this.requireSameThread(owner, analysis.threadId, asset.record.threadId, "Asset");
    if (
      analysis.result.binding.assetId !== analysis.assetId ||
      analysis.result.binding.sha256 !== asset.record.sha256 ||
      analysis.result.binding.sourceKind !== asset.record.sourceKind ||
      (analysis.result.binding.fixtureId ?? null) !== asset.record.fixtureId
    ) {
      throw new GrowthRepositoryError(
        "SOURCE_INVALIDATED",
        "The analysis binding does not match the canonical asset.",
      );
    }
    let connectionId = analysis.connectionId ?? null;
    let generation = analysis.generation ?? null;
    if (analysis.mediaSourceId != null) {
      const source = this.mediaSources.get(scopedKey(owner, analysis.mediaSourceId));
      if (source === undefined) {
        throw new GrowthRepositoryError("NOT_FOUND", "Media source not found.");
      }
      if (source.invalidatedAt !== null || source.revokedAt !== null) {
        throw new GrowthRepositoryError(
          "SOURCE_INVALIDATED",
          "The media source has been invalidated.",
        );
      }
      this.requireSameThread(owner, analysis.threadId, source.threadId, "Media source");
      if (source.assetId != null && source.assetId !== analysis.assetId) {
        throw new GrowthRepositoryError(
          "SOURCE_INVALIDATED",
          "The media source does not match the analysis asset.",
        );
      }
      this.requireUsableAnalysisSource(owner, source, analysis.assetId);
      const sourceConnectionId = source.connectionId ?? null;
      const sourceGeneration = source.generation ?? null;
      if (sourceConnectionId !== null) {
        if (
          connectionId !== null &&
          (connectionId !== sourceConnectionId || generation !== sourceGeneration)
        ) {
          throw new GrowthRepositoryError(
            "SOURCE_INVALIDATED",
            "The analysis has conflicting connection lineage.",
          );
        }
        connectionId = sourceConnectionId;
        generation = sourceGeneration;
      }
    }
    if (analysis.consentId != null) {
      const consent = this.consents.get(scopedKey(owner, analysis.consentId));
      if (
        consent === undefined ||
        consent.processor !== analysis.processor ||
        consent.revokedAt !== null ||
        new Date(consent.expiresAt).getTime() <= this.now().getTime()
      ) {
        throw new GrowthRepositoryError(
          "SOURCE_INVALIDATED",
          "The processing consent is unavailable.",
        );
      }
      const consentConnectionId = consent.connectionId ?? null;
      const consentGeneration = consent.generation ?? null;
      if (consentConnectionId !== null) {
        if (
          connectionId !== null &&
          (connectionId !== consentConnectionId || generation !== consentGeneration)
        ) {
          throw new GrowthRepositoryError(
            "SOURCE_INVALIDATED",
            "The analysis has conflicting connection lineage.",
          );
        }
        connectionId = consentConnectionId;
        generation = consentGeneration;
      }
    }
    this.requireConnection(owner, connectionId, generation);
    const record = Object.freeze({
      ...clone(analysis),
      connectionId,
      generation,
      createdAt: analysis.createdAt ?? this.now().toISOString(),
      invalidatedAt: null,
    });
    this.analyses.set(scopedKey(owner, analysis.id), record);
    this.rememberReceipt(owner, context, "save_analysis", analysis, {
      entityId: analysis.id,
    });
    return clone(record);
  }

  async saveSkillInvocation(
    owner: GrowthOwner,
    invocation: GrowthSkillInvocationInput,
    context: GrowthMutationContext,
  ): Promise<GrowthSkillInvocationRecord> {
    this.requireOwner(owner);
    const receipt = this.previousReceipt(
      owner,
      context,
      "save_skill_invocation",
      invocation,
    );
    if (receipt?.entityId !== null && receipt?.entityId !== undefined) {
      const existing = this.skills.get(scopedKey(owner, receipt.entityId));
      if (existing === undefined || existing.invalidatedAt !== null) {
        throw new GrowthRepositoryError(
          "SOURCE_INVALIDATED",
          "The saved skill invocation has been invalidated.",
        );
      }
      return clone(existing);
    }
    this.requireThread(owner, invocation.threadId);
    const analysis = this.requireAnalysis(owner, invocation.analysisId);
    this.requireSameThread(
      owner,
      invocation.threadId,
      analysis.threadId,
      "Analysis",
    );
    const asset = this.requireAsset(owner, analysis.assetId);
    this.requireSameThread(owner, invocation.threadId, asset.record.threadId, "Asset");
    const mediaSources = this.requireCanonicalSkillSources(
      owner,
      invocation.threadId,
      asset.record.id,
      invocation.mediaSourceIds,
    );
    this.validateSkillReport(invocation, analysis, asset, mediaSources);
    const record = Object.freeze({
      ...clone(invocation),
      mediaSourceIds: Object.freeze([...invocation.mediaSourceIds]),
      createdAt: invocation.createdAt ?? this.now().toISOString(),
      invalidatedAt: null,
    });
    this.skills.set(scopedKey(owner, invocation.id), record);
    this.rememberReceipt(owner, context, "save_skill_invocation", invocation, {
      entityId: invocation.id,
    });
    return clone(record);
  }

  async saveDraft(
    owner: GrowthOwner,
    draft: GrowthDraftInput,
    context: GrowthMutationContext,
  ): Promise<GrowthDraftRecord> {
    this.requireOwner(owner);
    const receipt = this.previousReceipt(owner, context, "save_draft", draft);
    if (receipt?.entityId !== null && receipt?.entityId !== undefined) {
      const existing = this.drafts.get(scopedKey(owner, receipt.entityId));
      if (existing === undefined) {
        throw new GrowthRepositoryError("NOT_FOUND", "Draft not found.");
      }
      if (existing.status === "invalidated" || existing.invalidatedAt !== null) {
        throw new GrowthRepositoryError(
          "SOURCE_INVALIDATED",
          "The saved draft has been invalidated.",
        );
      }
      return clone(existing);
    }
    this.requireThread(owner, draft.threadId);
    if (draft.analysisId != null && draft.assetId == null) {
      throw new GrowthRepositoryError(
        "SOURCE_INVALIDATED",
        "A derived draft requires its analysis asset.",
      );
    }
    if (draft.skillInvocationId != null && draft.analysisId == null) {
      throw new GrowthRepositoryError(
        "SOURCE_INVALIDATED",
        "A skill-derived draft requires its analysis.",
      );
    }
    let asset: InternalAsset | null = null;
    if (draft.assetId != null) {
      asset = this.requireAsset(owner, draft.assetId);
      this.requireSameThread(owner, draft.threadId, asset.record.threadId, "Asset");
    }
    let analysis: GrowthAnalysisRecord | null = null;
    if (draft.analysisId != null) {
      analysis = this.requireAnalysis(owner, draft.analysisId);
      this.requireSameThread(owner, draft.threadId, analysis.threadId, "Analysis");
      if (asset !== null && analysis.assetId !== asset.record.id) {
        throw new GrowthRepositoryError(
          "SOURCE_INVALIDATED",
          "Draft asset and analysis lineage do not match.",
        );
      }
    }
    if (draft.skillInvocationId != null) {
      const skill = this.skills.get(scopedKey(owner, draft.skillInvocationId));
      if (skill === undefined) {
        throw new GrowthRepositoryError("NOT_FOUND", "Skill invocation not found.");
      }
      if (skill.invalidatedAt !== null) {
        throw new GrowthRepositoryError(
          "SOURCE_INVALIDATED",
          "The skill invocation has been invalidated.",
        );
      }
      this.requireSameThread(owner, draft.threadId, skill.threadId, "Skill invocation");
      if (analysis !== null && skill.analysisId !== analysis.id) {
        throw new GrowthRepositoryError(
          "SOURCE_INVALIDATED",
          "Draft analysis and skill lineage do not match.",
        );
      }
    }
    const current = this.drafts.get(scopedKey(owner, draft.id));
    if (current !== undefined && current.status === "invalidated") {
      throw new GrowthRepositoryError(
        "SOURCE_INVALIDATED",
        "The draft source has been invalidated.",
      );
    }
    const currentRevision = current?.revision ?? 0;
    if (draft.expectedRevision !== currentRevision) {
      throw new GrowthRepositoryError(
        "REVISION_CONFLICT",
        "The draft revision is stale.",
      );
    }
    const timestamp = this.now().toISOString();
    const record = Object.freeze({
      id: draft.id,
      threadId: draft.threadId,
      assetId: draft.assetId ?? null,
      analysisId: draft.analysisId ?? null,
      skillInvocationId: draft.skillInvocationId ?? null,
      revision: currentRevision + 1,
      caption: draft.caption,
      manualDescription: draft.manualDescription,
      status: draft.status,
      terminalAt:
        draft.status === "completed" || draft.status === "cancelled"
          ? timestamp
          : null,
      invalidatedAt: null,
      createdAt: current?.createdAt ?? timestamp,
      updatedAt: timestamp,
    });
    this.drafts.set(scopedKey(owner, draft.id), record);
    this.rememberReceipt(owner, context, "save_draft", draft, {
      entityId: draft.id,
    });
    return clone(record);
  }

  async getPrivateDraft(
    owner: GrowthOwner,
    draftId: string,
  ): Promise<GrowthDraftRecord | null> {
    this.requireOwner(owner);
    const draft = this.drafts.get(scopedKey(owner, draftId));
    if (draft === undefined) return null;
    if (draft.invalidatedAt !== null || draft.status === "invalidated") {
      throw new GrowthRepositoryError(
        "SOURCE_INVALIDATED",
        "The draft source has been invalidated.",
      );
    }
    return clone(draft);
  }

  async setDraftStatus(
    owner: GrowthOwner,
    draftId: string,
    input: GrowthDraftStatusInput,
    context: GrowthMutationContext,
  ): Promise<GrowthDraftRecord> {
    this.requireOwner(owner);
    const receipt = this.previousReceipt(owner, context, "set_draft_status", {
      draftId,
      input,
    });
    if (receipt?.entityId !== null && receipt?.entityId !== undefined) {
      const existing = this.drafts.get(scopedKey(owner, receipt.entityId));
      if (existing === undefined) {
        throw new GrowthRepositoryError("NOT_FOUND", "Draft not found.");
      }
      if (existing.status === "invalidated" || existing.invalidatedAt !== null) {
        throw new GrowthRepositoryError("SOURCE_INVALIDATED", "Draft source is invalidated.");
      }
      return clone(existing);
    }
    const current = this.drafts.get(scopedKey(owner, draftId));
    if (current === undefined) {
      throw new GrowthRepositoryError("NOT_FOUND", "Draft not found.");
    }
    if (current.invalidatedAt !== null || current.status === "invalidated") {
      throw new GrowthRepositoryError("SOURCE_INVALIDATED", "Draft source is invalidated.");
    }
    if (current.revision !== input.expectedRevision) {
      throw new GrowthRepositoryError("REVISION_CONFLICT", "Draft revision is stale.");
    }
    const record = Object.freeze({
      ...current,
      revision: current.revision + 1,
      status: input.status,
      terminalAt:
        input.status === "completed" || input.status === "cancelled"
          ? input.changedAt
          : null,
      updatedAt: input.changedAt,
    });
    this.drafts.set(scopedKey(owner, draftId), record);
    this.rememberReceipt(owner, context, "set_draft_status", { draftId, input }, {
      entityId: draftId,
    });
    return clone(record);
  }

  async recordEvent(
    owner: GrowthOwner,
    event: GrowthEventInput,
    context: GrowthMutationContext,
  ): Promise<GrowthEventRecord> {
    this.requireOwner(owner);
    const receipt = this.previousReceipt(owner, context, "record_event", event);
    if (receipt?.entityId !== null && receipt?.entityId !== undefined) {
      const existing = this.events.get(scopedKey(owner, receipt.entityId));
      if (existing === undefined) {
        throw new GrowthRepositoryError("NOT_FOUND", "Event not found.");
      }
      return clone(existing);
    }
    const record = Object.freeze({
      ...clone(event),
      workspaceId: owner.workspaceId,
      creatorId: owner.creatorId,
    });
    this.events.set(scopedKey(owner, event.id), record);
    this.rememberReceipt(owner, context, "record_event", event, {
      entityId: event.id,
    });
    return clone(record);
  }

  async handleCanonicalIntegrationRevocation(
    owner: GrowthOwner,
    input: Readonly<{
      connectionId: string;
      generation: number;
      revokedAt: string;
    }>,
  ): Promise<void> {
    this.requireOwner(owner);
    const connection = this.connections.get(connectionKey(owner, input.connectionId));
    if (connection === undefined || connection.generation !== input.generation) {
      throw new GrowthRepositoryError(
        "GENERATION_REVOKED",
        "Connection generation is stale.",
      );
    }
    if (connection.status === "revoked") return;

    const mediaIds = new Set<string>();
    const consentIds = new Set<string>();
    for (const [key, source] of this.mediaSources) {
      if (
        key.startsWith(`${ownerKey(owner)}:`) &&
        source.connectionId === input.connectionId &&
        source.generation === input.generation &&
        source.invalidatedAt === null
      ) {
        mediaIds.add(source.id);
        this.mediaSources.set(
          key,
          Object.freeze({
            ...source,
            invalidatedAt: input.revokedAt,
            revokedAt: input.revokedAt,
          }),
        );
      }
    }
    for (const [key, consent] of this.consents) {
      if (
        key.startsWith(`${ownerKey(owner)}:`) &&
        consent.connectionId === input.connectionId &&
        consent.generation === input.generation &&
        consent.revokedAt === null
      ) {
        consentIds.add(consent.id);
        this.consents.set(
          key,
          Object.freeze({ ...consent, revokedAt: input.revokedAt }),
        );
      }
    }

    const analysisIds = new Set<string>();
    for (const [key, analysis] of this.analyses) {
      if (
        key.startsWith(`${ownerKey(owner)}:`) &&
        analysis.invalidatedAt === null &&
        (
          (analysis.connectionId === input.connectionId &&
            analysis.generation === input.generation) ||
          (analysis.mediaSourceId != null && mediaIds.has(analysis.mediaSourceId)) ||
          (analysis.consentId != null && consentIds.has(analysis.consentId))
        )
      ) {
        analysisIds.add(analysis.id);
        this.analyses.set(
          key,
          Object.freeze({ ...analysis, invalidatedAt: input.revokedAt }),
        );
      }
    }

    const skillIds = new Set<string>();
    for (const [key, skill] of this.skills) {
      if (
        key.startsWith(`${ownerKey(owner)}:`) &&
        skill.invalidatedAt === null &&
        (
          analysisIds.has(skill.analysisId) ||
          skill.mediaSourceIds.some((mediaSourceId) => mediaIds.has(mediaSourceId))
        )
      ) {
        skillIds.add(skill.id);
        this.skills.set(
          key,
          Object.freeze({ ...skill, invalidatedAt: input.revokedAt }),
        );
      }
    }

    const draftIds = new Set<string>();
    for (const [key, draft] of this.drafts) {
      if (
        key.startsWith(`${ownerKey(owner)}:`) &&
        draft.invalidatedAt === null &&
        (
          (draft.analysisId !== null && analysisIds.has(draft.analysisId)) ||
          (draft.skillInvocationId !== null && skillIds.has(draft.skillInvocationId))
        )
      ) {
        draftIds.add(draft.id);
        this.drafts.set(
          key,
          Object.freeze({
            ...draft,
            caption: "",
            manualDescription: "",
            status: "invalidated",
            terminalAt: input.revokedAt,
            invalidatedAt: input.revokedAt,
            revision: draft.revision + 1,
            updatedAt: input.revokedAt,
          }),
        );
      }
    }

    for (const [key, state] of this.routeCommands) {
      const binding = state.input;
      if (key.startsWith(`${ownerKey(owner)}:`) && (
        (binding.connectionId === input.connectionId && binding.generation === input.generation) ||
        binding.mediaSourceIds.some((id) => mediaIds.has(id)) ||
        (binding.analysisId !== null && analysisIds.has(binding.analysisId))
      )) this.routeCommands.set(key, { ...state, plan: null, invalidatedAt: input.revokedAt });
    }
    this.deleteReceiptsForEntity(
      owner,
      new Set([
        ...mediaIds,
        ...consentIds,
        ...analysisIds,
        ...skillIds,
        ...draftIds,
      ]),
    );
    this.connections.set(
      connectionKey(owner, input.connectionId),
      Object.freeze({
        ...connection,
        generation: connection.generation + 1,
        status: "revoked",
      }),
    );
  }

  async applyRetention(
    owner: GrowthOwner,
    now: Date,
    context: GrowthMutationContext,
  ): Promise<GrowthRetentionResult> {
    this.requireOwner(owner);
    const nowIso = now.toISOString();
    const receipt = this.previousReceipt(owner, context, "apply_retention", {
      now: nowIso,
    });
    if (receipt !== null) {
      return clone(receipt.resultHint) as GrowthRetentionResult;
    }
    const draftCutoff = now.getTime() - 30 * 24 * 60 * 60 * 1000;
    const assetCutoff = now.getTime() - 24 * 60 * 60 * 1000;
    const eventCutoff = now.getTime() - 90 * 24 * 60 * 60 * 1000;
    const prefix = `${ownerKey(owner)}:`;
    let draftsDeleted = 0;
    for (const [key, draft] of this.drafts) {
      if (
        key.startsWith(prefix) &&
        (
          draft.status === "completed" ||
          draft.status === "cancelled" ||
          draft.status === "invalidated"
        ) &&
        draft.terminalAt !== null &&
        new Date(draft.terminalAt).getTime() <= draftCutoff
      ) {
        this.drafts.delete(key);
        draftsDeleted += 1;
      }
    }
    const referencedAssets = new Set(
      [...this.drafts.entries()]
        .filter(
          ([key, draft]) =>
            key.startsWith(prefix) && draft.status !== "invalidated",
        )
        .flatMap(([, draft]) => draft.assetId === null ? [] : [draft.assetId]),
    );
    const expiredAssets = [...this.assets.entries()].filter(
      ([key, asset]) =>
        key.startsWith(prefix) &&
        !referencedAssets.has(asset.record.id) &&
        new Date(asset.record.createdAt).getTime() <= assetCutoff,
    );
    const paths = new Map<string, string>();
    for (const [key, asset] of expiredAssets) {
      paths.set(asset.record.id, asset.storagePath);
      this.assets.delete(key);
    }
    const removedMediaIds = new Set<string>();
    const removedAnalysisIds = new Set<string>();
    for (const assetId of paths.keys()) {
      for (const [key, source] of this.mediaSources) {
        if (key.startsWith(prefix) && source.assetId === assetId) {
          removedMediaIds.add(source.id);
          this.mediaSources.delete(key);
        }
      }
      for (const [key, analysis] of this.analyses) {
        if (
          key.startsWith(prefix) &&
          (
            analysis.assetId === assetId ||
            (analysis.mediaSourceId != null &&
              removedMediaIds.has(analysis.mediaSourceId))
          )
        ) {
          removedAnalysisIds.add(analysis.id);
          this.analyses.delete(key);
        }
      }
    }
    const removedSkillIds = new Set<string>();
    for (const [key, skill] of this.skills) {
      if (
        key.startsWith(prefix) &&
        skill.analysisId != null &&
        removedAnalysisIds.has(skill.analysisId)
      ) {
        removedSkillIds.add(skill.id);
        this.skills.delete(key);
      }
    }
    for (const [key, draft] of this.drafts) {
      if (!key.startsWith(prefix)) continue;
      if (
        (draft.analysisId !== null &&
          removedAnalysisIds.has(draft.analysisId)) ||
        (draft.skillInvocationId !== null &&
          removedSkillIds.has(draft.skillInvocationId))
      ) {
        this.drafts.delete(key);
        continue;
      }
      this.drafts.set(
        key,
        Object.freeze({
          ...draft,
          assetId:
            draft.assetId !== null && paths.has(draft.assetId)
              ? null
              : draft.assetId,
        }),
      );
    }
    let eventsDeleted = 0;
    for (const [key, event] of this.events) {
      if (
        key.startsWith(prefix) &&
        new Date(event.createdAt).getTime() < eventCutoff
      ) {
        this.events.delete(key);
        eventsDeleted += 1;
      }
    }
    let cleanupQueued = 0;
    for (const path of paths.values()) {
      const queued = this.queueCleanup(owner, path, "retention", nowIso);
      if (queued.inserted) cleanupQueued += 1;
    }
    for (const [key, state] of this.routeCommands) {
      if (!key.startsWith(prefix)) continue;
      if (Date.parse(state.expiresAt) <= now.getTime()) this.routeCommands.delete(key);
      else if ((state.input.assetId !== null && paths.has(state.input.assetId)) ||
        (state.input.analysisId !== null && removedAnalysisIds.has(state.input.analysisId)) ||
        state.input.mediaSourceIds.some((id) => removedMediaIds.has(id))) {
        this.routeCommands.set(key, { ...state, plan: null, invalidatedAt: nowIso });
      }
    }
    let receiptsDeleted = 0;
    for (const [key, commandReceipt] of this.commandReceipts) {
      if (
        key.startsWith(prefix) &&
        new Date(commandReceipt.expiresAt).getTime() <= now.getTime()
      ) {
        this.commandReceipts.delete(key);
        receiptsDeleted += 1;
      }
    }
    const result = Object.freeze({
      now: nowIso,
      assetsQueued: paths.size,
      draftsDeleted,
      eventsDeleted,
      cleanupQueued,
      receiptsDeleted,
    });
    this.rememberReceipt(owner, context, "apply_retention", { now: nowIso }, {
      entityId: null,
      resultHint: result,
    });
    return result;
  }

  async purgeOwner(
    owner: GrowthOwner,
    context: GrowthMutationContext,
  ): Promise<GrowthPurgeReceipt> {
    this.requireOwner(owner, true);
    const timestamp = this.now().toISOString();
    const receipt = this.previousReceipt(owner, context, "purge_owner", {});
    if (receipt !== null) {
      return clone(receipt.resultHint) as GrowthPurgeReceipt;
    }
    const prefix = `${ownerKey(owner)}:`;
    const ownedAssets = [...this.assets.entries()].filter(([key]) => key.startsWith(prefix));
    let cleanupQueued = 0;
    for (const [, asset] of ownedAssets) {
      const queued = this.queueCleanup(owner, asset.storagePath, "owner_purge", timestamp);
      if (queued.inserted) cleanupQueued += 1;
    }
    const routeCommandsDeleted = [...this.routeCommands.keys()].filter((key) => key.startsWith(prefix)).length;
    for (const key of this.routeCommands.keys()) if (key.startsWith(prefix)) this.routeCommands.delete(key);
    const metadataRowsDeleted =
      routeCommandsDeleted +
      ownedAssets.length +
      [...this.mediaSources.keys()].filter((key) => key.startsWith(prefix)).length +
      [...this.consents.keys()].filter((key) => key.startsWith(prefix)).length +
      [...this.analyses.keys()].filter((key) => key.startsWith(prefix)).length +
      [...this.skills.keys()].filter((key) => key.startsWith(prefix)).length +
      [...this.drafts.keys()].filter((key) => key.startsWith(prefix)).length +
      [...this.events.keys()].filter((key) => key.startsWith(prefix)).length +
      [...this.commandReceipts.keys()].filter((key) => key.startsWith(prefix)).length;
    for (const map of [
      this.assets,
      this.mediaSources,
      this.consents,
      this.analyses,
      this.skills,
      this.drafts,
      this.events,
      this.commandReceipts,
    ]) {
      for (const key of [...map.keys()]) {
        if (key.startsWith(prefix)) map.delete(key);
      }
    }
    const result = Object.freeze({
      state: "pending_physical_cleanup" as const,
      cleanupQueued,
      metadataRowsDeleted,
    });
    this.rememberReceipt(owner, context, "purge_owner", {}, {
      entityId: null,
      resultHint: result,
    });
    return result;
  }

  async listStorageCleanup(
    owner: GrowthOwner,
  ): Promise<readonly GrowthStorageCleanupRecord[]> {
    assertGrowthOwner(owner);
    const prefix = `${ownerKey(owner)}:`;
    return [...this.cleanup.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([, item]) => {
        const { createdAt, maxAttempts, ...record } = item;
        void createdAt;
        void maxAttempts;
        return clone(record);
      });
  }

  async processStorageCleanup(
    owner: GrowthOwner,
    context: GrowthMutationContext,
    limit = 25,
  ): Promise<GrowthCleanupResult> {
    assertGrowthOwner(owner);
    const boundedLimit = Number.isInteger(limit) && limit > 0
      ? Math.min(limit, 100)
      : 25;
    const receipt = this.previousReceipt(
      owner,
      context,
      "process_storage_cleanup",
      { limit: boundedLimit },
    );
    if (receipt !== null) {
      return clone(receipt.resultHint) as GrowthCleanupResult;
    }
    const prefix = `${ownerKey(owner)}:`;
    const now = this.now();
    const nowIso = now.toISOString();
    const queued = [...this.cleanup.entries()]
      .filter(
        ([key, item]) =>
          key.startsWith(prefix) &&
          (
            (item.state === "queued" &&
              new Date(item.availableAt).getTime() <= now.getTime()) ||
            (item.state === "processing" &&
              item.leaseExpiresAt !== null &&
              new Date(item.leaseExpiresAt).getTime() <= now.getTime())
          ),
      )
      .sort(
        ([, left], [, right]) =>
          left.createdAt.localeCompare(right.createdAt) ||
          left.id.localeCompare(right.id),
      )
      .slice(0, boundedLimit);
    let completed = 0;
    let failed = 0;
    let exhausted = 0;
    for (const [key, item] of queued) {
      const attempts = item.attempts + 1;
      const processing = Object.freeze({
        ...item,
        state: "processing" as const,
        attempts,
        leaseToken: context.idempotencyKey,
        leaseExpiresAt: addMilliseconds(nowIso, 60_000),
        lastError: null,
      });
      this.cleanup.set(key, processing);
      try {
        await this.storageRemover(item.objectPath);
        this.cleanup.set(
          key,
          Object.freeze({
            ...processing,
            state: "completed" as const,
            completedAt: nowIso,
            leaseToken: null,
            leaseExpiresAt: null,
          }),
        );
        completed += 1;
      } catch {
        const terminal = attempts >= item.maxAttempts;
        if (terminal) exhausted += 1;
        const backoffSeconds = Math.min(
          3600,
          15 * 2 ** Math.max(0, attempts - 1),
        );
        this.cleanup.set(key, Object.freeze({
          ...processing,
          state: terminal ? "exhausted" as const : "queued" as const,
          availableAt: terminal
            ? processing.availableAt
            : new Date(now.getTime() + backoffSeconds * 1000).toISOString(),
          leaseToken: null,
          leaseExpiresAt: null,
          lastError: "STORAGE_DELETE_FAILED",
        }));
        failed += 1;
      }
    }
    const result = Object.freeze({
      claimed: queued.length,
      completed,
      failed,
      exhausted,
    });
    this.rememberReceipt(
      owner,
      context,
      "process_storage_cleanup",
      { limit: boundedLimit },
      { entityId: null, resultHint: result },
    );
    return result;
  }

  async exportOwner(owner: GrowthOwner): Promise<GrowthOwnerExport> {
    this.requireOwner(owner);
    const prefix = `${ownerKey(owner)}:`;
    const values = <T>(map: Map<string, T>) =>
      Object.freeze([...map.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([, value]) => clone(value)));
    return Object.freeze({
      assets: Object.freeze(
        [...this.assets.entries()]
          .filter(([key]) => key.startsWith(prefix))
          .map(([, asset]) => clone(asset.record)),
      ),
      mediaSources: values(this.mediaSources),
      consents: values(this.consents),
      analyses: values(this.analyses),
      skillInvocations: values(this.skills),
      drafts: values(this.drafts),
      events: values(this.events),
    });
  }
}
