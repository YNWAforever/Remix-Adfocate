import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ActiveMissionWorkspace } from "@/lib/activeMission";
import { ApiError } from "@/lib/api";

vi.mock("@/lib/i18n", async () => {
  const { dict } = await import("@/lib/i18n.dict");
  const t = (key: string, params?: Record<string, string | number>) =>
    (dict.en[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? `{${name}}`));
  return {
    useI18n: () => ({ lang: "en", localeReady: true, setLang: vi.fn(), t }),
  };
});

const mocks = vi.hoisted(() => ({
  search: {} as { item?: string },
  query: { data: undefined as ActiveMissionWorkspace | undefined, isLoading: false, isError: false, error: null as Error | null, refetch: vi.fn() },
  save: { mutateAsync: vi.fn(), conflict: null, clearConflict: vi.fn() },
  receipt: { mutateAsync: vi.fn(), isPending: false },
  grant: { mutateAsync: vi.fn() },
  finalize: { mutateAsync: vi.fn() },
  submit: { mutateAsync: vi.fn() },
  upload: vi.fn(),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({ to, children, ...props }: { to: string; children: React.ReactNode } & Record<string, unknown>) => <a href={to} {...props}>{children}</a>,
    useNavigate: () => vi.fn(),
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
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { storage: { from: () => ({ uploadToSignedUrl: mocks.upload }) } },
}));

import { Route } from "./_app.my.$submissionId";
vi.spyOn(Route, "useParams").mockReturnValue({ submissionId: "sub-1" } as never);

function workspace(overrides: Partial<ActiveMissionWorkspace> = {}): ActiveMissionWorkspace {
  return {
    workflow: { id: "wf-1", submissionId: "sub-1", state: "drafting", acceptedAt: "2026-07-15T00:00:00Z", deadline: "2026-07-30T00:00:00Z", fulfillmentRequired: false, revisionLimit: 2, reviewSlaHours: 48, revisionResponseHours: 48, createdAt: "2026-07-15T00:00:00Z", updatedAt: "2026-07-15T00:00:00Z" },
    mission: { id: "mission-1", slug: "launch", title: "Launch mission", missionType: "ugc", brief: { description: null, deliverables: [], requirements: [], platforms: [], effort: null, targetAudience: null, dos: [], donts: [], keyMessages: [], referenceLinks: [] } },
    fulfillment: null,
    workItems: [
      { id: "item-1", title: "Instagram Reel", platform: "instagram", requirements: [{ id: "req-1", text: "Show the product", required: true }], required: true, position: 1, deadline: "2026-07-25T00:00:00Z", state: "drafting", draft: { id: "draft-1", caption: "Draft", externalUrl: null, checklist: { "req-1": true }, revision: 2, lastSavedAt: "2026-07-18T00:00:00Z" }, currentSubmittedVersionId: null, approvedVersionId: null, reviewStartedAt: null, reviewDueAt: null },
      { id: "item-2", title: "Story", platform: "instagram", requirements: [], required: false, position: 2, deadline: "2026-07-27T00:00:00Z", state: "drafting", draft: { id: "draft-2", caption: "", externalUrl: null, checklist: {}, revision: 0, lastSavedAt: "2026-07-18T00:00:00Z" }, currentSubmittedVersionId: null, approvedVersionId: null, reviewStartedAt: null, reviewDueAt: null },
    ],
    events: [],
    nextAction: { kind: "draft", workItemId: "item-1", deadline: "2026-07-25T00:00:00Z", blockedReason: null },
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
    mocks.search = {};
    Object.assign(mocks.query, { data: workspace(), isLoading: false, isError: false, error: null });
    mocks.save.mutateAsync.mockResolvedValue({ draft: workspace().workItems[0].draft });
    mocks.receipt.mutateAsync.mockResolvedValue({});
    mocks.grant.mutateAsync.mockResolvedValue({ asset: { id: "asset-1", storageObjectPath: "creator/wf-1/item-1/asset-1.png" }, token: "signed-token" });
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
