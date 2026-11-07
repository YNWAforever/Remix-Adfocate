import {
  AssetPolicyError,
  inspectImagePayload,
  sha256Hex,
  type SupportedImageMime,
} from "./assetPolicy.js";
import {
  authorizeVisionProcessing,
  type VisionActor,
  type VisionAuthorizationState,
} from "./visionConsent.js";

export const MAX_CAPTION_LENGTH = 500;
export const MAX_CONSENT_VERSION_LENGTH = 64;
export const MAX_OBSERVATION_ITEMS = 12;
export const MAX_OBSERVATION_TEXT_LENGTH = 240;

export type ImageObservationAvailability = "observed" | "manual";

export type ImageObservationReason =
  | "manual_description_required"
  | "processing_not_approved"
  | "processor_consent_missing"
  | "processor_consent_invalid"
  | "processing_state_changed"
  | "trusted_fixture_unavailable";

export type CaptionAlignment =
  | "aligned"
  | "misaligned"
  | "uncertain"
  | "unavailable";

export type ImageObservation = {
  availability: ImageObservationAvailability;
  reason?: ImageObservationReason;
  objects: readonly string[];
  visibleText: readonly string[];
  composition: readonly string[];
  captionAlignment: CaptionAlignment;
  uncertainties: readonly string[];
  sampleOnly: boolean;
};

export type VisionAdapter = {
  kind: "mock" | "external";
  // Required at the external boundary; missing identity always denies processing.
  processorId?: string;
  processorVersion?: string;
  configVersion?: string;
  analyze: (
    imageBytes: Uint8Array,
    context: { caption?: string },
  ) => Promise<ImageObservation>;
};

export type TrustedCreatorImageAsset = {
  assetId: string;
  bytes: Uint8Array;
  sha256: string;
  sourceKind: "creator-upload";
  /** Trusted loader projection, never taken from the analysis request. */
  owner?: VisionActor;
};

export type TrustedSyntheticImageAsset = {
  assetId: string;
  bytes: Uint8Array;
  sha256: string;
  sourceKind: "synthetic-fixture";
  fixtureId: string;
  owner?: VisionActor;
};

export type LoadedImageAsset =
  | TrustedCreatorImageAsset
  | TrustedSyntheticImageAsset;

export type ImageObservationBinding =
  | {
      readonly assetId: string;
      readonly sha256: string;
      readonly sourceKind: "creator-upload";
      readonly fixtureId?: never;
    }
  | {
      readonly assetId: string;
      readonly sha256: string;
      readonly sourceKind: "synthetic-fixture";
      readonly fixtureId: string;
    };

export type ImageAnalysisResult = Readonly<{
  observation: ImageObservation;
  binding: ImageObservationBinding;
}>;

export type LoadImageAsset = (
  assetId: string,
) => Promise<LoadedImageAsset>;

export type SyntheticFixtureRegistry = Readonly<Record<string, string>>;

export type AnalyzeImageInput = {
  assetId: string;
  sourceRef: string;
  caption?: string;
  consentVersion?: string;
};

export type AnalyzeImageDependencies = {
  loadAsset: LoadImageAsset;
  syntheticFixtures?: SyntheticFixtureRegistry;
  vision: VisionAdapter;
  processingApproved: boolean;
  /** Server-only dependencies. Absence keeps all external processing disabled. */
  authorization?: {
    actor: VisionActor;
    now: () => Date;
    /** Fresh coherent records; do not cache a prior authorization decision. */
    loadCurrent: (assetId: string) => Promise<VisionAuthorizationState | null>;
  };
};

export type ImageAnalysisErrorCode =
  | "ASSET_BINDING_MISMATCH"
  | "ASSET_HASH_MISMATCH"
  | "INVALID_ANALYSIS_INPUT"
  | "INVALID_ASSET_METADATA"
  | "UNSANITIZED_ASSET"
  | "UNSUPPORTED_VISION_ADAPTER"
  | "VISION_ADAPTER_FAILED"
  | "VISION_OBSERVATION_INVALID";

export class ImageAnalysisError extends Error {
  constructor(
    readonly code: ImageAnalysisErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ImageAnalysisError";
  }
}

const ASSET_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SOURCE_REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~:-]{0,511}$/;
const CONSENT_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const CAPTION_ALIGNMENTS = new Set<CaptionAlignment>([
  "aligned",
  "misaligned",
  "uncertain",
  "unavailable",
]);

function hasForbiddenControl(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint !== undefined &&
      (
        (codePoint >= 0 && codePoint <= 8) ||
        codePoint === 11 ||
        codePoint === 12 ||
        (codePoint >= 14 && codePoint <= 31) ||
        codePoint === 127
      )
    ) {
      return true;
    }
  }
  return false;
}

function fail(
  code: ImageAnalysisErrorCode,
  message: string,
): never {
  throw new ImageAnalysisError(code, message);
}

function validateInput(input: AnalyzeImageInput): void {
  if (
    input === null ||
    typeof input !== "object" ||
    typeof input.assetId !== "string" ||
    !ASSET_ID_PATTERN.test(input.assetId) ||
    typeof input.sourceRef !== "string" ||
    !SOURCE_REFERENCE_PATTERN.test(input.sourceRef)
  ) {
    fail("INVALID_ANALYSIS_INPUT", "The image analysis request is invalid.");
  }
  if (
    input.caption !== undefined &&
    (
      typeof input.caption !== "string" ||
      input.caption !== input.caption.trim() ||
      Array.from(input.caption).length > MAX_CAPTION_LENGTH ||
      hasForbiddenControl(input.caption)
    )
  ) {
    fail("INVALID_ANALYSIS_INPUT", "The image caption is invalid.");
  }
  if (
    input.consentVersion !== undefined &&
    (
      typeof input.consentVersion !== "string" ||
      !CONSENT_VERSION_PATTERN.test(input.consentVersion)
    )
  ) {
    fail("INVALID_ANALYSIS_INPUT", "The processor consent version is invalid.");
  }
}

function inspectLoadedAsset(
  assetId: string,
  loaded: LoadedImageAsset,
): {
  loaded: LoadedImageAsset;
  detectedMime: SupportedImageMime;
  digest: string;
} {
  if (
    loaded === null ||
    typeof loaded !== "object" ||
    typeof loaded.assetId !== "string" ||
    loaded.assetId !== assetId
  ) {
    fail(
      "ASSET_BINDING_MISMATCH",
      "The trusted loader returned a different asset.",
    );
  }
  if (
    !(loaded.bytes instanceof Uint8Array) ||
    typeof loaded.sha256 !== "string" ||
    !SHA256_PATTERN.test(loaded.sha256) ||
    (
      loaded.sourceKind !== "creator-upload" &&
      loaded.sourceKind !== "synthetic-fixture"
    ) ||
    (
      loaded.sourceKind === "synthetic-fixture" &&
      (
        typeof loaded.fixtureId !== "string" ||
        !ASSET_ID_PATTERN.test(loaded.fixtureId)
      )
    )
  ) {
    fail(
      "INVALID_ASSET_METADATA",
      "The trusted asset metadata is invalid.",
    );
  }

  let inspection: ReturnType<typeof inspectImagePayload>;
  try {
    inspection = inspectImagePayload(loaded.bytes, {
      requireSanitized: true,
    });
  } catch (error) {
    if (error instanceof AssetPolicyError) {
      fail(
        "UNSANITIZED_ASSET",
        "The stored image bytes are not in the approved sanitized form.",
      );
    }
    throw error;
  }

  const digest = sha256Hex(loaded.bytes);
  if (digest !== loaded.sha256) {
    fail(
      "ASSET_HASH_MISMATCH",
      "The stored image digest does not match the current bytes.",
    );
  }
  return {
    loaded,
    detectedMime: inspection.detectedMime,
    digest,
  };
}

function isTrustedFixture(
  loaded: LoadedImageAsset,
  digest: string,
  registry: SyntheticFixtureRegistry | undefined,
): loaded is TrustedSyntheticImageAsset {
  if (
    loaded.sourceKind !== "synthetic-fixture" ||
    registry === undefined ||
    !Object.prototype.hasOwnProperty.call(registry, loaded.fixtureId)
  ) {
    return false;
  }
  return registry[loaded.fixtureId] === digest;
}

function manualObservation(
  reason: ImageObservationReason,
): ImageObservation {
  return Object.freeze({
    availability: "manual",
    reason,
    objects: Object.freeze([]),
    visibleText: Object.freeze([]),
    composition: Object.freeze([]),
    captionAlignment: "unavailable",
    uncertainties: Object.freeze([reason]),
    sampleOnly: false,
  });
}

function createResult(
  observation: ImageObservation,
  loaded: LoadedImageAsset,
  digest: string,
): ImageAnalysisResult {
  const binding: ImageObservationBinding =
    loaded.sourceKind === "synthetic-fixture"
      ? Object.freeze({
          assetId: loaded.assetId,
          sha256: digest,
          sourceKind: "synthetic-fixture",
          fixtureId: loaded.fixtureId,
        })
      : Object.freeze({
          assetId: loaded.assetId,
          sha256: digest,
          sourceKind: "creator-upload",
        });
  return Object.freeze({
    observation: Object.freeze({
      ...observation,
      sampleOnly: observation.sampleOnly ||
        (loaded.sourceKind === "synthetic-fixture" && observation.availability === "observed"),
    }),
    binding,
  });
}

function validateObservationText(value: unknown): string {
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    Array.from(value).length > MAX_OBSERVATION_TEXT_LENGTH ||
    hasForbiddenControl(value)
  ) {
    fail(
      "VISION_OBSERVATION_INVALID",
      "The vision adapter returned malformed observation text.",
    );
  }
  return value;
}

function validateObservationList(value: unknown): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length > MAX_OBSERVATION_ITEMS
  ) {
    fail(
      "VISION_OBSERVATION_INVALID",
      "The vision adapter returned an unbounded observation field.",
    );
  }
  return Object.freeze(value.map(validateObservationText));
}

function normalizeObservation(
  observation: ImageObservation,
  kind: VisionAdapter["kind"],
): ImageObservation {
  if (
    observation === null ||
    typeof observation !== "object" ||
    observation.availability !== "observed" ||
    !CAPTION_ALIGNMENTS.has(observation.captionAlignment)
  ) {
    fail(
      "VISION_OBSERVATION_INVALID",
      "The vision adapter returned an invalid observation.",
    );
  }
  return Object.freeze({
    availability: "observed",
    objects: validateObservationList(observation.objects),
    visibleText: validateObservationList(observation.visibleText),
    composition: validateObservationList(observation.composition),
    captionAlignment: observation.captionAlignment,
    uncertainties: validateObservationList(observation.uncertainties),
    sampleOnly: kind === "mock",
  });
}

async function callVision(
  vision: VisionAdapter,
  bytes: Uint8Array,
  caption: string | undefined,
): Promise<ImageObservation> {
  const context = caption === undefined ? {} : { caption };
  let observation: ImageObservation;
  try {
    observation = await vision.analyze(new Uint8Array(bytes), context);
  } catch {
    fail(
      "VISION_ADAPTER_FAILED",
      "The configured vision adapter failed without producing a result.",
    );
  }
  return normalizeObservation(observation, vision.kind);
}

async function loadVisionState(
  deps: AnalyzeImageDependencies,
  assetId: string,
): Promise<VisionAuthorizationState | null> {
  try {
    return await deps.authorization?.loadCurrent(assetId) ?? null;
  } catch {
    // Missing/deleted records and lookup failures cannot become consent.
    return null;
  }
}

function authorizedRevision(
  state: VisionAuthorizationState | null,
  loaded: LoadedImageAsset,
  consentVersion: string,
  vision: VisionAdapter,
  deps: AnalyzeImageDependencies,
): string | null {
  const auth = deps.authorization;
  if (!auth || !state || !loaded.owner || deps.processingApproved !== true || deps.vision !== vision) return null;
  const { grant, asset, processorConfig: config, connection } = state;
  try {
    if (
      !grant || !asset || !config ||
      loaded.owner.ownerId !== auth.actor.ownerId || loaded.owner.workspaceId !== auth.actor.workspaceId ||
      asset.assetId !== loaded.assetId || asset.sourceHash !== loaded.sha256 ||
      grant.consentVersion !== consentVersion ||
      vision.kind !== "external" || vision.processorId !== config.processorId ||
      vision.processorVersion !== config.processorVersion || vision.configVersion !== config.configVersion ||
      !authorizeVisionProcessing(grant, auth.actor, asset, config, { now: auth.now(), connection })
    ) return null;
  } catch {
    return null;
  }
  // Capture immutable scalar values now, not references that a later read may
  // mutate. Even a newly valid replacement consent/config cannot reuse a result.
  return JSON.stringify([
    grant.grantId, grant.ownerId, grant.workspaceId, grant.assetId, grant.sourceHash,
    grant.purpose, grant.consentVersion, grant.processorId, grant.processorVersion, grant.configVersion,
    grant.grantedAt, grant.expiresAt, grant.revokedAt,
    grant.connection?.connectionId, grant.connection?.generation,
    asset.ownerId, asset.workspaceId, asset.assetId, asset.sourceHash, asset.expiresAt, asset.revokedAt,
    asset.connection?.connectionId, asset.connection?.generation,
    config.processorId, config.processorVersion, config.configVersion, config.purpose, config.consentVersion,
    config.enabled, config.approved, config.approvedAt, config.expiresAt, config.revokedAt,
    ...(asset.connection === null ? [] : [
      connection?.ownerId, connection?.workspaceId, connection?.connectionId,
      connection?.generation, connection?.status, connection?.expiresAt,
    ]),
  ]);
}

export async function analyzeImage(
  input: AnalyzeImageInput,
  deps: AnalyzeImageDependencies,
): Promise<ImageAnalysisResult> {
  validateInput(input);
  const request = { ...input };
  const fromLoader = await deps.loadAsset(request.assetId);
  const inspected = inspectLoadedAsset(request.assetId, fromLoader);
  // Pin inspected bytes and identity before the next asynchronous read. The
  // loader's mutable buffer must not change what a consented request sends.
  const loaded = {
    ...fromLoader,
    bytes: new Uint8Array(fromLoader.bytes),
    owner: fromLoader.owner ? { ...fromLoader.owner } : undefined,
  };
  const bytes = loaded.bytes;

  if (deps.vision.kind === "mock") {
    if (loaded.sourceKind !== "synthetic-fixture") {
      return createResult(
        manualObservation("manual_description_required"),
        loaded,
        inspected.digest,
      );
    }
    if (
      !isTrustedFixture(
        loaded,
        inspected.digest,
        deps.syntheticFixtures,
      )
    ) {
      return createResult(
        manualObservation("trusted_fixture_unavailable"),
        loaded,
        inspected.digest,
      );
    }
    return createResult(
      await callVision(deps.vision, bytes, request.caption),
      loaded,
      inspected.digest,
    );
  }
  if (deps.vision.kind !== "external") {
    fail(
      "UNSUPPORTED_VISION_ADAPTER",
      "The configured vision adapter kind is unsupported.",
    );
  }
  if (deps.processingApproved !== true) {
    return createResult(
      manualObservation("processing_not_approved"),
      loaded,
      inspected.digest,
    );
  }
  if (
    typeof request.consentVersion !== "string" ||
    !CONSENT_VERSION_PATTERN.test(request.consentVersion)
  ) {
    return createResult(
      manualObservation("processor_consent_missing"),
      loaded,
      inspected.digest,
    );
  }
  const vision = deps.vision;
  const current = await loadVisionState(deps, loaded.assetId);
  // No asynchronous work between this current-state check and invoking the
  // adapter. The injected clock is sampled after the state read, never globally.
  const revision = authorizedRevision(current, loaded, request.consentVersion, vision, deps);
  if (revision === null) {
    return createResult(manualObservation("processor_consent_invalid"), loaded, inspected.digest);
  }
  const observation = await callVision(vision, bytes, request.caption);
  const after = await loadVisionState(deps, loaded.assetId);
  if (authorizedRevision(after, loaded, request.consentVersion, vision, deps) !== revision) {
    return createResult(manualObservation("processing_state_changed"), loaded, inspected.digest);
  }
  return createResult(observation, loaded, inspected.digest);
}
