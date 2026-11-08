// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { GrowthEvidenceReport } from "./report.js";
import type { GrowthSkillResult } from "./skillRunner.js";
import type { GrowthRpc } from "./supabaseRepository.js";
import {
  GrowthRepositoryError,
  type GrowthAnalysisInput,
  type GrowthAssetInput,
  type GrowthConsentInput,
  type GrowthDraftInput,
  type GrowthMediaSourceInput,
  type GrowthMutationContext,
  type GrowthOwner,
  type GrowthSkillInvocationInput,
} from "./repository.js";
import { MemoryGrowthRepository } from "./memoryRepository.js";
import {
  SupabaseGrowthRepository,
  creatorGrowthPersistenceEnabled,
} from "./supabaseRepository.js";

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
const connectionTwo = "00000000-0000-4000-8000-000000000052";
const assetOne = "00000000-0000-4000-8000-000000000061";
const assetTwo = "00000000-0000-4000-8000-000000000062";
const assetThree = "00000000-0000-4000-8000-000000000063";
const assetFour = "00000000-0000-4000-8000-000000000064";
const mediaOne = "00000000-0000-4000-8000-000000000071";
const mediaTwo = "00000000-0000-4000-8000-000000000072";
const mediaThree = "00000000-0000-4000-8000-000000000073";
const consentOne = "00000000-0000-4000-8000-000000000081";
const analysisOne = "00000000-0000-4000-8000-000000000091";
const skillOne = "00000000-0000-4000-8000-000000000101";
const draftOne = "00000000-0000-4000-8000-000000000111";
const draftTwo = "00000000-0000-4000-8000-000000000112";
const draftThree = "00000000-0000-4000-8000-000000000113";
const now = "2026-11-04T00:00:00.000Z";

function mutation(): GrowthMutationContext {
  return { idempotencyKey: crypto.randomUUID() };
}

const owner: GrowthOwner = { workspaceId: workspace, creatorId: creator };
const sameWorkspaceOther: GrowthOwner = {
  workspaceId: workspace,
  creatorId: colleague,
};
const crossWorkspace: GrowthOwner = {
  workspaceId: otherWorkspace,
  creatorId: otherCreator,
};
const brandOwner: GrowthOwner = {
  workspaceId: workspace,
  creatorId: brandActor,
};
const staffOwner: GrowthOwner = {
  workspaceId: workspace,
  creatorId: staffActor,
};

function bytes(label: string): Uint8Array {
  return new TextEncoder().encode(label);
}

function asset(id: string, createdAt = now, threadId = thread): GrowthAssetInput {
  const content = bytes(`PRIVATE-IMAGE-BYTES-${id}`);
  return {
    id,
    threadId,
    bytes: content,
    sha256: "a".repeat(64),
    mime: "image/png",
    byteSize: content.byteLength,
    width: 640,
    height: 640,
    rightsConfirmed: true,
    sourceKind: "creator-upload",
    sampleOnly: false,
    createdAt,
  };
}

function report(): GrowthEvidenceReport {
  return {
    question: "How should I improve the post?",
    platform: "instagram",
    runAt: now,
    metrics: [],
    availability: {
      officialMetrics: "unavailable",
      publicImageMock: "not_provided",
      selfUploadManual: "manual",
      reasons: [],
    },
    provenance: {
      officialMetrics: [],
      publicImageMock: null,
      selfUploadManual: {
        sourceKind: "creator-upload",
        manualMode: "creator_upload",
        sourceRef: `asset:${assetOne}`,
        observedAt: now,
        sampleOnly: false,
        assetId: assetOne,
        sha256: "a".repeat(64),
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
    observation: {
      availability: "manual",
      reason: "processing_not_approved",
      sourceKind: "creator-upload",
      sampleOnly: false,
      objects: [],
      visibleText: [],
      composition: [],
      captionAlignment: "unavailable",
      uncertainties: ["sample"],
      assetId: assetOne,
      sha256: "a".repeat(64),
    },
    sourcePermission: { publicImage: "denied", basis: "default_denied" },
    partial: true,
    partialReasons: [],
    sampleOnly: false,
    citations: [{
      sourceKind: "self_upload_manual",
      title: "Creator-provided image or manual input",
      sourceRef: `asset:${assetOne}`,
      observedAt: now,
      sampleOnly: false,
    }],
  };
}

function result(): GrowthSkillResult {
  return {
    proposal: "Try one truthful opening.",
    sourceRefs: [`asset:${assetOne}`],
    limitations: ["sample_only"],
    sampleOnly: false,
  };
}

function mediaSource(): GrowthMediaSourceInput {
  return {
    id: mediaOne,
    threadId: thread,
    assetId: assetOne,
    connectionId: connection,
    generation: 1,
    sourceKind: "official_instagram",
    sourceRef: "official-source",
    subject: "sample-subject",
    mediaId: "789",
    permalink: "https://www.instagram.com/p/789",
    rights: "allowed",
    visibility: "public",
    matchStatus: "matched",
    sampleOnly: false,
    observedAt: now,
    fetchedAt: now,
  };
}

function consent(): GrowthConsentInput {
  return {
    id: consentOne,
    processor: "mock-vision",
    consentVersion: "consent-v1",
    grantedAt: now,
    expiresAt: "2026-12-04T00:00:00.000Z",
    connectionId: connection,
    generation: 1,
  };
}

function analysis(): GrowthAnalysisInput {
  return {
    id: analysisOne,
    threadId: thread,
    assetId: assetOne,
    consentId: consentOne,
    processor: "mock-vision",
    processorVersion: "v1",
    result: {
      observation: {
        availability: "manual",
        reason: "processing_not_approved",
        objects: [],
        visibleText: [],
        composition: [],
        captionAlignment: "unavailable",
        uncertainties: ["sample"],
        sampleOnly: false,
      },
      binding: {
        assetId: assetOne,
        sha256: "a".repeat(64),
        sourceKind: "creator-upload",
      },
    },
    createdAt: now,
  };
}

function skill(): GrowthSkillInvocationInput {
  return {
    id: skillOne,
    threadId: thread,
    analysisId: analysisOne,
    mediaSourceIds: [],
    skillId: "next_caption",
    report: report(),
    result: result(),
    createdAt: now,
  };
}

function multiSourceReport(): GrowthEvidenceReport {
  const base = report();
  return {
    ...base,
    sampleOnly: true,
    metrics: [{
      metric: "reach",
      value: 84,
      status: "available",
      reason: null,
      sourceRef: "official-two",
      observedAt: now,
      periodKind: "lifetime",
      sampleOnly: true,
    }],
    availability: {
      ...base.availability,
      officialMetrics: "available",
      publicImageMock: "mock",
    },
    provenance: {
      officialMetrics: [
        {
          sourceKind: "official_metrics",
          sourceRef: "official-source",
          observedAt: now,
          sampleOnly: false,
          periodKind: "lifetime",
        },
        {
          sourceKind: "official_metrics",
          sourceRef: "official-two",
          observedAt: now,
          sampleOnly: true,
          periodKind: "lifetime",
        },
      ],
      publicImageMock: {
        sourceKind: "public_image_mock",
        sourceRef: "mock-public",
        observedAt: now,
        sampleOnly: true,
        assetId: assetOne,
        sha256: "a".repeat(64),
      },
      selfUploadManual: base.provenance.selfUploadManual,
    },
    period: {
      ...base.period,
      metrics: [{
        metric: "reach",
        kind: "lifetime",
        startAt: null,
        endAt: null,
        sourceRef: "official-source",
      }],
    },
    citations: [
      {
        sourceKind: "official_metrics",
        title: "Official A",
        sourceRef: "official-source",
        observedAt: now,
        sampleOnly: false,
      },
      {
        sourceKind: "official_metrics",
        title: "Official B",
        sourceRef: "official-two",
        observedAt: now,
        sampleOnly: true,
      },
      {
        sourceKind: "public_image_mock",
        title: "Public mock",
        sourceRef: "mock-public",
        observedAt: now,
        sampleOnly: true,
      },
      ...base.citations,
    ],
  };
}

async function multiSourceContext() {
  const repo = repository();
  await repo.putAsset(owner, asset(assetOne), mutation());
  await repo.putAsset(owner, asset(assetTwo), mutation());
  await repo.saveMediaSource(owner, mediaSource(), mutation());
  await repo.saveMediaSource(owner, {
    id: mediaTwo,
    threadId: thread,
    assetId: assetOne,
    connectionId: connectionTwo,
    generation: 1,
    sourceKind: "official_instagram",
    sourceRef: "official-two",
    subject: "second-official",
    mediaId: "222",
    permalink: "https://www.instagram.com/p/second",
    rights: "allowed",
    visibility: "public",
    matchStatus: "matched",
    sampleOnly: true,
    observedAt: now,
    fetchedAt: now,
  }, mutation());
  await repo.saveMediaSource(owner, {
    id: mediaThree,
    threadId: thread,
    assetId: assetOne,
    connectionId: null,
    generation: null,
    sourceKind: "public_image_mock",
    sourceRef: "mock-public",
    subject: "public-match",
    mediaId: "333",
    permalink: "https://www.instagram.com/p/public",
    rights: "allowed",
    visibility: "public",
    matchStatus: "matched",
    sampleOnly: true,
    observedAt: now,
    fetchedAt: now,
  }, mutation());
  await repo.saveConsent(owner, consent(), mutation());
  await repo.saveAnalysis(owner, analysis(), mutation());
  return { repo, mediaSourceIds: [mediaOne, mediaTwo, mediaThree] };
}

function repository() {
  return new MemoryGrowthRepository({
    owners: [
      { owner, status: "active" },
      { owner: sameWorkspaceOther, status: "active" },
      { owner: crossWorkspace, status: "active" },
    ],
    connections: [
      {
        owner,
        id: connection,
        generation: 1,
        status: "connected",
      },
      {
        owner,
        id: connectionTwo,
        generation: 1,
        status: "connected",
      },
    ],
    threads: [
      { owner, id: thread },
      { owner, id: secondThread },
      { owner: sameWorkspaceOther, id: colleagueThread },
      { owner: crossWorkspace, id: thread },
    ],
    now: () => new Date(now),
  });
}

async function addDraft(
  repo: MemoryGrowthRepository,
  input: Partial<GrowthDraftInput> & Pick<GrowthDraftInput, "id">,
) {
  const { id: draftId, ...overrides } = input;
  return repo.saveDraft(
    owner,
    {
      id: draftId,
      threadId: thread,
      assetId: assetOne,
      expectedRevision: 0,
      caption: "Private next-post draft",
      manualDescription: "Creator-only description",
      status: "private",
      ...overrides,
    },
    mutation(),
  );
}

describe("creator growth repository ownership", () => {
  it("enforces the server owner on assets, drafts, brand IDs, and staff IDs", async () => {
    const repo = repository();
    await repo.putAsset(owner, asset(assetOne), mutation());
    await repo.putAsset(
      sameWorkspaceOther,
      asset(assetTwo, now, colleagueThread),
      mutation(),
    );
    await addDraft(repo, { id: draftOne });
    await repo.saveDraft(
      sameWorkspaceOther,
      {
        id: draftTwo,
        threadId: colleagueThread,
        assetId: assetTwo,
        expectedRevision: 0,
        caption: "Other creator draft",
        manualDescription: "",
        status: "private",
      },
      mutation(),
    );

    await expect(repo.getAssetBytes(sameWorkspaceOther, assetOne)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(repo.getAssetBytes(crossWorkspace, assetOne)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      repo.getPrivateDraft(sameWorkspaceOther, draftOne),
    ).resolves.toBeNull();
    await expect(repo.getPrivateDraft(crossWorkspace, draftOne)).resolves.toBeNull();
    await expect(repo.getPrivateDraft(brandOwner, draftOne)).rejects.toMatchObject({
      code: "NOT_ACTIVE_CREATOR",
    });
    await expect(repo.getPrivateDraft(staffOwner, draftOne)).rejects.toMatchObject({
      code: "NOT_ACTIVE_CREATOR",
    });
  });

  it("validates the current official connection generation without a growth revoke mutation", async () => {
    const repo = repository();
    await repo.putAsset(owner, asset(assetOne), mutation());
    await repo.saveMediaSource(owner, {
      id: mediaOne,
      threadId: thread,
      connectionId: connection,
      generation: 1,
      sourceKind: "public_image_mock",
      sourceRef: "sample-public-image",
      subject: "sample-subject",
      mediaId: "123",
      permalink: "https://www.instagram.com/p/sample",
      rights: "allowed",
      visibility: "public",
      matchStatus: "matched",
      sampleOnly: true,
      observedAt: now,
      fetchedAt: now,
    }, mutation());
    await expect(repo.getAssetBytes(owner, assetOne)).resolves.toEqual(
      bytes(`PRIVATE-IMAGE-BYTES-${assetOne}`),
    );
    await expect(
      repo.saveMediaSource(owner, {
        id: mediaTwo,
        threadId: thread,
        connectionId: connection,
        generation: 2,
        sourceKind: "official_instagram",
        sourceRef: "official-old",
        subject: "sample-subject",
        mediaId: "456",
        permalink: "https://www.instagram.com/p/old",
        rights: "allowed",
        visibility: "public",
        matchStatus: "matched",
        sampleOnly: false,
        observedAt: now,
        fetchedAt: now,
      }, mutation()),
    ).rejects.toMatchObject({ code: "GENERATION_REVOKED" });
  });

  it("rejects stale draft revisions and returns only the latest owner-scoped draft", async () => {
    const repo = repository();
    await repo.putAsset(owner, asset(assetOne), mutation());
    const first = await addDraft(repo, { id: draftOne });
    expect(first.revision).toBe(1);
    await expect(
      repo.saveDraft(owner, {
        id: draftOne,
        threadId: thread,
        assetId: assetOne,
        expectedRevision: 0,
        caption: "stale update",
        manualDescription: "",
        status: "private",
      }, mutation()),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    const second = await repo.saveDraft(
      owner,
      {
        id: draftOne,
        threadId: thread,
        assetId: assetOne,
        expectedRevision: 1,
        caption: "fresh update",
        manualDescription: "",
        status: "private",
      },
      mutation(),
    );
    expect(second.revision).toBe(2);
    expect(await repo.getPrivateDraft(owner, draftOne)).toEqual(second);
  });

  it("keeps standalone public-image provenance separate from a connection generation", async () => {
    const repo = repository();
    const source = await repo.saveMediaSource(owner, {
      id: mediaThree,
      threadId: thread,
      connectionId: null,
      generation: null,
      sourceKind: "public_image_mock",
      sourceRef: "sample-public-image",
      subject: null,
      mediaId: null,
      permalink: null,
      rights: "unknown",
      visibility: "unknown",
      matchStatus: "unverified",
      sampleOnly: true,
      observedAt: now,
      fetchedAt: now,
    }, mutation());
    expect(source).toMatchObject({
      sourceKind: "public_image_mock",
      connectionId: null,
      invalidatedAt: null,
    });
  });

  it("enforces one canonical, same-thread analysis chain and complete asset binding", async () => {
    const repo = repository();
    await repo.putAsset(owner, asset(assetOne), mutation());
    await repo.saveMediaSource(owner, mediaSource(), mutation());
    await repo.saveConsent(
      owner,
      { ...consent(), expiresAt: "2027-12-04T00:00:00.000Z" },
      mutation(),
    );

    const invalidBinding: GrowthAnalysisInput = {
      ...analysis(),
      result: {
        ...analysis().result,
        binding: {
          ...analysis().result.binding,
          sourceKind: "synthetic-fixture",
          fixtureId: "fixture-other",
        },
      },
    };
    await expect(
      repo.saveAnalysis(owner, invalidBinding, mutation()),
    ).rejects.toMatchObject({ code: "SOURCE_INVALIDATED" });

    const analysisRequest = mutation();
    const savedAnalysis = await repo.saveAnalysis(owner, analysis(), analysisRequest);
    expect(await repo.saveAnalysis(owner, analysis(), analysisRequest)).toEqual(savedAnalysis);

    await expect(
      repo.saveSkillInvocation(
        owner,
        { ...skill(), threadId: secondThread },
        mutation(),
      ),
    ).rejects.toMatchObject({ code: "SOURCE_INVALIDATED" });
    await expect(
      repo.saveSkillInvocation(
        owner,
        { ...skill(), analysisId: null as unknown as string },
        mutation(),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      repo.saveDraft(
        owner,
        {
          id: draftOne,
          threadId: secondThread,
          assetId: assetOne,
          analysisId: analysisOne,
          skillInvocationId: skillOne,
          expectedRevision: 0,
          caption: "cross-thread",
          manualDescription: "",
          status: "private",
        },
        mutation(),
      ),
    ).rejects.toMatchObject({ code: "SOURCE_INVALIDATED" });
  });

  it("does not expose a second generation-revocation mutation path", () => {
    const memory = repository();
    const supabase = new SupabaseGrowthRepository({
      rpc: vi.fn() as unknown as GrowthRpc,
      storage: {
        put: vi.fn(async () => undefined),
        read: vi.fn(async () => bytes("read")),
        remove: vi.fn(async () => undefined),
      },
      enabled: true,
    });
    expect("revokeGeneration" in memory).toBe(false);
    expect("revokeGeneration" in supabase).toBe(false);
  });

  it("rejects unusable media sources when attaching them to an analysis", async () => {
    const repo = repository();
    await repo.putAsset(owner, asset(assetOne), mutation());
    await repo.putAsset(owner, asset(assetTwo), mutation());

    const cases: readonly Readonly<{
      sourceKind: GrowthMediaSourceInput["sourceKind"];
      assetId: string | null;
      connectionId: string | null;
      generation: number | null;
      rights: GrowthMediaSourceInput["rights"];
      visibility: GrowthMediaSourceInput["visibility"];
      matchStatus: GrowthMediaSourceInput["matchStatus"];
    }>[] = [
      {
        sourceKind: "official_instagram",
        assetId: assetOne,
        connectionId: connection,
        generation: 1,
        rights: "denied",
        visibility: "public",
        matchStatus: "matched",
      },
      {
        sourceKind: "creator_upload",
        assetId: assetOne,
        connectionId: null,
        generation: null,
        rights: "unknown",
        visibility: "unknown",
        matchStatus: "unverified",
      },
      {
        sourceKind: "public_image_mock",
        assetId: null,
        connectionId: null,
        generation: null,
        rights: "allowed",
        visibility: "private",
        matchStatus: "matched",
      },
      {
        sourceKind: "public_image_mock",
        assetId: null,
        connectionId: null,
        generation: null,
        rights: "allowed",
        visibility: "unknown",
        matchStatus: "matched",
      },
      {
        sourceKind: "public_image_mock",
        assetId: null,
        connectionId: null,
        generation: null,
        rights: "allowed",
        visibility: "public",
        matchStatus: "unverified",
      },
      {
        sourceKind: "public_image_mock",
        assetId: null,
        connectionId: null,
        generation: null,
        rights: "allowed",
        visibility: "public",
        matchStatus: "rejected",
      },
      {
        sourceKind: "official_instagram",
        assetId: assetOne,
        connectionId: connection,
        generation: 1,
        rights: "allowed",
        visibility: "private",
        matchStatus: "matched",
      },
      {
        sourceKind: "official_instagram",
        assetId: assetOne,
        connectionId: connection,
        generation: 1,
        rights: "allowed",
        visibility: "public",
        matchStatus: "unverified",
      },
      {
        sourceKind: "creator_upload",
        assetId: assetTwo,
        connectionId: null,
        generation: null,
        rights: "allowed",
        visibility: "unknown",
        matchStatus: "unverified",
      },
    ];

    for (const [index, candidate] of cases.entries()) {
      const sourceId = crypto.randomUUID();
      await repo.saveMediaSource(owner, {
        id: sourceId,
        threadId: thread,
        sourceRef: `source-${index}`,
        subject: null,
        mediaId: null,
        permalink: null,
        sampleOnly: true,
        observedAt: now,
        fetchedAt: now,
        ...candidate,
      }, mutation());
      await expect(
        repo.saveAnalysis(
          owner,
          {
            ...analysis(),
            id: crypto.randomUUID(),
            assetId: assetOne,
            mediaSourceId: sourceId,
            consentId: null,
          },
          mutation(),
        ),
      ).rejects.toMatchObject({ code: "SOURCE_INVALIDATED" });
    }
  });

  it("requires consent processor equality and complete derived-draft lineage", async () => {
    const repo = repository();
    await repo.putAsset(owner, asset(assetOne), mutation());
    await repo.putAsset(owner, asset(assetTwo), mutation());
    await repo.saveConsent(owner, {
      ...consent(),
      processor: "different-processor",
    }, mutation());
    await expect(
      repo.saveAnalysis(owner, analysis(), mutation()),
    ).rejects.toMatchObject({ code: "SOURCE_INVALIDATED" });

    await repo.saveConsent(owner, consent(), mutation());
    await repo.saveAnalysis(owner, analysis(), mutation());
    await repo.saveSkillInvocation(owner, skill(), mutation());
    await expect(
      repo.saveDraft(
        owner,
        {
          id: draftOne,
          threadId: thread,
          assetId: null,
          analysisId: analysisOne,
          expectedRevision: 0,
          caption: "analysis-only",
          manualDescription: "",
          status: "private",
        },
        mutation(),
      ),
    ).rejects.toMatchObject({ code: "SOURCE_INVALIDATED" });
    await expect(
      repo.saveDraft(
        owner,
        {
          id: draftTwo,
          threadId: thread,
          assetId: assetOne,
          analysisId: null,
          skillInvocationId: skillOne,
          expectedRevision: 0,
          caption: "skill-only",
          manualDescription: "",
          status: "private",
        },
        mutation(),
      ),
    ).rejects.toMatchObject({ code: "SOURCE_INVALIDATED" });
    await expect(
      repo.saveDraft(
        owner,
        {
          id: draftThree,
          threadId: thread,
          assetId: assetTwo,
          analysisId: analysisOne,
          skillInvocationId: skillOne,
          expectedRevision: 0,
          caption: "mismatched",
          manualDescription: "",
          status: "private",
        },
        mutation(),
      ),
    ).rejects.toMatchObject({ code: "SOURCE_INVALIDATED" });
  });

  it("accepts a complete canonical multi-source skill report", async () => {
    const { repo, mediaSourceIds } = await multiSourceContext();
    const saved = await repo.saveSkillInvocation(
      owner,
      {
        ...skill(),
        id: crypto.randomUUID(),
        mediaSourceIds,
        report: multiSourceReport(),
        result: {
          ...result(),
          sourceRefs: [
            "official-source",
            "official-two",
            "mock-public",
            `asset:${assetOne}`,
            "native:test",
            "curated:test",
          ],
          sampleOnly: true,
        },
      },
      mutation(),
    );
    expect(saved.mediaSourceIds).toEqual(mediaSourceIds);
    expect(
      (await repo.exportOwner(owner)).skillInvocations[0].mediaSourceIds,
    ).toEqual(mediaSourceIds);
  });

  it("rejects a public-image report that names another asset", async () => {
    const { repo, mediaSourceIds } = await multiSourceContext();
    const reportValue = multiSourceReport();
    await expect(
      repo.saveSkillInvocation(
        owner,
        {
          ...skill(),
          id: crypto.randomUUID(),
          mediaSourceIds,
          report: {
            ...reportValue,
            provenance: {
              ...reportValue.provenance,
              publicImageMock: {
                ...reportValue.provenance.publicImageMock!,
                assetId: assetTwo,
                sha256: "b".repeat(64),
              },
            },
          },
        },
        mutation(),
      ),
    ).rejects.toMatchObject({ code: "SOURCE_INVALIDATED" });
  });

  it("rejects a public-image source that is bound to another asset", async () => {
    const { repo, mediaSourceIds } = await multiSourceContext();
    const badPublicSource = crypto.randomUUID();
    await repo.saveMediaSource(owner, {
      id: badPublicSource,
      threadId: thread,
      assetId: assetTwo,
      connectionId: null,
      generation: null,
      sourceKind: "public_image_mock",
      sourceRef: "bad-public",
      subject: "wrong-asset",
      mediaId: "555",
      permalink: "https://www.instagram.com/p/wrong",
      rights: "allowed",
      visibility: "public",
      matchStatus: "matched",
      sampleOnly: true,
      observedAt: now,
      fetchedAt: now,
    }, mutation());
    await expect(
      repo.saveSkillInvocation(
        owner,
        {
          ...skill(),
          id: crypto.randomUUID(),
          mediaSourceIds: [badPublicSource],
          report: multiSourceReport(),
        },
        mutation(),
      ),
    ).rejects.toMatchObject({ code: "SOURCE_INVALIDATED" });
    expect(mediaSourceIds).toHaveLength(3);
  });

  it("rejects a self-upload report with the wrong digest", async () => {
    const { repo, mediaSourceIds } = await multiSourceContext();
    const reportValue = multiSourceReport();
    await expect(
      repo.saveSkillInvocation(
        owner,
        {
          ...skill(),
          id: crypto.randomUUID(),
          mediaSourceIds,
          report: {
            ...reportValue,
            provenance: {
              ...reportValue.provenance,
              selfUploadManual: {
                ...reportValue.provenance.selfUploadManual!,
                sha256: "b".repeat(64),
              },
            },
          },
        },
        mutation(),
      ),
    ).rejects.toMatchObject({ code: "SOURCE_INVALIDATED" });
  });

  it("rejects a fake official source reference", async () => {
    const { repo, mediaSourceIds } = await multiSourceContext();
    const reportValue = multiSourceReport();
    await expect(
      repo.saveSkillInvocation(
        owner,
        {
          ...skill(),
          id: crypto.randomUUID(),
          mediaSourceIds,
          report: {
            ...reportValue,
            provenance: {
              ...reportValue.provenance,
              officialMetrics: [
                ...reportValue.provenance.officialMetrics,
                {
                  sourceKind: "official_metrics",
                  sourceRef: "official-fake",
                  observedAt: now,
                  sampleOnly: false,
                  periodKind: "lifetime",
                },
              ],
            },
            citations: [
              ...reportValue.citations,
              {
                sourceKind: "official_metrics",
                title: "Fake official",
                sourceRef: "official-fake",
                observedAt: now,
                sampleOnly: false,
              },
            ],
          },
        },
        mutation(),
      ),
    ).rejects.toMatchObject({ code: "SOURCE_INVALIDATED" });
    await expect(
      repo.saveSkillInvocation(
        owner,
        {
          ...skill(),
          id: crypto.randomUUID(),
          mediaSourceIds,
          report: reportValue,
          result: {
            ...result(),
            sourceRefs: ["official-fake"],
          },
        },
        mutation(),
      ),
    ).rejects.toMatchObject({ code: "SOURCE_INVALIDATED" });
  });

  it("rejects provenance without its required citation", async () => {
    const { repo, mediaSourceIds } = await multiSourceContext();
    const reportValue = multiSourceReport();
    await expect(
      repo.saveSkillInvocation(
        owner,
        {
          ...skill(),
          id: crypto.randomUUID(),
          mediaSourceIds,
          report: {
            ...reportValue,
            citations: reportValue.citations.filter(
              (citation) => citation.sourceRef !== "official-two",
            ),
          },
        },
        mutation(),
      ),
    ).rejects.toMatchObject({ code: "SOURCE_INVALIDATED" });
  });

  it("requires a typed observation and consistent sample flags", async () => {
    const { repo, mediaSourceIds } = await multiSourceContext();
    const missingObservation = {
      ...skill(),
      id: crypto.randomUUID(),
      mediaSourceIds,
      report: {
        ...multiSourceReport(),
        observation: null,
      } as unknown as GrowthEvidenceReport,
    };
    await expect(
      repo.saveSkillInvocation(owner, missingObservation, mutation()),
    ).rejects.toMatchObject({ code: "SOURCE_INVALIDATED" });
    await expect(
      repo.saveSkillInvocation(
        owner,
        {
          ...skill(),
          id: crypto.randomUUID(),
          mediaSourceIds,
          report: {
            ...multiSourceReport(),
            observation: {
              ...multiSourceReport().observation,
              assetId: undefined as unknown as string,
              sha256: undefined as unknown as string,
            },
          },
        },
        mutation(),
      ),
    ).rejects.toMatchObject({ code: "SOURCE_INVALIDATED" });
    await expect(
      repo.saveSkillInvocation(
        owner,
        {
          ...skill(),
          id: crypto.randomUUID(),
          mediaSourceIds,
          report: {
            ...multiSourceReport(),
            observation: {
              ...multiSourceReport().observation,
              sourceKind: "synthetic-fixture",
              sampleOnly: true,
            },
          },
          result: {
            ...result(),
            sampleOnly: true,
          },
        },
        mutation(),
      ),
    ).rejects.toMatchObject({ code: "SOURCE_INVALIDATED" });

    const contradictory = multiSourceReport();
    await expect(
      repo.saveSkillInvocation(
        owner,
        {
          ...skill(),
          id: crypto.randomUUID(),
          mediaSourceIds,
          report: {
            ...contradictory,
            observation: {
              ...contradictory.observation,
              sampleOnly: true,
            },
          },
        },
        mutation(),
      ),
    ).rejects.toMatchObject({ code: "SOURCE_INVALIDATED" });
    await expect(
      repo.saveSkillInvocation(
        owner,
        {
          ...skill(),
          id: crypto.randomUUID(),
          mediaSourceIds,
          report: contradictory,
          result: {
            ...result(),
            sampleOnly: false,
          },
        },
        mutation(),
      ),
    ).rejects.toMatchObject({ code: "SOURCE_INVALIDATED" });
    await expect(
      repo.saveSkillInvocation(
        owner,
        {
          ...skill(),
          id: crypto.randomUUID(),
          mediaSourceIds,
          report: {
            ...contradictory,
            sampleOnly: false,
          },
          result: {
            ...result(),
            sampleOnly: true,
          },
        },
        mutation(),
      ),
    ).rejects.toMatchObject({ code: "SOURCE_INVALIDATED" });
  });

  it("requires normalized equality with every canonical observation field", async () => {
    const { repo, mediaSourceIds } = await multiSourceContext();
    const base = multiSourceReport();
    const mutations: readonly Partial<GrowthEvidenceReport["observation"]>[] = [
      { availability: "observed" },
      { reason: "manual_description_required" },
      { objects: ["object"] },
      { visibleText: ["visible text"] },
      { composition: ["rule of thirds"] },
      { captionAlignment: "aligned" },
      { uncertainties: ["changed"] },
    ];
    for (const change of mutations) {
      await expect(
        repo.saveSkillInvocation(
          owner,
          {
            ...skill(),
            id: crypto.randomUUID(),
            mediaSourceIds,
            report: {
              ...base,
              observation: {
                ...base.observation,
                ...change,
              },
            },
          },
          mutation(),
        ),
      ).rejects.toMatchObject({ code: "SOURCE_INVALIDATED" });
    }

    const { composition: _composition, ...missingField } = base.observation;
    void _composition;
    await expect(
      repo.saveSkillInvocation(
        owner,
        {
          ...skill(),
          id: crypto.randomUUID(),
          mediaSourceIds,
          report: {
            ...base,
            observation: missingField as unknown as GrowthEvidenceReport["observation"],
          },
        },
        mutation(),
      ),
    ).rejects.toMatchObject({ code: "SOURCE_INVALIDATED" });
    await expect(
      repo.saveSkillInvocation(
        owner,
        {
          ...skill(),
          id: crypto.randomUUID(),
          mediaSourceIds,
          report: {
            ...base,
            observation: {
              ...base.observation,
              extraObservationField: true,
            } as unknown as GrowthEvidenceReport["observation"],
          },
        },
        mutation(),
      ),
    ).rejects.toMatchObject({ code: "SOURCE_INVALIDATED" });
  });

  it("matches official and public source sample flags and timestamps", async () => {
    const { repo, mediaSourceIds } = await multiSourceContext();
    const base = multiSourceReport();
    await expect(
      repo.saveSkillInvocation(
        owner,
        {
          ...skill(),
          id: crypto.randomUUID(),
          mediaSourceIds,
          report: {
            ...base,
            provenance: {
              ...base.provenance,
              officialMetrics: base.provenance.officialMetrics.map((entry) =>
                entry.sourceRef === "official-two"
                  ? { ...entry, sampleOnly: false }
                  : entry
              ),
            },
          },
        },
        mutation(),
      ),
    ).rejects.toMatchObject({ code: "SOURCE_INVALIDATED" });
    await expect(
      repo.saveSkillInvocation(
        owner,
        {
          ...skill(),
          id: crypto.randomUUID(),
          mediaSourceIds,
          report: {
            ...base,
            citations: base.citations.map((entry) =>
              entry.sourceRef === "mock-public"
                ? { ...entry, sampleOnly: false }
                : entry
            ),
          },
        },
        mutation(),
      ),
    ).rejects.toMatchObject({ code: "SOURCE_INVALIDATED" });
    await expect(
      repo.saveSkillInvocation(
        owner,
        {
          ...skill(),
          id: crypto.randomUUID(),
          mediaSourceIds,
          report: {
            ...base,
            provenance: {
              ...base.provenance,
              officialMetrics: base.provenance.officialMetrics.map((entry) => ({
                ...entry,
                observedAt: "2026-11-01T00:00:00.000Z",
              })),
            },
          },
        },
        mutation(),
      ),
    ).rejects.toMatchObject({ code: "SOURCE_INVALIDATED" });
    await expect(
      repo.saveSkillInvocation(
        owner,
        {
          ...skill(),
          id: crypto.randomUUID(),
          mediaSourceIds,
          report: {
            ...base,
            citations: base.citations.map((entry) =>
              entry.sourceRef === "official-source"
                ? { ...entry, observedAt: "2026-11-01T00:00:00.000Z" }
                : entry
            ),
          },
        },
        mutation(),
      ),
    ).rejects.toMatchObject({ code: "SOURCE_INVALIDATED" });
  });

  it("requires a canonical source for every available metric", async () => {
    const { repo, mediaSourceIds } = await multiSourceContext();
    const reportValue = multiSourceReport();
    await expect(
      repo.saveSkillInvocation(
        owner,
        {
          ...skill(),
          id: crypto.randomUUID(),
          mediaSourceIds,
          report: {
            ...reportValue,
            metrics: [{
              metric: "reach",
              value: 42,
              status: "available",
              reason: null,
              sourceRef: null,
              observedAt: now,
              periodKind: "lifetime",
              sampleOnly: true,
            }],
          },
          result: {
            ...result(),
            sampleOnly: true,
          },
        },
        mutation(),
      ),
    ).rejects.toMatchObject({ code: "SOURCE_INVALIDATED" });
  });

  it("rejects an unused extra canonical media-source id", async () => {
    const { repo, mediaSourceIds } = await multiSourceContext();
    const unusedSource = crypto.randomUUID();
    await repo.saveMediaSource(owner, {
      id: unusedSource,
      threadId: thread,
      assetId: assetOne,
      connectionId: connectionTwo,
      generation: 1,
      sourceKind: "official_instagram",
      sourceRef: "official-unused",
      subject: "unused",
      mediaId: "666",
      permalink: "https://www.instagram.com/p/unused",
      rights: "allowed",
      visibility: "public",
      matchStatus: "matched",
      sampleOnly: true,
      observedAt: now,
      fetchedAt: now,
    }, mutation());
    await expect(
      repo.saveSkillInvocation(
        owner,
        {
          ...skill(),
          id: crypto.randomUUID(),
          mediaSourceIds: [...mediaSourceIds, unusedSource],
          report: multiSourceReport(),
        },
        mutation(),
      ),
    ).rejects.toMatchObject({ code: "SOURCE_INVALIDATED" });
  });

  it("requires every attached media-source asset to equal the analysis asset", async () => {
    const { repo } = await multiSourceContext();
    const officialSource = crypto.randomUUID();
    const publicSource = crypto.randomUUID();
    await repo.saveMediaSource(owner, {
      id: officialSource,
      threadId: thread,
      assetId: assetTwo,
      connectionId: connection,
      generation: 1,
      sourceKind: "official_instagram",
      sourceRef: "official-wrong-asset",
      subject: "wrong-official",
      mediaId: "777",
      permalink: "https://www.instagram.com/p/wrong-official",
      rights: "allowed",
      visibility: "public",
      matchStatus: "matched",
      sampleOnly: false,
      observedAt: now,
      fetchedAt: now,
    }, mutation());
    await repo.saveMediaSource(owner, {
      id: publicSource,
      threadId: thread,
      assetId: assetTwo,
      connectionId: null,
      generation: null,
      sourceKind: "public_image_mock",
      sourceRef: "public-wrong-asset",
      subject: "wrong-public",
      mediaId: "888",
      permalink: "https://www.instagram.com/p/wrong-public",
      rights: "allowed",
      visibility: "public",
      matchStatus: "matched",
      sampleOnly: false,
      observedAt: now,
      fetchedAt: now,
    }, mutation());
    for (const mediaSourceId of [officialSource, publicSource]) {
      await expect(
        repo.saveAnalysis(
          owner,
          {
            ...analysis(),
            id: crypto.randomUUID(),
            mediaSourceId,
            consentId: null,
          },
          mutation(),
        ),
      ).rejects.toMatchObject({ code: "SOURCE_INVALIDATED" });
    }
  });

  it("rejects a canonical media source from another thread", async () => {
    const { repo, mediaSourceIds } = await multiSourceContext();
    const crossThreadSource = crypto.randomUUID();
    await repo.putAsset(
      owner,
      asset(assetThree, now, secondThread),
      mutation(),
    );
    await repo.saveMediaSource(owner, {
      id: crossThreadSource,
      threadId: secondThread,
      assetId: assetThree,
      connectionId: connectionTwo,
      generation: 1,
      sourceKind: "official_instagram",
      sourceRef: "official-cross-thread",
      subject: "cross-thread",
      mediaId: "444",
      permalink: "https://www.instagram.com/p/cross",
      rights: "allowed",
      visibility: "public",
      matchStatus: "matched",
      sampleOnly: true,
      observedAt: now,
      fetchedAt: now,
    }, mutation());
    const reportValue = multiSourceReport();
    await expect(
      repo.saveSkillInvocation(
        owner,
        {
          ...skill(),
          id: crypto.randomUUID(),
          mediaSourceIds: [...mediaSourceIds, crossThreadSource],
          report: {
            ...reportValue,
            provenance: {
              ...reportValue.provenance,
              officialMetrics: [{
                sourceKind: "official_metrics",
                sourceRef: "official-cross-thread",
                observedAt: now,
                sampleOnly: true,
                periodKind: "lifetime",
              }],
            },
            citations: [{
              sourceKind: "official_metrics",
              title: "Cross thread",
              sourceRef: "official-cross-thread",
              observedAt: now,
              sampleOnly: true,
            }, ...reportValue.citations],
          },
        },
        mutation(),
      ),
    ).rejects.toMatchObject({ code: "SOURCE_INVALIDATED" });
  });

  it("rejects duplicate and cross-owner canonical source lists", async () => {
    const { repo, mediaSourceIds } = await multiSourceContext();
    await expect(
      repo.saveSkillInvocation(
        owner,
        {
          ...skill(),
          id: crypto.randomUUID(),
          mediaSourceIds: [...mediaSourceIds, mediaSourceIds[0]],
          report: multiSourceReport(),
        },
        mutation(),
      ),
    ).rejects.toMatchObject({ code: "SOURCE_INVALIDATED" });

    const colleagueSource = crypto.randomUUID();
    await repo.putAsset(
      sameWorkspaceOther,
      asset(assetFour, now, colleagueThread),
      mutation(),
    );
    await repo.saveMediaSource(sameWorkspaceOther, {
      id: colleagueSource,
      threadId: colleagueThread,
      assetId: assetFour,
      connectionId: null,
      generation: null,
      sourceKind: "creator_upload",
      sourceRef: `asset:${assetFour}`,
      subject: "colleague-source",
      mediaId: null,
      permalink: null,
      rights: "allowed",
      visibility: "unknown",
      matchStatus: "unverified",
      sampleOnly: false,
      observedAt: now,
      fetchedAt: now,
    }, mutation());
    await expect(
      repo.saveSkillInvocation(
        owner,
        {
          ...skill(),
          id: crypto.randomUUID(),
          mediaSourceIds: [colleagueSource],
          report: report(),
        },
        mutation(),
      ),
    ).rejects.toMatchObject({ code: "SOURCE_INVALIDATED" });
  });

  it("invalidates a skill through a linked source while its analysis lineage stays active", async () => {
    const { repo, mediaSourceIds } = await multiSourceContext();
    const skillId = crypto.randomUUID();
    await repo.saveSkillInvocation(
      owner,
      {
        ...skill(),
        id: skillId,
        mediaSourceIds,
        report: multiSourceReport(),
        result: {
          ...result(),
          sourceRefs: [
            "official-source",
            "official-two",
            "mock-public",
            `asset:${assetOne}`,
          ],
          sampleOnly: true,
        },
      },
      mutation(),
    );
    await repo.handleCanonicalIntegrationRevocation(owner, {
      connectionId: connectionTwo,
      generation: 1,
      revokedAt: now,
    });
    const exported = await repo.exportOwner(owner);
    expect(exported.analyses.find((value) => value.id === analysisOne)?.invalidatedAt)
      .toBeNull();
    expect(exported.skillInvocations.find((value) => value.id === skillId)?.invalidatedAt)
      .toBe(now);
  });
});

describe("creator growth retention and physical cleanup", () => {
  it("applies exact 24-hour, 30-day, and 90-day boundaries to only owner rows", async () => {
    const clock = new Date("2026-12-04T00:00:00.000Z");
    const repo = new MemoryGrowthRepository({
      owners: [{ owner, status: "active" }],
      connections: [],
      threads: [{ owner, id: thread }],
      now: () => clock,
    });
    await repo.putAsset(
      owner,
      asset(assetOne, "2026-12-03T00:00:00.000Z"),
      mutation(),
    );
    await repo.putAsset(
      owner,
      asset(assetTwo, "2026-12-03T00:00:00.001Z"),
      mutation(),
    );
    await repo.putAsset(
      owner,
      asset(assetThree, "2026-11-03T00:00:00.000Z"),
      mutation(),
    );
    await repo.putAsset(
      owner,
      asset(assetFour, "2026-11-03T00:00:00.000Z"),
      mutation(),
    );
    await addDraft(repo, {
      id: draftOne,
      assetId: assetOne,
    });
    await addDraft(repo, {
      id: draftTwo,
      assetId: assetThree,
    });
    await addDraft(repo, {
      id: draftThree,
      assetId: assetFour,
    });
    await repo.setDraftStatus(
      owner,
      draftOne,
      {
        expectedRevision: 1,
        status: "completed",
        changedAt: "2026-11-04T00:00:00.000Z",
      },
      mutation(),
    );
    await repo.setDraftStatus(
      owner,
      draftTwo,
      {
        expectedRevision: 1,
        status: "cancelled",
        changedAt: "2026-11-04T00:00:00.001Z",
      },
      mutation(),
    );
    await repo.setDraftStatus(
      owner,
      draftThree,
      {
        expectedRevision: 1,
        status: "cancelled",
        changedAt: "2026-11-04T00:00:00.000Z",
      },
      mutation(),
    );
    await repo.recordEvent(
      owner,
      {
        id: "00000000-0000-4000-8000-000000000121",
        code: "asset_created",
        createdAt: "2026-09-04T23:59:59.999Z",
        entityId: assetOne,
      },
      mutation(),
    );
    await repo.recordEvent(
      owner,
      {
        id: "00000000-0000-4000-8000-000000000122",
        code: "asset_created",
        createdAt: "2026-09-05T00:00:00.000Z",
        entityId: assetTwo,
      },
      mutation(),
    );

    const retention = await repo.applyRetention(owner, clock, mutation());
    expect(retention.cleanupQueued).toBe(2);
    expect(retention.draftsDeleted).toBe(2);
    expect(retention.eventsDeleted).toBe(1);
    await expect(repo.getPrivateDraft(owner, draftOne)).resolves.toBeNull();
    expect(await repo.getPrivateDraft(owner, draftTwo)).toMatchObject({
      status: "cancelled",
      revision: 2,
    });
    await expect(repo.getPrivateDraft(owner, draftThree)).resolves.toBeNull();
    await expect(repo.getAssetBytes(owner, assetOne)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(repo.getAssetBytes(owner, assetThree)).resolves.toEqual(
      bytes(`PRIVATE-IMAGE-BYTES-${assetThree}`),
    );
    await expect(repo.getAssetBytes(owner, assetTwo)).resolves.toEqual(
      bytes(`PRIVATE-IMAGE-BYTES-${assetTwo}`),
    );
    await expect(repo.getAssetBytes(owner, assetFour)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(await repo.listStorageCleanup(owner)).toEqual([
      expect.objectContaining({ state: "queued", reason: "retention" }),
      expect.objectContaining({ state: "queued", reason: "retention" }),
    ]);
  });

  it("purges owner metadata and processes physical storage separately", async () => {
    const repo = repository();
    await repo.putAsset(owner, asset(assetOne), mutation());
    await repo.putAsset(owner, asset(assetTwo), mutation());
    await repo.saveMediaSource(owner, {
      id: mediaOne,
      threadId: thread,
      connectionId: connection,
      generation: 1,
      sourceKind: "official_instagram",
      sourceRef: "official-source",
      subject: "sample-subject",
      mediaId: "789",
      permalink: "https://www.instagram.com/p/789",
      rights: "allowed",
      visibility: "public",
      matchStatus: "matched",
      sampleOnly: false,
      observedAt: now,
      fetchedAt: now,
    }, mutation());
    await addDraft(repo, { id: draftOne });
    await expect(repo.getAssetBytes(owner, assetOne)).resolves.toBeDefined();

    const purge = await repo.purgeOwner(owner, mutation());
    expect(purge).toMatchObject({
      state: "pending_physical_cleanup",
      cleanupQueued: 2,
    });
    await expect(repo.getAssetBytes(owner, assetOne)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(await repo.listStorageCleanup(owner)).toMatchObject([
      { state: "queued", reason: "owner_purge" },
      { state: "queued", reason: "owner_purge" },
    ]);

    const cleanup = await repo.processStorageCleanup(owner, mutation());
    expect(cleanup).toEqual({ claimed: 2, completed: 2, failed: 0, exhausted: 0 });
    expect(await repo.listStorageCleanup(owner)).toEqual([
      expect.objectContaining({ state: "completed" }),
      expect.objectContaining({ state: "completed" }),
    ]);
  });

  it("claims cleanup atomically, respects retry availability, and completes after backoff", async () => {
    let clock = new Date(now);
    let removeCalls = 0;
    const repo = new MemoryGrowthRepository({
      owners: [{ owner, status: "active" }],
      connections: [],
      threads: [{ owner, id: thread }],
      now: () => clock,
      storageRemover: async () => {
        removeCalls += 1;
        if (removeCalls === 1) throw new Error("synthetic storage failure");
      },
    });
    await repo.putAsset(owner, asset(assetOne), mutation());
    await repo.purgeOwner(owner, mutation());

    expect(await repo.processStorageCleanup(owner, mutation())).toEqual({
      claimed: 1,
      completed: 0,
      failed: 1,
      exhausted: 0,
    });
    expect(await repo.listStorageCleanup(owner)).toMatchObject([
      {
        state: "queued",
        attempts: 1,
        lastError: "STORAGE_DELETE_FAILED",
      },
    ]);
    expect(await repo.processStorageCleanup(owner, mutation())).toEqual({
      claimed: 0,
      completed: 0,
      failed: 0,
      exhausted: 0,
    });

    clock = new Date(new Date(now).getTime() + 30_000);
    expect(await repo.processStorageCleanup(owner, mutation())).toEqual({
      claimed: 1,
      completed: 1,
      failed: 0,
      exhausted: 0,
    });
  });

  it("exhausts cleanup after the bounded retry count", async () => {
    let clock = new Date(now);
    const repo = new MemoryGrowthRepository({
      owners: [{ owner, status: "active" }],
      connections: [],
      threads: [{ owner, id: thread }],
      now: () => clock,
      storageRemover: async () => {
        throw new Error("synthetic storage failure");
      },
    });
    await repo.putAsset(owner, asset(assetOne), mutation());
    await repo.purgeOwner(owner, mutation());
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await repo.processStorageCleanup(owner, mutation());
      clock = new Date(clock.getTime() + 3_600_000);
    }
    expect(await repo.listStorageCleanup(owner)).toMatchObject([
      {
        state: "exhausted",
        attempts: 5,
        lastError: "STORAGE_DELETE_FAILED",
      },
    ]);
  });

  it("reclaims an expired processing cleanup lease", async () => {
    let clock = new Date(now);
    let releaseFirstRemoval: (() => void) | undefined;
    let removalCalls = 0;
    const repo = new MemoryGrowthRepository({
      owners: [{ owner, status: "active" }],
      connections: [],
      threads: [{ owner, id: thread }],
      now: () => clock,
      storageRemover: async () => {
        removalCalls += 1;
        if (removalCalls === 1) {
          await new Promise<void>((resolve) => {
            releaseFirstRemoval = resolve;
          });
        }
      },
    });
    await repo.putAsset(owner, asset(assetOne), mutation());
    await repo.purgeOwner(owner, mutation());

    const firstProcessing = repo.processStorageCleanup(owner, mutation());
    for (let attempt = 0; attempt < 20 && removalCalls === 0; attempt += 1) {
      await Promise.resolve();
    }
    expect(await repo.listStorageCleanup(owner)).toMatchObject([
      { state: "processing", attempts: 1 },
    ]);

    clock = new Date(new Date(now).getTime() + 61_000);
    let reclaimed;
    try {
      reclaimed = await repo.processStorageCleanup(owner, mutation());
    } finally {
      releaseFirstRemoval?.();
    }
    expect(reclaimed).toMatchObject({
      claimed: 1,
      completed: 1,
    });
    await firstProcessing;
    expect(removalCalls).toBe(2);
  });

  it("allows an owner purge from suspended state while ordinary data operations stay denied", async () => {
    const repo = new MemoryGrowthRepository({
      owners: [{ owner, status: "suspended" }],
      connections: [],
      threads: [{ owner, id: thread }],
      now: () => new Date(now),
    });
    await expect(repo.purgeOwner(owner, mutation())).resolves.toEqual({
      state: "pending_physical_cleanup",
      cleanupQueued: 0,
      metadataRowsDeleted: 0,
    });
    await expect(repo.putAsset(owner, asset(assetOne), mutation())).rejects.toMatchObject({
      code: "NOT_ACTIVE_CREATOR",
    });
  });

  it("returns a metadata export without bytes, object paths, tokens, or private credentials", async () => {
    const repo = repository();
    await repo.putAsset(owner, asset(assetOne), mutation());
    await addDraft(repo, { id: draftOne });
    await repo.recordEvent(
      owner,
      {
        id: "00000000-0000-4000-8000-000000000123",
        code: "draft_saved",
        createdAt: now,
        entityId: draftOne,
      },
      mutation(),
    );
    const exported = await repo.exportOwner(owner);
    const serialized = JSON.stringify(exported);
    expect(serialized).not.toContain("PRIVATE-IMAGE-BYTES");
    expect(serialized).not.toContain("storagePath");
    expect(serialized).not.toContain("credential");
    expect(exported.assets[0]).not.toHaveProperty("bytes");
    expect(exported.assets[0]).not.toHaveProperty("storagePath");
  });
});

describe("Supabase growth repository adapter", () => {
  it("uses one server idempotency context for retries and stable upload sub-operation IDs", async () => {
    const remoteAsset = {
      id: assetOne,
      threadId: thread,
      sha256: "a".repeat(64),
      mime: "image/png",
      byteSize: asset(assetOne).byteSize,
      width: 640,
      height: 640,
      rightsConfirmed: true,
      sourceKind: "creator-upload",
      sampleOnly: false,
      fixtureId: null,
      uploadState: "uploaded",
      createdAt: now,
      expiresAt: "2026-11-05T00:00:00.000Z",
      storagePath: `${workspace}/${creator}/${thread}/${assetOne}.png`,
    };
    const rpc = vi.fn(async (
      name: string,
      argumentsByName: Readonly<Record<string, unknown>>,
    ) => {
      void argumentsByName;
      if (name === "creator_growth_reserve_asset") {
        return { asset: { ...remoteAsset, uploadState: "pending" } };
      }
      return { asset: remoteAsset };
    });
    const repo = new SupabaseGrowthRepository({
      rpc: rpc as unknown as GrowthRpc,
      storage: {
        put: vi.fn(async () => undefined),
        read: vi.fn(async () => bytes("read")),
        remove: vi.fn(async () => undefined),
      },
      enabled: true,
      now: () => new Date(now),
    });
    const request = mutation();
    await repo.putAsset(owner, asset(assetOne), request);
    await repo.putAsset(owner, asset(assetOne), request);

    const requestIds = (name: string) =>
      rpc.mock.calls
        .filter(([calledName]) => calledName === name)
        .map(([, argumentsByName]) => argumentsByName.requestId as string);
    const reserveIds = requestIds("creator_growth_reserve_asset");
    const confirmIds = requestIds("creator_growth_confirm_asset");
    expect(reserveIds).toEqual([reserveIds[0], reserveIds[0]]);
    expect(confirmIds).toEqual([confirmIds[0], confirmIds[0]]);
    expect(reserveIds[0]).not.toBe(confirmIds[0]);
    expect(reserveIds[0]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(rpc).toHaveBeenCalledWith(
      "creator_growth_reserve_asset",
      expect.objectContaining({
        workspaceId: workspace,
        creatorId: creator,
      }),
    );
  });

  it("uses atomic cleanup claims and leases through the Supabase adapter", async () => {
    const cleanupId = "00000000-0000-4000-8000-000000000131";
    const objectPath = `${workspace}/${creator}/${thread}/${assetOne}.png`;
    const rpc = vi.fn(async (name: string) => {
      if (name === "creator_growth_claim_cleanup") {
        return {
          items: [{
            id: cleanupId,
            bucket: "creator-growth-private",
            objectPath,
            reason: "owner_purge",
            state: "processing",
            availableAt: now,
            completedAt: null,
            attempts: 1,
            leaseExpiresAt: "2026-11-04T00:01:00.000Z",
            lastError: null,
          }],
        };
      }
      if (name === "creator_growth_finish_cleanup") {
        return { state: "completed", attempts: 1 };
      }
      return null;
    });
    const remove = vi.fn(async () => undefined);
    const repo = new SupabaseGrowthRepository({
      rpc: rpc as unknown as GrowthRpc,
      storage: {
        put: vi.fn(async () => undefined),
        read: vi.fn(async () => bytes("read")),
        remove,
      },
      enabled: true,
      now: () => new Date(now),
    });

    expect(await repo.processStorageCleanup(owner, mutation())).toEqual({
      claimed: 1,
      completed: 1,
      failed: 0,
      exhausted: 0,
    });
    expect(rpc).toHaveBeenCalledWith(
      "creator_growth_claim_cleanup",
      expect.objectContaining({
        workspaceId: workspace,
        creatorId: creator,
        limit: 25,
      }),
    );
    expect(rpc).toHaveBeenCalledWith(
      "creator_growth_finish_cleanup",
      expect.objectContaining({
        cleanupId,
        objectPath,
        outcome: "completed",
      }),
    );
    expect(remove).toHaveBeenCalledWith("creator-growth-private", objectPath);
  });

  it("rejects a storage path outside the current owner scope before upload", async () => {
    const rpc = vi.fn(async () => ({
      asset: {
        id: assetOne,
        threadId: thread,
        sha256: "a".repeat(64),
        mime: "image/png",
        byteSize: 10,
        width: 1,
        height: 1,
        rightsConfirmed: true,
        sourceKind: "creator-upload",
        sampleOnly: false,
        storagePath: `${otherWorkspace}/${otherCreator}/${thread}/${assetOne}.png`,
        uploadState: "pending",
        createdAt: now,
        expiresAt: "2026-11-05T00:00:00.000Z",
      },
    }));
    const storage = {
      put: vi.fn(async () => undefined),
      read: vi.fn(async () => bytes("read")),
      remove: vi.fn(async () => undefined),
    };
    const repo = new SupabaseGrowthRepository({
      rpc: rpc as unknown as GrowthRpc,
      storage,
      enabled: true,
      now: () => new Date(now),
    });

    await expect(repo.putAsset(owner, asset(assetOne), mutation())).rejects.toEqual(
      expect.objectContaining<Partial<GrowthRepositoryError>>({
        code: "INVALID_STORAGE_PATH",
      }),
    );
    expect(rpc).toHaveBeenCalledWith(
      "creator_growth_reserve_asset",
      expect.objectContaining({
        workspaceId: workspace,
        creatorId: creator,
      }),
    );
    expect(storage.put).not.toHaveBeenCalled();
  });

  it("passes server-derived owner IDs to every Supabase operation", async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === "creator_growth_get_draft") return null;
      return { ok: true };
    });
    const repo = new SupabaseGrowthRepository({
      rpc: rpc as unknown as GrowthRpc,
      storage: {
        put: vi.fn(async () => undefined),
        read: vi.fn(async () => bytes("read")),
        remove: vi.fn(async () => undefined),
      },
      enabled: true,
    });
    await repo.getPrivateDraft(crossWorkspace, draftOne);
    expect(rpc).toHaveBeenCalledWith(
      "creator_growth_get_draft",
      expect.objectContaining({
        workspaceId: otherWorkspace,
        creatorId: otherCreator,
        draftId: draftOne,
      }),
    );
  });

  it("keeps Supabase persistence disabled unless the server flag is explicitly enabled", async () => {
    expect(creatorGrowthPersistenceEnabled({})).toBe(false);
    expect(
      creatorGrowthPersistenceEnabled({
        CREATOR_GROWTH_PERSISTENCE_ENABLED: "true",
      }),
    ).toBe(true);
    const rpc = vi.fn();
    const repo = new SupabaseGrowthRepository({
      rpc: rpc as unknown as GrowthRpc,
      storage: {
        put: vi.fn(async () => undefined),
        read: vi.fn(async () => bytes("read")),
        remove: vi.fn(async () => undefined),
      },
    });
    await expect(repo.getPrivateDraft(owner, draftOne)).rejects.toMatchObject({
      code: "PERSISTENCE_DISABLED",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("waits for a pending-upload cleanup grace period before touching storage", async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === "creator_growth_claim_cleanup") {
        return { items: [] };
      }
      return null;
    });
    const remove = vi.fn(async () => undefined);
    const repo = new SupabaseGrowthRepository({
      rpc: rpc as unknown as GrowthRpc,
      storage: {
        put: vi.fn(async () => undefined),
        read: vi.fn(async () => bytes("read")),
        remove,
      },
      enabled: true,
      now: () => new Date(now),
    });
    expect(await repo.processStorageCleanup(owner, mutation())).toEqual({
      claimed: 0,
      completed: 0,
      failed: 0,
      exhausted: 0,
    });
    expect(remove).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith(
      "creator_growth_claim_cleanup",
      expect.objectContaining({
        claimedAt: now,
        leaseSeconds: 60,
      }),
    );
  });

  it("marks an out-of-owner cleanup path failed without removing storage", async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === "creator_growth_claim_cleanup") {
        return {
          items: [{
            id: "00000000-0000-4000-8000-000000000132",
            bucket: "creator-growth-private",
            objectPath: `${otherWorkspace}/${otherCreator}/${thread}/${assetOne}.png`,
            reason: "owner_purge",
            state: "queued",
            availableAt: now,
            completedAt: null,
            attempts: 1,
            leaseToken: "00000000-0000-4000-8000-000000000141",
            leaseExpiresAt: "2026-11-04T00:01:00.000Z",
            lastError: null,
          }],
        };
      }
      throw new Error("NOT_FOUND");
    });
    const remove = vi.fn(async () => undefined);
    const repo = new SupabaseGrowthRepository({
      rpc: rpc as unknown as GrowthRpc,
      storage: {
        put: vi.fn(async () => undefined),
        read: vi.fn(async () => bytes("read")),
        remove,
      },
      enabled: true,
      now: () => new Date(now),
    });
    expect(await repo.processStorageCleanup(owner, mutation())).toEqual({
      claimed: 1,
      completed: 0,
      failed: 1,
      exhausted: 0,
    });
    expect(remove).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith(
      "creator_growth_finish_cleanup",
      expect.objectContaining({ outcome: "failed" }),
    );
  });
});


describe("durable route command state", () => {
  it("reserves a full caller hash and retains the first preparation across time", async () => {
    let clock = new Date(now).getTime();
    const repo = new MemoryGrowthRepository({
      owners: [{ owner, status: "active" }],
      threads: [{ owner, id: thread }],
      connections: [{ owner, id: connection, generation: 1, status: "connected" }],
      now: () => new Date(clock),
    });
    const input = {
      operation: "media/select" as const,
      threadId: thread,
      requestHash: "a".repeat(64),
      assetId: null,
      analysisId: null,
      mediaSourceIds: [],
      connectionId: connection,
      generation: 1,
    };
    const context = mutation();
    const first = await repo.routeCommand(owner, input, context);
    clock += 1000;
    expect(await repo.routeCommand(owner, input, context)).toEqual(first);
    const plan = {
      operation: "media/select" as const,
      official: mediaSource(),
      publicImage: {
        ...mediaSource(),
        id: mediaTwo,
        sourceKind: "public_image_mock" as const,
      },
      reason: "exact_media_id",
    };
    const prepared = await repo.routeCommand(owner, input, context, plan);
    expect(prepared.plan).toEqual(plan);
    expect(
      await repo.routeCommand(owner, input, context, { ...plan, reason: "changed" }),
    ).toEqual(prepared);
    await expect(
      repo.routeCommand(owner, { ...input, requestHash: "b".repeat(64) }, context),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await repo.handleCanonicalIntegrationRevocation(owner, {
      connectionId: connection,
      generation: 1,
      revokedAt: now,
    });
    await expect(repo.routeCommand(owner, input, context)).rejects.toMatchObject({
      code: "SOURCE_INVALIDATED",
    });
  });
});
