import type { Me, MissionMatch, MyMission, OnboardingStatus, SocialAccount } from "./queries/kocmax";
import { deriveNextAction, type ActiveMissionNextAction, type ActiveMissionWorkspace } from "./activeMission";
import { creatorRewardExperience } from "./rewardHandoff";

export type ActivationMilestoneId =
  | "account_created"
  | "onboarding_completed"
  | "interests_selected"
  | "social_added"
  | "social_verified"
  | "payment_ready"
  | "first_mission_viewed"
  | "first_mission_joined";

export type ActivationMilestone = {
  id: ActivationMilestoneId;
  state: "complete" | "recommended" | "blocked" | "not_applicable";
  labelKey: string;
  benefitKey: string;
  action?: { to: string; labelKey: string };
  countsTowardReadiness: boolean;
  weight: number;
};

export type NextBestActionKind =
  | ActiveMissionNextAction["kind"]
  | "reward_pending"
  | "reward_reassessment"
  | "urgent_mission"
  | "review_feedback"
  | "publish_content"
  | "submit_proof"
  | "resume_onboarding"
  | "improve_profile"
  | "view_recommended_mission"
  | "set_preferences"
  | "review_growth";

export type NextBestAction = {
  kind: NextBestActionKind;
  titleKey: string;
  bodyKey: string;
  to: string;
  ctaKey: string;
  deadline?: string;
  rewardContext?: string;
  missionId?: string;
  missionType?: string;
  missionTitle?: string;
};

// Presentation only: the workspace and detail page share deriveNextAction.
const WORK_ACTION_LABELS: Record<ActiveMissionNextAction["kind"], string> = {
  wait_for_setup: "waitForSetup", wait_for_shipment: "waitForShipment", confirm_receipt: "confirmReceipt",
  draft: "draft", revise: "revise", await_review: "awaitReview", await_publication: "awaitPublication",
  publish_and_submit_proof: "awaitPublication", await_proof_review: "awaitReview",
  revise_publication_proof: "revise", proof_verified: "awaitPublication", contact_support: "contactSupport",
};

export function activeMissionNextBestAction(workspace: ActiveMissionWorkspace): NextBestAction {
  const reward = creatorRewardExperience(workspace.workflow.state, workspace.pendingReward)
    ?? (workspace.workflow.state === "reward_pending" ? "reward_pending" : null);
  const base = {
    missionId: workspace.mission.id, missionTitle: workspace.mission.title, missionType: workspace.mission.missionType,
    to: `/my/${encodeURIComponent(workspace.workflow.submissionId)}`,
  };
  if (reward) {
    return { ...base, kind: reward,
      titleKey: reward === "reward_reassessment" ? "app.activeMission.rewardPending.cancelledTitle" : "app.activeMission.workspace.state.rewardPending",
      bodyKey: "app.home.work.rewardNeutrality",
      ctaKey: `app.activeMission.workspace.action.${reward === "reward_reassessment" ? "rewardReassessment" : "rewardPending"}` };
  }
  const action = deriveNextAction(workspace);
  const label = WORK_ACTION_LABELS[action.kind];
  const verified = action.kind === "proof_verified";
  return { ...base, kind: action.kind,
    to: action.workItemId ? `${base.to}?item=${encodeURIComponent(action.workItemId)}` : base.to,
    titleKey: verified ? "app.home.work.proofVerifiedAction" : `app.activeMission.workspace.action.${label}`,
    bodyKey: verified ? "app.home.work.proofVerifiedBody" : `app.activeMission.workspace.responsible.${label}`,
    ctaKey: verified ? "app.home.work.proofVerifiedAction" : `app.activeMission.workspace.action.${label}`,
    deadline: action.deadline ?? undefined };
}

export type CreatorActivationInput = {
  me?: Me | null;
  onboarding?: OnboardingStatus | null;
  socialAccounts?: SocialAccount[];
  myMissions?: MyMission[];
  missionMatches?: MissionMatch[];
};

export type CreatorActivationSnapshot = {
  readinessPercent: number;
  completedReadinessWeight: number;
  totalReadinessWeight: 100;
  milestones: ActivationMilestone[];
  nextAction: NextBestAction;
  activeMissions: MyMission[];
  suitableMissions: MissionMatch[];
  activated: boolean;
};

const ACTIVE_MISSION_STATUSES = new Set<MyMission["status"]>(["joined", "submitted", "under_review"]);
const MISSION_JOINED_STATUSES = new Set<MyMission["status"]>(["joined", "submitted", "under_review", "approved", "rejected", "expired"]);

function weightedMilestone(
  id: ActivationMilestoneId,
  complete: boolean,
  labelKey: string,
  benefitKey: string,
  action: ActivationMilestone["action"],
  incompleteState: ActivationMilestone["state"] = "recommended",
): ActivationMilestone {
  return {
    id,
    state: complete ? "complete" : incompleteState,
    labelKey,
    benefitKey,
    action: complete ? undefined : action,
    countsTowardReadiness: true,
    weight: 20,
  };
}

function nextAction(
  input: CreatorActivationInput,
  sortedMatches: MissionMatch[],
  onboardingComplete: boolean,
  socialVerified: boolean,
): NextBestAction {
  const joinedMission = input.myMissions?.find(({ status }) => status === "joined");
  if (joinedMission) {
    return {
      kind: "submit_proof",
      titleKey: "app.activation.next.submitProof.title",
      bodyKey: "app.activation.next.submitProof.body",
      to: joinedMission.creator_workflow_mode === "active_workspace"
        || joinedMission.missions.creator_workflow_mode === "active_workspace"
        ? `/my/${joinedMission.id}` : `/mission/${joinedMission.missions.slug}`,
      ctaKey: "app.activation.next.submitProof.cta",
      missionType: joinedMission.missions.mission_type,
    };
  }

  if (!onboardingComplete) {
    return {
      kind: "resume_onboarding",
      titleKey: "app.activation.next.resumeOnboarding.title",
      bodyKey: "app.activation.next.resumeOnboarding.body",
      to: "/onboarding",
      ctaKey: "app.activation.next.resumeOnboarding.cta",
    };
  }

  if (!socialVerified && sortedMatches.some(({ locked }) => locked)) {
    return {
      kind: "improve_profile",
      titleKey: "app.activation.next.improveProfile.title",
      bodyKey: "app.activation.next.improveProfile.body",
      to: "/profile",
      ctaKey: "app.activation.next.improveProfile.cta",
    };
  }

  const recommendation = sortedMatches.find(({ locked }) => !locked);
  if (recommendation) {
    return {
      kind: "view_recommended_mission",
      titleKey: "app.activation.next.viewRecommendedMission.title",
      bodyKey: "app.activation.next.viewRecommendedMission.body",
      to: `/mission/${recommendation.slug}`,
      ctaKey: "app.activation.next.viewRecommendedMission.cta",
      deadline: recommendation.deadline ?? undefined,
      missionId: recommendation.id,
      missionType: recommendation.mission_type,
    };
  }

  if (!input.me?.categories?.length) {
    return {
      kind: "set_preferences",
      titleKey: "app.activation.next.setPreferences.title",
      bodyKey: "app.activation.next.setPreferences.body",
      to: "/profile",
      ctaKey: "app.activation.next.setPreferences.cta",
    };
  }

  return {
    kind: "review_growth",
    titleKey: "app.activation.next.reviewGrowth.title",
    bodyKey: "app.activation.next.reviewGrowth.body",
    to: "/guide",
    ctaKey: "app.activation.next.reviewGrowth.cta",
  };
}

export function deriveCreatorActivation(input: CreatorActivationInput): CreatorActivationSnapshot {
  const accountCreated = Boolean(input.me);
  const onboardingComplete = Boolean(input.onboarding?.onboarding_completed || input.me?.onboarding_completed);
  const interestsSelected = Boolean(input.me?.categories?.length);
  const socialAdded = Boolean(input.socialAccounts?.length || input.me?.social_handles?.length);
  const socialVerified = Boolean(input.socialAccounts?.some(({ owner_verified }) => owner_verified));
  const missionJoined = Boolean(input.myMissions?.some(({ status }) => MISSION_JOINED_STATUSES.has(status)));

  const milestones: ActivationMilestone[] = [
    weightedMilestone(
      "account_created",
      accountCreated,
      "app.activation.milestone.accountCreated.label",
      "app.activation.milestone.accountCreated.benefit",
      { to: "/login", labelKey: "app.activation.action.createAccount" },
    ),
    weightedMilestone(
      "onboarding_completed",
      onboardingComplete,
      "app.activation.milestone.onboardingCompleted.label",
      "app.activation.milestone.onboardingCompleted.benefit",
      { to: "/onboarding", labelKey: "app.activation.action.resumeOnboarding" },
      accountCreated ? "recommended" : "blocked",
    ),
    weightedMilestone(
      "interests_selected",
      interestsSelected,
      "app.activation.milestone.interestsSelected.label",
      "app.activation.milestone.interestsSelected.benefit",
      { to: "/profile", labelKey: "app.activation.action.setPreferences" },
      accountCreated ? "recommended" : "blocked",
    ),
    weightedMilestone(
      "social_added",
      socialAdded,
      "app.activation.milestone.socialAdded.label",
      "app.activation.milestone.socialAdded.benefit",
      { to: "/profile", labelKey: "app.activation.action.addSocial" },
    ),
    weightedMilestone(
      "social_verified",
      socialVerified,
      "app.activation.milestone.socialVerified.label",
      "app.activation.milestone.socialVerified.benefit",
      { to: "/profile", labelKey: "app.activation.action.verifySocial" },
      socialAdded ? "recommended" : "blocked",
    ),
    {
      id: "payment_ready",
      state: "not_applicable",
      labelKey: "app.activation.milestone.paymentReady.label",
      benefitKey: "app.activation.milestone.paymentReady.benefit",
      countsTowardReadiness: false,
      weight: 0,
    },
    {
      id: "first_mission_viewed",
      state: "not_applicable",
      labelKey: "app.activation.milestone.firstMissionViewed.label",
      benefitKey: "app.activation.milestone.firstMissionViewed.benefit",
      countsTowardReadiness: false,
      weight: 0,
    },
    {
      id: "first_mission_joined",
      state: missionJoined ? "complete" : "recommended",
      labelKey: "app.activation.milestone.firstMissionJoined.label",
      benefitKey: "app.activation.milestone.firstMissionJoined.benefit",
      action: missionJoined ? undefined : { to: "/match", labelKey: "app.activation.action.viewMissions" },
      countsTowardReadiness: false,
      weight: 0,
    },
  ];

  const completedReadinessWeight = milestones
    .filter(({ countsTowardReadiness, state }) => countsTowardReadiness && state === "complete")
    .reduce((total, { weight }) => total + weight, 0);
  const suitableMissions = [...(input.missionMatches ?? [])].sort(
    (left, right) => right.fit_score - left.fit_score || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
  );
  const activeMissions = (input.myMissions ?? []).filter(({ status }) => ACTIVE_MISSION_STATUSES.has(status));

  return {
    readinessPercent: completedReadinessWeight,
    completedReadinessWeight,
    totalReadinessWeight: 100,
    milestones,
    nextAction: nextAction(input, suitableMissions, onboardingComplete, socialVerified),
    activeMissions,
    suitableMissions,
    activated: onboardingComplete && missionJoined,
  };
}
