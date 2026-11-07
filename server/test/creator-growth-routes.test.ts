// @vitest-environment node
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../app.js";
import {
  type DecodeAndStripMetadata,
} from "../lib/creatorGrowth/assetPolicy.js";
import type { VisionAdapter } from "../lib/creatorGrowth/imageAnalysis.js";
import { MemoryGrowthRepository } from "../lib/creatorGrowth/memoryRepository.js";
import {
  createPublicImageProvider,
  type PublicImageProvider,
} from "../lib/creatorGrowth/publicImageProvider.js";
import type {
  GrowthEvidenceReport,
  PublicImageEvidenceMatch,
} from "../lib/creatorGrowth/report.js";
import type {
  GrowthMutationContext,
  GrowthOwner,
} from "../lib/creatorGrowth/repository.js";
import type { GrowthAnalysisDto } from "../../src/lib/creatorGrowth/queries.js";
import {
  createCreatorGrowthRoutes,
  type CreatorGrowthIntegrationReader,
  type CreatorGrowthRouteDependencies,
} from "../routes/creatorGrowth.js";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Offline route tests forbid network"); }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const workspace = "00000000-0000-4000-8000-000000000001";
const otherWorkspace = "00000000-0000-4000-8000-000000000002";
const creator = "00000000-0000-4000-8000-000000000011";
const colleague = "00000000-0000-4000-8000-000000000012";
const otherCreator = "00000000-0000-4000-8000-000000000013";
const brandActor = "00000000-0000-4000-8000-000000000021";
const staffActor = "00000000-0000-4000-8000-000000000031";
const thread = "00000000-0000-4000-8000-000000000041";
const colleagueThread = "00000000-0000-4000-8000-000000000042";
const secondThread = "00000000-0000-4000-8000-000000000043";
const connection = "00000000-0000-4000-8000-000000000051";
const integrationResource = "00000000-0000-4000-8000-000000000061";
const syntheticAsset = "00000000-0000-4000-8000-000000000071";
const now = "2026-11-04T00:00:00.000Z";
const owner: GrowthOwner = { workspaceId: workspace, creatorId: creator };

function bytesFromHex(value: string): Uint8Array {
  return Uint8Array.from(
    value.replace(/\s+/g, "").match(/../g) ?? [],
    (pair) => Number.parseInt(pair, 16),
  );
}

function arrayBufferFromBytes(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

const PNG_IMAGE = bytesFromHex(
  "89504e470d0a1a0a 0000000d4948445200000001000000010804000000b51c0c02 " +
    "0000000b4944415478da6364f80f00010501012718e366 " +
    "0000000049454e44ae426082",
);

function mutation(): GrowthMutationContext {
  return { idempotencyKey: crypto.randomUUID() };
}

function fixture(clock = () => new Date(now)) {
  let sequence = 100;
  const repo = new MemoryGrowthRepository({
    owners: [
      { owner, status: "active" },
      {
        owner: { workspaceId: workspace, creatorId: colleague },
        status: "active",
      },
      {
        owner: { workspaceId: otherWorkspace, creatorId: otherCreator },
        status: "active",
      },
    ],
    connections: [{
      owner,
      id: connection,
      generation: 1,
      status: "connected",
    }],
    threads: [
      { owner, id: thread },
      { owner, id: secondThread },
      {
        owner: { workspaceId: workspace, creatorId: colleague },
        id: colleagueThread,
      },
    ],
    now: clock,
    idFactory: () =>
      `00000000-0000-4000-8000-${String(sequence++).padStart(12, "0")}`,
  });
  const integrationConnection = {
    id: connection,
    provider: "instagram" as const,
    label: "mock-instagram",
    status: "connected" as const,
    scopes: ["instagram_business_basic", "instagram_business_manage_insights"],
    generation: 1,
    lastSyncAt: now,
    expiresAt: "2026-12-04T00:00:00.000Z",
    lastError: null,
    sampleOnly: true,
    providerRevocation: "not_requested" as const,
  };
  const resource = {
    id: integrationResource,
    connectionId: connection,
    externalId: "123456",
    title: "Mock post",
    mimeType: "image/jpeg",
    version: "v1",
    selected: true,
    canDownload: true,
    rights: "owned" as const,
    availability: "available" as const,
    excerpt: null,
    metrics: {},
    observedAt: now,
    fetchedAt: now,
    coverage: { region: null, language: null, partial: true },
    sampleOnly: true,
    evidence: {
      apiVersion: "mock-v1",
      endpoint: "mock-media",
      measurementPeriod: "lifetime",
      permalink: "https://www.instagram.com/p/mock-post",
    },
  };
  const integrations: CreatorGrowthIntegrationReader = {
    list: vi.fn(async () => [integrationConnection]),
    resources: vi.fn(async () => [resource]),
  };
  const vision: VisionAdapter = {
    kind: "mock",
    analyze: vi.fn(async () => ({
      availability: "observed" as const,
      objects: ["cup"],
      visibleText: [],
      composition: ["centered subject"],
      captionAlignment: "aligned" as const,
      uncertainties: ["mock fixture"],
      sampleOnly: true,
    })),
  };
  const publicImages = createPublicImageProvider({
    mode: "mock",
    now: clock,
    samples: [{
      provider: "rapidapi",
      subject: connection,
      permalink: "https://www.instagram.com/p/mock-post",
      mediaId: "123456",
      imageRef: "mock-image-ref:one",
      fetchedAt: now,
      rights: "allowed",
      visibility: "public",
      provenance: "mock",
      sampleOnly: true,
    }],
  });
  const decodeAndStripMetadata: DecodeAndStripMetadata = vi.fn(async () => ({
    bytes: PNG_IMAGE,
    mime: "image/png" as const,
    width: 1,
    height: 1,
  }));
  return {
    repo,
    integrations,
    vision,
    publicImages,
    decodeAndStripMetadata,
    resource,
    integrationConnection,
    now: clock,
  };
}

function controlledApp(
  deps: CreatorGrowthRouteDependencies | undefined,
  identity: { userId?: string; workspaceId?: string } = {
    userId: creator,
    workspaceId: workspace,
  },
) {
  const app = new Hono<Env>();
  app.use("*", async (context, next) => {
    if (identity.userId) context.set("userId", identity.userId);
    if (identity.workspaceId) context.set("workspaceId", identity.workspaceId);
    context.set("jwt", "offline-test-token");
    await next();
  });
  app.route("/api/creator-growth", createCreatorGrowthRoutes(deps));
  return app;
}

function enabledDependencies(parts: ReturnType<typeof fixture>) {
  return {
    ...parts,
    enabled: true,
    mode: "mock" as const,
    now: parts.now,
  };
}

function imageForm(
  bytes: Uint8Array = PNG_IMAGE,
  mime = "image/png",
  threadId = thread,
  extras: Readonly<Record<string, string>> = {},
) {
  const form = new FormData();
  form.set("threadId", threadId);
  form.set("rightsConfirmed", "true");
  form.set(
    "file",
    new File([arrayBufferFromBytes(bytes)], "image.png", { type: mime }),
  );
  for (const [key, value] of Object.entries(extras)) form.set(key, value);
  return form;
}

function requestId() {
  return crypto.randomUUID();
}

async function uploadAsset(app: ReturnType<typeof controlledApp>) {
  const idempotencyKey = requestId();
  const response = await app.request("/api/creator-growth/assets", {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: imageForm(),
  });
  expect(response.status).toBe(200);
  return {
    asset: await response.json() as { id: string; sha256: string },
    idempotencyKey,
  };
}

async function selectMedia(app: ReturnType<typeof controlledApp>) {
  const response = await app.request("/api/creator-growth/media/select", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": requestId(),
    },
    body: JSON.stringify({
      threadId: thread,
      officialMediaRef: {
        connectionId: connection,
        resourceId: integrationResource,
      },
      candidateRef: "mock-image-ref:one",
    }),
  });
  expect(response.status).toBe(200);
  return await response.json() as PublicImageEvidenceMatch & {
    officialSource: {
      id: string;
      sourceRef: string;
      observedAt: string;
      sampleOnly: boolean;
    };
    publicImageSource: {
      id: string;
      sourceRef: string;
      observedAt: string;
      sampleOnly: boolean;
    };
  };
}

async function analyse(
  app: ReturnType<typeof controlledApp>,
  assetId: string,
  sourceSelection: readonly string[] = [],
) {
  const response = await app.request("/api/creator-growth/analyse", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": requestId(),
    },
    body: JSON.stringify({
      threadId: thread,
      assetId,
      sourceSelection,
      processorConsentVersion: "consent-v1",
    }),
  });
  expect(response.status).toBe(200);
  return await response.json() as GrowthAnalysisDto;
}

function evidenceReport(
  analysis: Awaited<ReturnType<typeof analyse>>,
  media: Awaited<ReturnType<typeof selectMedia>>,
  assetId: string,
): GrowthEvidenceReport {
  const canonicalObservation: GrowthEvidenceReport["observation"] = {
    availability: analysis.availability,
    reason: analysis.reason,
    sourceKind: analysis.sourceKind,
    sampleOnly: analysis.sampleOnly,
    objects: analysis.objects,
    visibleText: analysis.visibleText,
    composition: analysis.composition,
    captionAlignment: analysis.captionAlignment,
    uncertainties: analysis.uncertainties,
    assetId: analysis.assetId,
    sha256: analysis.sha256,
  };
  const sampleOnly =
    analysis.sampleOnly ||
    media.officialSource.sampleOnly ||
    media.publicImageSource.sampleOnly;
  return {
    question: "How can I improve this post?",
    platform: "instagram",
    runAt: now,
    metrics: [],
    availability: {
      officialMetrics: "unavailable",
      publicImageMock: "mock",
      selfUploadManual: "manual",
      reasons: [],
    },
    provenance: {
      officialMetrics: [{
        sourceKind: "official_metrics",
        sourceRef: media.officialSource.sourceRef,
        observedAt: media.officialSource.observedAt,
        sampleOnly: media.officialSource.sampleOnly,
        periodKind: "lifetime",
      }],
      publicImageMock: {
        sourceKind: "public_image_mock",
        sourceRef: media.publicImageSource.sourceRef,
        observedAt: media.publicImageSource.observedAt,
        sampleOnly: media.publicImageSource.sampleOnly,
        assetId,
        sha256: analysis.sha256,
      },
      selfUploadManual: {
        sourceKind: analysis.sourceKind,
        manualMode: "manual_observation",
        sourceRef: `asset:${assetId}`,
        observedAt: now,
        sampleOnly: analysis.sampleOnly,
        assetId,
        sha256: analysis.sha256,
      },
    },
    region: {
      requested: "Hong Kong",
      verified: false,
      value: null,
      label: "未驗證",
      reason: "official_region_coverage_missing",
    },
    language: {
      requested: "zh-Hant",
      verified: false,
      value: null,
      label: "未驗證",
      reason: "official_language_coverage_missing",
    },
    period: {
      selection: { windowDays: 30, mediaLimit: 50, appliesTo: "selection_only" },
      metrics: [],
    },
    observation: canonicalObservation,
    sourcePermission: { publicImage: "allowed", basis: "explicit" },
    partial: true,
    partialReasons: [],
    sampleOnly,
    citations: [
      {
        sourceKind: "official_metrics",
        title: "Instagram official metrics",
        sourceRef: media.officialSource.sourceRef,
        observedAt: media.officialSource.observedAt,
        sampleOnly: media.officialSource.sampleOnly,
      },
      {
        sourceKind: "public_image_mock",
        title: "Public image",
        sourceRef: media.publicImageSource.sourceRef,
        observedAt: media.publicImageSource.observedAt,
        sampleOnly: media.publicImageSource.sampleOnly,
      },
      {
        sourceKind: "self_upload_manual",
        title: "Creator image",
        sourceRef: `asset:${assetId}`,
        observedAt: now,
        sampleOnly: analysis.sampleOnly,
      },
    ],
  };
}

async function requestSkill(
  app: ReturnType<typeof controlledApp>,
  analysis: Awaited<ReturnType<typeof analyse>>,
  media: Awaited<ReturnType<typeof selectMedia>>,
) {
  const response = await app.request("/api/creator-growth/skills", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": requestId(),
    },
    body: JSON.stringify({
      threadId: thread,
      analysisId: analysis.id,
      mediaSourceIds: [
        media.officialSource.id,
        media.publicImageSource.id,
      ],
      skillId: "next_caption",
      question: "How can I improve this post?",
    }),
  });
  expect(response.status).toBe(200);
  return await response.json() as {
    id: string;
    skillId: string;
    proposal: string;
  };
}

describe("creator growth routes", () => {
  it("mounts disabled in the default application and rejects missing session/workspace", async () => {
    const { createApp } = await import("../app.js");
    expect(
      (await createApp().app.request("/api/creator-growth/assets", {
        method: "POST",
      })).status,
    ).toBe(401);
    expect(
      (await controlledApp(undefined, {}).request(
        "/api/creator-growth/assets",
        { method: "POST" },
      )).status,
    ).toBe(401);
    expect(
      (await controlledApp(undefined, { userId: creator }).request(
        "/api/creator-growth/assets",
        { method: "POST" },
      )).status,
    ).toBe(401);
  });

  it("stays disabled by default even with authenticated route variables", async () => {
    const response = await controlledApp(undefined).request(
      "/api/creator-growth/assets",
      { method: "POST", body: imageForm() },
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({
      code: "creator_growth_disabled",
    });
  });

  it("runs a complete owner-scoped upload, select, analyse, skill, draft and get flow", async () => {
    const parts = fixture();
    const deps = enabledDependencies(parts);
    const app = controlledApp(deps);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const uploaded = await uploadAsset(app);
    const media = await selectMedia(app);
    const analysis = await analyse(app, uploaded.asset.id, [
      media.officialSource.id,
      media.publicImageSource.id,
    ]);
    const skill = await requestSkill(app, analysis, media);
    const draftResponse = await app.request("/api/creator-growth/drafts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": requestId(),
      },
      body: JSON.stringify({
        threadId: thread,
        assetId: uploaded.asset.id,
        analysisId: analysis.id,
        skillInvocationId: skill.id,
        expectedRevision: 0,
        caption: "Editable next post",
        manualDescription: "Private details",
      }),
    });
    expect(draftResponse.status).toBe(200);
    const draft = await draftResponse.json() as {
      id: string;
      revision: number;
      skillId: string;
    };
    expect(draft).toMatchObject({
      revision: 1,
      skillId: "next_caption",
    });
    const fetched = await app.request(
      `/api/creator-growth/drafts/${draft.id}`,
    );
    expect(fetched.status).toBe(200);
    expect(await fetched.json()).toEqual(draft);
    expect(parts.vision.analyze).not.toHaveBeenCalled();
    expect(parts.integrations.list).toHaveBeenCalledWith(owner);
    expect(parts.integrations.resources).toHaveBeenCalledWith(
      owner,
      connection,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("returns an observed mock sample only for a trusted synthetic fixture", async () => {
    const parts = fixture();
    await parts.repo.putAsset(
      owner,
      {
        id: syntheticAsset,
        threadId: thread,
        bytes: PNG_IMAGE,
        sha256: "a".repeat(64),
        mime: "image/png",
        byteSize: PNG_IMAGE.byteLength,
        width: 1,
        height: 1,
        rightsConfirmed: true,
        sourceKind: "synthetic-fixture",
        sampleOnly: true,
        fixtureId: "fixture-one",
      },
      mutation(),
    );
    const digest = await import("../lib/creatorGrowth/assetPolicy.js")
      .then(({ sha256Hex }) => sha256Hex(PNG_IMAGE));
    await parts.repo.putAsset(
      owner,
      {
        id: syntheticAsset,
        threadId: thread,
        bytes: PNG_IMAGE,
        sha256: digest,
        mime: "image/png",
        byteSize: PNG_IMAGE.byteLength,
        width: 1,
        height: 1,
        rightsConfirmed: true,
        sourceKind: "synthetic-fixture",
        sampleOnly: true,
        fixtureId: "fixture-one",
      },
      mutation(),
    );
    const analysis = await analyse(
      controlledApp({
        ...enabledDependencies(parts),
        syntheticFixtures: { "fixture-one": digest },
      }),
      syntheticAsset,
    );
    expect(analysis).toMatchObject({
      availability: "observed",
      sampleOnly: true,
    });
    expect(parts.vision.analyze).toHaveBeenCalledOnce();
  });

  it.each([
    ["creator", brandActor],
    ["staff", staffActor],
  ])("denies a %s identity that is not an active creator", async (_label, userId) => {
    const parts = fixture();
    const response = await controlledApp(
      enabledDependencies(parts),
      { userId, workspaceId: workspace },
    ).request("/api/creator-growth/assets", {
      method: "POST",
      body: imageForm(),
    });
    expect(response.status).toBe(403);
  });

  it("rejects a public candidate that is not an exact injected match", async () => {
    const parts = fixture();
    const saveSource = vi.spyOn(parts.repo, "saveMediaSource");
    const response = await controlledApp(enabledDependencies(parts)).request(
      "/api/creator-growth/media/select",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": requestId(),
        },
        body: JSON.stringify({
          threadId: thread,
          officialMediaRef: {
            connectionId: connection,
            resourceId: integrationResource,
          },
          candidateRef: "mock-image-ref:forged",
        }),
      },
    );
    expect(response.status).toBe(403);
    expect(saveSource).not.toHaveBeenCalled();
  });

  it("rejects arbitrary URL fields in media selection requests", async () => {
    const parts = fixture();
    const saveSource = vi.spyOn(parts.repo, "saveMediaSource");
    const response = await controlledApp(enabledDependencies(parts)).request(
      "/api/creator-growth/media/select",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": requestId(),
        },
        body: JSON.stringify({
          threadId: thread,
          officialMediaRef: {
            connectionId: connection,
            resourceId: integrationResource,
          },
          candidateRef: "mock-image-ref:one",
          candidateUrl: "https://example.com/private-image",
        }),
      },
    );
    expect(response.status).toBe(400);
    expect(saveSource).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "same-workspace creator",
      userId: colleague,
      workspaceId: workspace,
    },
    {
      label: "cross-workspace creator",
      userId: otherCreator,
      workspaceId: otherWorkspace,
    },
  ])(
    "denies an upload against another $label thread with 404",
    async ({ userId, workspaceId }) => {
      const parts = fixture();
      const response = await controlledApp(
        enabledDependencies(parts),
        { userId, workspaceId },
      ).request("/api/creator-growth/assets", {
        method: "POST",
        body: imageForm(),
      });
      expect(response.status).toBe(404);
      expect((await parts.repo.exportOwner(owner)).assets).toHaveLength(0);
    },
  );

  it("rejects client owner fields before repository access", async () => {
    const parts = fixture();
    const putAsset = vi.spyOn(parts.repo, "putAsset");
    const app = controlledApp(enabledDependencies(parts));
    const response = await app.request("/api/creator-growth/analyse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        threadId: thread,
        assetId: syntheticAsset,
        sourceSelection: [],
        processorConsentVersion: "consent-v1",
        owner: { workspaceId: otherWorkspace, creatorId: otherCreator },
      }),
    });
    expect(response.status).toBe(400);
    expect(putAsset).not.toHaveBeenCalled();
  });

  it("rejects nested owner claims in skill reports", async () => {
    const parts = fixture();
    const app = controlledApp(enabledDependencies(parts));
    const uploaded = await uploadAsset(app);
    const media = await selectMedia(app);
    const analysis = await analyse(app, uploaded.asset.id, [
      media.officialSource.id,
    ]);
    const report = evidenceReport(
      analysis,
      media,
      uploaded.asset.id,
    );
    const reportWithOwner = {
      ...report,
      observation: {
        ...report.observation,
        owner: { creatorId: otherCreator },
      },
    };
    const saveSkill = vi.spyOn(parts.repo, "saveSkillInvocation");
    const response = await app.request("/api/creator-growth/skills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        threadId: thread,
        analysisId: analysis.id,
        mediaSourceIds: [media.officialSource.id],
        skillId: "next_caption",
        report: reportWithOwner,
      }),
    });
    expect(response.status).toBe(400);
    expect(saveSkill).not.toHaveBeenCalled();
  });

  it("keeps drafts isolated from another creator and another workspace", async () => {
    const parts = fixture();
    const deps = enabledDependencies(parts);
    const app = controlledApp(deps);
    const uploaded = await uploadAsset(app);
    const media = await selectMedia(app);
    const analysis = await analyse(app, uploaded.asset.id, [
      media.officialSource.id,
    ]);
    const skill = await requestSkill(app, analysis, media);
    const created = await app.request("/api/creator-growth/drafts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": requestId(),
      },
      body: JSON.stringify({
        threadId: thread,
        assetId: uploaded.asset.id,
        analysisId: analysis.id,
        skillInvocationId: skill.id,
        expectedRevision: 0,
        caption: "Private",
        manualDescription: "",
      }),
    });
    const draft = await created.json() as { id: string };
    expect(
      (await controlledApp(deps, {
        userId: colleague,
        workspaceId: workspace,
      }).request(`/api/creator-growth/drafts/${draft.id}`)).status,
    ).toBe(404);
    expect(
      (await controlledApp(deps, {
        userId: otherCreator,
        workspaceId: otherWorkspace,
      }).request(`/api/creator-growth/drafts/${draft.id}`)).status,
    ).toBe(404);
  });

  it("rejects stale draft revisions with 409", async () => {
    const parts = fixture();
    const deps = enabledDependencies(parts);
    const app = controlledApp(deps);
    const uploaded = await uploadAsset(app);
    const media = await selectMedia(app);
    const analysis = await analyse(app, uploaded.asset.id, [
      media.officialSource.id,
    ]);
    const skill = await requestSkill(app, analysis, media);
    const body = {
      threadId: thread,
      assetId: uploaded.asset.id,
      analysisId: analysis.id,
      skillInvocationId: skill.id,
      expectedRevision: 0,
      caption: "First",
      manualDescription: "",
    };
    const first = await app.request("/api/creator-growth/drafts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": requestId(),
      },
      body: JSON.stringify(body),
    });
    const draft = await first.json() as { id: string };
    const stale = await app.request("/api/creator-growth/drafts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": requestId(),
      },
      body: JSON.stringify({
        ...body,
        draftId: draft.id,
        expectedRevision: 0,
        caption: "Stale",
      }),
    });
    expect(stale.status).toBe(409);
  });

  it("denies analysis and skills after the selected source generation is revoked", async () => {
    const parts = fixture();
    const deps = enabledDependencies(parts);
    const app = controlledApp(deps);
    const uploaded = await uploadAsset(app);
    const media = await selectMedia(app);
    const analysis = await analyse(app, uploaded.asset.id, [
      media.officialSource.id,
      media.publicImageSource.id,
    ]);
    await parts.repo.handleCanonicalIntegrationRevocation(owner, {
      connectionId: connection,
      generation: 1,
      revokedAt: now,
    });
    const skill = await app.request("/api/creator-growth/skills", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": requestId(),
      },
      body: JSON.stringify({
        threadId: thread,
        analysisId: analysis.id,
        mediaSourceIds: [
          media.officialSource.id,
          media.publicImageSource.id,
        ],
        skillId: "next_caption",
        question: "How can I improve this post?",
      }),
    });
    expect(skill.status).toBe(403);
    const failedAnalysis = await app.request("/api/creator-growth/analyse", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": requestId(),
      },
      body: JSON.stringify({
        threadId: thread,
        assetId: uploaded.asset.id,
        sourceSelection: [media.officialSource.id],
        processorConsentVersion: "consent-v1",
      }),
    });
    expect(failedAnalysis.status).toBe(403);
  });

  it("rejects fake official provenance from an independently successful canonical baseline (M1)", async () => {
    const parts = fixture();
    const app = controlledApp(enabledDependencies(parts));
    const uploaded = await uploadAsset(app);
    const media = await selectMedia(app);
    const analysis = await analyse(app, uploaded.asset.id, [media.officialSource.id, media.publicImageSource.id]);
    const skill = await requestSkill(app, analysis, media);
    const baseline = (await parts.repo.exportOwner(owner)).skillInvocations.find((entry) => entry.id === skill.id)!;
    expect(baseline.mediaSourceIds).toEqual([media.officialSource.id, media.publicImageSource.id]);
    // The unchanged report with BOTH sources succeeds before changing only official provenance.
    await expect(parts.repo.saveSkillInvocation(owner, { ...baseline, id: requestId() }, mutation())).resolves.toMatchObject({ report: baseline.report });
    const forged = structuredClone(baseline.report);
    const report = {
      ...forged,
      provenance: { ...forged.provenance, officialMetrics: forged.provenance.officialMetrics.map((source) => ({ ...source, sourceRef: "official:forged-source" })) },
    };
    await expect(parts.repo.saveSkillInvocation(owner, { ...baseline, id: requestId(), report }, mutation())).rejects.toMatchObject({ code: "SOURCE_INVALIDATED" });
    expect((await parts.repo.exportOwner(owner)).skillInvocations).toHaveLength(2);
  });

  it("does not call an external vision adapter without explicit approval", async () => {
    const parts = fixture();
    const externalAnalyze = vi.fn();
    const app = controlledApp({
      ...enabledDependencies(parts),
      mode: "external",
      vision: {
        kind: "external",
        analyze: externalAnalyze,
      },
    });
    const uploaded = await uploadAsset(app);
    const analysis = await analyse(app, uploaded.asset.id);
    expect(analysis).toMatchObject({
      availability: "manual",
      reason: "processing_not_approved",
      sampleOnly: false,
    });
    expect(externalAnalyze).not.toHaveBeenCalled();
  });

  it("rejects cross-thread source analysis", async () => {
    const parts = fixture();
    const app = controlledApp(enabledDependencies(parts));
    const uploaded = await uploadAsset(app);
    const sourceId = crypto.randomUUID();
    await parts.repo.saveMediaSource(
      owner,
      {
        id: sourceId,
        threadId: secondThread,
        assetId: null,
        connectionId: null,
        generation: null,
        sourceKind: "public_image_mock",
        sourceRef: "public:cross-thread",
        subject: null,
        mediaId: null,
        permalink: null,
        rights: "allowed",
        visibility: "public",
        matchStatus: "matched",
        sampleOnly: true,
        observedAt: now,
        fetchedAt: now,
      },
      mutation(),
    );
    const response = await app.request("/api/creator-growth/analyse", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": requestId(),
      },
      body: JSON.stringify({
        threadId: thread,
        assetId: uploaded.asset.id,
        sourceSelection: [sourceId],
        processorConsentVersion: "consent-v1",
      }),
    });
    expect(response.status).toBe(403);
  });

  it.each([
    ["unsupported MIME", PNG_IMAGE, "image/gif", 415],
    ["invalid structure", Uint8Array.from([1, 2, 3]), "image/png", 415],
  ])("rejects %s uploads", async (_label, bytes, mime, status) => {
    const parts = fixture();
    const response = await controlledApp(enabledDependencies(parts)).request(
      "/api/creator-growth/assets",
      {
        method: "POST",
        body: imageForm(bytes, mime),
      },
    );
    expect(response.status).toBe(status);
    expect(parts.decodeAndStripMetadata).not.toHaveBeenCalled();
  });

  it("rejects oversized uploads with 413 before decoding", async () => {
    const parts = fixture();
    const response = await controlledApp(enabledDependencies(parts)).request(
      "/api/creator-growth/assets",
      {
        method: "POST",
        body: imageForm(
          new Uint8Array(8 * 1024 * 1024 + 1),
          "image/png",
        ),
      },
    );
    expect(response.status).toBe(413);
    expect(parts.decodeAndStripMetadata).not.toHaveBeenCalled();
  });

  it("rejects owner fields in multipart uploads", async () => {
    const parts = fixture();
    const response = await controlledApp(enabledDependencies(parts)).request(
      "/api/creator-growth/assets",
      {
        method: "POST",
        body: imageForm(PNG_IMAGE, "image/png", thread, {
          creatorId: otherCreator,
        }),
      },
    );
    expect(response.status).toBe(400);
    expect(parts.decodeAndStripMetadata).not.toHaveBeenCalled();
  });

  it("returns safe DTOs without bytes, storage paths, credentials or owner fields", async () => {
    const parts = fixture();
    const app = controlledApp(enabledDependencies(parts));
    const uploaded = await uploadAsset(app);
    const media = await selectMedia(app);
    const analysis = await analyse(app, uploaded.asset.id, [
      media.officialSource.id,
    ]);
    const skill = await requestSkill(app, analysis, media);
    const serialized = JSON.stringify({ uploaded, media, analysis, skill });
    expect(serialized).not.toMatch(/storagePath|objectPath|access_token|refresh_token|credential|creatorId|workspaceId/);
    expect(serialized).not.toContain("PRIVATE-IMAGE-BYTES");
    expect(uploaded.asset).not.toHaveProperty("bytes");
  });

  it("uses one explicit idempotency context for upload retries", async () => {
    const parts = fixture();
    const putAsset = vi.spyOn(parts.repo, "putAsset");
    const app = controlledApp(enabledDependencies(parts));
    const key = requestId();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await app.request("/api/creator-growth/assets", {
        method: "POST",
        headers: { "Idempotency-Key": key },
        body: imageForm(),
      });
      expect(response.status).toBe(200);
    }
    expect(putAsset).toHaveBeenCalledTimes(2);
    expect(
      putAsset.mock.calls.map(([, , context]) => context.idempotencyKey),
    ).toEqual([key, key]);
    expect((await parts.repo.exportOwner(owner)).assets).toHaveLength(1);
  });

  it("maps a reused upload idempotency key with changed input to 409", async () => {
    const app = controlledApp(enabledDependencies(fixture()));
    const key = requestId();
    const first = await app.request("/api/creator-growth/assets", {
      method: "POST",
      headers: { "Idempotency-Key": key },
      body: imageForm(),
    });
    expect(first.status).toBe(200);
    const conflict = await app.request("/api/creator-growth/assets", {
      method: "POST",
      headers: { "Idempotency-Key": key },
      body: imageForm(PNG_IMAGE, "image/png", secondThread),
    });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({
      code: "revision_conflict",
    });
  });

  it("rejects malformed idempotency keys before decoding", async () => {
    const parts = fixture();
    const response = await controlledApp(enabledDependencies(parts)).request(
      "/api/creator-growth/assets",
      {
        method: "POST",
        headers: { "Idempotency-Key": "client-controlled" },
        body: imageForm(),
      },
    );
    expect(response.status).toBe(400);
    expect(parts.decodeAndStripMetadata).not.toHaveBeenCalled();
  });

  it("rejects analysable media selection when the public provider is disabled", async () => {
    const parts = fixture();
    const response = await controlledApp({
      ...enabledDependencies(parts),
      publicImages: createPublicImageProvider({ mode: "disabled" }) as PublicImageProvider,
    }).request("/api/creator-growth/media/select", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": requestId(),
      },
      body: JSON.stringify({
        threadId: thread,
        officialMediaRef: {
          connectionId: connection,
          resourceId: integrationResource,
        },
        candidateRef: "mock-image-ref:one",
      }),
    });
    expect(response.status).toBe(503);
  });
});



describe("Task 7 fix round 1", () => {
  async function post(
    app: ReturnType<typeof controlledApp>,
    path: string,
    body: unknown,
    key = requestId(),
  ) {
    return app.request(`/api/creator-growth/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify(body),
    });
  }

  async function skillFixture(clock = () => new Date(now)) {
    const parts = fixture(clock);
    const app = controlledApp(enabledDependencies(parts));
    const uploaded = await uploadAsset(app);
    const media = await selectMedia(app);
    const analysis = await analyse(app, uploaded.asset.id, [
      media.officialSource.id,
      media.publicImageSource.id,
    ]);
    const body = {
      threadId: thread,
      analysisId: analysis.id,
      mediaSourceIds: [media.officialSource.id, media.publicImageSource.id],
      skillId: "next_caption",
      question: "How can I improve this post?",
    };
    return { parts, app, uploaded, media, analysis, body };
  }

  it("I1 builds missing metrics and coverage from canonical resources without a client report", async () => {
    const { app, body, parts } = await skillFixture();
    const response = await post(app, "skills", body);
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.report.metrics).toHaveLength(7);
    expect(
      result.report.metrics.every(
        (metric: { value: unknown }) => metric.value === null,
      ),
    ).toBe(true);
    expect(result.report.region.verified).toBe(false);
    expect(result.report.language.verified).toBe(false);
    expect(result.report.availability.officialMetrics).toBe("unavailable");
    expect((await parts.repo.exportOwner(owner)).skillInvocations[0].report).toEqual(
      result.report,
    );
  });

  it.each([
    "metric",
    "coverage",
    "period",
    "availability",
    "sample",
    "object-data-uri",
  ])("I1 rejects client-authored %s even with valid canonical IDs", async (field) => {
    const { app, parts, analysis, media, body } = await skillFixture();
    await requestSkill(app, analysis, media);
    const baseline = (await parts.repo.exportOwner(owner)).skillInvocations[0].report;
    const report = JSON.parse(JSON.stringify(baseline));
    if (field === "metric" || field === "object-data-uri")
      report.metrics = [
        {
          metric: "reach",
          value:
            field === "metric"
              ? 987654321
              : { bytes: "data:image/png;base64,UFJJVkFURS1JTUFHRS1CWVRFUw==" },
          status: "available",
          reason: null,
          sourceRef: media.officialSource.sourceRef,
          observedAt: now,
          periodKind: "lifetime",
          sampleOnly: true,
        },
      ];
    if (field === "coverage") {
      report.region.verified = true;
      report.language.verified = true;
    }
    if (field === "period")
      report.period.metrics = [
        {
          metric: "reach",
          kind: "date_range",
          startAt: now,
          endAt: now,
          sourceRef: media.officialSource.sourceRef,
        },
      ];
    if (field === "availability") report.availability.officialMetrics = "available";
    if (field === "sample") report.sampleOnly = false;
    const response = await post(app, "skills", { ...body, report });
    expect(response.status).toBe(400);
    expect((await parts.repo.exportOwner(owner)).skillInvocations).toHaveLength(1);
    expect(await response.text()).not.toMatch(/987654321|data:image|bytes|UFJJVk/);
  });

  it.each(["analyse", "skills", "media/select"])(
    "I2 replays %s across advancing clocks and a fresh route instance",
    async (path) => {
      let time = new Date(now).getTime();
      const state = await skillFixture(() => new Date(time));
      const body =
        path === "skills"
          ? state.body
          : path === "analyse"
            ? {
                threadId: thread,
                assetId: state.uploaded.asset.id,
                sourceSelection: [
                  state.media.officialSource.id,
                  state.media.publicImageSource.id,
                ],
                processorConsentVersion: "consent-v1",
              }
            : {
                threadId: thread,
                officialMediaRef: {
                  connectionId: connection,
                  resourceId: integrationResource,
                },
                candidateRef: "mock-image-ref:one",
              };
      const key = requestId();
      const first = await post(state.app, path, body, key);
      expect(first.status).toBe(200);
      const original = await first.json();
      const before = await state.parts.repo.exportOwner(owner);
      time += 1000;
      const retry = await post(
        controlledApp(enabledDependencies(state.parts)),
        path,
        body,
        key,
      );
      expect(retry.status).toBe(200);
      expect(await retry.json()).toEqual(original);
      expect(await state.parts.repo.exportOwner(owner)).toEqual(before);
    },
  );

  it.each([
    ["analyse", "saveMediaSource"],
    ["analyse", "saveConsent"],
    ["analyse", "saveAnalysis"],
    ["skills", "saveSkillInvocation"],
    ["media/select", "saveMediaSource"],
  ] as const)(
    "I2 resumes %s after a committed %s loses its response",
    async (path, method) => {
      let time = new Date(now).getTime();
      const state = await skillFixture(() => new Date(time));
      const body =
        path === "skills"
          ? state.body
          : path === "analyse"
            ? {
                threadId: thread,
                assetId: state.uploaded.asset.id,
                sourceSelection: [],
                processorConsentVersion: "consent-v1",
              }
            : {
                threadId: thread,
                officialMediaRef: {
                  connectionId: connection,
                  resourceId: integrationResource,
                },
                candidateRef: "mock-image-ref:one",
              };
      const key = requestId();
      const originalWrite = state.parts.repo[method].bind(state.parts.repo);
      // Drop exactly the response AFTER the real repository write has committed.
      const injected = vi
        .spyOn(state.parts.repo, method)
        .mockImplementationOnce(async (...args: unknown[]) => {
          await (originalWrite as (...values: unknown[]) => Promise<unknown>)(...args);
          throw new Error("private provider internals must not escape");
        });
      const failed = await post(state.app, path, body, key);
      expect(failed.status).toBe(503);
      expect(await failed.text()).not.toContain("private provider internals");
      injected.mockRestore();
      const partial = await state.parts.repo.exportOwner(owner);
      time += 1000;
      const retry = await post(
        controlledApp(enabledDependencies(state.parts)),
        path,
        body,
        key,
      );
      expect(retry.status).toBe(200);
      const result = await retry.json();
      if (path === "media/select") expect(result.fetchedAt).toBe(now);
      else expect(result.createdAt).toBe(now);
      const completed = await state.parts.repo.exportOwner(owner);
      for (const field of [
        "mediaSources",
        "consents",
        "analyses",
        "skillInvocations",
      ] as const) {
        for (const entry of partial[field])
          expect(completed[field]).toContainEqual(entry);
      }
      time += 1000;
      const again = await post(
        controlledApp(enabledDependencies(state.parts)),
        path,
        body,
        key,
      );
      expect(again.status).toBe(200);
      expect(await again.json()).toEqual(result);
      expect(await state.parts.repo.exportOwner(owner)).toEqual(completed);
    },
  );

  it("I2 resumes a prepared skill after failure before writing, retaining the original resource facts", async () => {
    let time = new Date(now).getTime();
    const state = await skillFixture(() => new Date(time));
    state.parts.resource.metrics = {
      reach: { value: 123, availability: "available", reason: null },
    };
    const fail = vi
      .spyOn(state.parts.repo, "saveSkillInvocation")
      .mockRejectedValueOnce(new Error("interrupted before write"));
    const key = requestId();
    expect((await post(state.app, "skills", state.body, key)).status).toBe(503);
    fail.mockRestore();
    expect((await state.parts.repo.exportOwner(owner)).skillInvocations).toHaveLength(
      0,
    );
    time += 1000;
    state.parts.resource.metrics = {
      reach: { value: 999, availability: "available", reason: null },
    };
    const retry = await post(
      controlledApp(enabledDependencies(state.parts)),
      "skills",
      state.body,
      key,
    );
    expect(retry.status).toBe(200);
    const result = await retry.json();
    expect(result.report.runAt).toBe(now);
    expect(result.createdAt).toBe(now);
    expect(
      result.report.metrics.find(
        (entry: { metric: string }) => entry.metric === "reach",
      ).value,
    ).toBe(123);
  });

  it("I2 preserves original source snapshots after the second media write loses its response", async () => {
    let time = new Date(now).getTime();
    const parts = fixture(() => new Date(time));
    const app = controlledApp(enabledDependencies(parts));
    const key = requestId();
    const body = {
      threadId: thread,
      officialMediaRef: { connectionId: connection, resourceId: integrationResource },
      candidateRef: "mock-image-ref:one",
    };
    const write = parts.repo.saveMediaSource.bind(parts.repo);
    let calls = 0;
    const fail = vi
      .spyOn(parts.repo, "saveMediaSource")
      .mockImplementation(async (...args) => {
        const result = await write(...args);
        if (++calls === 2) throw new Error("response interrupted");
        return result;
      });
    expect((await post(app, "media/select", body, key)).status).toBe(503);
    fail.mockRestore();
    const before = await parts.repo.exportOwner(owner);
    time += 1000;
    parts.resource.fetchedAt = new Date(time).toISOString();
    const provider = vi.spyOn(parts.publicImages, "listForProfile");
    const retry = await post(
      controlledApp(enabledDependencies(parts)),
      "media/select",
      body,
      key,
    );
    expect(retry.status).toBe(200);
    expect((await retry.json()).fetchedAt).toBe(now);
    expect(await parts.repo.exportOwner(owner)).toEqual(before);
    expect(provider).not.toHaveBeenCalled();
  });

  it.each([
    "sourceSelection",
    "processorConsentVersion",
    "question",
    "creatorGoal",
    "mediaSourceIds",
    "candidateRef",
  ])("I2 conflicts when the complete caller command changes %s", async (field) => {
    const state = await skillFixture();
    const path = ["sourceSelection", "processorConsentVersion"].includes(field)
      ? "analyse"
      : field === "candidateRef"
        ? "media/select"
        : "skills";
    const body: Record<string, unknown> =
      path === "skills"
        ? state.body
        : path === "analyse"
          ? {
              threadId: thread,
              assetId: state.uploaded.asset.id,
              sourceSelection: [
                state.media.officialSource.id,
                state.media.publicImageSource.id,
              ],
              processorConsentVersion: "consent-v1",
            }
          : {
              threadId: thread,
              officialMediaRef: {
                connectionId: connection,
                resourceId: integrationResource,
              },
              candidateRef: "mock-image-ref:one",
            };
    const key = requestId();
    expect((await post(state.app, path, body, key)).status).toBe(200);
    const before = await state.parts.repo.exportOwner(owner);
    const changed = {
      ...body,
      [field]:
        field === "sourceSelection" || field === "mediaSourceIds"
          ? [state.media.officialSource.id]
          : "changed",
    };
    const response = await post(state.app, path, changed, key);
    expect(response.status).toBe(409);
    expect(await state.parts.repo.exportOwner(owner)).toEqual(before);
  });

  it.each(["analyse", "skills", "media/select"])(
    "I2 rechecks owner and revoke before replaying %s",
    async (path) => {
      const state = await skillFixture();
      const body =
        path === "skills"
          ? state.body
          : path === "analyse"
            ? {
                threadId: thread,
                assetId: state.uploaded.asset.id,
                sourceSelection: [
                  state.media.officialSource.id,
                  state.media.publicImageSource.id,
                ],
                processorConsentVersion: "consent-v1",
              }
            : {
                threadId: thread,
                officialMediaRef: {
                  connectionId: connection,
                  resourceId: integrationResource,
                },
                candidateRef: "mock-image-ref:one",
              };
      const key = requestId();
      expect((await post(state.app, path, body, key)).status).toBe(200);
      for (const identity of [
        { userId: colleague, workspaceId: workspace },
        { userId: otherCreator, workspaceId: otherWorkspace },
      ]) {
        const denied = await post(
          controlledApp(enabledDependencies(state.parts), identity),
          path,
          body,
          key,
        );
        expect([403, 404]).toContain(denied.status);
        expect(await denied.text()).not.toMatch(/proposal|report|sourceRef|createdAt/);
      }
      await state.parts.repo.handleCanonicalIntegrationRevocation(owner, {
        connectionId: connection,
        generation: 1,
        revokedAt: now,
      });
      // Integration reader deliberately remains stale; canonical repository revoke
      // must still deny the retry and redact any prepared content.
      expect((await post(state.app, path, body, key)).status).toBe(403);
    },
  );

  it("I1 uses actual metric snapshots while keeping sample coverage unverified", async () => {
    const { app, parts, body, media } = await skillFixture();
    parts.resource.metrics = {
      reach: { value: 123, availability: "available", reason: null },
    };
    Object.assign(parts.resource.coverage, {
      region: "Hong Kong",
      language: "zh-Hant",
      partial: false,
    });
    const response = await post(app, "skills", body);
    expect(response.status).toBe(200);
    const { report } = await response.json();
    expect(
      report.metrics.find((metric: { metric: string }) => metric.metric === "reach"),
    ).toMatchObject({
      value: 123,
      status: "available",
      periodKind: "lifetime",
      sourceRef: media.officialSource.sourceRef,
      sampleOnly: true,
    });
    expect(report.region.verified).toBe(false);
    expect(report.language.verified).toBe(false);
    expect(report.period.metrics[0]).toMatchObject({
      kind: "lifetime",
      startAt: null,
      endAt: null,
    });
  });

  it("I1 converts a non-scalar resource metric to unavailable without persisting image data", async () => {
    const { app, parts, body } = await skillFixture();
    parts.resource.metrics = {
      reach: {
        value: { bytes: "data:image/png;base64,UFJJVkFURS1JTUFHRS1CWVRFUw==" },
        availability: "available",
        reason: null,
      },
    };
    const response = await post(app, "skills", body);
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(
      result.report.metrics.find(
        (metric: { metric: string }) => metric.metric === "reach",
      ),
    ).toMatchObject({ value: null, status: "unavailable", reason: "metric_invalid" });
    expect(JSON.stringify(result)).not.toMatch(/data:image|bytes|UFJJVk/);
    expect(
      JSON.stringify((await parts.repo.exportOwner(owner)).skillInvocations),
    ).not.toMatch(/data:image|bytes|UFJJVk/);
  });

  it("I1 rejects a non-scalar stored proposal before returning a replay DTO", async () => {
    const state = await skillFixture();
    const key = requestId();
    expect((await post(state.app, "skills", state.body, key)).status).toBe(200);
    const exported = await state.parts.repo.exportOwner(owner);
    const corrupt = structuredClone(exported);
    const result = corrupt.skillInvocations[0].result as unknown as Record<
      string,
      unknown
    >;
    result.proposal = { bytes: "data:image/png;base64,cHJpdmF0ZQ==" };
    vi.spyOn(state.parts.repo, "exportOwner").mockResolvedValue(corrupt);
    const response = await post(state.app, "skills", state.body, key);
    expect(response.status).toBe(403);
    expect(await response.text()).not.toMatch(/data:image|bytes|cHJpdm/);
  });

  it.each(["question", "creatorGoal"])(
    "I1 rejects data URIs in allowed text field %s",
    async (field) => {
      const { app, parts, body } = await skillFixture();
      expect(
        (
          await post(app, "skills", {
            ...body,
            [field]: "data:image/png;base64,cHJpdmF0ZQ==",
          })
        ).status,
      ).toBe(400);
      expect((await parts.repo.exportOwner(owner)).skillInvocations).toHaveLength(0);
    },
  );

  it.each([
    "extra-file",
    "unknown-scalar",
    "duplicate-thread",
    "duplicate-rights",
    "scalar-file",
  ])("I3 rejects ambiguous multipart %s before decoding", async (kind) => {
    const parts = fixture();
    const form = imageForm();
    if (kind === "extra-file")
      form.append(
        "extraImage",
        new File(["other"], "other.png", { type: "image/png" }),
      );
    if (kind === "unknown-scalar") form.append("ignored", "value");
    if (kind === "duplicate-thread") form.append("threadId", secondThread);
    if (kind === "duplicate-rights") form.append("rightsConfirmed", "false");
    if (kind === "scalar-file") form.append("file", "text");
    const response = await controlledApp(enabledDependencies(parts)).request(
      "/api/creator-growth/assets",
      { method: "POST", body: form },
    );
    expect(response.status).toBe(400);
    expect(parts.decodeAndStripMetadata).not.toHaveBeenCalled();
    expect((await parts.repo.exportOwner(owner)).assets).toHaveLength(0);
  });

  it.each([undefined, "1"])(
    "I3 bounds the stream before formData with Content-Length %s",
    async (length) => {
      const parts = fixture();
      const form = imageForm();
      form.append("ignored", "x".repeat(10 * 1024 * 1024));
      const encoded = new Request("http://localhost/api/creator-growth/assets", {
        method: "POST",
        body: form,
      });
      const bytes = new Uint8Array(await encoded.arrayBuffer());
      let offset = 0;
      let cancelled = false;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (offset === bytes.length) {
            controller.close();
            return;
          }
          controller.enqueue(bytes.slice(offset, offset + 65536));
          offset = Math.min(bytes.length, offset + 65536);
        },
        cancel() {
          cancelled = true;
        },
      });
      const headers = new Headers({
        "Content-Type": encoded.headers.get("Content-Type")!,
      });
      if (length !== undefined) headers.set("Content-Length", length);
      const parse = vi.spyOn(Request.prototype, "formData");
      try {
        const request = new Request(encoded.url, {
          method: "POST",
          headers,
          body,
          duplex: "half",
        } as RequestInit);
        const response = await controlledApp(enabledDependencies(parts)).request(
          request,
        );
        expect(response.status).toBe(413);
        expect(parse).not.toHaveBeenCalled();
        expect(cancelled).toBe(true);
        expect(offset).toBeLessThan(bytes.length);
        expect(parts.decodeAndStripMetadata).not.toHaveBeenCalled();
      } finally {
        parse.mockRestore();
      }
    },
  );
});
