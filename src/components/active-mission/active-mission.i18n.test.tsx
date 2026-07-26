import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CheckCircle2, XCircle } from "lucide-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActiveMissionNextAction, ActiveMissionWorkspace, MissionWorkItemView } from "@/lib/activeMission";
import type { ActiveMissionWorkflow } from "@/lib/admin";
import { I18nProvider } from "@/lib/i18n";
import { dict, type Locale } from "@/lib/i18n.dict";
import {
  renderNotification,
  type NotificationRow,
  type NotificationType,
} from "@/lib/notifications";
import { ActiveMissionQueue } from "@/components/admin/ActiveMissionQueue";
import { ActiveMissionReview } from "@/components/admin/ActiveMissionReview";
import { DeliverableNavigator } from "./DeliverableNavigator";
import { DraftEditor } from "./DraftEditor";
import { FulfillmentCard } from "./FulfillmentCard";
import { ReviewFeedback } from "./ReviewFeedback";
import { VersionTimeline } from "./VersionTimeline";
import { WorkspaceHeader } from "./WorkspaceHeader";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const original = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...original,
    Link: ({ children, className }: { children: React.ReactNode; className?: string }) => <a href="/" className={className}>{children}</a>,
  };
});
vi.mock("@/components/admin/AdminAuthContext", () => ({
  useAdminAuth: () => ({ authed: true, reportAuthError: vi.fn() }),
}));
vi.mock("@/components/admin/AdminWorkspaceContext", () => ({
  useAdminWorkspace: () => ({ workspace: "", setWorkspace: vi.fn() }),
}));

const item: MissionWorkItemView = {
  id: "item-1",
  title: "Instagram Reel",
  platform: "instagram",
  requirements: [{ id: "show-product", label: "Show product", required: true }],
  required: true,
  position: 0,
  deadline: "2099-07-22T09:30:00.000Z",
  state: "revision_requested",
  draft: {
    id: "draft-1", caption: "Draft", externalUrl: null,
    checklist: { "show-product": true }, revision: 3, lastSavedAt: "2026-07-18T09:00:00.000Z",
  },
  currentSubmittedVersionId: "version-1",
  approvedVersionId: null,
  reviewStartedAt: null,
  reviewDueAt: null,
};

const nextAction: ActiveMissionNextAction = {
  kind: "revise",
  workItemId: item.id,
  deadline: null,
  blockedReason: "feedback_requires_changes",
};

const workspace = {
  workflow: { state: "revision_requested" },
  mission: { title: "Summer launch" },
} as ActiveMissionWorkspace;

const operatorWorkflow: ActiveMissionWorkflow = {
  workflow: { id: "workflow-1", revision_limit: 2, revision_response_hours: 48, deadline: "2099-07-22T00:00:00.000Z" },
  submission: {
    creators: { id: "creator-1", display_name: "Amy Wong" },
    missions: { id: "mission-1", title: "Summer launch", description: null, key_messages: [], dos: [], donts: [] },
  },
  workItems: [{
    id: "item-1", title: "Instagram Reel", platform: "instagram", position: 0,
    state: "under_review", deadline: "2099-07-22T00:00:00.000Z", current_reviewer_id: "reviewer-1",
    current_submitted_version_id: "version-1", approved_version_id: null, requirements_snapshot: [],
  }],
  fulfillment: null,
  versions: [{
    id: "version-1", mission_work_item_id: "item-1", version_number: 1,
    caption_snapshot: "Ready", external_draft_url_snapshot: null, checklist_snapshot: {}, submitted_at: "2026-07-19T00:00:00.000Z",
  }],
  reviews: [], grants: [], events: [], assets: [],
};

async function renderLocale(ui: React.ReactNode, locale: Locale) {
  window.localStorage.setItem("lang", locale);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <QueryClientProvider client={client}>
      <I18nProvider>{ui}</I18nProvider>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(document.documentElement.lang).toBe(locale === "zh" ? "zh-Hant-HK" : "en"));
  return result;
}

function renderOutcomeNotification(
  type: NotificationType,
  locale: Locale,
) {
  const row: NotificationRow = {
    id: "notification-1",
    type,
    data: {
      mission_title: "Summer launch",
      mission_slug: "summer-launch",
      submission_id: "submission-1",
      deliverable_title: "Instagram Reel",
      deadline: "29 Jul",
      attempt_number: 2,
      reason_categories: ["content", "disclosure"],
    },
    entity_type: "mission_work_item",
    entity_id: "work-item-1",
    read_at: null,
    created_at: "2026-07-27T00:00:00.000Z",
  };
  const t = (key: string, params: Record<string, string | number> = {}) => {
    let value = (dict[locale] as Record<string, string>)[key] ?? key;
    for (const [param, replacement] of Object.entries(params)) {
      value = value.replaceAll(`{${param}}`, String(replacement));
    }
    return value;
  };
  return renderNotification(row, t);
}

describe("active mission bilingual UI", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => cleanup());

  it.each([
    ["en", "Active mission", "Product delivery", "Mission deliverables", "Revise draft"],
    ["zh", "主動任務", "產品送貨", "任務交付項目", "修改草稿"],
  ] as const)("renders converted creator overview components in %s", async (locale, header, delivery, nav, action) => {
    await renderLocale(
      <>
        <WorkspaceHeader workspace={workspace} nextAction={nextAction} onPrimaryAction={vi.fn()} />
        <FulfillmentCard
          fulfillment={{ id: "f-1", status: "shipped", shippedAt: "2026-07-18T03:00:00.000Z", receivedAt: null, operationalNote: null }}
          onConfirmReceipt={vi.fn()}
        />
        <DeliverableNavigator items={[item]} selectedId={item.id} onSelect={vi.fn()} />
      </>,
      locale,
    );
    expect(screen.getByText(header)).toBeVisible();
    expect(screen.getByRole("heading", { name: delivery })).toBeVisible();
    expect(screen.getByRole("navigation", { name: nav })).toBeVisible();
    expect(screen.getByRole("button", { name: action })).toBeVisible();
  });

  it("renders editor, feedback, and timeline copy in zh-Hant-HK", async () => {
    const onUploadFile = vi.fn().mockRejectedValue(new Error("offline"));
    await renderLocale(
      <>
        <ReviewFeedback requirements={[]} changes={[{ id: "change-1", requirementId: null, text: "Tighten opening", createdAt: "2026-07-19T00:00:00.000Z" }]} />
        <VersionTimeline versions={[{ id: "v-1", versionNumber: 1, state: "approved_to_publish", submittedAt: "2026-07-19T00:00:00.000Z", decisionAt: null }]} events={[]} />
        <DraftEditor item={item} onSave={vi.fn()} onSubmit={vi.fn()} onUploadFile={onUploadFile} />
      </>,
      "zh",
    );
    expect.soft(screen.getByRole("heading", { name: "修改要求" })).toBeVisible();
    expect.soft(screen.getByRole("heading", { name: "版本記錄" })).toBeVisible();
    expect.soft(screen.getByRole("button", { name: "提交版本" })).toBeVisible();
    expect.soft(screen.getByText("已批准發佈 — 尚未發放獎賞")).toBeVisible();
    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(fileInput).not.toBeNull();
    fireEvent.change(fileInput!, { target: { files: [new File(["draft"], "draft.png", { type: "image/png" })] } });
    const retry = await screen.findByRole("button", { name: "重試 draft.png" });
    expect(retry).toHaveTextContent("重試");
  });

  it("renders operator queue and review copy in zh-Hant-HK", async () => {
    await renderLocale(
      <>
        <ActiveMissionQueue items={[]} />
        <ActiveMissionReview
          workflow={operatorWorkflow}
          onStartReview={vi.fn()}
          onRequestRevision={vi.fn()}
          onGrantRevision={vi.fn()}
          onApproveVersion={vi.fn()}
          onMarkShipped={vi.fn()}
        />
      </>,
      "zh",
    );
    expect.soft(screen.getByRole("heading", { name: "主動任務審批" })).toBeVisible();
    expect.soft(screen.getByRole("button", { name: "套用篩選" })).toBeVisible();
    expect.soft(screen.getByRole("heading", { name: "任務簡介及清單" })).toBeVisible();
    expect.soft(screen.getByRole("button", { name: "要求修改" })).toBeVisible();
  });

  it("renders creator and operator route states in zh-Hant-HK", async () => {
    const { WorkspaceProblem } = await import("@/routes/_app.my.$submissionId");
    const queueModule = await import("@/routes/admin.active-missions");
    const { AdminActiveMissionReviewView } = await import("@/routes/admin.active-missions.$workflowId");
    const QueueView = queueModule.Route.options.component as React.ComponentType;

    await renderLocale(
      <WorkspaceProblem title={dict.zh["app.activeMission.route.notFoundTitle"]} body={dict.zh["app.activeMission.route.notFoundBody"]} />,
      "zh",
    );
    expect(screen.getByRole("link", { name: "返回我的任務" })).toBeVisible();
    cleanup();

    await renderLocale(<QueueView />, "zh");
    expect(screen.getByText("請選擇工作區以開啟主動任務審批佇列。")).toBeVisible();
    cleanup();

    await renderLocale(<AdminActiveMissionReviewView workflowId="workflow-1" />, "zh");
    expect(screen.getByText("請選擇工作區以審批此主動任務。")).toBeVisible();
  });

  it("keeps the reward-neutral approval statement exact in both locales", () => {
    expect(dict.en["app.activeMission.route.approvedRewardNeutral"]).toBe("Approved to publish — rewards are not issued yet");
    expect(dict.zh["app.activeMission.route.approvedRewardNeutral"]).toBe("已批准發佈 — 尚未發放獎賞");
    expect(dict.en["app.activeMission.timeline.state.approvedToPublish"]).toBe("Approved to publish — rewards are not issued yet");
    expect(dict.zh["app.activeMission.timeline.state.approvedToPublish"]).toBe("已批准發佈 — 尚未發放獎賞");
  });
});
  it.each([
    [
      "en",
      "mission_publication_correction_requested",
      "Publication proof needs correction",
      "\"Instagram Reel\" publication proof (attempt 2) needs correction. Reason categories: content,disclosure.",
      XCircle,
    ],
    [
      "zh",
      "mission_publication_correction_requested",
      "發佈證明需要修正",
      "「Instagram Reel」的發佈證明（第 2 次提交）需要修正。原因類別：content,disclosure。",
      XCircle,
    ],
    [
      "en",
      "mission_publication_verified",
      "Publication proof verified",
      "\"Instagram Reel\" publication proof (attempt 2) has been verified.",
      CheckCircle2,
    ],
    [
      "zh",
      "mission_publication_verified",
      "發佈證明已核實",
      "「Instagram Reel」的發佈證明（第 2 次提交）已核實。",
      CheckCircle2,
    ],
  ] as const)(
    "renders the %s %s notification with bilingual copy, creator link, and icon",
    (locale, type, title, body, icon) => {
      const rendered = renderOutcomeNotification(type, locale);

      expect(rendered).toMatchObject({
        title,
        body,
        href: "/my/submission-1",
        icon,
      });
      expect(dict[locale][`app.notif.${type}.title`]).toBe(title);
      expect(dict[locale][`app.notif.${type}.body`]).toBeTruthy();
    },
  );
