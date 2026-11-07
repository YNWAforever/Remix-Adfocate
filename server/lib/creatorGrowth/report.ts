import type { EvidenceValue } from "../../../src/lib/integrations/types.js";
import type {
  ImageAnalysisResult,
  ImageObservationBinding,
} from "./imageAnalysis.js";
import type { PublicImageMatch } from "./mediaMatch.js";

export const OFFICIAL_GROWTH_METRICS = [
  "reach",
  "views",
  "impressions",
  "likes",
  "comments",
  "shares",
  "saves",
] as const;

export type OfficialGrowthMetric =
  (typeof OFFICIAL_GROWTH_METRICS)[number];

export type GrowthMetricPeriod =
  | Readonly<{
      kind: "lifetime";
    }>
  | Readonly<{
      kind: "date_range";
      startAt: string;
      endAt: string;
    }>;

export type OfficialCoverageValue = Readonly<{
  value: string;
  verified: boolean;
}>;

export type OfficialGrowthSnapshot = Readonly<{
  sourceRef: string;
  fetchedAt: string;
  period: GrowthMetricPeriod | null;
  measurementPeriod?: string;
  metrics?: Readonly<Record<string, EvidenceValue>>;
  coverage?: Readonly<{
    region?: OfficialCoverageValue;
    language?: OfficialCoverageValue;
  }>;
}>;

export type PublicImageEvidenceMatch = Readonly<
  PublicImageMatch & {
    sourceRef: string;
    fetchedAt: string;
    sampleOnly: boolean;
    rights: "allowed" | "unknown" | "denied";
    selectedAsset: Readonly<{
      assetId: string;
      sha256: string;
    }> | null;
  }
>;

export type BuildGrowthEvidenceInput = Readonly<{
  question: string;
  officialSnapshots: readonly OfficialGrowthSnapshot[];
  publicImageMatch: PublicImageEvidenceMatch | null;
  sourcePermission?: Readonly<{
    publicImage: "allowed" | "unknown" | "denied";
  }>;
  observation: ImageAnalysisResult;
  runAt: string;
}>;

export type MetricEvidenceReason =
  | "metric_missing"
  | "metric_empty"
  | "metric_invalid"
  | "metric_unsupported"
  | "metric_stale"
  | "metric_revoked"
  | "metric_rate_limited"
  | "metric_period_invalid"
  | "source_reference_invalid"
  | "source_time_invalid";

export type MetricEvidence = Readonly<{
  metric: OfficialGrowthMetric;
  value: number | null;
  status: "available" | "unavailable";
  reason: MetricEvidenceReason | null;
  sourceRef: string | null;
  observedAt: string | null;
  periodKind: GrowthMetricPeriod["kind"] | "unknown";
  sampleOnly: boolean;
}>;

export type GrowthEvidenceCitation = Readonly<{
  sourceKind:
    | "official_metrics"
    | "public_image_mock"
    | "self_upload_manual";
  title: string;
  sourceRef: string;
  observedAt: string;
  sampleOnly: boolean;
}>;

export type GrowthEvidenceReport = Readonly<{
  question: string;
  platform: "instagram";
  runAt: string;
  metrics: readonly MetricEvidence[];
  availability: Readonly<{
    officialMetrics: "available" | "partial" | "unavailable";
    publicImageMock:
      | "available"
      | "mock"
      | "unavailable"
      | "not_provided";
    selfUploadManual: "manual" | "not_applicable";
    reasons: readonly string[];
  }>;
  provenance: Readonly<{
    officialMetrics: readonly Readonly<{
      sourceKind: "official_metrics";
      sourceRef: string;
      observedAt: string;
      sampleOnly: boolean;
      periodKind: GrowthMetricPeriod["kind"];
    }>[];
    publicImageMock: Readonly<{
      sourceKind: "public_image_mock";
      sourceRef: string;
      observedAt: string;
      sampleOnly: boolean;
      assetId: string;
      sha256: string;
    }> | null;
    selfUploadManual: Readonly<{
      sourceKind: ImageObservationBinding["sourceKind"];
      manualMode: "creator_upload" | "manual_observation";
      sourceRef: string;
      observedAt: string;
      sampleOnly: boolean;
      assetId: string;
      sha256: string;
    }> | null;
  }>;
  region: Readonly<{
    requested: "Hong Kong";
    verified: boolean;
    value: string | null;
    label: "未驗證" | "已核對";
    reason: string;
  }>;
  language: Readonly<{
    requested: "zh-Hant";
    verified: boolean;
    value: string | null;
    label: "未驗證" | "已核對";
    reason: string;
  }>;
  period: Readonly<{
    selection: Readonly<{
      windowDays: 30;
      mediaLimit: 50;
      appliesTo: "selection_only";
    }>;
    metrics: readonly Readonly<{
      metric: OfficialGrowthMetric;
      kind: GrowthMetricPeriod["kind"];
      startAt: string | null;
      endAt: string | null;
      sourceRef: string;
    }>[];
  }>;
  observation: Readonly<{
    availability: "observed" | "manual";
    reason: string | null;
    sourceKind: ImageObservationBinding["sourceKind"];
    sampleOnly: boolean;
    objects: readonly string[];
    visibleText: readonly string[];
    composition: readonly string[];
    captionAlignment: string;
    uncertainties: readonly string[];
    assetId: string;
    sha256: string;
  }>;
  sourcePermission: Readonly<{
    publicImage: "allowed" | "unknown" | "denied";
    basis: "explicit" | "default_denied";
  }>;
  partial: boolean;
  partialReasons: readonly string[];
  sampleOnly: boolean;
  citations: readonly GrowthEvidenceCitation[];
}>;

export type GrowthEvidenceErrorCode =
  | "ASSET_BINDING_MISMATCH"
  | "INVALID_RUN_AT";

export class GrowthEvidenceError extends Error {
  constructor(
    readonly code: GrowthEvidenceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GrowthEvidenceError";
  }
}

const SAFE_SOURCE_REFERENCE =
  /^[A-Za-z0-9][A-Za-z0-9._:/@#-]{0,255}$/;
const SAFE_ASSET_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const URL_PATTERN = /(?:https?|data|blob):\/\/\S+/gi;
const JWT_PATTERN =
  /eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9._-]+\.[A-Za-z0-9._-]*/g;
const SENSITIVE_ASSIGNMENT =
  /\b(?:access_token|token|secret|password|authorization)\s*=\s*[^\s]+/gi;
const MAX_QUESTION_LENGTH = 1000;
const MAX_OBSERVATION_TEXT_LENGTH = 240;
const MAX_OBSERVATION_ITEMS = 12;
const MAX_OFFICIAL_SNAPSHOTS = 20;

function withoutControlCharacters(value: string): string {
  return Array.from(value)
    .filter((character) => {
      const codePoint = character.codePointAt(0);
      return (
        codePoint !== undefined &&
        (
          (codePoint >= 0 && codePoint <= 8) ||
          codePoint === 11 ||
          codePoint === 12 ||
          (codePoint >= 14 && codePoint <= 31) ||
          codePoint === 127
        )
      ) === false;
    })
    .join("");
}

function boundedText(value: unknown, limit = MAX_OBSERVATION_TEXT_LENGTH): string {
  if (typeof value !== "string") {
    return "";
  }
  return Array.from(
    withoutControlCharacters(value).trim(),
  ).slice(0, limit).join("");
}

function sanitizeQuestion(value: unknown): string {
  return boundedText(value, MAX_QUESTION_LENGTH)
    .replace(URL_PATTERN, "[網址已移除]")
    .replace(JWT_PATTERN, "[憑證已移除]")
    .replace(SENSITIVE_ASSIGNMENT, "[敏感值已移除]");
}

function sanitizeSourceRef(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    !SAFE_SOURCE_REFERENCE.test(value) ||
    value.includes("://") ||
    /token|secret|password|authorization|temporary|tempurl/i.test(value)
  ) {
    return null;
  }
  return value;
}

function normalizeTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || value !== value.trim()) {
    return null;
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

function validatePeriod(
  period: unknown,
): GrowthMetricPeriod | null {
  if (period === null || typeof period !== "object") {
    return null;
  }
  const candidate = period as {
    kind?: unknown;
    startAt?: unknown;
    endAt?: unknown;
  };
  if (candidate.kind === "lifetime") {
    return Object.freeze({ kind: "lifetime" });
  }
  if (candidate.kind !== "date_range") {
    return null;
  }
  const startAt = normalizeTimestamp(candidate.startAt);
  const endAt = normalizeTimestamp(candidate.endAt);
  if (
    startAt === null ||
    endAt === null ||
    startAt > endAt
  ) {
    return null;
  }
  return Object.freeze({
    kind: "date_range" as const,
    startAt,
    endAt,
  });
}

function snapshotPeriod(
  snapshot: OfficialGrowthSnapshot,
): GrowthMetricPeriod | null {
  const directPeriod = validatePeriod(snapshot.period);
  if (directPeriod !== null) {
    return directPeriod;
  }
  if (
    snapshot.period === null &&
    snapshot.measurementPeriod === "lifetime"
  ) {
    return Object.freeze({ kind: "lifetime" });
  }
  return null;
}

function normalizeNumericMetricValue(value: unknown): Readonly<{
  value: number | null;
  reason: MetricEvidenceReason | null;
}> {
  if (typeof value === "string") {
    return value.trim().length === 0
      ? { value: null, reason: "metric_empty" }
      : { value: null, reason: "metric_invalid" };
  }
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 0
  ) {
    return { value: null, reason: "metric_invalid" };
  }
  return { value, reason: null };
}

function normalizeMetricEnvelope(value: unknown): Readonly<{
  value: number | null;
  reason: MetricEvidenceReason | null;
}> {
  if (
    value === null ||
    typeof value !== "object" ||
    !("availability" in value)
  ) {
    return { value: null, reason: "metric_invalid" };
  }
  const envelope = value as Partial<EvidenceValue>;
  if (envelope.availability === "available") {
    return normalizeNumericMetricValue(envelope.value);
  }
  if (envelope.availability === "missing") {
    return { value: null, reason: "metric_missing" };
  }
  if (envelope.availability === "unsupported") {
    return { value: null, reason: "metric_unsupported" };
  }
  if (envelope.availability === "stale") {
    return { value: null, reason: "metric_stale" };
  }
  if (envelope.availability === "revoked") {
    return { value: null, reason: "metric_revoked" };
  }
  if (envelope.availability === "rate_limited") {
    return { value: null, reason: "metric_rate_limited" };
  }
  return { value: null, reason: "metric_invalid" };
}

function validateObservation(
  observation: ImageAnalysisResult,
): void {
  if (
    observation === null ||
    typeof observation !== "object" ||
    observation.observation === null ||
    typeof observation.observation !== "object" ||
    observation.binding === null ||
    typeof observation.binding !== "object" ||
    !SAFE_ASSET_ID.test(observation.binding.assetId) ||
    !SHA256_PATTERN.test(observation.binding.sha256)
  ) {
    throw new GrowthEvidenceError(
      "ASSET_BINDING_MISMATCH",
      "The Task 3 image binding is invalid.",
    );
  }
}

function normalizeSourcePermission(
  value: unknown,
): "allowed" | "unknown" | "denied" {
  return value === "allowed" || value === "denied"
    ? value
    : "unknown";
}

function metricEnvelope(
  metrics: Readonly<Record<string, EvidenceValue>> | undefined,
  metric: OfficialGrowthMetric,
): unknown {
  if (metrics === undefined) {
    return undefined;
  }
  if (Object.prototype.hasOwnProperty.call(metrics, metric)) {
    return metrics[metric];
  }
  if (
    metric === "saves" &&
    Object.prototype.hasOwnProperty.call(metrics, "saved")
  ) {
    return metrics.saved;
  }
  return undefined;
}

function validateSelectedAsset(
  publicImageMatch: PublicImageEvidenceMatch,
  binding: ImageObservationBinding,
): Readonly<{
  assetId: string;
  sha256: string;
}> {
  const selectedAsset = publicImageMatch.selectedAsset;
  if (
    publicImageMatch.status === "matched" &&
    (
      selectedAsset === null ||
      !SAFE_ASSET_ID.test(selectedAsset.assetId) ||
      !SHA256_PATTERN.test(selectedAsset.sha256) ||
      selectedAsset.assetId !== binding.assetId ||
      selectedAsset.sha256 !== binding.sha256
    )
  ) {
    throw new GrowthEvidenceError(
      "ASSET_BINDING_MISMATCH",
      "The selected public image does not match the Task 3 asset binding.",
    );
  }
  return selectedAsset ?? {
    assetId: binding.assetId,
    sha256: binding.sha256,
  };
}

function observationList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return Object.freeze([]);
  }
  return Object.freeze(
    value
      .slice(0, MAX_OBSERVATION_ITEMS)
      .map((item) => boundedText(item))
      .filter((item) => item.length > 0),
  );
}

function coverageValue(
  snapshots: readonly OfficialGrowthSnapshot[],
  key: "region" | "language",
): Readonly<{
  value: string | null;
  verified: boolean;
  reason: string;
}> {
  for (const snapshot of [...snapshots].reverse()) {
    const coverage = snapshot.coverage?.[key];
    if (
      coverage?.verified === true &&
      typeof coverage.value === "string" &&
      coverage.value.trim().length > 0 &&
      sanitizeSourceRef(snapshot.sourceRef) !== null &&
      normalizeTimestamp(snapshot.fetchedAt) !== null
    ) {
      return {
        value: boundedText(coverage.value, 80),
        verified: true,
        reason: "official_coverage_verified",
      };
    }
  }
  return {
    value: null,
    verified: false,
    reason: `official_${key}_coverage_missing`,
  };
}

function hasVerifiedCoverage(
  coverage: Readonly<{
    value: string | null;
    verified: boolean;
  }>,
  expected: string,
): boolean {
  if (!coverage.verified || coverage.value === null) {
    return false;
  }
  const normalized = coverage.value.toLowerCase();
  if (expected === "Hong Kong") {
    return normalized === "hong kong" || normalized === "hk";
  }
  return normalized === "zh-hant" || normalized === "traditional chinese";
}

function freezeMetric(metric: MetricEvidence): MetricEvidence {
  return Object.freeze(metric);
}

export function buildGrowthEvidence(
  input: BuildGrowthEvidenceInput,
): GrowthEvidenceReport {
  validateObservation(input.observation);
  const runAt = normalizeTimestamp(input.runAt);
  if (runAt === null) {
    throw new GrowthEvidenceError(
      "INVALID_RUN_AT",
      "The report run time must be a valid timestamp.",
    );
  }
  const boundedOfficialSnapshots =
    input.officialSnapshots.slice(0, MAX_OFFICIAL_SNAPSHOTS);
  const sourcePermissionValue =
    input.sourcePermission === undefined
      ? "denied" as const
      : normalizeSourcePermission(
          input.sourcePermission.publicImage,
        );
  const sourcePermissionBasis =
    input.sourcePermission === undefined
      ? "default_denied" as const
      : "explicit" as const;

  const selectedAsset = input.publicImageMatch === null
    ? null
    : validateSelectedAsset(
        input.publicImageMatch,
        input.observation.binding,
      );
  const selectedMetrics = new Map<
    OfficialGrowthMetric,
    Readonly<{
      value: unknown;
      sourceRef: string | null;
      observedAt: string | null;
      period: GrowthMetricPeriod | null;
    }>
  >();
  const metricPeriods = new Map<
    OfficialGrowthMetric,
    Readonly<{
      period: GrowthMetricPeriod;
      sourceRef: string;
    }>
  >();
  const officialProvenance: Array<
    GrowthEvidenceReport["provenance"]["officialMetrics"][number]
  > = [];
  const citations: GrowthEvidenceCitation[] = [];

  for (const snapshot of boundedOfficialSnapshots) {
    const sourceRef = sanitizeSourceRef(snapshot.sourceRef);
    const observedAt = normalizeTimestamp(snapshot.fetchedAt);
    const period = snapshotPeriod(snapshot);
    if (sourceRef !== null && observedAt !== null && period !== null) {
      officialProvenance.push(
        Object.freeze({
          sourceKind: "official_metrics",
          sourceRef,
          observedAt,
          sampleOnly: false,
          periodKind: period.kind,
        }),
      );
      citations.push(
        Object.freeze({
          sourceKind: "official_metrics",
          title: "Instagram official metrics",
          sourceRef,
          observedAt,
          sampleOnly: false,
        }),
      );
    }
    for (const metric of OFFICIAL_GROWTH_METRICS) {
      const envelope = metricEnvelope(snapshot.metrics, metric);
      if (envelope === undefined) {
        continue;
      }
      selectedMetrics.set(
        metric,
        Object.freeze({
          value: envelope,
          sourceRef,
          observedAt,
          period,
        }),
      );
      if (sourceRef !== null && period !== null) {
        metricPeriods.set(
          metric,
          Object.freeze({
            period,
            sourceRef,
          }),
        );
      }
    }
  }

  const metrics = OFFICIAL_GROWTH_METRICS.map((metric) => {
    const selected = selectedMetrics.get(metric);
    if (selected === undefined) {
      return freezeMetric({
        metric,
        value: null,
        status: "unavailable",
        reason: "metric_missing",
        sourceRef: null,
        observedAt: null,
        periodKind: "unknown",
        sampleOnly: false,
      });
    }
    if (selected.sourceRef === null) {
      return freezeMetric({
        metric,
        value: null,
        status: "unavailable",
        reason: "source_reference_invalid",
        sourceRef: null,
        observedAt: selected.observedAt,
        periodKind: selected.period?.kind ?? "unknown",
        sampleOnly: false,
      });
    }
    if (selected.observedAt === null) {
      return freezeMetric({
        metric,
        value: null,
        status: "unavailable",
        reason: "source_time_invalid",
        sourceRef: selected.sourceRef,
        observedAt: null,
        periodKind: selected.period?.kind ?? "unknown",
        sampleOnly: false,
      });
    }
    if (selected.period === null) {
      return freezeMetric({
        metric,
        value: null,
        status: "unavailable",
        reason: "metric_period_invalid",
        sourceRef: selected.sourceRef,
        observedAt: selected.observedAt,
        periodKind: "unknown",
        sampleOnly: false,
      });
    }
    const normalizedMetric = normalizeMetricEnvelope(selected.value);
    return freezeMetric({
      metric,
      value: normalizedMetric.value,
      status: normalizedMetric.value === null ? "unavailable" : "available",
      reason: normalizedMetric.reason,
      sourceRef: selected.sourceRef,
      observedAt: selected.observedAt,
      periodKind: selected.period.kind,
      sampleOnly: false,
    });
  });

  const publicImageSourceRef = input.publicImageMatch === null
    ? null
    : sanitizeSourceRef(input.publicImageMatch.sourceRef);
  const publicImageObservedAt = input.publicImageMatch === null
    ? null
    : normalizeTimestamp(input.publicImageMatch.fetchedAt);
  const publicImageAvailable =
    input.publicImageMatch?.status === "matched" &&
    sourcePermissionValue === "allowed" &&
    input.publicImageMatch.rights === "allowed" &&
    publicImageSourceRef !== null &&
    publicImageObservedAt !== null &&
    selectedAsset !== null;
  const publicImageProvenance =
    publicImageAvailable &&
    input.publicImageMatch !== null &&
    publicImageSourceRef !== null &&
    publicImageObservedAt !== null
      ? Object.freeze({
          sourceKind: "public_image_mock" as const,
          sourceRef: publicImageSourceRef,
          observedAt: publicImageObservedAt,
          sampleOnly: input.publicImageMatch.sampleOnly,
          assetId: selectedAsset.assetId,
          sha256: selectedAsset.sha256,
        })
      : null;

  if (publicImageProvenance !== null) {
    citations.push(
      Object.freeze({
        sourceKind: "public_image_mock",
        title: "Public image match",
        sourceRef: publicImageProvenance.sourceRef,
        observedAt: publicImageProvenance.observedAt,
        sampleOnly: publicImageProvenance.sampleOnly,
      }),
    );
  }

  const binding = input.observation.binding;
  const manualMode =
    input.observation.observation.availability === "manual"
      ? "manual_observation" as const
      : binding.sourceKind === "creator-upload"
        ? "creator_upload" as const
        : null;
  const selfUploadManual =
    manualMode !== null
      ? Object.freeze({
          sourceKind: binding.sourceKind,
          manualMode,
          sourceRef: `asset:${binding.assetId}`,
          observedAt: runAt,
          sampleOnly: input.observation.observation.sampleOnly,
          assetId: binding.assetId,
          sha256: binding.sha256,
        })
      : null;
  if (selfUploadManual !== null) {
    citations.push(
      Object.freeze({
        sourceKind: "self_upload_manual",
        title: "Creator-provided image or manual input",
        sourceRef: selfUploadManual.sourceRef,
        observedAt: selfUploadManual.observedAt,
        sampleOnly: false,
      }),
    );
  }

  const regionCoverage = coverageValue(
    boundedOfficialSnapshots,
    "region",
  );
  const languageCoverage = coverageValue(
    boundedOfficialSnapshots,
    "language",
  );
  const regionVerified = hasVerifiedCoverage(
    regionCoverage,
    "Hong Kong",
  );
  const languageVerified = hasVerifiedCoverage(
    languageCoverage,
    "zh-Hant",
  );
  const availableMetrics = metrics.filter(
    (metric) => metric.status === "available",
  ).length;
  const officialMetricsAvailability =
    availableMetrics === 0
      ? "unavailable"
      : availableMetrics === metrics.length
        ? "available"
        : "partial";
  const partialReasons = [
    ...new Set([
      ...metrics
        .filter((metric) => metric.status === "unavailable")
        .map((metric) => `metric:${metric.metric}:${metric.reason ?? "unknown"}`),
      ...(input.publicImageMatch !== null && !publicImageAvailable
        ? ["public_image_unavailable"]
        : []),
      ...(!regionVerified ? [regionCoverage.reason] : []),
      ...(!languageVerified ? [languageCoverage.reason] : []),
      ...(
        boundedOfficialSnapshots.length < input.officialSnapshots.length
          ? ["official_snapshots_truncated"]
          : []
      ),
    ]),
  ];
  const sampleOnly =
    input.observation.observation.sampleOnly === true ||
    (input.publicImageMatch?.sampleOnly === true);
  const availabilityReasons = Object.freeze([
    ...partialReasons,
    ...(input.publicImageMatch === null
      ? ["public_image_not_provided"]
      : []),
  ]);
  const report = {
    question: sanitizeQuestion(input.question),
    platform: "instagram" as const,
    runAt,
    metrics: Object.freeze(metrics),
    availability: Object.freeze({
      officialMetrics: officialMetricsAvailability,
      publicImageMock:
        input.publicImageMatch === null
          ? "not_provided"
          : publicImageAvailable
            ? input.publicImageMatch.sampleOnly
              ? "mock"
              : "available"
            : "unavailable",
      selfUploadManual:
        selfUploadManual === null
          ? "not_applicable"
          : "manual",
      reasons: availabilityReasons,
    }),
    provenance: Object.freeze({
      officialMetrics: Object.freeze(officialProvenance),
      publicImageMock: publicImageProvenance,
      selfUploadManual,
    }),
    region: Object.freeze({
      requested: "Hong Kong" as const,
      verified: regionVerified,
      value: regionVerified ? regionCoverage.value : null,
      label: regionVerified ? "已核對" : "未驗證",
      reason: regionCoverage.reason,
    }),
    language: Object.freeze({
      requested: "zh-Hant" as const,
      verified: languageVerified,
      value: languageVerified ? languageCoverage.value : null,
      label: languageVerified ? "已核對" : "未驗證",
      reason: languageCoverage.reason,
    }),
    period: Object.freeze({
      selection: Object.freeze({
        windowDays: 30 as const,
        mediaLimit: 50 as const,
        appliesTo: "selection_only" as const,
      }),
      metrics: Object.freeze(
        [...metricPeriods.entries()].map(
          ([metric, selectedPeriod]) =>
            Object.freeze({
              metric,
              kind: selectedPeriod.period.kind,
              startAt:
                selectedPeriod.period.kind === "date_range"
                  ? selectedPeriod.period.startAt
                  : null,
              endAt:
                selectedPeriod.period.kind === "date_range"
                  ? selectedPeriod.period.endAt
                  : null,
              sourceRef: selectedPeriod.sourceRef,
            }),
        ),
      ),
    }),
    observation: Object.freeze({
      availability: input.observation.observation.availability,
      reason: input.observation.observation.reason ?? null,
      sourceKind: binding.sourceKind,
      sampleOnly: input.observation.observation.sampleOnly,
      objects: observationList(input.observation.observation.objects),
      visibleText: observationList(input.observation.observation.visibleText),
      composition: observationList(
        input.observation.observation.composition,
      ),
      captionAlignment:
        boundedText(input.observation.observation.captionAlignment, 40),
      uncertainties: observationList(
        input.observation.observation.uncertainties,
      ),
      assetId: binding.assetId,
      sha256: binding.sha256,
    }),
    sourcePermission: Object.freeze({
      publicImage: sourcePermissionValue,
      basis: sourcePermissionBasis,
    }),
    partial: partialReasons.length > 0,
    partialReasons: Object.freeze(partialReasons),
    sampleOnly,
    citations: Object.freeze(citations),
  };
  return Object.freeze(report);
}
