import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ActiveMissionNextAction,
  ActiveMissionWorkspace,
  MissionWorkItemView,
} from "@/lib/activeMission";
import { DeliverableNavigator } from "./DeliverableNavigator";
import { DraftEditor } from "./DraftEditor";
import { FulfillmentCard } from "./FulfillmentCard";
import { ReviewFeedback } from "./ReviewFeedback";
import { VersionTimeline } from "./VersionTimeline";
import { WorkspaceHeader } from "./WorkspaceHeader";

vi.mock("@/lib/i18n", async () => {
  const { dict } = await import("@/lib/i18n.dict");
  const t = (key: string, params?: Record<string, string | number>) =>
    (dict.en[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? `{${name}}`));
  return {
    useI18n: () => ({ lang: "en", localeReady: true, setLang: vi.fn(), t }),
  };
});

const draftItem: MissionWorkItemView = {
  id: "item-1",
  title: "Instagram Reel",
  platform: "instagram",
  requirements: [
    { id: "show-product", label: "Show the product", required: true },
    { id: "mention-brand", label: "Mention Adfocate", required: false },
  ],
  required: true,
  position: 0,
  deadline: "2026-07-22T09:30:00.000Z",
  state: "revision_requested",
  draft: {
    id: "draft-1",
    caption: "Draft",
    externalUrl: "https://example.com/draft",
    checklist: { "show-product": false, "mention-brand": false },
    revision: 3,
    lastSavedAt: "2026-07-18T09:00:00.000Z",
  },
  currentSubmittedVersionId: "version-2",
  approvedVersionId: null,
  reviewStartedAt: null,
  reviewDueAt: null,
};

function workspace(nextAction: ActiveMissionNextAction): ActiveMissionWorkspace {
  return {
    workflow: {
      id: "workflow-1",
      submissionId: "sub-1",
      state: "revision_requested",
      acceptedAt: "2026-07-15T00:00:00.000Z",
      deadline: "2026-07-24T10:00:00.000Z",
      fulfillmentRequired: true,
      revisionLimit: 2,
      reviewSlaHours: 48,
      revisionResponseHours: 48,
      createdAt: "2026-07-15T00:00:00.000Z",
      updatedAt: "2026-07-18T00:00:00.000Z",
    },
    mission: {
      id: "mission-1",
      slug: "mission-one",
      title: "Summer launch",
      missionType: "ugc",
      brief: {
        description: null,
        deliverables: [],
        requirements: [],
        platforms: ["instagram"],
        effort: null,
        targetAudience: null,
        dos: [],
        donts: [],
        keyMessages: [],
        referenceLinks: [],
      },
    },
    fulfillment: {
      id: "fulfillment-1",
      status: "shipped",
      shippedAt: "2026-07-18T03:00:00.000Z",
      receivedAt: null,
      operationalNote: "Leave at reception",
    },
    workItems: [draftItem],
    events: [],
    nextAction,
  };
}

describe("WorkspaceHeader", () => {
  it("renders one action from nextAction with truthful ownership and blocking context", () => {
    const nextAction: ActiveMissionNextAction = {
      kind: "revise",
      workItemId: "item-1",
      deadline: "2026-07-22T09:30:00.000Z",
      blockedReason: "feedback_requires_changes",
    };
    const onPrimaryAction = vi.fn();
    render(<WorkspaceHeader workspace={workspace(nextAction)} nextAction={nextAction} onPrimaryAction={onPrimaryAction} />);

    expect(screen.getByRole("heading", { name: "Summer launch" })).toBeVisible();
    expect(screen.getByText("Revision requested")).toBeVisible();
    expect(screen.getByText(/You are responsible/)).toBeVisible();
    expect(screen.getByText(/Feedback requires changes/)).toBeVisible();
    expect(screen.getByText(/Jul/)).toBeVisible();
    const actions = screen.getAllByRole("button");
    expect(actions).toHaveLength(1);
    expect(actions[0]).toHaveAccessibleName("Revise draft");
    fireEvent.click(actions[0]);
    expect(onPrimaryAction).toHaveBeenCalledWith(nextAction);
  });
});

describe("FulfillmentCard", () => {
  it("offers receipt confirmation only after shipment and exposes operation errors", async () => {
    const onConfirmReceipt = vi.fn().mockRejectedValue(new Error("offline"));
    render(<FulfillmentCard fulfillment={workspace({ kind: "confirm_receipt", workItemId: "item-1", deadline: null, blockedReason: null }).fulfillment} onConfirmReceipt={onConfirmReceipt} />);

    expect(screen.getAllByText("Shipped")[0]).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Confirm receipt" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t confirm receipt. Try again.");
  });
});

describe("DeliverableNavigator", () => {
  it("announces text statuses and supports Arrow, Home, and End keyboard selection", () => {
    const items: MissionWorkItemView[] = [
      { ...draftItem, id: "item-1", title: "Reel", state: "drafting" },
      { ...draftItem, id: "item-2", title: "Story", state: "under_review", position: 1 },
      { ...draftItem, id: "item-3", title: "Post", state: "approved_to_publish", position: 2 },
    ];
    const onSelect = vi.fn();
    render(<DeliverableNavigator items={items} selectedId="item-1" onSelect={onSelect} />);

    const reel = screen.getByRole("button", { name: /Reel.*Drafting/ });
    expect(reel).toHaveAttribute("aria-current", "step");
    reel.focus();
    fireEvent.keyDown(reel, { key: "ArrowRight" });
    expect(onSelect).toHaveBeenLastCalledWith("item-2");
    fireEvent.keyDown(reel, { key: "End" });
    expect(onSelect).toHaveBeenLastCalledWith("item-3");
    fireEvent.keyDown(reel, { key: "Home" });
    expect(onSelect).toHaveBeenLastCalledWith("item-1");
  });
});

describe("DraftEditor", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("debounces autosave, announces state, and gates submit on required checks", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <DraftEditor
        item={draftItem}
        requiredChanges={[{ id: "change-1", requirementId: "show-product", text: "Keep the product visible for 3 seconds", createdAt: "2026-07-18T08:00:00.000Z" }]}
        onSave={onSave}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByRole("heading", { name: "Changes requested" })).toBeVisible();
    fireEvent.change(screen.getByLabelText("Caption or copy"), { target: { value: "Draft updated" } });
    expect(screen.getByRole("status")).toHaveTextContent("Saving…");
    await act(async () => vi.advanceTimersByTimeAsync(799));
    expect(onSave).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await Promise.resolve();
    });
    expect(onSave).toHaveBeenCalledWith({
      workItemId: "item-1",
      revision: 3,
      caption: "Draft updated",
      externalUrl: "https://example.com/draft",
      checklist: { "show-product": false, "mention-brand": false },
    });
    expect(screen.getByRole("status")).toHaveTextContent("Saved");

    const submit = screen.getByRole("button", { name: "Submit version" });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /Show the product/ }));
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await act(async () => Promise.resolve());
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      workItemId: "item-1",
      expectedRevision: 3,
    }));
  });

  it("preserves local input and announces a conflict when autosave fails stale", async () => {
    const stale = Object.assign(new Error("stale"), { code: "WORKFLOW_STALE" });
    const onSave = vi.fn().mockRejectedValue(stale);
    render(<DraftEditor item={draftItem} onSave={onSave} onSubmit={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Caption or copy"), { target: { value: "Keep this local edit" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole("status")).toHaveTextContent(/conflict/i);
    expect(screen.getByLabelText("Caption or copy")).toHaveValue("Keep this local edit");
  });

  it("rejects invalid files before upload and offers a per-file retry after upload failure", async () => {
    vi.useRealTimers();
    const onUploadFile = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(undefined);
    render(<DraftEditor item={draftItem} onSave={vi.fn()} onSubmit={vi.fn()} onUploadFile={onUploadFile} maxFileSizeBytes={10} acceptedMimeTypes={["video/mp4"]} />);
    const input = screen.getByLabelText("Upload draft files");

    fireEvent.change(input, { target: { files: [new File(["image"], "draft.png", { type: "image/png" })] } });
    expect(onUploadFile).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("draft.png must be an accepted file type");

    const video = new File(["video"], "draft.mp4", { type: "video/mp4" });
    fireEvent.change(input, { target: { files: [video] } });
    expect(await screen.findByText("Upload failed. Your file is still selected.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Retry draft.mp4" }));
    await waitFor(() => expect(onUploadFile).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Uploaded")).toBeVisible();
  });
  it("disables every editing action and does not autosave in non-editable states", async () => {
    const onSave = vi.fn();
    const onUploadFile = vi.fn();
    render(
      <DraftEditor
        item={{ ...draftItem, state: "under_review" }}
        onSave={onSave}
        onSubmit={vi.fn()}
        onUploadFile={onUploadFile}
      />,
    );

    expect(screen.getByLabelText("Caption or copy")).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /Show the product/ })).toBeDisabled();
    expect(screen.getByLabelText("Upload draft files")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Submit version" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Caption or copy"), { target: { value: "not editable" } });
    await act(async () => vi.advanceTimersByTimeAsync(800));
    expect(onSave).not.toHaveBeenCalled();
    expect(onUploadFile).not.toHaveBeenCalled();
  });
});

describe("ReviewFeedback", () => {
  it("places required changes beside the matching requirement", () => {
    render(
      <ReviewFeedback
        requirements={draftItem.requirements}
        changes={[
          { id: "change-1", requirementId: "show-product", text: "Show it longer", createdAt: "2026-07-18T08:00:00.000Z" },
          { id: "change-2", requirementId: "mention-brand", text: "Use the full name", createdAt: "2026-07-18T09:00:00.000Z" },
        ]}
      />,
    );
    const productRequirement = screen.getByText("Show the product").closest("li");
    expect(productRequirement).not.toBeNull();
    expect(within(productRequirement!).getByText("Show it longer")).toBeVisible();
    expect(within(productRequirement!).queryByText("Use the full name")).not.toBeInTheDocument();
  });
  it("uses unique aria-labelledby targets when reusable cards repeat", () => {
    const fulfillment = workspace({ kind: "confirm_receipt", workItemId: "item-1", deadline: null, blockedReason: null }).fulfillment;
    const change = { id: "change-1", requirementId: "show-product", text: "Show it longer", createdAt: "2026-07-18T08:00:00.000Z" };
    const { container } = render(
      <>
        <ReviewFeedback requirements={draftItem.requirements} changes={[change]} />
        <ReviewFeedback requirements={draftItem.requirements} changes={[change]} />
        <FulfillmentCard fulfillment={fulfillment} onConfirmReceipt={vi.fn()} />
        <FulfillmentCard fulfillment={fulfillment} onConfirmReceipt={vi.fn()} />
      </>,
    );

    const labelledRegions = Array.from(container.querySelectorAll<HTMLElement>("section[aria-labelledby]"));
    const labelledBy = labelledRegions.map((region) => region.getAttribute("aria-labelledby"));
    expect(labelledRegions).toHaveLength(4);
    expect(new Set(labelledBy).size).toBe(4);
    for (const id of labelledBy) {
      expect(id).not.toBeNull();
      expect(container.querySelector(`#${CSS.escape(id!)}`)).not.toBeNull();
    }
  });
});

describe("VersionTimeline", () => {
  it("renders versions and events newest-first with exact timestamps and truthful approval copy", () => {
    render(
      <VersionTimeline
        versions={[
          { id: "version-1", versionNumber: 1, state: "revision_requested", submittedAt: "2026-07-16T08:00:00.000Z", decisionAt: "2026-07-16T10:00:00.000Z" },
          { id: "version-2", versionNumber: 2, state: "approved_to_publish", submittedAt: "2026-07-18T08:00:00.000Z", decisionAt: "2026-07-18T10:00:00.000Z" },
        ]}
        events={[{
          id: "event-1", workItemId: "item-1", actorType: "operator", actorId: "operator-1",
          eventType: "review_started", entityType: "version", entityId: "version-2", metadata: {},
          createdAt: "2026-07-18T09:00:00.000Z",
        }]}
      />,
    );

    const entries = screen.getAllByRole("listitem");
    expect(entries[0]).toHaveTextContent("Version 2");
    expect(entries[1]).toHaveTextContent("Review started");
    expect(entries[2]).toHaveTextContent("Version 1");
    expect(screen.getByText("Approved to publish — rewards are not issued yet")).toBeVisible();
    expect(screen.queryByText(/completed|rewarded/i)).not.toBeInTheDocument();
    expect(screen.getAllByText("Decision time")[0].nextElementSibling).toHaveAttribute("datetime", "2026-07-18T10:00:00.000Z");
  });
});
