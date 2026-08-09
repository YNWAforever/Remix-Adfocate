import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ApiError } from "@/lib/api";

const hoisted = vi.hoisted(() => ({
  query: { data: undefined as unknown, isLoading: false, isError: false, error: null as Error | null, refetch: vi.fn() },
  draft: { isError: false, error: null as Error | null },
}));

vi.mock("@/lib/queries/creatorStudio", () => ({
  useSubmissionWorkspace: () => hoisted.query,
  useSaveCreatorDraft: () => hoisted.draft,
}));

import { Route } from "./_app.my.$submissionId";
vi.spyOn(Route, "useParams").mockReturnValue({ submissionId: "submission-1" } as never);

function makeWorkspace() {
  return {
    submission: { id: "submission-1", creatorId: "creator-1", workspaceId: "workspace-1", missionId: "mission-1", status: "joined" as const },
    brief: { missionId: "mission-1", title: "Launch mission", deliverables: ["Story", "Reel"], requirements: ["Disclosure"], platforms: ["instagram"] },
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
  hoisted.query.isLoading = false;
  hoisted.query.isError = false;
  hoisted.query.error = null;
  hoisted.query.refetch.mockReset();
  hoisted.draft.isError = false;
  hoisted.draft.error = null;
});

afterEach(() => {
  hoisted.query.data = undefined;
  hoisted.query.isLoading = false;
  hoisted.query.isError = false;
  hoisted.query.error = null;
  hoisted.query.refetch.mockReset();
  hoisted.draft.isError = false;
  hoisted.draft.error = null;
});

describe("Creator Studio submission route", () => {
  it("renders the mission, active ordered work item, and next action", () => {
    renderRoute();
    expect(screen.getByRole("heading", { name: "Launch mission" })).toBeInTheDocument();
    expect(screen.getByText("Story")).toBeInTheDocument();
    expect(screen.getByText("Finish Story")).toBeInTheDocument();
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
    expect(screen.getByLabelText("Creator Studio draft editor")).toBeInTheDocument();
    expect(screen.getByText("Review feedback is temporarily unavailable.")).toBeInTheDocument();
  });

  it("shows a draft validation error beside the active work item", () => {
    hoisted.draft.isError = true;
    hoisted.draft.error = new ApiError(422, "draft_invalid", "Draft is incomplete");
    renderRoute();
    expect(screen.getByText("Draft is incomplete")).toBeInTheDocument();
  });
});
