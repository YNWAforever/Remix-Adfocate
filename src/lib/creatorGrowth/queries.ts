import type {
  GrowthEvidenceReport,
  PublicImageEvidenceMatch,
} from "../../../server/lib/creatorGrowth/report";
import type { GrowthSkillId } from "./skillManifest";

export const CREATOR_GROWTH_ROUTES = Object.freeze({
  assets: "/creator-growth/assets",
  analyse: "/creator-growth/analyse",
  skills: "/creator-growth/skills",
  drafts: "/creator-growth/drafts",
  mediaSelect: "/creator-growth/media/select",
} as const);

export type CreatorGrowthTransport = Readonly<{
  request: <Result>(
    path: string,
    init: RequestInit,
  ) => Promise<Result>;
}>;

export type GrowthAssetDto = Readonly<{
  id: string;
  threadId: string;
  mime: "image/jpeg" | "image/png" | "image/webp";
  byteSize: number;
  width: number;
  height: number;
  sha256: string;
  rightsConfirmed: true;
  sampleOnly: false;
  createdAt: string;
}>;

export type GrowthAnalysisDto = Readonly<{
  id: string;
  threadId: string;
  assetId: string;
  mediaSourceId: string | null;
  sha256: string;
  availability: "observed" | "manual";
  reason: string | null;
  sourceKind: "creator-upload" | "synthetic-fixture";
  sampleOnly: boolean;
  objects: readonly string[];
  visibleText: readonly string[];
  composition: readonly string[];
  captionAlignment: string;
  uncertainties: readonly string[];
  createdAt: string;
}>;

export type GrowthSkillDto = Readonly<{
  id: string;
  skillId: GrowthSkillId;
  threadId: string;
  analysisId: string;
  mediaSourceIds: readonly string[];
  report: GrowthEvidenceReport;
  proposal: string;
  sourceRefs: readonly string[];
  limitations: readonly string[];
  sampleOnly: boolean;
  createdAt: string;
}>;

export type GrowthDraftDto = Readonly<{
  id: string;
  threadId: string;
  assetId: string;
  analysisId: string;
  skillId: GrowthSkillId;
  revision: number;
  caption: string;
  manualDescription: string;
  evidenceReportId: string | null;
  updatedAt: string;
}>;

export type GrowthAssetRequest = Readonly<{
  threadId: string;
  rightsConfirmed: true;
  file: Blob;
  idempotencyKey?: string;
}>;

export type GrowthAnalysisRequest = Readonly<{
  threadId: string;
  assetId: string;
  sourceSelection: readonly string[];
  processorConsentVersion: string;
  idempotencyKey?: string;
}>;

export type GrowthSkillRequest = Readonly<{
  threadId: string;
  analysisId: string;
  mediaSourceIds: readonly string[];
  skillId: GrowthSkillId;
  question: string;
  creatorGoal?: string;
  idempotencyKey?: string;
}>;

export type GrowthDraftRequest = Readonly<{
  threadId: string;
  draftId?: string;
  assetId: string;
  analysisId: string;
  skillInvocationId: string;
  skillId: GrowthSkillId;
  expectedRevision: number;
  caption: string;
  manualDescription: string;
  evidenceReportId: string | null;
  idempotencyKey?: string;
}>;

export type GrowthMediaSelectionRequest = Readonly<{
  threadId: string;
  officialMediaRef: Readonly<{
    connectionId: string;
    resourceId: string;
  }>;
  candidateRef: string;
  idempotencyKey?: string;
}>;

export type GrowthMediaSelectionDto = Readonly<
  PublicImageEvidenceMatch & {
    mediaSourceIds: readonly string[];
    officialSource: Readonly<{
      id: string;
      sourceRef: string;
      observedAt: string;
      sampleOnly: boolean;
    }>;
    publicImageSource: Readonly<{
      id: string;
      sourceRef: string;
      observedAt: string;
      sampleOnly: boolean;
    }>;
  }
>;

export type CreatorGrowthClient = Readonly<{
  uploadAsset(input: GrowthAssetRequest): Promise<GrowthAssetDto>;
  analyse(input: GrowthAnalysisRequest): Promise<GrowthAnalysisDto>;
  requestSkill(input: GrowthSkillRequest): Promise<GrowthSkillDto>;
  saveDraft(input: GrowthDraftRequest): Promise<GrowthDraftDto>;
  getDraft(draftId: string): Promise<GrowthDraftDto>;
  selectMedia(
    input: GrowthMediaSelectionRequest,
  ): Promise<GrowthMediaSelectionDto>;
}>;

function idempotencyHeaders(idempotencyKey?: string): HeadersInit {
  return idempotencyKey === undefined
    ? { "Content-Type": "application/json" }
    : {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      };
}

function withoutIdempotencyKey(
  body: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const { idempotencyKey, ...payload } = body;
  void idempotencyKey;
  return payload;
}

function jsonRequest(
  body: Readonly<Record<string, unknown>>,
  idempotencyKey?: string,
): RequestInit {
  return {
    method: "POST",
    headers: idempotencyHeaders(idempotencyKey),
    body: JSON.stringify(withoutIdempotencyKey(body)),
  };
}

export function createCreatorGrowthClient(
  transport: CreatorGrowthTransport,
): CreatorGrowthClient {
  return Object.freeze({
    async uploadAsset(input) {
      const body = new FormData();
      body.set("threadId", input.threadId);
      body.set("rightsConfirmed", "true");
      body.set("file", input.file);
      return transport.request<GrowthAssetDto>(CREATOR_GROWTH_ROUTES.assets, {
        method: "POST",
        headers: input.idempotencyKey === undefined
          ? undefined
          : { "Idempotency-Key": input.idempotencyKey },
        body,
      });
    },
    analyse(input) {
      return transport.request<GrowthAnalysisDto>(
        CREATOR_GROWTH_ROUTES.analyse,
        jsonRequest(
          input as unknown as Readonly<Record<string, unknown>>,
          input.idempotencyKey,
        ),
      );
    },
    requestSkill(input) {
      return transport.request<GrowthSkillDto>(
        CREATOR_GROWTH_ROUTES.skills,
        jsonRequest(
          input as unknown as Readonly<Record<string, unknown>>,
          input.idempotencyKey,
        ),
      );
    },
    saveDraft(input) {
      return transport.request<GrowthDraftDto>(
        CREATOR_GROWTH_ROUTES.drafts,
        jsonRequest(
          input as unknown as Readonly<Record<string, unknown>>,
          input.idempotencyKey,
        ),
      );
    },
    getDraft(draftId) {
      return transport.request<GrowthDraftDto>(
        `${CREATOR_GROWTH_ROUTES.drafts}/${encodeURIComponent(draftId)}`,
        { method: "GET" },
      );
    },
    selectMedia(input) {
      return transport.request<GrowthMediaSelectionDto>(
        CREATOR_GROWTH_ROUTES.mediaSelect,
        jsonRequest(
          input as unknown as Readonly<Record<string, unknown>>,
          input.idempotencyKey,
        ),
      );
    },
  });
}
