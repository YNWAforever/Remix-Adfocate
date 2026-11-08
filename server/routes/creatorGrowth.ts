import { createHash, randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import type { Env } from "../app.js";
import {
  AssetPolicyError,
  MAX_IMAGE_BYTES,
  isSupportedImageMime,
  normalizeImageAsset,
  type DecodeAndStripMetadata,
} from "../lib/creatorGrowth/assetPolicy.js";
import {
  ImageAnalysisError,
  analyzeImage,
  type SyntheticFixtureRegistry,
  type VisionAdapter,
} from "../lib/creatorGrowth/imageAnalysis.js";
import {
  matchPublicImage,
  type OfficialMediaRef,
} from "../lib/creatorGrowth/mediaMatch.js";
import {
  PublicImageProvider,
  PublicImageProviderError,
} from "../lib/creatorGrowth/publicImageProvider.js";
import { buildGrowthEvidence, OFFICIAL_GROWTH_METRICS, type GrowthEvidenceReport, type OfficialGrowthSnapshot } from "../lib/creatorGrowth/report.js";
import {
  GrowthRepositoryError,
  type GrowthAnalysisRecord,
  type GrowthAssetRecord,
  type GrowthDraftRecord,
  type GrowthMediaSourceRecord,
  type GrowthMutationContext,
  type GrowthOwner,
  type GrowthOwnerExport,
  type GrowthRepository,
  type GrowthRouteCommandInput,
  type GrowthRoutePlan,
  type GrowthSkillInvocationRecord,
} from "../lib/creatorGrowth/repository.js";
import {
  runGrowthSkill,
  type GrowthSkillResult,
} from "../lib/creatorGrowth/skillRunner.js";
import {
  GROWTH_SKILLS,
  type GrowthSkillId,
} from "../../src/lib/creatorGrowth/skillManifest.js";
import type {
  GrowthAnalysisDto,
  GrowthAssetDto,
  GrowthDraftDto,
  GrowthMediaSelectionDto,
  GrowthSkillDto,
} from "../../src/lib/creatorGrowth/queries.js";
import type {
  IntegrationConnection,
  IntegrationResource,
} from "../../src/lib/integrations/types.js";

type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 413 | 415 | 429 | 503;
type JsonRecord = Record<string, unknown>;

export type CreatorGrowthIntegrationReader = Readonly<{
  list(owner: GrowthOwner): Promise<readonly IntegrationConnection[]>;
  resources(
    owner: GrowthOwner,
    connectionId: string,
  ): Promise<readonly IntegrationResource[]>;
}>;

export type CreatorGrowthRouteDependencies = Readonly<{
  repo: GrowthRepository;
  vision: VisionAdapter;
  publicImages: PublicImageProvider;
  integrations: CreatorGrowthIntegrationReader;
  decodeAndStripMetadata: DecodeAndStripMetadata;
  enabled: boolean;
  mode: "mock" | "external";
  now?: () => Date;
  syntheticFixtures?: SyntheticFixtureRegistry;
}>;

class CreatorGrowthRouteError extends Error {
  constructor(
    readonly status: ErrorStatus,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CreatorGrowthRouteError";
  }
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONSENT_VERSION =
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const OWNER_FIELD_NAMES = new Set([
  "actor",
  "actorid",
  "creator",
  "creatorid",
  "owner",
  "ownerid",
  "user",
  "userid",
  "workspace",
  "workspaceid",
]);
const SENSITIVE_FIELD_NAMES = new Set([
  "accesstoken",
  "authorization",
  "credential",
  "objectpath",
  "password",
  "permalink",
  "providertoken",
  "refreshtoken",
  "secret",
  "storagepath",
  "token",
  "url",
]);
const CLIENT_SECRET_VALUE =
  /(?:eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9._-]+\.[A-Za-z0-9._-]*|\bBearer\s+\S+|\b(?:access_token|refresh_token|authorization|secret|password)\s*=\s*\S+)/i;
const REPORT_URL_VALUE = /(?:https?:\/\/|data:|blob:)/i;
const MAX_JSON_BYTES = 64 * 1024;
const MAX_REPORT_BYTES = 256 * 1024;
// One 8 MiB file plus a bounded multipart envelope. Count streamed bytes,
// independently of Content-Length, before invoking the multipart parser.
const MAX_MULTIPART_BYTES = MAX_IMAGE_BYTES + 16 * 1024;
const MAX_SOURCES = 12;
const MAX_CAPTION_LENGTH = 6000;
const MAX_GOAL_LENGTH = 300;
const MAX_DEPTH = 16;

function routeError(
  status: ErrorStatus,
  code: string,
  message: string,
): never {
  throw new CreatorGrowthRouteError(status, code, message);
}

function safeRouteError(context: Context<Env>, error: unknown) {
  if (error instanceof CreatorGrowthRouteError) {
    return context.json(
      { code: error.code, error: error.message },
      error.status,
    );
  }
  if (error instanceof GrowthRepositoryError) {
    if (
      error.code === "REVISION_CONFLICT" ||
      error.code === "IDEMPOTENCY_CONFLICT" ||
      error.code === "IDEMPOTENCY_EXPIRED"
    ) {
      return context.json(
        {
          code: "revision_conflict",
          error: "內容版本已更新，請重新載入後再試。",
        },
        409,
      );
    }
    if (
      error.code === "PERSISTENCE_DISABLED" ||
      error.code === "STORAGE_UNAVAILABLE" ||
      error.code === "INVALID_STORAGE_PATH"
    ) {
      return context.json(
        {
          code: "creator_growth_unavailable",
          error: "私人成長功能暫時不可用。",
        },
        503,
      );
    }
    if (error.code === "NOT_FOUND") {
      return context.json(
        {
          code: "not_found",
          error: "找不到可用的私人內容。",
        },
        404,
      );
    }
    if (error.code === "INVALID_OWNER") {
      return context.json(
        {
          code: "no_auth",
          error: "請先登入工作室。",
        },
        401,
      );
    }
    return context.json(
      {
        code:
          error.code === "NOT_ACTIVE_CREATOR"
            ? "creator_required"
            : "source_unavailable",
        error:
          error.code === "NOT_ACTIVE_CREATOR"
            ? "此工作區只限有效創作者使用。"
            : "此來源目前不可用。",
      },
      403,
    );
  }
  if (error instanceof AssetPolicyError) {
    if (error.code === "IMAGE_TOO_LARGE") {
      return context.json(
        {
          code: "image_too_large",
          error: "圖片超過大小限制。",
        },
        413,
      );
    }
    if (error.code === "DECODER_FAILED") {
      return context.json(
        {
          code: "decoder_unavailable",
          error: "私人圖片處理暫時不可用。",
        },
        503,
      );
    }
    return context.json(
      {
        code: "invalid_image",
        error: "請使用有效的 JPEG、PNG 或 WebP 圖片。",
      },
      415,
    );
  }
  if (error instanceof ImageAnalysisError) {
    if (error.code === "INVALID_ANALYSIS_INPUT") {
      return context.json(
        {
          code: "invalid_input",
          error: "請檢查圖片分析設定。",
        },
        400,
      );
    }
    if (
      error.code === "VISION_ADAPTER_FAILED" ||
      error.code === "UNSUPPORTED_VISION_ADAPTER"
    ) {
      return context.json(
        {
          code: "analysis_unavailable",
          error: "圖片分析暫時不可用。",
        },
        503,
      );
    }
    return context.json(
      {
        code: "asset_unavailable",
        error: "此圖片或來源目前不可用。",
      },
      403,
    );
  }
  if (error instanceof PublicImageProviderError) {
    return context.json(
      {
        code: "public_image_unavailable",
        error: "公開圖片核對暫時不可用。",
      },
      503,
    );
  }
  return context.json(
    {
      code: "creator_growth_unavailable",
      error: "私人成長功能暫時不可用。",
    },
    503,
  );
}

function normalizedFieldName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isSensitiveClientField(value: string): boolean {
  return (
    SENSITIVE_FIELD_NAMES.has(value) ||
    /(?:credential|password|secret|token|url)$/.test(value)
  );
}

function assertSafeClientFields(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
): void {
  if (depth > MAX_DEPTH) {
    routeError(400, "invalid_input", "請檢查輸入內容。");
  }
  if (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return;
  }
  if (value instanceof File) {
    return;
  }
  if (value instanceof FormData) {
    for (const [key, entry] of value.entries()) {
      const normalized = normalizedFieldName(key);
      if (OWNER_FIELD_NAMES.has(normalized)) {
        routeError(
          400,
          "owner_not_accepted",
          "帳戶及工作區身分只由工作階段決定。",
        );
      }
      if (isSensitiveClientField(normalized)) {
        routeError(400, "invalid_input", "請移除私人連線資料。");
      }
      assertSafeClientFields(entry, depth + 1, seen);
    }
    return;
  }
  if (typeof value !== "object") {
    return;
  }
  if (seen.has(value)) {
    return;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      assertSafeClientFields(item, depth + 1, seen);
    }
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    const normalized = normalizedFieldName(key);
    if (OWNER_FIELD_NAMES.has(normalized)) {
      routeError(
        400,
        "owner_not_accepted",
        "帳戶及工作區身分只由工作階段決定。",
      );
    }
    if (isSensitiveClientField(normalized)) {
      routeError(400, "invalid_input", "請移除私人連線資料。");
    }
    if (
      typeof entry === "string" &&
      CLIENT_SECRET_VALUE.test(entry)
    ) {
      routeError(400, "invalid_input", "請移除私人憑證。");
    }
    assertSafeClientFields(entry, depth + 1, seen);
  }
}

function assertSafeEvidenceReport(
  report: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
): void {
  if (depth > MAX_DEPTH) {
    routeError(400, "invalid_report", "請檢查證據內容。");
  }
  if (typeof report === "string") {
    if (REPORT_URL_VALUE.test(report) || CLIENT_SECRET_VALUE.test(report)) {
      routeError(400, "invalid_report", "證據只可包含私人安全來源編號。");
    }
    return;
  }
  if (
    report === null ||
    report === undefined ||
    typeof report === "number" ||
    typeof report === "boolean"
  ) {
    return;
  }
  if (typeof report !== "object") {
    routeError(400, "invalid_report", "請檢查證據內容。");
  }
  if (seen.has(report)) {
    routeError(400, "invalid_report", "請檢查證據內容。");
  }
  seen.add(report);
  if (Array.isArray(report)) {
    for (const item of report) {
      assertSafeEvidenceReport(
        item,
        depth + 1,
        seen,
      );
    }
    return;
  }
  for (const entry of Object.values(report)) {
    assertSafeEvidenceReport(
      entry,
      depth + 1,
      seen,
    );
  }
}

async function readJson(context: Context<Env>): Promise<JsonRecord> {
  const raw = new TextDecoder().decode(await boundedBody(context, MAX_JSON_BYTES));
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw || "{}");
  } catch {
    routeError(400, "invalid_input", "請檢查輸入內容。");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    routeError(400, "invalid_input", "請檢查輸入內容。");
  }
  assertSafeClientFields(parsed);
  return parsed as JsonRecord;
}

async function boundedBody(
  context: Context<Env>,
  limit: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const reader = context.req.raw.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    const declared = Number(context.req.header("Content-Length"));
    if (Number.isFinite(declared) && declared > limit) {
      await reader?.cancel();
      routeError(413, "input_too_large", "輸入內容太長。");
    }
    if (reader) {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > limit) {
          await reader.cancel();
          routeError(413, "input_too_large", "輸入內容太長。");
        }
        chunks.push(part.value);
      }
    }
  } catch (error) {
    if (error instanceof CreatorGrowthRouteError) throw error;
    routeError(400, "invalid_input", "請檢查輸入內容。");
  } finally {
    reader?.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function onlyFields(value: JsonRecord, allowed: readonly string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    routeError(400, "invalid_input", "請移除未支援的欄位。");
  }
}

function sessionOwner(context: Context<Env>): GrowthOwner {
  const workspaceId = context.get("workspaceId") as string | undefined;
  const creatorId = context.get("userId") as string | undefined;
  const jwt = context.get("jwt") as string | undefined;
  if (
    !workspaceId ||
    !creatorId ||
    !jwt ||
    !UUID.test(workspaceId) ||
    !UUID.test(creatorId)
  ) {
    routeError(401, "no_auth", "請先登入工作室。");
  }
  return Object.freeze({ workspaceId, creatorId });
}

function requestMutation(context: Context<Env>): GrowthMutationContext {
  const supplied = context.req.header("Idempotency-Key");
  if (supplied !== undefined && !UUID.test(supplied)) {
    routeError(400, "invalid_idempotency_key", "請重新整理後再試。");
  }
  return Object.freeze({
    idempotencyKey: supplied ?? randomUUID(),
  });
}

function derivedUuid(idempotencyKey: string, purpose: string): string {
  const bytes = createHash("sha256")
    .update(`${idempotencyKey}:${purpose}`)
    .digest()
    .subarray(0, 16);
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

function subMutation(
  context: GrowthMutationContext,
  purpose: string,
): GrowthMutationContext {
  return Object.freeze({
    idempotencyKey: derivedUuid(context.idempotencyKey, purpose),
  });
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function callerCommand(
  operation: GrowthRouteCommandInput["operation"],
  body: JsonRecord,
  binding: Omit<GrowthRouteCommandInput, "operation" | "requestHash">,
): GrowthRouteCommandInput {
  return {
    ...binding,
    operation,
    requestHash: createHash("sha256")
      .update(canonicalJson({ operation, body }))
      .digest("hex"),
  };
}

function requiredDependencies(
  dependencies: CreatorGrowthRouteDependencies | undefined,
): CreatorGrowthRouteDependencies {
  if (dependencies === undefined || dependencies.enabled !== true) {
    routeError(503, "creator_growth_disabled", "私人成長功能尚未開放。");
  }
  return dependencies;
}

function nowFor(
  dependencies: CreatorGrowthRouteDependencies,
): Date {
  return dependencies.now?.() ?? new Date();
}

function addHours(value: Date, hours: number): string {
  return new Date(
    value.getTime() + hours * 60 * 60 * 1000,
  ).toISOString();
}

async function activeOwnerExport(
  repo: GrowthRepository,
  owner: GrowthOwner,
): Promise<GrowthOwnerExport> {
  return repo.exportOwner(owner);
}

function requiredUuid(value: unknown, message: string): string {
  if (typeof value !== "string" || !UUID.test(value)) {
    routeError(400, "invalid_input", message);
  }
  return value;
}

function requiredString(
  value: unknown,
  message: string,
  maximum = 128,
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum
  ) {
    routeError(400, "invalid_input", message);
  }
  return value;
}

function optionalText(
  value: unknown,
  message: string,
  maximum: number,
): string {
  if (value === undefined) {
    return "";
  }
  if (typeof value !== "string") {
    routeError(400, "invalid_input", message);
  }
  const length = Array.from(value).length;
  if (length > maximum || CLIENT_SECRET_VALUE.test(value) || REPORT_URL_VALUE.test(value)) {
    routeError(400, "invalid_input", message);
  }
  return value;
}

function uuidList(
  value: unknown,
  message: string,
): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length > MAX_SOURCES ||
    value.some((entry) => typeof entry !== "string" || !UUID.test(entry)) ||
    new Set(value).size !== value.length
  ) {
    routeError(400, "invalid_input", message);
  }
  return Object.freeze([...value] as string[]);
}

function findAsset(
  exported: GrowthOwnerExport,
  assetId: string,
): GrowthAssetRecord {
  const asset = exported.assets.find((entry) => entry.id === assetId);
  if (asset === undefined) {
    routeError(403, "asset_unavailable", "此圖片目前不可用。");
  }
  return asset;
}

function findAnalysis(
  exported: GrowthOwnerExport,
  analysisId: string,
): GrowthAnalysisRecord {
  const analysis = exported.analyses.find(
    (entry) => entry.id === analysisId,
  );
  if (analysis === undefined || analysis.invalidatedAt !== null) {
    routeError(403, "source_unavailable", "此分析來源目前不可用。");
  }
  return analysis;
}

function findSkill(
  exported: GrowthOwnerExport,
  skillInvocationId: string,
): GrowthSkillInvocationRecord {
  const skill = exported.skillInvocations.find(
    (entry) => entry.id === skillInvocationId,
  );
  if (skill === undefined || skill.invalidatedAt !== null) {
    routeError(403, "source_unavailable", "此技能結果目前不可用。");
  }
  return skill;
}

function canonicalSources(
  exported: GrowthOwnerExport,
  sourceIds: readonly string[],
  threadId: string,
  assetId: string,
): readonly GrowthMediaSourceRecord[] {
  return Object.freeze(
    sourceIds.map((sourceId) => {
      const source = exported.mediaSources.find(
        (entry) => entry.id === sourceId,
      );
      if (
        source === undefined ||
        source.invalidatedAt !== null ||
        source.revokedAt !== null ||
        source.threadId !== threadId ||
        (source.assetId !== null && source.assetId !== assetId)
      ) {
        routeError(403, "source_unavailable", "此來源目前不可用。");
      }
      return source;
    }),
  );
}

function projectAsset(asset: GrowthAssetRecord): GrowthAssetDto {
  return Object.freeze({
    id: asset.id,
    threadId: asset.threadId,
    mime: asset.mime,
    byteSize: asset.byteSize,
    width: asset.width,
    height: asset.height,
    sha256: asset.sha256,
    rightsConfirmed: true,
    sampleOnly: false,
    createdAt: asset.createdAt,
  });
}

function projectAnalysis(analysis: GrowthAnalysisRecord): GrowthAnalysisDto {
  const observation = analysis.result.observation;
  if (!observationGuard({ ...observation, reason: observation.reason ?? null })) {
    routeError(403, "source_unavailable", "分析來源格式無效。");
  }
  return Object.freeze({
    id: analysis.id,
    threadId: analysis.threadId,
    assetId: analysis.assetId,
    mediaSourceId: analysis.mediaSourceId ?? null,
    sha256: analysis.result.binding.sha256,
    availability: observation.availability,
    reason: observation.reason ?? null,
    sourceKind: analysis.result.binding.sourceKind,
    sampleOnly: observation.sampleOnly,
    objects: Object.freeze([...observation.objects]),
    visibleText: Object.freeze([...observation.visibleText]),
    composition: Object.freeze([...observation.composition]),
    captionAlignment: observation.captionAlignment,
    uncertainties: Object.freeze([...observation.uncertainties]),
    createdAt: analysis.createdAt,
  });
}

type ValueGuard = (value: unknown) => boolean;
const safeText: ValueGuard = (value) =>
  typeof value === "string" &&
  value.length <= 6000 &&
  !REPORT_URL_VALUE.test(value) &&
  !CLIENT_SECRET_VALUE.test(value) &&
  !Array.from(value).some((char) => {
    const code = char.charCodeAt(0);
    return (code < 32 && ![9, 10, 13].includes(code)) || code === 127;
  });
const booleanValue: ValueGuard = (value) => typeof value === "boolean";
const scalarNumber: ValueGuard = (value) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const timestampValue: ValueGuard = (value) =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T/.test(value) &&
  Number.isFinite(Date.parse(value));
const oneOf =
  (...values: readonly unknown[]): ValueGuard =>
  (value) =>
    values.includes(value);
const nullable =
  (guard: ValueGuard): ValueGuard =>
  (value) =>
    value === null || guard(value);
const listOf =
  (guard: ValueGuard, maximum = 32): ValueGuard =>
  (value) =>
    Array.isArray(value) && value.length <= maximum && value.every(guard);
const shape =
  (fields: Readonly<Record<string, ValueGuard>>): ValueGuard =>
  (value) => {
    if (value === null || typeof value !== "object" || Array.isArray(value))
      return false;
    const record = value as JsonRecord;
    return (
      Object.keys(record).length === Object.keys(fields).length &&
      Object.entries(fields).every(
        ([key, guard]) => Object.hasOwn(record, key) && guard(record[key]),
      )
    );
  };
const sourceKind = oneOf("creator-upload", "synthetic-fixture");
const periodKind = oneOf("lifetime", "date_range");
const sourceReference: ValueGuard = (value) =>
  safeText(value) &&
  typeof value === "string" &&
  /^[A-Za-z0-9][A-Za-z0-9._:/@#-]{0,255}$/.test(value);
const assetIdValue: ValueGuard = (value) =>
  typeof value === "string" && UUID.test(value);
const shaValue: ValueGuard = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const metricName = oneOf(...OFFICIAL_GROWTH_METRICS);
const observationGuard = shape({
  availability: oneOf("observed", "manual"),
  reason: nullable(safeText),
  sampleOnly: booleanValue,
  objects: listOf(safeText, 12),
  visibleText: listOf(safeText, 12),
  composition: listOf(safeText, 12),
  captionAlignment: oneOf("aligned", "misaligned", "uncertain", "unavailable"),
  uncertainties: listOf(safeText, 12),
});
const skillResultGuard = shape({
  proposal: safeText,
  sourceRefs: listOf(sourceReference, 12),
  limitations: listOf(safeText),
  sampleOnly: booleanValue,
});
const reportGuard = shape({
  question: safeText,
  platform: oneOf("instagram"),
  runAt: timestampValue,
  metrics: listOf(
    shape({
      metric: metricName,
      value: nullable(scalarNumber),
      status: oneOf("available", "unavailable"),
      reason: nullable(
        oneOf(
          "metric_missing",
          "metric_empty",
          "metric_invalid",
          "metric_unsupported",
          "metric_stale",
          "metric_revoked",
          "metric_rate_limited",
          "metric_period_invalid",
          "source_reference_invalid",
          "source_time_invalid",
        ),
      ),
      sourceRef: nullable(sourceReference),
      observedAt: nullable(timestampValue),
      periodKind: oneOf("lifetime", "date_range", "unknown"),
      sampleOnly: booleanValue,
    }),
    7,
  ),
  availability: shape({
    officialMetrics: oneOf("available", "partial", "unavailable"),
    publicImageMock: oneOf("available", "mock", "unavailable", "not_provided"),
    selfUploadManual: oneOf("manual", "not_applicable"),
    reasons: listOf(safeText),
  }),
  provenance: shape({
    officialMetrics: listOf(
      shape({
        sourceKind: oneOf("official_metrics"),
        sourceRef: sourceReference,
        observedAt: timestampValue,
        sampleOnly: booleanValue,
        periodKind,
      }),
      12,
    ),
    publicImageMock: nullable(
      shape({
        sourceKind: oneOf("public_image_mock"),
        sourceRef: sourceReference,
        observedAt: timestampValue,
        sampleOnly: booleanValue,
        assetId: assetIdValue,
        sha256: shaValue,
      }),
    ),
    selfUploadManual: nullable(
      shape({
        sourceKind,
        manualMode: oneOf("creator_upload", "manual_observation"),
        sourceRef: sourceReference,
        observedAt: timestampValue,
        sampleOnly: booleanValue,
        assetId: assetIdValue,
        sha256: shaValue,
      }),
    ),
  }),
  region: shape({
    requested: oneOf("Hong Kong"),
    verified: booleanValue,
    value: nullable(safeText),
    label: oneOf("未驗證", "已核對"),
    reason: safeText,
  }),
  language: shape({
    requested: oneOf("zh-Hant"),
    verified: booleanValue,
    value: nullable(safeText),
    label: oneOf("未驗證", "已核對"),
    reason: safeText,
  }),
  period: shape({
    selection: shape({
      windowDays: oneOf(30),
      mediaLimit: oneOf(50),
      appliesTo: oneOf("selection_only"),
    }),
    metrics: listOf(
      shape({
        metric: metricName,
        kind: periodKind,
        startAt: nullable(timestampValue),
        endAt: nullable(timestampValue),
        sourceRef: sourceReference,
      }),
      7,
    ),
  }),
  observation: shape({
    availability: oneOf("observed", "manual"),
    reason: nullable(safeText),
    sourceKind,
    sampleOnly: booleanValue,
    objects: listOf(safeText, 12),
    visibleText: listOf(safeText, 12),
    composition: listOf(safeText, 12),
    captionAlignment: oneOf("aligned", "misaligned", "uncertain", "unavailable"),
    uncertainties: listOf(safeText, 12),
    assetId: assetIdValue,
    sha256: shaValue,
  }),
  sourcePermission: shape({
    publicImage: oneOf("allowed", "unknown", "denied"),
    basis: oneOf("explicit", "default_denied"),
  }),
  partial: booleanValue,
  partialReasons: listOf(safeText),
  sampleOnly: booleanValue,
  citations: listOf(
    shape({
      sourceKind: oneOf("official_metrics", "public_image_mock", "self_upload_manual"),
      title: safeText,
      sourceRef: sourceReference,
      observedAt: timestampValue,
      sampleOnly: booleanValue,
    }),
    12,
  ),
});

function validateReport(report: GrowthEvidenceReport): void {
  assertSafeEvidenceReport(report);
  if (
    !reportGuard(report) ||
    Buffer.byteLength(JSON.stringify(report), "utf8") > MAX_REPORT_BYTES
  ) {
    routeError(403, "source_unavailable", "證據來源格式無效。");
  }
}

async function canonicalReport(
  configured: CreatorGrowthRouteDependencies,
  owner: GrowthOwner,
  analysis: GrowthAnalysisRecord,
  sources: readonly GrowthMediaSourceRecord[],
  question: string,
  runAt: string,
): Promise<GrowthEvidenceReport> {
  const snapshots: OfficialGrowthSnapshot[] = [];
  const connections = await configured.integrations.list(owner);
  for (const source of sources) {
    if (
      source.rights !== "allowed" ||
      (source.sourceKind !== "creator_upload" &&
        (source.visibility !== "public" || source.matchStatus !== "matched"))
    ) {
      routeError(403, "source_unavailable", "此來源目前不可用。");
    }
    if (source.sourceKind !== "official_instagram") continue;
    const connection = connections.find(
      (entry) =>
        entry.id === source.connectionId &&
        entry.generation === source.generation &&
        entry.provider === "instagram" &&
        ["connected", "partial"].includes(entry.status),
    );
    if (!connection) routeError(403, "source_unavailable", "此官方來源目前不可用。");
    const resources = await configured.integrations.resources(owner, connection.id);
    const resource = resources.find(
      (entry) =>
        source.sourceRef ===
        `official:${connection.id}:${entry.id}:g${connection.generation}`,
    );
    if (
      !resource ||
      resource.connectionId !== connection.id ||
      resource.externalId !== source.mediaId ||
      !resource.selected ||
      resource.availability !== "available" ||
      !["owned", "licensed"].includes(resource.rights) ||
      normalizedTimestamp(resource.observedAt, "來源時間無效。") !==
        source.observedAt ||
      (connection.sampleOnly || resource.sampleOnly) !== source.sampleOnly
    ) {
      routeError(403, "source_unavailable", "官方來源快照已變更。");
    }
    // Only the official metric measurement period is meaningful here. The
    // resource selection window is deliberately never used as a metric period.
    const verifiedCoverage = !source.sampleOnly && resource.coverage.partial === false;
    snapshots.push({
      sourceRef: source.sourceRef,
      fetchedAt: source.observedAt,
      period:
        resource.evidence?.measurementPeriod === "lifetime"
          ? { kind: "lifetime" }
          : null,
      metrics:
        resource.evidence?.measurementPeriod === "lifetime" ? resource.metrics : {},
      coverage: {
        ...(typeof resource.coverage.region === "string"
          ? { region: { value: resource.coverage.region, verified: verifiedCoverage } }
          : {}),
        ...(typeof resource.coverage.language === "string"
          ? {
              language: {
                value: resource.coverage.language,
                verified: verifiedCoverage,
              },
            }
          : {}),
      },
    });
  }
  const publicSources = sources.filter(
    (source) => source.sourceKind === "public_image_mock",
  );
  if (publicSources.length > 1)
    routeError(400, "invalid_input", "請選擇一個公開圖片來源。");
  const publicSource = publicSources[0];
  const report = buildGrowthEvidence({
    question,
    officialSnapshots: snapshots,
    observation: analysis.result,
    runAt,
    publicImageMatch: publicSource
      ? {
          status: "matched",
          reason: "media_id",
          sourceRef: publicSource.sourceRef,
          fetchedAt: publicSource.observedAt,
          sampleOnly: publicSource.sampleOnly,
          rights: publicSource.rights,
          selectedAsset: {
            assetId: analysis.assetId,
            sha256: analysis.result.binding.sha256,
          },
        }
      : null,
    ...(publicSource ? { sourcePermission: { publicImage: publicSource.rights } } : {}),
  });
  const sampleFor = (ref: string | null) =>
    sources.find((source) => source.sourceRef === ref)?.sampleOnly ?? false;
  const result: GrowthEvidenceReport = {
    ...report,
    sampleOnly:
      analysis.result.observation.sampleOnly ||
      sources.some((source) => source.sampleOnly),
    // The shared builder predates sample official snapshots. Preserve each
    // stored source's sample flag, including missing metrics and citations.
    metrics: report.metrics.map((metric) => ({
      ...metric,
      sampleOnly: sampleFor(metric.sourceRef),
    })),
    provenance: {
      ...report.provenance,
      officialMetrics: report.provenance.officialMetrics.map((source) => ({
        ...source,
        sampleOnly: sampleFor(source.sourceRef),
      })),
    },
    citations: report.citations.map((citation) => ({
      ...citation,
      sampleOnly:
        citation.sourceKind === "self_upload_manual"
          ? analysis.result.observation.sampleOnly
          : sampleFor(citation.sourceRef),
    })),
  };
  validateReport(result);
  return result;
}

function projectReport(
  report: GrowthEvidenceReport,
): GrowthEvidenceReport {
  validateReport(report);
  return Object.freeze({
    question: report.question,
    platform: "instagram",
    runAt: report.runAt,
    metrics: Object.freeze(
      report.metrics.map((metric) => Object.freeze({
        metric: metric.metric,
        value: metric.value,
        status: metric.status,
        reason: metric.reason,
        sourceRef: metric.sourceRef,
        observedAt: metric.observedAt,
        periodKind: metric.periodKind,
        sampleOnly: metric.sampleOnly,
      })),
    ),
    availability: Object.freeze({
      officialMetrics: report.availability.officialMetrics,
      publicImageMock: report.availability.publicImageMock,
      selfUploadManual: report.availability.selfUploadManual,
      reasons: Object.freeze([...report.availability.reasons]),
    }),
    provenance: Object.freeze({
      officialMetrics: Object.freeze(
        report.provenance.officialMetrics.map((source) =>
          Object.freeze({
            sourceKind: "official_metrics" as const,
            sourceRef: source.sourceRef,
            observedAt: source.observedAt,
            sampleOnly: source.sampleOnly,
            periodKind: source.periodKind,
          }),
        ),
      ),
      publicImageMock:
        report.provenance.publicImageMock === null
          ? null
          : Object.freeze({
              sourceKind: "public_image_mock" as const,
              sourceRef: report.provenance.publicImageMock.sourceRef,
              observedAt: report.provenance.publicImageMock.observedAt,
              sampleOnly: report.provenance.publicImageMock.sampleOnly,
              assetId: report.provenance.publicImageMock.assetId,
              sha256: report.provenance.publicImageMock.sha256,
            }),
      selfUploadManual:
        report.provenance.selfUploadManual === null
          ? null
          : Object.freeze({
              sourceKind: report.provenance.selfUploadManual.sourceKind,
              manualMode: report.provenance.selfUploadManual.manualMode,
              sourceRef: report.provenance.selfUploadManual.sourceRef,
              observedAt: report.provenance.selfUploadManual.observedAt,
              sampleOnly: report.provenance.selfUploadManual.sampleOnly,
              assetId: report.provenance.selfUploadManual.assetId,
              sha256: report.provenance.selfUploadManual.sha256,
            }),
    }),
    region: Object.freeze({
      requested: "Hong Kong",
      verified: report.region.verified,
      value: report.region.value,
      label: report.region.verified ? "已核對" : "未驗證",
      reason: report.region.reason,
    }),
    language: Object.freeze({
      requested: "zh-Hant",
      verified: report.language.verified,
      value: report.language.value,
      label: report.language.verified ? "已核對" : "未驗證",
      reason: report.language.reason,
    }),
    period: Object.freeze({
      selection: Object.freeze({
        windowDays: 30 as const,
        mediaLimit: 50 as const,
        appliesTo: "selection_only" as const,
      }),
      metrics: Object.freeze(
        report.period.metrics.map((period) => Object.freeze({
          metric: period.metric,
          kind: period.kind,
          startAt: period.startAt,
          endAt: period.endAt,
          sourceRef: period.sourceRef,
        })),
      ),
    }),
    observation: Object.freeze({
      availability: report.observation.availability,
      reason: report.observation.reason,
      sourceKind: report.observation.sourceKind,
      sampleOnly: report.observation.sampleOnly,
      objects: Object.freeze([...report.observation.objects]),
      visibleText: Object.freeze([...report.observation.visibleText]),
      composition: Object.freeze([...report.observation.composition]),
      captionAlignment: report.observation.captionAlignment,
      uncertainties: Object.freeze([...report.observation.uncertainties]),
      assetId: report.observation.assetId,
      sha256: report.observation.sha256,
    }),
    sourcePermission: Object.freeze({
      publicImage: report.sourcePermission.publicImage,
      basis: report.sourcePermission.basis,
    }),
    partial: report.partial,
    partialReasons: Object.freeze([...report.partialReasons]),
    sampleOnly: report.sampleOnly,
    citations: Object.freeze(
      report.citations.map((citation) => Object.freeze({
        sourceKind: citation.sourceKind,
        title: citation.title,
        sourceRef: citation.sourceRef,
        observedAt: citation.observedAt,
        sampleOnly: citation.sampleOnly,
      })),
    ),
  });
}

function projectSkill(
  skill: GrowthSkillInvocationRecord,
  result: GrowthSkillResult,
): GrowthSkillDto {
  if (!skillResultGuard(result))
    routeError(403, "source_unavailable", "技能結果格式無效。");
  return Object.freeze({
    id: skill.id,
    skillId: skill.skillId,
    threadId: skill.threadId,
    analysisId: skill.analysisId,
    mediaSourceIds: Object.freeze([...skill.mediaSourceIds]),
    report: projectReport(skill.report),
    proposal: result.proposal,
    sourceRefs: Object.freeze([...result.sourceRefs]),
    limitations: Object.freeze([...result.limitations]),
    sampleOnly: result.sampleOnly,
    createdAt: skill.createdAt,
  });
}

function projectDraft(
  draft: GrowthDraftRecord,
  skill: GrowthSkillInvocationRecord,
): GrowthDraftDto {
  if (draft.assetId === null || draft.analysisId === null) {
    routeError(404, "not_found", "找不到可用的私人草稿。");
  }
  return Object.freeze({
    id: draft.id,
    threadId: draft.threadId,
    assetId: draft.assetId,
    analysisId: draft.analysisId,
    skillId: skill.skillId,
    revision: draft.revision,
    caption: draft.caption,
    manualDescription: draft.manualDescription,
    evidenceReportId: skill.id,
    updatedAt: draft.updatedAt,
  });
}

function validSkillId(value: unknown): GrowthSkillId {
  if (
    typeof value !== "string" ||
    !GROWTH_SKILLS.some((skill) => skill.id === value)
  ) {
    routeError(400, "invalid_skill", "請選擇可用的成長技能。");
  }
  return value as GrowthSkillId;
}

function normalizedTimestamp(
  value: unknown,
  message: string,
): string {
  if (typeof value !== "string") {
    routeError(403, "source_unavailable", message);
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    routeError(403, "source_unavailable", message);
  }
  return parsed.toISOString();
}

export function createCreatorGrowthRoutes(
  dependencies?: CreatorGrowthRouteDependencies,
): Hono<Env> {
  const routes = new Hono<Env>();

  routes.use("*", async (context, next) => {
    context.header("Cache-Control", "private, no-store");
    context.header("Pragma", "no-cache");
    context.header("Referrer-Policy", "no-referrer");
    context.header("X-Content-Type-Options", "nosniff");
    sessionOwner(context);
    requiredDependencies(dependencies);
    await next();
  });

  routes.onError((error, context) => safeRouteError(context, error));

  routes.post("/assets", async (context) => {
    const configured = requiredDependencies(dependencies);
    const owner = sessionOwner(context);
    await activeOwnerExport(configured.repo, owner);
    const mutation = requestMutation(context);
    const bytes = await boundedBody(context, MAX_MULTIPART_BYTES);
    const form = await new Request(context.req.url, {
      method: "POST",
      headers: { "Content-Type": context.req.header("Content-Type") ?? "" },
      body: bytes,
    })
      .formData()
      .catch(() => {
        routeError(400, "invalid_input", "請提供一張私人圖片。");
      });
    assertSafeClientFields(form);
    const allowedFields = ["threadId", "rightsConfirmed", "file"];
    if (
      [...form.keys()].some((key) => !allowedFields.includes(key)) ||
      allowedFields.some((key) => form.getAll(key).length !== 1) ||
      [...form.values()].filter((value) => value instanceof File).length !== 1 ||
      typeof form.get("threadId") !== "string" ||
      typeof form.get("rightsConfirmed") !== "string"
    ) {
      routeError(400, "invalid_input", "請一次提供一張圖片及使用權確認。");
    }
    const files = form
      .getAll("file")
      .filter((entry): entry is File => entry instanceof File);
    if (files.length !== 1 || form.getAll("file").length !== 1) {
      routeError(400, "invalid_input", "請一次提供一張圖片。");
    }
    if (form.get("rightsConfirmed") !== "true" || form.get("threadId") === null) {
      routeError(400, "invalid_input", "請確認圖片使用權。");
    }
    const threadId = requiredUuid(form.get("threadId"), "請提供有效的創作對話。");
    const file = files[0];
    if (file.size > MAX_IMAGE_BYTES) {
      routeError(413, "image_too_large", "圖片超過大小限制。");
    }
    if (!isSupportedImageMime(file.type)) {
      routeError(415, "invalid_image_type", "請使用有效的 JPEG、PNG 或 WebP 圖片。");
    }
    const normalized = await normalizeImageAsset(
      {
        bytes: new Uint8Array(await file.arrayBuffer()),
        declaredMime: file.type,
        ownerId: `${owner.workspaceId}:${owner.creatorId}`,
        rightsConfirmed: true,
      },
      {
        decodeAndStripMetadata: configured.decodeAndStripMetadata,
      },
    );
    const asset = await configured.repo.putAsset(
      owner,
      {
        id: derivedUuid(mutation.idempotencyKey, "creator-upload-asset"),
        threadId,
        bytes: normalized.bytes,
        sha256: normalized.sha256,
        mime: normalized.detectedMime,
        byteSize: normalized.byteSize,
        width: normalized.width,
        height: normalized.height,
        rightsConfirmed: true,
        sourceKind: "creator-upload",
        sampleOnly: false,
        createdAt: nowFor(configured).toISOString(),
      },
      mutation,
    );
    return context.json(projectAsset(asset));
  });

  routes.post("/media/select", async (context) => {
    const configured = requiredDependencies(dependencies);
    const owner = sessionOwner(context);
    await activeOwnerExport(configured.repo, owner);
    const mutation = requestMutation(context);
    const body = await readJson(context);
    onlyFields(body, ["threadId", "officialMediaRef", "candidateRef"]);
    const threadId = requiredUuid(body.threadId, "請提供有效的創作對話。");
    if (
      body.officialMediaRef === null ||
      typeof body.officialMediaRef !== "object" ||
      Array.isArray(body.officialMediaRef)
    ) {
      routeError(400, "invalid_input", "請選擇官方媒體來源。");
    }
    const officialRef = body.officialMediaRef as JsonRecord;
    onlyFields(officialRef, ["connectionId", "resourceId"]);
    const connectionId = requiredUuid(
      officialRef.connectionId,
      "請選擇有效的官方連線。",
    );
    const resourceId = requiredUuid(officialRef.resourceId, "請選擇有效的官方貼文。");
    const candidateRef = requiredString(
      body.candidateRef,
      "請選擇可核對的公開圖片候選。",
      300,
    );
    const connections = await configured.integrations.list(owner);
    const connection = connections.find((entry) => entry.id === connectionId);
    if (
      connection === undefined ||
      connection.provider !== "instagram" ||
      connection.status === "revoked" ||
      connection.status === "reauth_required"
    ) {
      routeError(403, "source_unavailable", "此官方來源目前不可用。");
    }
    const resources = await configured.integrations.resources(owner, connectionId);
    const resource = resources.find((entry) => entry.id === resourceId);
    if (
      resource === undefined ||
      resource.connectionId !== connection.id ||
      resource.availability !== "available" ||
      !resource.selected ||
      resource.rights === "unknown"
    ) {
      routeError(403, "source_unavailable", "此官方貼文目前不可用。");
    }
    const permalink = resource.evidence?.permalink;
    if (typeof permalink !== "string") {
      routeError(403, "source_unavailable", "缺少可核對的官方貼文位置。");
    }
    const command = callerCommand("media/select", body, {
      threadId,
      assetId: null,
      analysisId: null,
      mediaSourceIds: [],
      connectionId,
      generation: connection.generation,
    });
    let state = await configured.repo.routeCommand(owner, command, mutation);
    if (state.plan === null) {
      const official: OfficialMediaRef = {
        subject: connection.id,
        mediaId: resource.externalId,
        permalink,
        mediaType: "IMAGE",
        observedAt: resource.observedAt,
      };
      const candidates = await configured.publicImages.listForProfile(
        {
          subject: connection.id,
          username: connection.label,
          officialPermalink: permalink,
        },
        new AbortController().signal,
      );
      if (candidates.length === 0) {
        routeError(503, "public_image_unavailable", "公開圖片核對暫時不可用。");
      }
      const candidate = candidates.find((entry) => entry.imageRef === candidateRef);
      if (candidate === undefined) {
        routeError(403, "public_image_unmatched", "未能核對這張公開圖片。");
      }
      const match = matchPublicImage(official, candidate);
      if (match.status !== "matched") {
        routeError(403, "public_image_unmatched", "未能核對這張公開圖片。");
      }
      const officialSourceId = derivedUuid(
        mutation.idempotencyKey,
        `official-source:${connection.id}:${resource.id}`,
      );
      const publicSourceId = derivedUuid(
        mutation.idempotencyKey,
        `public-source:${candidate.imageRef}`,
      );
      const observedAt = normalizedTimestamp(resource.observedAt, "官方來源時間無效。");
      const fetchedAt = normalizedTimestamp(resource.fetchedAt, "官方來源時間無效。");
      const publicFetchedAt = normalizedTimestamp(
        candidate.fetchedAt,
        "公開圖片來源時間無效。",
      );
      const officialInput = {
        id: officialSourceId,
        threadId,
        assetId: null,
        connectionId: connection.id,
        generation: connection.generation,
        sourceKind: "official_instagram",
        sourceRef: `official:${connection.id}:${resource.id}:g${connection.generation}`,
        subject: connection.id,
        mediaId: resource.externalId,
        permalink,
        rights: "allowed",
        visibility: "public",
        matchStatus: "matched",
        sampleOnly: connection.sampleOnly || resource.sampleOnly,
        observedAt,
        fetchedAt,
      } satisfies Extract<GrowthRoutePlan, { operation: "media/select" }>["official"];
      const publicInput = {
        id: publicSourceId,
        threadId,
        assetId: null,
        connectionId: connection.id,
        generation: connection.generation,
        sourceKind: "public_image_mock",
        sourceRef: `public-mock:${candidate.imageRef}`,
        subject: connection.id,
        mediaId: candidate.mediaId,
        permalink: candidate.permalink,
        rights: candidate.rights,
        visibility: candidate.visibility,
        matchStatus: match.status,
        sampleOnly: candidate.sampleOnly === true,
        observedAt,
        fetchedAt: publicFetchedAt,
      } satisfies Extract<
        GrowthRoutePlan,
        { operation: "media/select" }
      >["publicImage"];
      state = await configured.repo.routeCommand(owner, command, mutation, {
        operation: "media/select",
        official: officialInput,
        publicImage: publicInput,
        reason: match.reason,
      });
    }
    if (state.plan?.operation !== "media/select")
      routeError(503, "creator_growth_unavailable", "私人成長功能暫時不可用。");
    const plan = state.plan;
    const officialSource = await configured.repo.saveMediaSource(
      owner,
      plan.official,
      subMutation(mutation, "save-official-source"),
    );
    const publicSource = await configured.repo.saveMediaSource(
      owner,
      plan.publicImage,
      subMutation(mutation, "save-public-source"),
    );
    const response: GrowthMediaSelectionDto = Object.freeze({
      status: "matched",
      reason: plan.reason,
      sourceRef: publicSource.sourceRef,
      fetchedAt: publicSource.fetchedAt,
      sampleOnly: publicSource.sampleOnly,
      rights: publicSource.rights,
      selectedAsset: null,
      mediaSourceIds: Object.freeze([officialSource.id, publicSource.id]),
      officialSource: Object.freeze({
        id: officialSource.id,
        sourceRef: officialSource.sourceRef,
        observedAt: officialSource.observedAt,
        sampleOnly: officialSource.sampleOnly,
      }),
      publicImageSource: Object.freeze({
        id: publicSource.id,
        sourceRef: publicSource.sourceRef,
        observedAt: publicSource.observedAt,
        sampleOnly: publicSource.sampleOnly,
      }),
    });
    return context.json(response);
  });

  routes.post("/analyse", async (context) => {
    const configured = requiredDependencies(dependencies);
    const owner = sessionOwner(context);
    const exported = await activeOwnerExport(configured.repo, owner);
    const mutation = requestMutation(context);
    const body = await readJson(context);
    onlyFields(body, [
      "threadId",
      "assetId",
      "sourceSelection",
      "processorConsentVersion",
    ]);
    const threadId = requiredUuid(body.threadId, "請提供有效的創作對話。");
    const assetId = requiredUuid(body.assetId, "請提供有效的私人圖片。");
    const sourceSelection = uuidList(body.sourceSelection, "請檢查已選來源。");
    const processorConsentVersion =
      typeof body.processorConsentVersion === "string" &&
      CONSENT_VERSION.test(body.processorConsentVersion)
        ? body.processorConsentVersion
        : routeError(400, "invalid_consent", "請確認圖片處理同意版本。");
    const asset = findAsset(exported, assetId);
    if (asset.threadId !== threadId) {
      routeError(403, "asset_unavailable", "圖片不屬於這條創作對話。");
    }
    const selectedSources = canonicalSources(
      exported,
      sourceSelection,
      threadId,
      assetId,
    );
    const connectionIds = new Set(
      selectedSources
        .filter((source) => source.connectionId !== null)
        .map((source) => `${source.connectionId}:${source.generation}`),
    );
    if (connectionIds.size > 1) {
      routeError(403, "source_unavailable", "已選來源來自不同連線。");
    }
    const firstConnectionSource = selectedSources.find(
      (source) => source.connectionId !== null,
    );
    const command = callerCommand("analyse", body, {
      threadId,
      assetId,
      analysisId: null,
      mediaSourceIds: sourceSelection,
      connectionId: firstConnectionSource?.connectionId ?? null,
      generation: firstConnectionSource?.generation ?? null,
    });
    let state = await configured.repo.routeCommand(owner, command, mutation);
    const existing = exported.analyses.find(
      (entry) => entry.id === derivedUuid(mutation.idempotencyKey, "image-analysis"),
    );
    if (existing)
      return context.json(projectAnalysis(findAnalysis(exported, existing.id)));
    if (state.plan === null) {
      const timestamp = state.startedAt;
      let source: Extract<GrowthRoutePlan, { operation: "analyse" }>["source"] = null;

      let primaryMediaSourceId = selectedSources[0]?.id ?? null;
      if (primaryMediaSourceId === null) {
        source = {
          id: derivedUuid(mutation.idempotencyKey, `creator-source:${assetId}`),
          threadId,
          assetId,
          connectionId: null,
          generation: null,
          sourceKind: "creator_upload",
          sourceRef: `asset:${assetId}`,
          subject: null,
          mediaId: null,
          permalink: null,
          rights: "allowed",
          visibility: "private",
          matchStatus: "matched",
          sampleOnly: asset.sampleOnly,
          observedAt: asset.createdAt,
          fetchedAt: timestamp,
        };
        primaryMediaSourceId = source.id;
      }
      const processor =
        configured.vision.kind === "mock"
          ? "kocmax-local-mock-vision"
          : "kocmax-vision";
      const consent = {
        id: derivedUuid(mutation.idempotencyKey, "analysis-consent"),
        processor,
        consentVersion: processorConsentVersion,
        grantedAt: timestamp,
        expiresAt: addHours(new Date(timestamp), 24),
        connectionId: firstConnectionSource?.connectionId ?? null,
        generation: firstConnectionSource?.generation ?? null,
      };
      const result = await analyzeImage(
        {
          assetId,
          sourceRef: `asset:${assetId}`,
          consentVersion: processorConsentVersion,
        },
        {
          loadAsset: async (requestedAssetId) => {
            if (requestedAssetId !== asset.id) {
              throw new ImageAnalysisError(
                "ASSET_BINDING_MISMATCH",
                "The repository returned a different asset.",
              );
            }
            const bytes = await configured.repo.getAssetBytes(owner, asset.id);
            if (asset.sourceKind === "synthetic-fixture") {
              if (asset.fixtureId === null) {
                throw new ImageAnalysisError(
                  "INVALID_ASSET_METADATA",
                  "The synthetic fixture binding is missing.",
                );
              }
              return {
                assetId: asset.id,
                bytes,
                sha256: asset.sha256,
                sourceKind: "synthetic-fixture",
                fixtureId: asset.fixtureId,
              };
            }
            return {
              assetId: asset.id,
              bytes,
              sha256: asset.sha256,
              sourceKind: "creator-upload",
            };
          },
          syntheticFixtures: configured.syntheticFixtures,
          vision: configured.vision,
          processingApproved:
            configured.mode === "mock" && configured.vision.kind === "mock",
        },
      );
      const analysis = {
        id: derivedUuid(mutation.idempotencyKey, "image-analysis"),
        threadId,
        mediaSourceId: primaryMediaSourceId,
        assetId,
        consentId: consent.id,
        connectionId: firstConnectionSource?.connectionId ?? null,
        generation: firstConnectionSource?.generation ?? null,
        processor,
        processorVersion: configured.vision.kind === "mock" ? "mock-v1" : "external-v1",
        result,
        createdAt: timestamp,
      } satisfies Extract<GrowthRoutePlan, { operation: "analyse" }>["analysis"];
      assertSafeEvidenceReport(result);
      if (
        !observationGuard({
          ...result.observation,
          reason: result.observation.reason ?? null,
        })
      ) {
        routeError(403, "source_unavailable", "分析來源格式無效。");
      }
      state = await configured.repo.routeCommand(owner, command, mutation, {
        operation: "analyse",
        source,
        consent,
        analysis,
      });
    }
    if (state.plan?.operation !== "analyse")
      routeError(503, "creator_growth_unavailable", "私人成長功能暫時不可用。");
    const plan = state.plan;
    if (plan.source)
      await configured.repo.saveMediaSource(
        owner,
        plan.source,
        subMutation(mutation, "save-analysis-creator-source"),
      );
    await configured.repo.saveConsent(
      owner,
      plan.consent,
      subMutation(mutation, "save-analysis-consent"),
    );
    const analysis = await configured.repo.saveAnalysis(
      owner,
      plan.analysis,
      subMutation(mutation, "save-analysis"),
    );
    return context.json(projectAnalysis(analysis));
  });

  routes.post("/skills", async (context) => {
    const configured = requiredDependencies(dependencies);
    const owner = sessionOwner(context);
    const exported = await activeOwnerExport(configured.repo, owner);
    const mutation = requestMutation(context);
    const body = await readJson(context);
    const threadId = requiredUuid(body.threadId, "請提供有效的創作對話。");
    const analysisId = requiredUuid(body.analysisId, "請提供有效的圖片分析。");
    const mediaSourceIds = uuidList(body.mediaSourceIds, "請提供有效的來源清單。");
    const skillId = validSkillId(body.skillId);
    onlyFields(body, [
      "threadId",
      "analysisId",
      "mediaSourceIds",
      "skillId",
      "question",
      "creatorGoal",
    ]);
    const question = optionalText(body.question, "請檢查分析問題。", 1000);
    const analysis = findAnalysis(exported, analysisId);
    if (analysis.threadId !== threadId) {
      routeError(403, "source_unavailable", "分析不屬於這條創作對話。");
    }
    const sources = canonicalSources(
      exported,
      mediaSourceIds,
      threadId,
      analysis.assetId,
    );
    const creatorGoal = optionalText(
      body.creatorGoal,
      "請檢查創作目標。",
      MAX_GOAL_LENGTH,
    );
    const command = callerCommand("skills", body, {
      threadId,
      assetId: analysis.assetId,
      analysisId,
      mediaSourceIds,
      connectionId: analysis.connectionId ?? null,
      generation: analysis.generation ?? null,
    });
    let state = await configured.repo.routeCommand(owner, command, mutation);
    const existing = exported.skillInvocations.find(
      (entry) => entry.id === derivedUuid(mutation.idempotencyKey, "skill-invocation"),
    );
    if (existing) {
      const saved = findSkill(exported, existing.id);
      return context.json(projectSkill(saved, saved.result));
    }
    if (state.plan === null) {
      const report = await canonicalReport(
        configured,
        owner,
        analysis,
        sources,
        question,
        state.startedAt,
      );
      let result: GrowthSkillResult;
      try {
        result = await runGrowthSkill({
          skillId,
          report,
          creatorGoal,
        });
      } catch (error) {
        if (error instanceof CreatorGrowthRouteError) throw error;
        routeError(400, "invalid_report", "請檢查證據報告。");
      }
      if (!skillResultGuard(result))
        routeError(403, "source_unavailable", "技能結果格式無效。");
      const invocation = {
        id: derivedUuid(mutation.idempotencyKey, "skill-invocation"),
        threadId,
        analysisId,
        mediaSourceIds,
        skillId,
        report,
        result,
        createdAt: state.startedAt,
      };
      state = await configured.repo.routeCommand(owner, command, mutation, {
        operation: "skills",
        invocation,
      });
    }
    if (state.plan?.operation !== "skills")
      routeError(503, "creator_growth_unavailable", "私人成長功能暫時不可用。");
    validateReport(state.plan.invocation.report);
    const saved = await configured.repo.saveSkillInvocation(
      owner,
      state.plan.invocation,
      subMutation(mutation, "save-skill"),
    );
    return context.json(projectSkill(saved, saved.result));
  });

  routes.post("/drafts", async (context) => {
    const configured = requiredDependencies(dependencies);
    const owner = sessionOwner(context);
    const exported = await activeOwnerExport(configured.repo, owner);
    const mutation = requestMutation(context);
    const body = await readJson(context);
    const threadId = requiredUuid(body.threadId, "請提供有效的創作對話。");
    const assetId = requiredUuid(body.assetId, "請提供有效的私人圖片。");
    const analysisId = requiredUuid(body.analysisId, "請提供有效的圖片分析。");
    const skillInvocationId = requiredUuid(
      body.skillInvocationId,
      "請提供有效的技能結果。",
    );
    if (
      !Number.isSafeInteger(body.expectedRevision) ||
      (body.expectedRevision as number) < 0
    ) {
      routeError(400, "invalid_revision", "請重新載入私人草稿。");
    }
    const caption = optionalText(body.caption, "請檢查草稿文案。", MAX_CAPTION_LENGTH);
    const manualDescription = optionalText(
      body.manualDescription,
      "請檢查手動描述。",
      MAX_CAPTION_LENGTH,
    );
    const analysis = findAnalysis(exported, analysisId);
    const skill = findSkill(exported, skillInvocationId);
    if (
      analysis.threadId !== threadId ||
      skill.threadId !== threadId ||
      analysis.assetId !== assetId ||
      skill.analysisId !== analysisId
    ) {
      routeError(403, "source_unavailable", "草稿來源鏈不完整。");
    }
    canonicalSources(exported, skill.mediaSourceIds, threadId, assetId);
    if (body.skillId !== undefined && body.skillId !== skill.skillId) {
      routeError(400, "invalid_skill", "技能結果與草稿來源不符。");
    }
    if (
      body.evidenceReportId !== undefined &&
      body.evidenceReportId !== null &&
      body.evidenceReportId !== skill.id
    ) {
      routeError(400, "invalid_report", "證據報告與技能結果不符。");
    }
    const draftId =
      body.draftId === undefined
        ? derivedUuid(mutation.idempotencyKey, "private-draft")
        : requiredUuid(body.draftId, "請提供有效的私人草稿。");
    const draft = await configured.repo.saveDraft(
      owner,
      {
        id: draftId,
        threadId,
        assetId,
        analysisId,
        skillInvocationId,
        expectedRevision: body.expectedRevision as number,
        caption,
        manualDescription,
        status: "private",
      },
      mutation,
    );
    return context.json(projectDraft(draft, skill));
  });

  routes.get("/drafts/:id", async (context) => {
    const configured = requiredDependencies(dependencies);
    const owner = sessionOwner(context);
    const draftId = context.req.param("id");
    if (!UUID.test(draftId)) {
      routeError(404, "not_found", "找不到可用的私人草稿。");
    }
    let draft: GrowthDraftRecord | null;
    try {
      draft = await configured.repo.getPrivateDraft(owner, draftId);
    } catch (error) {
      if (
        error instanceof GrowthRepositoryError &&
        error.code === "SOURCE_INVALIDATED"
      ) {
        routeError(404, "not_found", "找不到可用的私人草稿。");
      }
      throw error;
    }
    if (
      draft === null ||
      draft.invalidatedAt !== null ||
      draft.status === "invalidated"
    ) {
      routeError(404, "not_found", "找不到可用的私人草稿。");
    }
    const exported = await activeOwnerExport(configured.repo, owner);
    if (draft.skillInvocationId === null) {
      routeError(404, "not_found", "找不到可用的私人草稿。");
    }
    const skill = findSkill(exported, draft.skillInvocationId);
    return context.json(projectDraft(draft, skill));
  });

  return routes;
}
