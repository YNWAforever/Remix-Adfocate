import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActiveMissionSummary } from "./ActiveMissionSummary";
import { ActivationProgressCard } from "./ActivationProgressCard";
import { EarningsSummaryCard } from "./EarningsSummaryCard";
import { NextBestActionCard } from "./NextBestActionCard";
import type {
  ActivationMilestone,
  CreatorActivationSnapshot,
  NextBestAction,
} from "../lib/creatorActivation";
import { I18nProvider } from "../lib/i18n";
import { dict } from "../lib/i18n.dict";
import type { MyMission } from "../lib/queries/kocmax";

const nextAction: NextBestAction = {
  kind: "resume_onboarding",
  titleKey: "app.activation.next.resumeOnboarding.title",
  bodyKey: "app.activation.next.resumeOnboarding.body",
  to: "/onboarding",
  ctaKey: "app.activation.next.resumeOnboarding.cta",
};

const milestones: ActivationMilestone[] = [
  {
    id: "account_created",
    state: "complete",
    labelKey: "app.activation.milestone.accountCreated.label",
    benefitKey: "app.activation.milestone.accountCreated.benefit",
    countsTowardReadiness: true,
    weight: 20,
  },
  {
    id: "onboarding_completed",
    state: "recommended",
    labelKey: "app.activation.milestone.onboardingCompleted.label",
    benefitKey: "app.activation.milestone.onboardingCompleted.benefit",
    action: {
      to: "/onboarding",
      labelKey: "app.activation.action.resumeOnboarding",
    },
    countsTowardReadiness: true,
    weight: 20,
  },
  {
    id: "interests_selected",
    state: "blocked",
    labelKey: "app.activation.milestone.interestsSelected.label",
    benefitKey: "app.activation.milestone.interestsSelected.benefit",
    countsTowardReadiness: true,
    weight: 20,
  },
  {
    id: "payment_ready",
    state: "not_applicable",
    labelKey: "app.activation.milestone.paymentReady.label",
    benefitKey: "app.activation.milestone.paymentReady.benefit",
    countsTowardReadiness: false,
    weight: 0,
  },
];

const snapshot: CreatorActivationSnapshot = {
  readinessPercent: 20,
  completedReadinessWeight: 20,
  totalReadinessWeight: 100,
  milestones,
  nextAction,
  activeMissions: [],
  suitableMissions: [],
  activated: false,
};

function mission(status: MyMission["status"], title: string): MyMission {
  return {
    id: title.toLowerCase().replaceAll(" ", "-"),
    status,
    content_urls: [],
    points_awarded: 0,
    created_at: "2026-07-14T00:00:00.000Z",
    missions: {
      slug: title.toLowerCase().replaceAll(" ", "-"),
      title,
      points_reward: 500,
      mission_type: "social_post",
    },
  };
}

describe("NextBestActionCard", () => {
  it("renders one primary action and reports the complete action on click", () => {
    const onAction = vi.fn();
    render(
      <NextBestActionCard
        action={nextAction}
        locale="en"
        onAction={onAction}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Continue onboarding" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Continue the remaining onboarding steps."),
    ).toBeInTheDocument();
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "/onboarding");
    expect(links[0]).toHaveTextContent("Resume onboarding");

    links[0].addEventListener("click", (event) => event.preventDefault());
    fireEvent.click(links[0]);
    expect(onAction).toHaveBeenCalledOnce();
    expect(onAction).toHaveBeenCalledWith(nextAction);
  });

  it("omits deadline and reward context when the action has none", () => {
    render(<NextBestActionCard action={nextAction} locale="en" />);

    expect(screen.queryByText(/deadline/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/reward context/i)).not.toBeInTheDocument();
  });

  it("uses English dictionary terms for optional action context", () => {
    render(
      <NextBestActionCard
        action={{
          ...nextAction,
          deadline: "2026-08-01T00:00:00.000Z",
          rewardContext: "HK$500 mission compensation",
        }}
        locale="en"
      />,
    );

    const terms = screen.getAllByRole("term").map(({ textContent }) => textContent);
    expect(terms).toEqual([
      dict.en["app.activation.next.deadlineLabel"],
      dict.en["app.activation.next.rewardContextLabel"],
    ]);
  });

  it("uses Chinese dictionary terms without hard-coded English accessible labels", () => {
    render(
      <NextBestActionCard
        action={{
          ...nextAction,
          deadline: "2026-08-01T00:00:00.000Z",
          rewardContext: "港幣 500 元任務報酬",
        }}
        locale="zh"
      />,
    );

    const terms = screen.getAllByRole("term").map(({ textContent }) => textContent);
    expect(terms).toEqual([
      dict.zh["app.activation.next.deadlineLabel"],
      dict.zh["app.activation.next.rewardContextLabel"],
    ]);
    expect(terms).not.toContain("Deadline");
    expect(terms).not.toContain("Reward context");
  });
});

describe("ActivationProgressCard", () => {
  beforeEach(() => window.localStorage.setItem("lang", "en"));

  it("exposes milestone completion semantics and textual states", async () => {
    render(
      <I18nProvider>
        <ActivationProgressCard snapshot={snapshot} />
      </I18nProvider>,
    );

    const progress = screen.getByRole("progressbar");
    expect(progress).toHaveAttribute("aria-valuemin", "0");
    expect(progress).toHaveAttribute("aria-valuemax", "100");
    expect(progress).toHaveAttribute("aria-valuenow", "20");
    expect(
      await screen.findByText(
        "Setup milestone completion only. This is not a score for creator quality, reliability, or mission eligibility.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Complete")).toBeInTheDocument();
    expect(screen.getByText("Recommended")).toBeInTheDocument();
    expect(screen.getByText("Blocked")).toBeInTheDocument();
    expect(screen.getByText("Not available")).toBeInTheDocument();
    expect(screen.getByText("Account created")).toBeInTheDocument();
  });
});

describe("EarningsSummaryCard", () => {
  it("keeps available and pending wallet balances distinct in English", () => {
    render(
      <EarningsSummaryCard
        earnings={{ available: 1234.5, pending: 250 }}
        locale="en"
        isLoading={false}
        isError={false}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Earnings" })).toBeInTheDocument();
    expect(screen.getByText("Available to withdraw")).toBeInTheDocument();
    expect(screen.getByText("Pending review or release")).toBeInTheDocument();
    expect(screen.getByText("HK$1,234.50")).toBeInTheDocument();
    expect(screen.getByText("HK$250.00")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View wallet details" })).toHaveAttribute(
      "href",
      "/wallet",
    );
    expect(screen.queryByText(/projected/i)).not.toBeInTheDocument();
  });

  it("renders the same precise balance concepts in Traditional Chinese", () => {
    render(
      <EarningsSummaryCard
        earnings={{ available: 80, pending: 20 }}
        locale="zh"
        isLoading={false}
        isError={false}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "收入" })).toBeInTheDocument();
    expect(screen.getByText("可提取金額")).toBeInTheDocument();
    expect(screen.getByText("待審核或發放")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看錢包詳情" })).toBeInTheDocument();
  });

  it("shows a retryable error without substituting zero balances", () => {
    const onRetry = vi.fn();
    render(
      <EarningsSummaryCard
        locale="en"
        isLoading={false}
        isError
        onRetry={onRetry}
      />,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(
      "We could not load your wallet balances. No amount has been substituted.",
    );
    expect(within(alert).queryByText(/HK\$/)).not.toBeInTheDocument();
    expect(within(alert).queryByText(/0\.00/)).not.toBeInTheDocument();
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});

describe("ActiveMissionSummary", () => {
  beforeEach(() => window.localStorage.setItem("lang", "en"));

  it("shows joined and pending work while excluding terminal missions", async () => {
    render(
      <I18nProvider>
        <ActiveMissionSummary
          missions={[
            mission("joined", "Joined mission"),
            mission("submitted", "Submitted mission"),
            mission("under_review", "Review mission"),
            mission("approved", "Approved mission"),
            mission("rejected", "Rejected mission"),
            mission("expired", "Expired mission"),
          ]}
          isLoading={false}
          isError={false}
          onRetry={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(
      await screen.findByRole("heading", { name: "Active missions" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Joined mission")).toBeInTheDocument();
    expect(screen.getByText("Submitted mission")).toBeInTheDocument();
    expect(screen.getByText("Review mission")).toBeInTheDocument();
    expect(screen.queryByText("Approved mission")).not.toBeInTheDocument();
    expect(screen.queryByText("Rejected mission")).not.toBeInTheDocument();
    expect(screen.queryByText("Expired mission")).not.toBeInTheDocument();
    expect(screen.getByText("Joined")).toBeInTheDocument();
    expect(screen.getByText("Proof submitted")).toBeInTheDocument();
    expect(screen.getByText("Under review")).toBeInTheDocument();
  });

  it("renders nothing for a successful list without active work", () => {
    const { container } = render(
      <ActiveMissionSummary
        missions={[mission("approved", "Completed mission")]}
        isLoading={false}
        isError={false}
        onRetry={vi.fn()}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
