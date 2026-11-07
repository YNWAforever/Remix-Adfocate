/** Server projections only. None of these records is an accepted browser DTO. */
export type VisionActor = { ownerId: string; workspaceId: string };

export type VisionConnectionBinding = { connectionId: string; generation: number };

export type VisionConnectionState = VisionActor & VisionConnectionBinding & {
  status: "active" | "revoked" | "reauth_required";
  expiresAt: string;
};

export type VisionConsentAsset = VisionActor & {
  assetId: string;
  sourceHash: string;
  expiresAt: string;
  revokedAt: string | null;
  /** Explicit null for an upload independent of Instagram. */
  connection: VisionConnectionBinding | null;
};

export type VisionProcessingGrant = VisionActor & {
  grantId: string;
  assetId: string;
  purpose: "image_diagnosis";
  processorId: string;
  processorVersion: string;
  configVersion: string;
  consentVersion: string;
  sourceHash: string;
  grantedAt: string;
  expiresAt: string;
  revokedAt: string | null;
  connection: VisionConnectionBinding | null;
};

/** A reviewed configuration revision, not a provider registration or legal approval. */
export type VisionProcessorConfig = {
  processorId: string;
  processorVersion: string;
  configVersion: string;
  purpose: "image_diagnosis";
  consentVersion: string;
  enabled: boolean;
  approved: boolean;
  approvedAt: string;
  expiresAt: string;
  revokedAt: string | null;
};

export type VisionAuthorizationState = {
  grant: VisionProcessingGrant | null;
  asset: VisionConsentAsset | null;
  processorConfig: VisionProcessorConfig | null;
  connection: VisionConnectionState | null;
};

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH = /^[a-f0-9]{64}$/;

function validId(value: unknown): value is string {
  return typeof value === "string" && ID.test(value);
}

function timestamp(value: unknown): number {
  if (typeof value !== "string") return NaN;
  const time = Date.parse(value);
  // Canonical UTC only; reject timezone-less, rolled-over and partial dates.
  return Number.isFinite(time) && new Date(time).toISOString() === value ? time : NaN;
}

function sameOwner(value: VisionActor, actor: VisionActor): boolean {
  return value.ownerId === actor.ownerId && value.workspaceId === actor.workspaceId;
}

function validBinding(binding: VisionConnectionBinding | null): binding is VisionConnectionBinding {
  return binding != null && validId(binding.connectionId) &&
    Number.isSafeInteger(binding.generation) && binding.generation >= 0;
}

/**
 * Pure, purpose-bound decision over current server records. Callers must reload
 * lifecycle state before use; a previous true result is never a reusable grant.
 * This does not discover a processor, perform I/O or verify provider deletion.
 */
export function authorizeVisionProcessing(
  grant: VisionProcessingGrant | null,
  actor: VisionActor | null,
  asset: VisionConsentAsset | null,
  processorConfig: VisionProcessorConfig | null,
  lifecycle: { now: Date; connection: VisionConnectionState | null },
): boolean {
  const now = lifecycle?.now instanceof Date ? lifecycle.now.getTime() : NaN;
  if (
    !Number.isFinite(now) || !grant || !actor || !asset || !processorConfig ||
    !validId(actor.ownerId) || !validId(actor.workspaceId) ||
    !sameOwner(grant, actor) || !sameOwner(asset, actor) ||
    !validId(grant.grantId) || !validId(asset.assetId) || grant.assetId !== asset.assetId ||
    typeof asset.sourceHash !== "string" || !HASH.test(asset.sourceHash) ||
    grant.sourceHash !== asset.sourceHash ||
    grant.purpose !== "image_diagnosis" || processorConfig.purpose !== "image_diagnosis" ||
    !validId(processorConfig.processorId) || !validId(processorConfig.processorVersion) ||
    !validId(processorConfig.configVersion) || !validId(processorConfig.consentVersion) ||
    grant.processorId !== processorConfig.processorId ||
    grant.processorVersion !== processorConfig.processorVersion ||
    grant.configVersion !== processorConfig.configVersion ||
    grant.consentVersion !== processorConfig.consentVersion ||
    processorConfig.enabled !== true || processorConfig.approved !== true ||
    grant.revokedAt !== null || asset.revokedAt !== null || processorConfig.revokedAt !== null ||
    !(timestamp(processorConfig.approvedAt) <= timestamp(grant.grantedAt)) ||
    !(timestamp(grant.grantedAt) <= now) ||
    !(now < timestamp(grant.expiresAt)) || !(now < timestamp(asset.expiresAt)) ||
    !(now < timestamp(processorConfig.expiresAt))
  ) return false;

  // An unbound self-upload does not require or inherit Instagram authority.
  if (grant.connection === null && asset.connection === null) return true;
  const current = lifecycle.connection;
  return validBinding(grant.connection) && validBinding(asset.connection) &&
    validBinding(current) && current.status === "active" && sameOwner(current, actor) &&
    now < timestamp(current.expiresAt) &&
    grant.connection.connectionId === asset.connection.connectionId &&
    grant.connection.generation === asset.connection.generation &&
    current.connectionId === grant.connection.connectionId &&
    current.generation === grant.connection.generation;
}
