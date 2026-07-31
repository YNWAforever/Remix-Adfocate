import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import type { ActiveMissionWorkspace, MissionPublicationView } from "@/lib/activeMission";
import { ApiError } from "@/lib/api";
import { setActivationAnalyticsSink } from "@/lib/activationAnalytics";

const i18nMocks = vi.hoisted(() => ({ lang: "en" as "en" | "zh" }));

vi.mock("@/lib/i18n", async () => {
  const { dict } = await import("@/lib/i18n.dict");
  const t = (key: string, params?: Record<string, string | number>) =>
    (dict[i18nMocks.lang][key] ?? dict.en[key] ?? key)
      .replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? `{${name}}`));
  return {
    useI18n: () => ({ lang: i18nMocks.lang, localeReady: true, setLang: vi.fn(), t }),
  };
});

const mocks = vi.hoisted(() => ({
  params: { submissionId: "sub-1" },
  search: {} as { item?: string },
  query: { data: undefined as ActiveMissionWorkspace | undefined, isLoading: false, isError: false, error: null as Error | null, refetch: vi.fn() },
  save: { mutateAsync: vi.fn(), conflict: null, clearConflict: vi.fn() },
  receipt: { mutateAsync: vi.fn(), isPending: false },
  grant: { mutateAsync: vi.fn() },
  finalize: { mutateAsync: vi.fn() },
  submit: { mutateAsync: vi.fn() },
  upload: vi.fn(),
  publication: { data: undefined as MissionPublicationView | undefined, isLoading: false, isError: false, error: null as Error | null, refetch: vi.fn() },
  publications: {} as Record<string, { data: MissionPublicationView | undefined; isLoading: boolean; isError: boolean; error: Error | null; refetch: ReturnType<typeof vi.fn> }>,
  proofEvidence: { createGrant: { mutateAsync: vi.fn() }, finalize: { mutateAsync: vi.fn() } },
  proofSubmit: { mutateAsync: vi.fn(), isPending: false, conflict: null as null | { localProof: Record<string, unknown>; currentPublication: MissionPublicationView }, clearConflict: vi.fn() },
  proofUpload: vi.fn(),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({ to, children, ...props }: { to: string; children: React.ReactNode } & Record<string, unknown>) => <a href={to} {...props}>{children}</a>,
    useNavigate: () => vi.fn(({ search }: { search?: (current: typeof mocks.search) => typeof mocks.search }) => {
      if (search) mocks.search = search(mocks.search);
    }),
    useSearch: () => mocks.search,
  };
});

vi.mock("@/lib/queries/activeMission", () => ({
  useActiveMissionWorkspace: () => mocks.query,
  useSaveMissionDraft: () => mocks.save,
  useConfirmMissionReceipt: () => mocks.receipt,
  useCreateDraftAssetGrant: () => mocks.grant,
  useFinalizeDraftAsset: () => mocks.finalize,
  useSubmitMissionWorkItem: () => mocks.submit,
  useMissionPublication: (_submissionId: string, workItemId: string) => mocks.publications[workItemId] ?? mocks.publication,
  useProofEvidenceUpload: () => mocks.proofEvidence,
  useSubmitPublicationProof: () => mocks.proofSubmit,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { storage: { from: (bucket: string) => ({ uploadToSignedUrl: bucket === "mission-publication-proof-assets" ? mocks.proofUpload : mocks.upload }) } },
}));

import { Route } from "./_app.my.$submissionId";
vi.spyOn(Route, "useParams").mockImplementation(() => mocks.params as never);

function workspace(overrides: Partial<ActiveMissionWorkspace> = {}): ActiveMissionWorkspace {
  return {
    workflow: { id: "wf-1", submissionId: "sub-1", state: "drafting", acceptedAt: "2026-07-15T00:00:00Z", deadline: "2026-07-30T00:00:00Z", revision: 0, fulfillmentRequired: false, revisionLimit: 2, reviewSlaHours: 48, revisionResponseHours: 48, createdAt: "2026-07-15T00:00:00Z", updatedAt: "2026-07-15T00:00:00Z" },
    mission: { id: "mission-1", slug: "launch", title: "Launch mission", missionType: "ugc", brief: { description: null, deliverables: [], requirements: [], platforms: [], effort: null, targetAudience: null, dos: [], donts: [], keyMessages: [], referenceLinks: [] } },
    fulfillment: null,
    workItems: [
      { id: "item-1", title: "Instagram Reel", platform: "instagram", requirements: [{ id: "req-1", text: "Show the product", required: true }], required: true, position: 1, deadline: "2026-07-25T00:00:00Z", state: "drafting", draft: { id: "draft-1", caption: "Draft", externalUrl: null, checklist: { "req-1": true }, revision: 2, lastSavedAt: "2026-07-18T00:00:00Z" }, currentSubmittedVersionId: null, approvedVersionId: null, reviewStartedAt: null, reviewDueAt: null },
      { id: "item-2", title: "Story", platform: "instagram", requirements: [], required: false, position: 2, deadline: "2026-07-27T00:00:00Z", state: "drafting", draft: { id: "draft-2", caption: "", externalUrl: null, checklist: {}, revision: 0, lastSavedAt: "2026-07-18T00:00:00Z" }, currentSubmittedVersionId: null, approvedVersionId: null, reviewStartedAt: null, reviewDueAt: null },
    ],
    events: [],
    rewardContract: null,
    completionEligibility: { eligible: false, blockers: ["reward_contract_required"],
      requiredItemCount: 1, verifiedRequiredItemCount: 0 },
    pendingReward: null,
    nextAction: { kind: "draft", workItemId: "item-1", deadline: "2026-07-25T00:00:00Z", blockedReason: null },
    ...overrides,
  };
}


function publication(overrides: Partial<MissionPublicationView> = {}): MissionPublicationView {
  return {
    workItemId: "item-1",
    platform: "instagram",
    state: "approved_to_publish",
    revision: 4,
    approvedVersionId: "version-3",
    instructions: {
      publicationInstructions: "Publish the approved version.",
      requiredDisclosures: ["#Ad"],
      expectedAccount: "@creator",
      proofEvidencePolicy: {},
      publishDueAt: "2026-07-27T08:00:00.000Z",
      frozenAt: "2026-07-24T08:00:00.000Z",
    },
    attempts: [],
    currentAttempt: null,
    acceptedAttempt: null,
    ...overrides,
  };
}
function renderRoute() {
  const Component = Route.options.component as React.ComponentType;
  return render(<Component />);
}

describe("creator active mission workspace route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    i18nMocks.lang = "en";
    mocks.params = { submissionId: "sub-1" };
    mocks.search = {};
    Object.assign(mocks.query, { data: workspace(), isLoading: false, isError: false, error: null });
    mocks.save.mutateAsync.mockResolvedValue({ draft: workspace().workItems[0].draft });
    mocks.receipt.mutateAsync.mockResolvedValue({});
    mocks.grant.mutateAsync.mockResolvedValue({ asset: { id: "asset-1", storageObjectPath: "creator/wf-1/item-1/asset-1.png" }, token: "signed-token" });
    Object.assign(mocks.publication, { data: undefined, isLoading: false, isError: false, error: null });
    mocks.publications = {};
    mocks.proofEvidence.createGrant.mutateAsync.mockResolvedValue({
      asset: { id: "proof-asset-1", storageObjectPath: "creator/wf-1/item-1/proof-evidence/proof-asset-1.webp" },
      token: "proof-token",
    });
    mocks.proofUpload.mockResolvedValue({ data: { path: "creator/wf-1/item-1/proof-evidence/proof-asset-1.webp" }, error: null });
    mocks.proofEvidence.finalize.mutateAsync.mockResolvedValue({});
    mocks.proofSubmit.mutateAsync.mockResolvedValue({});
    mocks.proofSubmit.conflict = null;
    mocks.upload.mockResolvedValue({ data: { path: "creator/wf-1/item-1/asset-1.png" }, error: null });
    mocks.finalize.mutateAsync.mockResolvedValue({});
    mocks.submit.mutateAsync.mockResolvedValue({});
  });

  it("shows loading, authorization, recoverable error, and impossible empty states", () => {
    Object.assign(mocks.query, { data: undefined, isLoading: true, isError: false, error: null });
    const loading = renderRoute();
    expect(screen.getByRole("status", { name: /loading active mission/i })).toBeInTheDocument();
    loading.unmount();

    Object.assign(mocks.query, { isLoading: false, isError: true, error: new ApiError(404, "WORKFLOW_NOT_FOUND", "Not found") });
    const missing = renderRoute();
    expect(screen.getByRole("heading", { name: /mission not found/i })).toBeInTheDocument();
    missing.unmount();

    Object.assign(mocks.query, { isError: true, error: new ApiError(403, "NOT_AUTHORIZED", "Forbidden") });
    const forbidden = renderRoute();
    expect(screen.getByRole("heading", { name: /access denied/i })).toBeInTheDocument();
    forbidden.unmount();

    Object.assign(mocks.query, { isError: true, error: new ApiError(500, "UNKNOWN", "Temporary") });
    const retry = renderRoute();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(mocks.query.refetch).toHaveBeenCalledOnce();
    retry.unmount();

    Object.assign(mocks.query, { data: workspace({ workItems: [] }), isError: false, error: null });
    renderRoute();
    expect(screen.getByRole("alert")).toHaveTextContent(/no deliverables/i);
  });

  it("defaults to the next action item and retains a valid item query selection", () => {
    const first = renderRoute();
    expect(screen.getByRole("heading", { name: "Instagram Reel" })).toBeInTheDocument();
    first.unmount();
    mocks.search = { item: "item-2" };
    renderRoute();
    expect(screen.getByRole("heading", { name: "Story" })).toBeInTheDocument();
  });

  it("binds persisted assets, immutable versions, and latest required changes after reload", async () => {
    const rich = workspace();
    Object.assign(rich.workItems[0], {
      draftAssets: Array.from({ length: 5 }, (_, index) => ({
        id: `asset-${index + 1}`,
        versionId: null,
        originalFilename: `draft-${index + 1}.png`,
        mimeType: "image/png",
        sizeBytes: 100,
        checksum: `checksum-${index + 1}`,
        uploadState: "ready",
        signedUrl: `https://signed.test/draft-${index + 1}.png`,
      })),
      versions: [{
        id: "version-1",
        versionNumber: 1,
        caption: "Submitted caption",
        externalUrl: null,
        checklist: { "req-1": true },
        submittedAt: "2026-07-18T02:00:00.000Z",
        state: "revision_requested",
        decisionAt: "2026-07-18T04:00:00.000Z",
        assets: [],
      }],
      requiredChanges: [{
        id: "change-1",
        requirementId: "req-1",
        text: "Keep the product visible for three seconds",
        createdAt: "2026-07-18T04:00:00.000Z",
      }],
      reviewRounds: [],
      revisionDeadline: "2026-07-20T04:00:00.000Z",
    });
    Object.assign(mocks.query, { data: rich });
    renderRoute();
    expect(screen.getByText("Keep the product visible for three seconds")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Version 1" })).toBeInTheDocument();

    const extra = new File(["draft"], "sixth.png", { type: "image/png", lastModified: 2 });
    fireEvent.change(screen.getByLabelText("Upload draft files"), { target: { files: [extra] } });
    expect(await screen.findByRole("alert")).toHaveTextContent(/at most five assets/i);
    expect(mocks.grant.mutateAsync).not.toHaveBeenCalled();
  });

  it("wires receipt, autosave, signed upload finalize, and immutable submit", async () => {
    Object.assign(mocks.query, { data: workspace({ fulfillment: { id: "f-1", status: "shipped", shippedAt: "2026-07-18T00:00:00Z", receivedAt: null, operationalNote: null } }) });
    renderRoute();
    fireEvent.click(screen.getByRole("button", { name: "Confirm receipt" }));
    await waitFor(() => expect(mocks.receipt.mutateAsync).toHaveBeenCalledOnce());

    const file = new File(["draft"], "draft.png", { type: "image/png", lastModified: 1 });
    Object.defineProperty(file, "arrayBuffer", { value: async () => new TextEncoder().encode("draft").buffer });
    fireEvent.change(screen.getByLabelText("Upload draft files"), { target: { files: [file] } });
    await waitFor(() => expect(mocks.grant.mutateAsync).toHaveBeenCalledWith({ workItemId: "item-1", fileName: "draft.png", contentType: "image/png", sizeBytes: 5 }));
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledWith("creator/wf-1/item-1/asset-1.png", "signed-token", file, { contentType: "image/png", upsert: false }));
    await waitFor(() => expect(mocks.finalize.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ workItemId: "item-1", assetId: "asset-1", checksum: expect.any(String) })));

    fireEvent.click(screen.getByRole("button", { name: "Submit version" }));
    await waitFor(() => expect(mocks.save.mutateAsync).toHaveBeenCalled());
    await waitFor(() => expect(mocks.submit.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ workItemId: "item-1", expectedRevision: 2, idempotencyKey: expect.any(String) })));
  });

  it("focuses the failed-submit error summary", async () => {
    mocks.submit.mutateAsync.mockRejectedValue(new ApiError(409, "WRONG_STATE", "Wrong state"));
    renderRoute();
    fireEvent.click(screen.getByRole("button", { name: "Submit version" }));
    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveFocus());
  });

  it("states the publication boundary exactly", () => {
    const approved = workspace();
    approved.workflow.state = "approved_to_publish";
    approved.workItems[0].state = "approved_to_publish";
    approved.nextAction = { kind: "await_publication", workItemId: null, deadline: approved.workflow.deadline, blockedReason: "approval_is_not_completion" };
    Object.assign(mocks.query, { data: approved });
    renderRoute();
    expect(screen.getByText("Approved to publish — rewards are not issued yet")).toBeInTheDocument();
  });
});

  it("replaces draft editing with publication instructions and submits the guarded proof mutation", async () => {
    const approved = workspace();
    approved.workflow.state = "approved_to_publish";
    approved.workItems[0].state = "approved_to_publish";
    approved.workItems[0].approvedVersionId = "version-3";
    approved.nextAction = { kind: "publish_proof", workItemId: "item-1", deadline: approved.workflow.deadline, blockedReason: null };
    Object.assign(mocks.query, { data: approved });
    Object.assign(mocks.publication, { data: publication() });

    renderRoute();
    expect(screen.getByRole("heading", { name: "Publication instructions" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Submit version" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Primary public URL"), { target: { value: "https://www.instagram.com/p/final" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /I confirm this is the published content/ }));
    fireEvent.click(screen.getByRole("button", { name: "Publish and submit proof" }));

    await waitFor(() => expect(mocks.proofSubmit.mutateAsync).toHaveBeenCalledWith({
      workItemId: "item-1",
      expectedState: "approved_to_publish",
      expectedRevision: 4,
      idempotencyKey: expect.any(String),
      primaryUrl: "https://www.instagram.com/p/final",
      additionalUrls: [],
      evidenceAssetIds: [],
    }));
  });

  it("uploads and finalizes private proof evidence before making it selectable", async () => {
    const approved = workspace();
    approved.workflow.state = "approved_to_publish";
    approved.workItems[0].state = "approved_to_publish";
    approved.nextAction = { kind: "publish_proof", workItemId: "item-1", deadline: approved.workflow.deadline, blockedReason: null };
    Object.assign(mocks.query, { data: approved });
    Object.assign(mocks.publication, { data: publication({ instructions: { ...publication().instructions, proofEvidencePolicy: { required: true } } }) });
    renderRoute();

    const file = new File(["proof"], "proof.webp", { type: "image/webp" });
    Object.defineProperty(file, "arrayBuffer", { value: async () => new TextEncoder().encode("proof").buffer });
    fireEvent.change(screen.getByLabelText("Add evidence files"), { target: { files: [file] } });

    await waitFor(() => expect(mocks.proofEvidence.createGrant.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      workItemId: "item-1",
      expectedState: "approved_to_publish",
      expectedRevision: 4,
      idempotencyKey: expect.any(String),
      fileName: "proof.webp",
      contentType: "image/webp",
      sizeBytes: 5,
    })));
    await waitFor(() => expect(mocks.proofUpload).toHaveBeenCalledWith(
      "creator/wf-1/item-1/proof-evidence/proof-asset-1.webp",
      "proof-token",
      file,
      { contentType: "image/webp", upsert: false },
    ));
    await waitFor(() => expect(mocks.proofEvidence.finalize.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      workItemId: "item-1",
      assetId: "proof-asset-1",
      checksum: expect.any(String),
    })));
    expect(await screen.findByRole("checkbox", { name: "Use proof.webp as evidence" })).toBeEnabled();
  });

  it("shows operator ownership while waiting and the accepted reward-neutral state after verification", async () => {
    const submitted = workspace();
    submitted.workflow.state = "publication_in_progress";
    submitted.workItems[0].state = "proof_submitted";
    Object.assign(mocks.query, { data: submitted });
    Object.assign(mocks.publication, { data: publication({ state: "proof_submitted" }) });
    const waiting = renderRoute();
    expect(screen.getByText("Adfocate is reviewing your publication proof.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Publish and submit proof" })).not.toBeInTheDocument();
    waiting.unmount();

    const accepted = { id: "attempt-2", attemptNumber: 2, primaryUrl: "https://www.instagram.com/p/final", additionalUrls: [], submittedAt: "2026-07-27T08:00:00.000Z", submittedLate: false, metadataStatus: "available" as const, metadataSnapshot: {}, metadataErrorCategory: null, evidence: [], review: { id: "review-2", state: "verified" as const, decision: "verified" as const, reviewedAt: "2026-07-27T10:00:00.000Z", createdAt: "2026-07-27T08:00:00.000Z", creatorResponseDeadline: null }, corrections: [] };
    submitted.workItems[0].state = "proof_verified";
    Object.assign(mocks.publication, { data: publication({ state: "proof_verified", attempts: [accepted], currentAttempt: accepted, acceptedAttempt: accepted }) });
    renderRoute();
    const verified = screen.getByRole("heading", { name: "Proof verified" });
    expect(verified).toBeVisible();
    await waitFor(() => expect(verified).toHaveFocus());
    expect(screen.getByText("Your verified publication proof remains on record.")).toBeVisible();
  });
  it("localizes publication review and stale-recovery states for Traditional Chinese creators", () => {
    i18nMocks.lang = "zh";
    const submitted = workspace();
    submitted.workflow.state = "publication_in_progress";
    submitted.workItems[0].state = "proof_submitted";
    Object.assign(mocks.query, { data: submitted });
    const currentPublication = publication({ state: "proof_submitted", revision: 5 });
    Object.assign(mocks.publication, { data: currentPublication });
    mocks.proofSubmit.conflict = {
      localProof: {
        workItemId: "item-1",
        expectedState: "approved_to_publish",
        expectedRevision: 4,
        idempotencyKey: "old-key",
        primaryUrl: "https://www.instagram.com/p/local",
        additionalUrls: [],
        evidenceAssetIds: ["asset-1"],
      },
      currentPublication,
    };

    const localized = renderRoute();

    expect(screen.getByText("Adfocate 正在審核你的發佈證明。")).toBeVisible();
    expect(screen.getByRole("heading", { name: "發佈狀態已變更" })).toBeVisible();
    expect(screen.getByText("目前系統狀態")).toBeVisible();
    expect(screen.getByText("已保留的主要網址")).toBeVisible();
    expect(screen.getByText("你已確認的網址和證明檔案選擇已保留。")).toBeVisible();
    expect(screen.getByRole("button", { name: "關閉並查看目前狀態" })).toBeVisible();
    localized.unmount();
    i18nMocks.lang = "en";
  });
  it("requires explicit review of a stale proof while preserving the confirmed local submission for retry", async () => {
    const approved = workspace();
    approved.workflow.state = "approved_to_publish";
    approved.workItems[0].state = "approved_to_publish";
    Object.assign(mocks.query, { data: approved });
    const correctionAttempt = {
      id: "attempt-1", attemptNumber: 1, primaryUrl: "https://www.instagram.com/p/server",
      additionalUrls: [], submittedAt: "2026-07-27T08:00:00.000Z", submittedLate: false,
      metadataStatus: "available" as const, metadataSnapshot: {}, metadataErrorCategory: null,
      evidence: [],
      review: {
        id: "review-1", state: "correction_requested" as const, decision: "rejected" as const,
        reviewedAt: "2026-07-28T08:00:00.000Z", createdAt: "2026-07-28T07:00:00.000Z",
        creatorResponseDeadline: "2026-07-29T08:00:00.000Z",
      },
      corrections: [{ id: "fix-1", category: "disclosure" as const, text: "Add #Ad", position: 0 }],
    };
    const currentPublication = publication({
      state: "proof_correction_requested",
      revision: 5,
      attempts: [correctionAttempt],
      currentAttempt: correctionAttempt,
    });
    const localProof = {
      workItemId: "item-1",
      expectedState: "approved_to_publish",
      expectedRevision: 4,
      idempotencyKey: "old-key",
      primaryUrl: "https://www.instagram.com/p/local",
      additionalUrls: ["https://www.instagram.com/p/local-story"],
      evidenceAssetIds: ["asset-1"],
    };
    Object.assign(mocks.publication, { data: currentPublication });
    mocks.proofSubmit.conflict = { localProof, currentPublication };
    mocks.proofSubmit.mutateAsync.mockResolvedValue({
      attempt: {
        ...correctionAttempt,
        id: "attempt-2",
        attemptNumber: 2,
        primaryUrl: localProof.primaryUrl,
        additionalUrls: localProof.additionalUrls,
        submittedAt: "2026-07-28T09:00:00.000Z",
        review: null,
        corrections: [],
      },
    });

    renderRoute();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Your proof was not submitted because the publication changed.",
    );
    expect(screen.getByText("Publication proof needs correction")).toBeVisible();
    expect(screen.getByText(localProof.primaryUrl)).toBeVisible();
    expect(screen.getByText("Your confirmed URL and evidence selection are preserved.")).toBeVisible();
    expect(screen.getByText("Response deadline").nextElementSibling?.querySelector("time"))
      .toHaveAttribute("datetime", "2026-07-29T08:00:00.000Z");

    fireEvent.click(screen.getByRole("button", { name: "Retry preserved proof" }));
    await waitFor(() => expect(mocks.proofSubmit.mutateAsync).toHaveBeenCalledWith({
      ...localProof,
      expectedState: "proof_correction_requested",
      expectedRevision: 5,
      idempotencyKey: expect.any(String),
    }));
    fireEvent.click(screen.getByRole("button", { name: "Review and edit submission" }));
    expect(mocks.proofSubmit.clearConflict).toHaveBeenCalled();
  });

  it("keeps an operator-owned stale proof read-only without offering retry", () => {
    vi.clearAllMocks();
    const submitted = workspace();
    submitted.workflow.state = "publication_in_progress";
    submitted.workItems[0].state = "proof_submitted";
    Object.assign(mocks.query, { data: submitted });
    const currentPublication = publication({
      state: "proof_submitted",
      revision: 5,
    });
    const localProof = {
      workItemId: "item-1",
      expectedState: "approved_to_publish",
      expectedRevision: 4,
      idempotencyKey: "old-key",
      primaryUrl: "https://www.instagram.com/p/local",
      additionalUrls: [],
      evidenceAssetIds: ["asset-1"],
    };
    Object.assign(mocks.publication, { data: currentPublication });
    mocks.proofSubmit.conflict = { localProof, currentPublication };

    renderRoute();
    expect(screen.getByText("Adfocate is reviewing your publication proof.")).toBeVisible();
    expect(screen.getByText(localProof.primaryUrl)).toBeVisible();
    expect(screen.getByText("Your confirmed URL and evidence selection are preserved.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Retry preserved proof" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dismiss and view current state" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss and view current state" }));
    expect(mocks.proofSubmit.clearConflict).toHaveBeenCalled();
    expect(mocks.proofSubmit.mutateAsync).not.toHaveBeenCalled();
  });

  it("replaces proof controls with reward review while preserving immutable proof history", async () => {
    mocks.params = { submissionId: "sub/1?creator" };
    const accepted = {
      id: "attempt-reward", attemptNumber: 1,
      primaryUrl: "https://www.instagram.com/p/verified", additionalUrls: [],
      submittedAt: "2026-07-30T08:00:00.000Z", submittedLate: false,
      metadataStatus: "available" as const, metadataSnapshot: {}, metadataErrorCategory: null,
      evidence: [],
      review: {
        id: "review-reward", state: "verified" as const, decision: "verified" as const,
        reviewedAt: "2026-07-30T10:00:00.000Z", createdAt: "2026-07-30T09:00:00.000Z",
        creatorResponseDeadline: null,
      },
      corrections: [],
    };
    const rewardWorkspace = workspace({
      pendingReward: {
        id: null,
        status: "pending",
        reward: { pointsAmount: 500, cashAmount: 125, currency: "HKD", xpAmount: 0 },
        processingWindowDays: 7,
        targetAt: "2026-08-07T10:00:00.000Z",
        createdAt: "2026-07-31T15:00:00.000Z",
        cancelledAt: null,
        decisionState: { kind: "approved", decidedAt: "2026-07-31T15:00:00.000Z" },
      },
    });
    rewardWorkspace.workflow.state = "reward_pending";
    rewardWorkspace.workItems[0].state = "proof_verified";
    Object.assign(mocks.query, { data: rewardWorkspace });
    Object.assign(mocks.publication, {
      data: publication({ state: "proof_verified", attempts: [accepted], currentAttempt: accepted, acceptedAttempt: accepted }),
    });

    renderRoute();

    const heading = screen.getByRole("heading", { name: "Mission complete — reward under finance review" });
    expect(heading).toBeVisible();
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.getByRole("heading", { name: "Proof attempt 1" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Primary published URL" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Publish and submit proof" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save draft" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Contact support about this reward" })).toHaveAttribute(
      "href",
      "/contact?topic=reward-pending&submission=sub%2F1%3Fcreator",
    );
  });

  it("returns a cancelled handoff to proof verification with honest reassessment copy", () => {
    const reassessment = workspace({
      pendingReward: {
        id: null,
        status: "cancelled",
        reward: { pointsAmount: 500, cashAmount: 125, currency: "HKD", xpAmount: 0 },
        processingWindowDays: 7,
        targetAt: null,
        createdAt: "2026-07-31T16:00:00.000Z",
        cancelledAt: "2026-08-01T08:00:00.000Z",
        decisionState: { kind: "cancelled", decidedAt: "2026-08-01T08:00:00.000Z" },
      },
    });
    reassessment.workflow.state = "proof_verified";
    reassessment.workItems[0].state = "proof_verified";
    Object.assign(mocks.query, { data: reassessment });
    Object.assign(mocks.publication, { data: publication({ state: "proof_verified" }) });

    renderRoute();

    expect(screen.getByText("Proof verified", { selector: "span" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Proof verified — reward reassessment" })).toBeVisible();
    expect(screen.getByText("Your publication proof remains verified. Finance is reassessing the reward details.")).toBeVisible();
    expect(document.body).not.toHaveTextContent(/reversed funds/i);
    expect(screen.queryByRole("button", { name: "Publish and submit proof" })).not.toBeInTheDocument();
  });


  it("keeps valid reward selection and changes localized proof history plus immutable timeline across items", async () => {
    const attempt = (id: string, attemptNumber: number, url: string) => ({
      id, attemptNumber, primaryUrl: url, additionalUrls: [],
      submittedAt: "2026-07-30T08:00:00.000Z", submittedLate: false,
      metadataStatus: "available" as const, metadataSnapshot: {}, metadataErrorCategory: null,
      evidence: [], corrections: [],
      review: {
        id: `review-${id}`, state: "verified" as const, decision: "verified" as const,
        reviewedAt: "2026-07-30T10:00:00.000Z", createdAt: "2026-07-30T09:00:00.000Z",
        creatorResponseDeadline: null,
      },
    });
    const firstAttempt = attempt("attempt-first", 1, "https://www.instagram.com/p/first");
    const secondAttempt = attempt("attempt-second", 2, "https://www.instagram.com/p/second");
    const rewardWorkspace = workspace({
      pendingReward: {
        id: null, status: "pending",
        reward: { pointsAmount: 500, cashAmount: 0, currency: "HKD", xpAmount: 0 },
        processingWindowDays: 7, targetAt: null,
        createdAt: "2026-08-02T01:00:00.000Z", cancelledAt: null,
        decisionState: { kind: "approved", decidedAt: "2026-08-02T01:00:00.000Z" },
      },
    });
    rewardWorkspace.workflow.state = "reward_pending";
    rewardWorkspace.workItems[0] = {
      ...rewardWorkspace.workItems[0], state: "proof_verified",
      versions: [{
        id: "version-first", versionNumber: 1, caption: "First frozen draft", externalUrl: null,
        checklist: {}, contentChecksum: "first", submittedAt: "2026-07-28T08:00:00.000Z",
        state: "approved_to_publish", decisionAt: "2026-07-29T08:00:00.000Z", assets: [],
      }],
    };
    rewardWorkspace.workItems[1] = {
      ...rewardWorkspace.workItems[1], state: "proof_verified",
      versions: [{
        id: "version-second", versionNumber: 7, caption: "Second frozen draft", externalUrl: null,
        checklist: {}, contentChecksum: "second", submittedAt: "2026-07-29T08:00:00.000Z",
        state: "approved_to_publish", decisionAt: "2026-07-30T08:00:00.000Z", assets: [],
      }],
    };
    mocks.search = { item: "item-2" };
    Object.assign(mocks.query, { data: rewardWorkspace });
    mocks.publications = {
      "item-1": { ...mocks.publication, data: publication({ workItemId: "item-1", state: "proof_verified", attempts: [firstAttempt], currentAttempt: firstAttempt, acceptedAttempt: firstAttempt }) },
      "item-2": { ...mocks.publication, data: publication({ workItemId: "item-2", state: "proof_verified", attempts: [secondAttempt], currentAttempt: secondAttempt, acceptedAttempt: secondAttempt }) },
    };

    renderRoute();
    expect(screen.getByRole("button", { name: /Story/ })).toHaveAttribute("aria-current", "step");
    expect(screen.getByRole("heading", { name: "Proof attempt 2" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Version 7" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /Instagram Reel/ }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Proof attempt 1" })).toBeVisible());
    expect(screen.getByRole("heading", { name: "Version 1" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Publish and submit proof" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save draft" })).not.toBeInTheDocument();
  });

  it("uses one conservative reassessment state when decision cancellation arrives before status", () => {
    const mismatch = workspace({
      pendingReward: {
        id: null, status: "pending",
        reward: { pointsAmount: 500, cashAmount: 125, currency: "HKD", xpAmount: 10 },
        processingWindowDays: 7, targetAt: "2026-08-10T08:00:00.000Z",
        createdAt: "2026-08-02T02:00:00.000Z", cancelledAt: null,
        decisionState: { kind: "cancelled", decidedAt: "2026-08-02T03:00:00.000Z" },
      },
    });
    mismatch.workflow.state = "reward_pending";
    mismatch.workItems[0].state = "proof_verified";
    Object.assign(mocks.query, { data: mismatch });
    Object.assign(mocks.publication, { data: publication({ state: "proof_verified" }) });

    renderRoute();
    expect(screen.getByText("Proof verified", { selector: "span" })).toBeVisible();
    expect(screen.getByRole("button", { name: "View reward reassessment" })).toBeVisible();
    expect(screen.getByRole("heading", { name: /Proof verified.*reward reassessment/ })).toBeVisible();
    expect(screen.queryByText("Points")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Publish and submit proof" })).not.toBeInTheDocument();
  });
describe("creator publication proof analytics", () => {
  const analyticsEvents: Array<{ name: string; properties: Record<string, unknown> }> = [];
  let nowSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    i18nMocks.lang = "en";
    mocks.search = { item: "item-1" };
    const approved = workspace();
    approved.workflow.state = "approved_to_publish";
    approved.workItems[0].state = "approved_to_publish";
    approved.workItems[0].approvedVersionId = "version-3";
    Object.assign(mocks.query, { data: approved, isLoading: false, isError: false, error: null });
    Object.assign(mocks.publication, {
      data: publication({
        instructions: {
          ...publication().instructions,
          publishDueAt: "2026-07-28T06:00:00.000Z",
        },
      }),
      isLoading: false,
      isError: false,
      error: null,
    });
    mocks.publications = { "item-1": mocks.publication };
    mocks.proofSubmit.conflict = null;
    mocks.proofSubmit.mutateAsync.mockResolvedValue({});
    analyticsEvents.length = 0;
    setActivationAnalyticsSink((event) => {
      analyticsEvents.push(event as { name: string; properties: Record<string, unknown> });
    });
    nowSpy = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-07-27T12:00:00.000Z"));
  });

  afterEach(() => {
    setActivationAnalyticsSink(null);
    nowSpy.mockRestore();
  });

  it("emits instruction visibility once and waits for the first real form interaction before starting", () => {
    const Component = Route.options.component as React.ComponentType;
    const view = renderRoute();

    expect(analyticsEvents.map(({ name }) => name)).toEqual([
      "publication_instructions_viewed",
    ]);

    const primaryUrl = screen.getByLabelText("Primary public URL");
    fireEvent.focus(primaryUrl);
    fireEvent.focus(primaryUrl);
    fireEvent.change(primaryUrl, { target: { value: "https://www.instagram.com/p/private-post" } });
    view.rerender(<Component />);

    expect(analyticsEvents.map(({ name }) => name)).toEqual([
      "publication_instructions_viewed",
      "publication_proof_form_started",
    ]);
    expect(analyticsEvents[1]?.properties).toEqual({
      locale: "en",
      missionType: "ugc",
      platform: "instagram",
      state: "approved_to_publish",
      timingBucket: "within_24h",
      attemptNumber: 1,
    });
  });

  it("deduplicates StrictMode replay and rerenders while allowing new items and genuine remounts", () => {
    const Component = Route.options.component as React.ComponentType;
    const firstMount = render(<StrictMode><Component /></StrictMode>);

    expect(analyticsEvents.map(({ name }) => name)).toEqual([
      "publication_instructions_viewed",
    ]);
    fireEvent.focus(screen.getByLabelText("Primary public URL"));
    firstMount.rerender(<StrictMode><Component /></StrictMode>);
    expect(analyticsEvents.map(({ name }) => name)).toEqual([
      "publication_instructions_viewed",
      "publication_proof_form_started",
    ]);

    const secondItemWorkspace = workspace();
    secondItemWorkspace.workflow.state = "approved_to_publish";
    secondItemWorkspace.workItems[1] = {
      ...secondItemWorkspace.workItems[1],
      state: "approved_to_publish",
      approvedVersionId: "version-4",
    };
    mocks.search = { item: "item-2" };
    Object.assign(mocks.query, { data: secondItemWorkspace });
    Object.assign(mocks.publication, {
      data: publication({ workItemId: "item-2", approvedVersionId: "version-4" }),
    });
    firstMount.rerender(<StrictMode><Component /></StrictMode>);
    fireEvent.focus(screen.getByLabelText("Primary public URL"));

    expect(analyticsEvents.map(({ name }) => name)).toEqual([
      "publication_instructions_viewed",
      "publication_proof_form_started",
      "publication_instructions_viewed",
      "publication_proof_form_started",
    ]);

    firstMount.unmount();
    render(<StrictMode><Component /></StrictMode>);
    fireEvent.focus(screen.getByLabelText("Primary public URL"));
    expect(analyticsEvents.map(({ name }) => name)).toEqual([
      "publication_instructions_viewed",
      "publication_proof_form_started",
      "publication_instructions_viewed",
      "publication_proof_form_started",
      "publication_instructions_viewed",
      "publication_proof_form_started",
    ]);
  });
  it("emits initial submit and unavailable metadata only after the mutation succeeds without private payload values", async () => {
    mocks.proofSubmit.mutateAsync.mockResolvedValue({
      attempt: {
        id: "attempt-private",
        attemptNumber: 1,
        primaryUrl: "https://www.instagram.com/p/private-post",
        additionalUrls: [],
        submittedAt: "2026-07-27T12:01:00.000Z",
        submittedLate: false,
        metadataStatus: "unavailable",
        metadataSnapshot: {},
        metadataErrorCategory: "private-error",
        evidence: [],
        review: null,
        corrections: [],
      },
    });
    renderRoute();
    fireEvent.change(screen.getByLabelText("Primary public URL"), {
      target: { value: "https://www.instagram.com/p/private-post" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /I confirm this is the published content/ }));
    fireEvent.click(screen.getByRole("button", { name: "Publish and submit proof" }));

    await waitFor(() => expect(analyticsEvents.map(({ name }) => name)).toContain(
      "publication_proof_metadata_unavailable",
    ));
    expect(analyticsEvents.map(({ name }) => name)).toEqual([
      "publication_instructions_viewed",
      "publication_proof_form_started",
      "publication_proof_submitted",
      "publication_proof_metadata_unavailable",
    ]);
    expect(analyticsEvents[2]?.properties).toEqual(expect.objectContaining({
      state: "proof_submitted",
      attemptNumber: 1,
      urlCount: 1,
      evidenceCount: 0,
      lateness: "on_time",
      metadataStatus: "unavailable",
    }));
    const serialized = JSON.stringify(analyticsEvents);
    ["mission-1", "item-1", "wf-1", "sub-1", "private-post", "@creator",
      "Publish the approved version.", "attempt-private", "private-error"]
      .forEach((forbidden) => expect(serialized).not.toContain(forbidden));
  });

  it("does not emit submit outcomes when the proof mutation fails", async () => {
    mocks.proofSubmit.mutateAsync.mockRejectedValueOnce(new Error("request failed"));
    renderRoute();
    fireEvent.change(screen.getByLabelText("Primary public URL"), {
      target: { value: "https://www.instagram.com/p/private-post" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /I confirm this is the published content/ }));
    fireEvent.click(screen.getByRole("button", { name: "Publish and submit proof" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/submit proof/i);
    expect(analyticsEvents.map(({ name }) => name)).toEqual([
      "publication_instructions_viewed",
      "publication_proof_form_started",
    ]);
  });

  it("uses the canonical next attempt to distinguish correction resubmission", async () => {
    const priorAttempt = {
      id: "attempt-1", attemptNumber: 1, primaryUrl: "https://www.instagram.com/p/prior",
      additionalUrls: [], submittedAt: "2026-07-26T08:00:00.000Z", submittedLate: false,
      metadataStatus: "available" as const, metadataSnapshot: {}, metadataErrorCategory: null,
      evidence: [], review: null, corrections: [],
    };
    Object.assign(mocks.publication, {
      data: publication({
        state: "proof_correction_requested",
        attempts: [priorAttempt],
        currentAttempt: priorAttempt,
      }),
    });
    mocks.proofSubmit.mutateAsync.mockResolvedValue({
      attempt: { ...priorAttempt, id: "attempt-2", attemptNumber: 2 },
    });
    renderRoute();
    fireEvent.change(screen.getByLabelText("Primary public URL"), {
      target: { value: "https://www.instagram.com/p/corrected" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /I confirm this is the published content/ }));
    fireEvent.click(screen.getByRole("button", { name: "Publish and submit proof" }));

    await waitFor(() => expect(analyticsEvents.map(({ name }) => name)).toContain(
      "publication_proof_resubmitted",
    ));
    expect(analyticsEvents.find(({ name }) => name === "publication_proof_resubmitted")?.properties)
      .toEqual(expect.objectContaining({
        state: "proof_submitted",
        attemptNumber: 2,
      }));
    expect(analyticsEvents.map(({ name }) => name)).not.toContain("publication_proof_submitted");
  });

  it("emits the canonical resubmission outcome, unavailable metadata, and recovery after a stale retry succeeds", async () => {
    const currentPublication = publication({ state: "proof_correction_requested", revision: 5 });
    mocks.proofSubmit.conflict = {
      localProof: {
        workItemId: "item-1", expectedState: "approved_to_publish", expectedRevision: 4,
        idempotencyKey: "old-key", primaryUrl: "https://www.instagram.com/p/private-local",
        additionalUrls: [], evidenceAssetIds: [],
      },
      currentPublication,
    };
    mocks.proofSubmit.mutateAsync.mockResolvedValue({
      attempt: {
        id: "attempt-private-retry",
        attemptNumber: 2,
        primaryUrl: "https://www.instagram.com/p/private-local",
        additionalUrls: ["https://www.instagram.com/p/private-extra"],
        submittedAt: "2026-07-27T12:01:00.000Z",
        submittedLate: false,
        metadataStatus: "unavailable",
        metadataSnapshot: {},
        metadataErrorCategory: "private-network-detail",
        evidence: [{ id: "private-evidence" }],
        review: null,
        corrections: [],
      },
    });
    Object.assign(mocks.publication, { data: currentPublication });
    renderRoute();

    fireEvent.click(screen.getByRole("button", { name: "Retry preserved proof" }));
    await waitFor(() => expect(analyticsEvents.map(({ name }) => name)).toContain(
      "publication_proof_recovery_used",
    ));
    expect(analyticsEvents.map(({ name }) => name)).toEqual([
      "publication_instructions_viewed",
      "publication_proof_resubmitted",
      "publication_proof_metadata_unavailable",
      "publication_proof_recovery_used",
    ]);
    expect(analyticsEvents.find(({ name }) => name === "publication_proof_resubmitted")?.properties)
      .toEqual(expect.objectContaining({
        state: "proof_submitted",
        attemptNumber: 2,
        urlCount: 2,
        evidenceCount: 1,
        metadataStatus: "unavailable",
      }));
    expect(analyticsEvents.find(({ name }) => name === "publication_proof_recovery_used")?.properties)
      .toEqual({
        locale: "en",
        missionType: "ugc",
        platform: "instagram",
        state: "proof_correction_requested",
        attemptNumber: 2,
        recoveryCategory: "stale_conflict",
      });
    const serialized = JSON.stringify(analyticsEvents);
    ["private-local", "private-extra", "private-evidence", "private-network-detail"]
      .forEach((forbidden) => expect(serialized).not.toContain(forbidden));
  });
});
