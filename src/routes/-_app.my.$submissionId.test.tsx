import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ApiError } from "@/lib/api";

const hoisted = vi.hoisted(() => ({
  params: { submissionId: "submission-1" },
  query: { data: undefined as unknown, isLoading: false, isError: false, error: null as Error | null, refetch: vi.fn() },
  save: { mutateAsync: vi.fn(), isPending: false, error: null as Error | null },
  grant: { mutateAsync: vi.fn(), isPending: false, error: null as Error | null },
  finalize: { mutateAsync: vi.fn(), isPending: false, error: null as Error | null },
  submit: { mutateAsync: vi.fn(), isPending: false, error: null as Error | null },
  upload: vi.fn(),
}));

vi.mock("@/lib/queries/creatorStudio", () => ({
  useSubmissionWorkspace: () => hoisted.query,
  useSaveCreatorDraft: () => hoisted.save,
  useCreateDraftAssetGrant: () => hoisted.grant,
  useFinalizeDraftAsset: () => hoisted.finalize,
  useSubmitWorkItem: () => hoisted.submit,
  uploadDraftAsset: hoisted.upload,
  creatorStudioKeys: { workspace: (submissionId: string) => ["creator-studio", "workspace", submissionId] },
}));

import { Route } from "./_app.my.$submissionId";
vi.spyOn(Route, "useParams").mockImplementation(() => hoisted.params as never);

function makeWorkspace() {
  return {
    submission: { id: "submission-1", creatorId: "creator-1", workspaceId: "workspace-1", missionId: "mission-1", status: "joined" as const, deadline: null },
    brief: { missionId: "mission-1", title: "Launch mission", description: null, deliverables: ["Story", "Reel"], requirements: ["Disclosure"], platforms: ["instagram"] },
    workflow: { id: "workflow-1", state: "drafting" as const, revision: 1 },
    workItems: [
      { id: "story", position: 1, title: "Story", instructions: "Create a story", requirements: { caption: true, externalUrl: false, checklist: [] }, requiresAsset: false, state: "drafting" as const, validation: { caption: true, externalUrl: true, checklist: true, assets: true }, draft: { caption: "Draft", externalUrl: null, checklist: {}, version: 1, updatedAt: "2026-08-09T00:00:00.000Z" }, assets: [], reviewFeedback: { status: "available" as const, value: [] } },
      { id: "reel", position: 2, title: "Reel", instructions: "Create a reel", requirements: { caption: false, externalUrl: true, checklist: ["Disclosure"] }, requiresAsset: true, state: "not_started" as const, validation: { caption: false, externalUrl: false, checklist: false, assets: false }, draft: null, assets: [], reviewFeedback: { status: "unavailable" as const, reason: "temporarily_unavailable" as const } },
    ],
    nextAction: { workItemId: "story", state: "drafting" as const, label: "Finish Story" },
  };
}

function renderRoute() {
  const Component = Route.options.component as React.ComponentType;
  return render(<Component />);
}

beforeEach(() => {
  hoisted.query.data = makeWorkspace();
  hoisted.params = { submissionId: "submission-1" };
  hoisted.query.isLoading = false;
  hoisted.query.isError = false;
  hoisted.query.error = null;
  hoisted.query.refetch.mockReset();
  hoisted.save.mutateAsync.mockReset();
  hoisted.save.isPending = false;
  hoisted.save.error = null;
  hoisted.grant.mutateAsync.mockReset();
  hoisted.grant.isPending = false;
  hoisted.grant.error = null;
  hoisted.finalize.mutateAsync.mockReset();
  hoisted.finalize.isPending = false;
  hoisted.finalize.error = null;
  hoisted.submit.mutateAsync.mockReset();
  hoisted.submit.isPending = false;
  hoisted.submit.error = null;
  hoisted.upload.mockReset();
});

afterEach(() => {
  hoisted.query.data = undefined;
  hoisted.params = { submissionId: "submission-1" };
  hoisted.query.isLoading = false;
  hoisted.query.isError = false;
  hoisted.query.error = null;
  hoisted.query.refetch.mockReset();
  hoisted.save.mutateAsync.mockReset();
  hoisted.save.isPending = false;
  hoisted.save.error = null;
  hoisted.grant.mutateAsync.mockReset();
  hoisted.grant.isPending = false;
  hoisted.grant.error = null;
  hoisted.finalize.mutateAsync.mockReset();
  hoisted.finalize.isPending = false;
  hoisted.finalize.error = null;
  hoisted.submit.mutateAsync.mockReset();
  hoisted.submit.isPending = false;
  hoisted.submit.error = null;
  hoisted.upload.mockReset();
});

describe("Creator Studio submission route", () => {
  it("renders the mission, active ordered work item, and next action", () => {
    renderRoute();
    expect(screen.getByRole("heading", { name: "Launch mission" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Deliverables" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Finish draft" })).toBeInTheDocument();
  });

  it("renders a loading skeleton while the workspace is loading", () => {
    hoisted.query.isLoading = true;
    hoisted.query.data = undefined;
    renderRoute();
    expect(screen.getByTestId("creator-studio-loading")).toBeInTheDocument();
  });

  it("renders a recoverable core workspace error", () => {
    hoisted.query.isError = true;
    hoisted.query.error = new Error("offline");
    renderRoute();
    screen.getByRole("button", { name: "Retry" }).click();
    expect(hoisted.query.refetch).toHaveBeenCalledTimes(1);
  });

  it("renders not found for an unavailable submission", () => {
    hoisted.query.isError = true;
    hoisted.query.error = new ApiError(404, "submission_not_found", "Not found");
    renderRoute();
    expect(screen.getByText("Creator Studio submission not found.")).toBeInTheDocument();
  });

  it("keeps the brief and editor visible when review enrichment is unavailable", () => {
    const workspace = hoisted.query.data as ReturnType<typeof makeWorkspace>;
    workspace.workItems[0].reviewFeedback = { status: "unavailable", reason: "temporarily_unavailable" };
    renderRoute();
    expect(screen.getByText("Launch mission")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Caption" })).toBeInTheDocument();
    expect(screen.getByText("Review feedback is temporarily unavailable.")).toBeInTheDocument();
  });

  it("shows a draft validation error beside the active work item", () => {
    hoisted.save.error = new ApiError(422, "draft_invalid", "Draft is incomplete");
    renderRoute();
    expect(screen.getByText("Draft is incomplete")).toBeInTheDocument();
  });

  it("clears previous submission draft context when the route submission changes", () => {
    const view = renderRoute();
    const nextWorkspace = makeWorkspace();
    nextWorkspace.submission.id = "submission-2";
    nextWorkspace.workItems[0].draft = { caption: "Second submission draft", externalUrl: null, checklist: {}, version: 1, updatedAt: "2026-08-09T02:00:00.000Z" };
    hoisted.params = { submissionId: "submission-2" };
    hoisted.query.data = nextWorkspace;
    const Component = Route.options.component as React.ComponentType;
    view.rerender(<Component />);
    expect(screen.getByRole("textbox", { name: "Caption" })).toHaveValue("Second submission draft");
  });
});
