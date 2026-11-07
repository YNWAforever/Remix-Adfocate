import { createHash } from "node:crypto";
import {
  CREATOR_GROWTH_STORAGE_BUCKET,
  GrowthRepositoryError,
  assertGrowthMutationContext,
  assertGrowthOwner,
  ownerStoragePrefix,
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

export type GrowthRpc = <Result>(
  functionName: string,
  argumentsByName: Readonly<Record<string, unknown>>,
) => Promise<Result>;

export type GrowthStorageAdapter = Readonly<{
  put(
    bucket: string,
    objectPath: string,
    bytes: Uint8Array,
    contentType: GrowthAssetInput["mime"],
  ): Promise<void>;
  read(bucket: string, objectPath: string): Promise<Uint8Array>;
  remove(bucket: string, objectPath: string): Promise<void>;
}>;

export type SupabaseGrowthRepositoryOptions = Readonly<{
  rpc: GrowthRpc;
  storage: GrowthStorageAdapter;
  enabled?: boolean;
  now?: () => Date;
}>;

export function creatorGrowthPersistenceEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env.CREATOR_GROWTH_PERSISTENCE_ENABLED === "true";
}

type RemoteAsset = GrowthAssetRecord &
  Readonly<{
    storagePath: string;
  }>;

function uuidFromSeed(seed: string): string {
  const bytes = createHash("sha256").update(seed).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

function stableOperationId(
  context: GrowthMutationContext,
  operation: string,
): string {
  return uuidFromSeed(`${context.idempotencyKey}:${operation}`);
}

function subOperationContext(
  context: GrowthMutationContext,
  operation: string,
): GrowthMutationContext {
  return Object.freeze({
    idempotencyKey: stableOperationId(context, operation),
  });
}

function readContext(
  owner: GrowthOwner,
  operation: string,
  values: Readonly<Record<string, unknown>>,
): GrowthMutationContext {
  return Object.freeze({
    idempotencyKey: uuidFromSeed(
      `${owner.workspaceId}:${owner.creatorId}:${operation}:${JSON.stringify(values)}`,
    ),
  });
}

function rpcArguments(
  owner: GrowthOwner,
  context: GrowthMutationContext,
  values: Readonly<Record<string, unknown>>,
) {
  assertGrowthMutationContext(context);
  return Object.freeze({
    ...values,
    workspaceId: owner.workspaceId,
    creatorId: owner.creatorId,
    requestId: context.idempotencyKey,
  });
}

function validateStoragePath(
  owner: GrowthOwner,
  asset: Pick<GrowthAssetInput, "id" | "threadId" | "mime">,
  objectPath: string,
): void {
  const extension =
    asset.mime === "image/jpeg" ? "jpg" : asset.mime === "image/png" ? "png" : "webp";
  const expected = `${ownerStoragePrefix(owner)}${asset.threadId}/${asset.id}.${extension}`;
  if (objectPath !== expected) {
    throw new GrowthRepositoryError(
      "INVALID_STORAGE_PATH",
      "The storage path is outside the owner-scoped asset namespace.",
    );
  }
}

function isOwnerCleanupPath(owner: GrowthOwner, objectPath: string): boolean {
  const escapedWorkspace = owner.workspaceId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedCreator = owner.creatorId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `^${escapedWorkspace}/${escapedCreator}/[0-9a-f-]+/[0-9a-f-]+\\.(jpg|png|webp)$`,
  ).test(objectPath);
}

function safeAsset(remote: RemoteAsset): GrowthAssetRecord {
  const { storagePath, ...safe } = remote;
  void storagePath;
  return Object.freeze(safe);
}

export class SupabaseGrowthRepository implements GrowthRepository {
  private readonly enabled: boolean;
  private readonly now: () => Date;

  constructor(private readonly options: SupabaseGrowthRepositoryOptions) {
    this.enabled =
      options.enabled ?? creatorGrowthPersistenceEnabled();
    this.now = options.now ?? (() => new Date());
  }

  private assertEnabled(): void {
    if (!this.enabled) {
      throw new GrowthRepositoryError(
        "PERSISTENCE_DISABLED",
        "Creator growth persistence is disabled by default.",
      );
    }
  }

  async routeCommand(
    owner: GrowthOwner,
    input: GrowthRouteCommandInput,
    context: GrowthMutationContext,
    plan?: GrowthRoutePlan,
  ): Promise<GrowthRouteCommand> {
    this.assertEnabled();
    assertGrowthOwner(owner);
    assertGrowthMutationContext(context);
    return this.options.rpc(
      "creator_growth_route_command",
      rpcArguments(owner, context, { input, plan: plan ?? null }),
    );
  }

  async putAsset(
    owner: GrowthOwner,
    asset: GrowthAssetInput,
    context: GrowthMutationContext,
  ): Promise<GrowthAssetRecord> {
    this.assertEnabled();
    assertGrowthOwner(owner);
    assertGrowthMutationContext(context);
    const reserveContext = subOperationContext(context, "reserve_asset");
    const confirmContext = subOperationContext(context, "confirm_asset");
    const abandonContext = subOperationContext(context, "abandon_asset");
    const reserved = await this.options.rpc<{ asset: RemoteAsset }>(
      "creator_growth_reserve_asset",
      rpcArguments(owner, reserveContext, {
        asset: {
          id: asset.id,
          threadId: asset.threadId,
          sha256: asset.sha256,
          mime: asset.mime,
          byteSize: asset.byteSize,
          width: asset.width,
          height: asset.height,
          rightsConfirmed: asset.rightsConfirmed,
          sourceKind: asset.sourceKind,
          sampleOnly: asset.sampleOnly,
          fixtureId: asset.fixtureId ?? null,
        },
      }),
    );
    if (reserved.asset === null || typeof reserved.asset !== "object") {
      throw new GrowthRepositoryError("STORAGE_UNAVAILABLE", "Asset reservation failed.");
    }
    validateStoragePath(owner, asset, reserved.asset.storagePath);
    try {
      await this.options.storage.put(
        CREATOR_GROWTH_STORAGE_BUCKET,
        reserved.asset.storagePath,
        Uint8Array.from(asset.bytes),
        asset.mime,
      );
      const confirmed = await this.options.rpc<{ asset: RemoteAsset }>(
        "creator_growth_confirm_asset",
        rpcArguments(owner, confirmContext, { assetId: asset.id }),
      );
      return safeAsset(confirmed.asset);
    } catch (error) {
      await this.options.rpc("creator_growth_abandon_asset", rpcArguments(owner, abandonContext, {
        assetId: asset.id,
      })).catch(() => undefined);
      throw error;
    }
  }

  async getAssetBytes(owner: GrowthOwner, assetId: string): Promise<Uint8Array> {
    this.assertEnabled();
    assertGrowthOwner(owner);
    const response = await this.options.rpc<{
      asset: Readonly<{
        id: string;
        threadId: string;
        mime: GrowthAssetInput["mime"];
        storagePath: string;
        uploadState: "pending" | "uploaded";
      }> | null;
    }>(
      "creator_growth_get_asset",
      rpcArguments(owner, readContext(owner, "get_asset", { assetId }), { assetId }),
    );
    if (response.asset === null) {
      throw new GrowthRepositoryError("NOT_FOUND", "Asset not found.");
    }
    validateStoragePath(owner, response.asset, response.asset.storagePath);
    if (response.asset.uploadState !== "uploaded") {
      throw new GrowthRepositoryError("STORAGE_UNAVAILABLE", "Asset upload is incomplete.");
    }
    try {
      return await this.options.storage.read(
        CREATOR_GROWTH_STORAGE_BUCKET,
        response.asset.storagePath,
      );
    } catch {
      throw new GrowthRepositoryError("STORAGE_UNAVAILABLE", "Asset bytes are unavailable.");
    }
  }

  async saveMediaSource(
    owner: GrowthOwner,
    source: GrowthMediaSourceInput,
    context: GrowthMutationContext,
  ): Promise<GrowthMediaSourceRecord> {
    this.assertEnabled();
    assertGrowthOwner(owner);
    assertGrowthMutationContext(context);
    return this.options.rpc(
      "creator_growth_save_media_source",
      rpcArguments(owner, context, { source }),
    );
  }

  async saveConsent(
    owner: GrowthOwner,
    consent: GrowthConsentInput,
    context: GrowthMutationContext,
  ): Promise<GrowthConsentRecord> {
    this.assertEnabled();
    assertGrowthOwner(owner);
    assertGrowthMutationContext(context);
    return this.options.rpc(
      "creator_growth_save_consent",
      rpcArguments(owner, context, { consent }),
    );
  }

  async saveAnalysis(
    owner: GrowthOwner,
    analysis: GrowthAnalysisInput,
    context: GrowthMutationContext,
  ): Promise<GrowthAnalysisRecord> {
    this.assertEnabled();
    assertGrowthOwner(owner);
    assertGrowthMutationContext(context);
    return this.options.rpc(
      "creator_growth_save_analysis",
      rpcArguments(owner, context, { analysis }),
    );
  }

  async saveSkillInvocation(
    owner: GrowthOwner,
    invocation: GrowthSkillInvocationInput,
    context: GrowthMutationContext,
  ): Promise<GrowthSkillInvocationRecord> {
    this.assertEnabled();
    assertGrowthOwner(owner);
    assertGrowthMutationContext(context);
    return this.options.rpc(
      "creator_growth_save_skill_invocation",
      rpcArguments(owner, context, { invocation }),
    );
  }

  async saveDraft(
    owner: GrowthOwner,
    draft: GrowthDraftInput,
    context: GrowthMutationContext,
  ): Promise<GrowthDraftRecord> {
    this.assertEnabled();
    assertGrowthOwner(owner);
    assertGrowthMutationContext(context);
    return this.options.rpc(
      "creator_growth_save_draft",
      rpcArguments(owner, context, { draft }),
    );
  }

  async getPrivateDraft(
    owner: GrowthOwner,
    draftId: string,
  ): Promise<GrowthDraftRecord | null> {
    this.assertEnabled();
    assertGrowthOwner(owner);
    return this.options.rpc(
      "creator_growth_get_draft",
      rpcArguments(
        owner,
        readContext(owner, "get_draft", { draftId }),
        { draftId },
      ),
    );
  }

  async setDraftStatus(
    owner: GrowthOwner,
    draftId: string,
    input: GrowthDraftStatusInput,
    context: GrowthMutationContext,
  ): Promise<GrowthDraftRecord> {
    this.assertEnabled();
    assertGrowthOwner(owner);
    assertGrowthMutationContext(context);
    return this.options.rpc(
      "creator_growth_set_draft_status",
      rpcArguments(owner, context, { draftId, input }),
    );
  }

  async recordEvent(
    owner: GrowthOwner,
    event: GrowthEventInput,
    context: GrowthMutationContext,
  ): Promise<GrowthEventRecord> {
    this.assertEnabled();
    assertGrowthOwner(owner);
    assertGrowthMutationContext(context);
    return this.options.rpc(
      "creator_growth_record_event",
      rpcArguments(owner, context, { event }),
    );
  }

  async applyRetention(
    owner: GrowthOwner,
    now: Date,
    context: GrowthMutationContext,
  ): Promise<GrowthRetentionResult> {
    this.assertEnabled();
    assertGrowthOwner(owner);
    assertGrowthMutationContext(context);
    return this.options.rpc(
      "creator_growth_apply_retention",
      rpcArguments(owner, context, { now: now.toISOString() }),
    );
  }

  async purgeOwner(
    owner: GrowthOwner,
    context: GrowthMutationContext,
  ): Promise<GrowthPurgeReceipt> {
    this.assertEnabled();
    assertGrowthOwner(owner);
    assertGrowthMutationContext(context);
    return this.options.rpc(
      "creator_growth_purge_owner",
      rpcArguments(owner, context, {}),
    );
  }

  async listStorageCleanup(
    owner: GrowthOwner,
  ): Promise<readonly GrowthStorageCleanupRecord[]> {
    this.assertEnabled();
    assertGrowthOwner(owner);
    const response = await this.options.rpc<{
      items: readonly GrowthStorageCleanupRecord[];
    }>(
      "creator_growth_list_cleanup",
      rpcArguments(
        owner,
        readContext(owner, "list_cleanup", {}),
        {},
      ),
    );
    return Object.freeze(response.items);
  }

  async processStorageCleanup(
    owner: GrowthOwner,
    context: GrowthMutationContext,
    limit = 25,
  ): Promise<GrowthCleanupResult> {
    this.assertEnabled();
    assertGrowthOwner(owner);
    assertGrowthMutationContext(context);
    const boundedLimit = Number.isInteger(limit) && limit > 0
      ? Math.min(limit, 100)
      : 25;
    const workerId = stableOperationId(context, "cleanup_worker");
    const claimed = await this.options.rpc<{
      items: readonly GrowthStorageCleanupRecord[];
    }>(
      "creator_growth_claim_cleanup",
      rpcArguments(
        owner,
        subOperationContext(context, "claim_cleanup"),
        {
          workerId,
          claimedAt: this.now().toISOString(),
          limit: boundedLimit,
          leaseSeconds: 60,
        },
      ),
    );
    let completed = 0;
    let failed = 0;
    let exhausted = 0;
    for (const item of claimed.items) {
      const finishContext = subOperationContext(
        context,
        `finish_cleanup:${item.id}`,
      );
      if (!isOwnerCleanupPath(owner, item.objectPath)) {
        const response = await this.options.rpc<{
          attempts: number;
          state: GrowthStorageCleanupRecord["state"];
        }>(
          "creator_growth_finish_cleanup",
          rpcArguments(owner, finishContext, {
            cleanupId: item.id,
            workerId,
            objectPath: item.objectPath,
            outcome: "failed",
            finishedAt: this.now().toISOString(),
          }),
        ).catch(() => undefined);
        failed += 1;
        if (response?.attempts !== undefined && response.attempts >= 5) {
          exhausted += 1;
        }
        continue;
      }
      try {
        await this.options.storage.remove(item.bucket, item.objectPath);
        await this.options.rpc(
          "creator_growth_finish_cleanup",
          rpcArguments(owner, finishContext, {
            cleanupId: item.id,
            workerId,
            objectPath: item.objectPath,
            outcome: "completed",
            finishedAt: this.now().toISOString(),
          }),
        );
        completed += 1;
      } catch {
        const response = await this.options.rpc<{
          attempts: number;
          state: GrowthStorageCleanupRecord["state"];
        }>(
          "creator_growth_finish_cleanup",
          rpcArguments(owner, finishContext, {
            cleanupId: item.id,
            workerId,
            objectPath: item.objectPath,
            outcome: "failed",
            finishedAt: this.now().toISOString(),
          }),
        ).catch(() => undefined);
        failed += 1;
        if (response?.state === "exhausted") exhausted += 1;
      }
    }
    return Object.freeze({
      claimed: claimed.items.length,
      completed,
      failed,
      exhausted,
    });
  }

  async exportOwner(owner: GrowthOwner): Promise<GrowthOwnerExport> {
    this.assertEnabled();
    assertGrowthOwner(owner);
    return this.options.rpc(
      "creator_growth_export_owner",
      rpcArguments(owner, readContext(owner, "export_owner", {}), {}),
    );
  }
}
