import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ActiveMissionReview } from "@/components/admin/ActiveMissionReview";
import { MissionCompletionReview } from "@/components/admin/MissionCompletionReview";
import { PublicationProofReview } from "@/components/admin/PublicationProofReview";
import { useAdminAuth } from "@/components/admin/AdminAuthContext";
import { useAdminWorkspace } from "@/components/admin/AdminWorkspaceContext";
import {
  getDeviceCategory,
  trackActivationEvent,
  type RewardHandoffAnalyticsProperties,
} from "@/lib/activationAnalytics";
import type { WorkflowState } from "@/lib/activeMission";
import {
  AdminAuthError,
  type ActiveMissionWorkflow,
  AdminRequestError,
  approveActiveMissionVersion,
  fetchActiveMissionWorkflow,
  grantActiveMissionRevision,
  markActiveMissionShipped,
  requestActiveMissionRevision,
  setActiveMissionPublicationInstructions,
  setupActiveMissionPublicationInstructions,
  startActiveMissionReview,
} from "@/lib/admin";
import { useI18n } from "@/lib/i18n";
import {
  useApproveMissionCompletion,
  useBackfillRewardContract,
  useCancelRewardHandoff,
  useCompletionReview,
  useRefreshProofMetadata,
  useRequestProofCorrection,
  useStartProofReview,
  useVerifyProof,
} from "@/lib/queries/activeMission";

export const Route = createFileRoute("/admin/active-missions/$workflowId")({
  validateSearch: (search: Record<string, unknown>) => ({
    workItemId: typeof search.workItemId === "string" ? search.workItemId : undefined,
  }),
  component: AdminActiveMissionReviewRoute,
});

const PUBLICATION_STATES = new Set([
  "approved_to_publish",
  "proof_submitted",
  "proof_under_review",
  "proof_correction_requested",
  "proof_verified",
]);

type CompletionWorkflowState = Extract<WorkflowState, "proof_verified" | "reward_pending">;
const COMPLETION_STATES = new Set<CompletionWorkflowState>(["proof_verified", "reward_pending"]);

function idempotencyKey() {
  return globalThis.crypto.randomUUID();
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function revisionField(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function workflowStateField(value: unknown): CompletionWorkflowState | null {
  return typeof value === "string" && COMPLETION_STATES.has(value as CompletionWorkflowState)
    ? value as CompletionWorkflowState
    : null;
}

function missionIdFrom(workflow: ActiveMissionWorkflow): string | null {
  const mission = Array.isArray(workflow.submission.missions)
    ? workflow.submission.missions[0]
    : workflow.submission.missions;
  return stringField(mission?.id);
}

export function AdminActiveMissionReviewRoute() {
  const { workflowId } = Route.useParams();
  const { workItemId } = Route.useSearch();
  return <AdminActiveMissionReviewView workflowId={workflowId} workItemId={workItemId} />;
}

export function AdminActiveMissionReviewView({
  workflowId,
  workItemId,
}: {
  workflowId: string;
  workItemId?: string;
}) {
  const { authed, staff, reportAuthError } = useAdminAuth();
  const { workspaceSlug } = useAdminWorkspace();
  const queryClient = useQueryClient();
  const key = ["admin-active-mission", workspaceSlug, workflowId] as const;
  const { lang, t } = useI18n();
  const [selectedAttemptId, setSelectedAttemptId] = useState<string>();
  const workflowActionKeys = useRef(new Map<string, string>());
  const viewedCompletionsRef = useRef(new Set<string>());
  const startProofReview = useStartProofReview();
  const requestProofCorrection = useRequestProofCorrection();
  const verifyProof = useVerifyProof();
  const refreshProofMetadata = useRefreshProofMetadata();
  const approveCompletion = useApproveMissionCompletion();
  const backfillRewardContract = useBackfillRewardContract();
  const cancelRewardHandoff = useCancelRewardHandoff();
  const completionReview = useCompletionReview(workflowId, workspaceSlug ?? "");
  const detail = useQuery({
    queryKey: key,
    queryFn: () => fetchActiveMissionWorkflow(workflowId, workspaceSlug),
    enabled: authed && Boolean(workspaceSlug),
    retry: false,
  });

  useEffect(() => {
    if (detail.error instanceof AdminAuthError) reportAuthError(detail.error);
  }, [detail.error, reportAuthError]);

  useEffect(() => {
    if (completionReview.error instanceof AdminAuthError) reportAuthError(completionReview.error);
  }, [completionReview.error, reportAuthError]);

  const workflowState = workflowStateField(detail.data?.workflow.state);
  const workflowRevision = revisionField(detail.data?.workflow.revision);
  const submissionId = stringField(detail.data?.workflow.mission_submission_id)
    ?? stringField(detail.data?.workflow.submission_id)
    ?? stringField(detail.data?.submission.id);
  const missionId = detail.data ? missionIdFrom(detail.data) : null;
  const completionProjection = completionReview.data;
  const completionReady = Boolean(completionProjection);
  const contractSource = completionProjection?.rewardContract?.source ?? "missing";
  const reward = completionProjection?.rewardContract
    ?? completionProjection?.pendingReward?.reward
    ?? null;
  const hasPoints = (reward?.pointsAmount ?? 0) > 0;
  const hasCash = (reward?.cashAmount ?? 0) > 0;
  const hasXp = (reward?.xpAmount ?? 0) > 0;

  useEffect(() => {
    if (
      !completionReady
      || !workflowState
      || workflowRevision === null
      || !missionId
    ) return;
    const viewedKey = `${workflowId}:${workflowRevision}`;
    if (viewedCompletionsRef.current.has(viewedKey)) return;
    viewedCompletionsRef.current.add(viewedKey);
    trackActivationEvent("mission_completion_review_viewed", {
      missionId,
      locale: lang === "zh" ? "zh" : "en",
      deviceCategory: getDeviceCategory(),
      workflowState,
      contractSource,
      hasPoints,
      hasCash,
      hasXp,
    });
  }, [
    completionReady, contractSource, hasCash, hasPoints, hasXp, lang, missionId,
    workflowId, workflowRevision, workflowState,
  ]);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: key }),
      queryClient.invalidateQueries({ queryKey: ["admin-active-missions", workspaceSlug] }),
    ]);
  };

  const runWorkflowAction = async <T,>(
    action: string,
    input: unknown,
    operation: (key: string) => Promise<T>,
  ): Promise<T> => {
    const signature = `${action}:${JSON.stringify(input)}`;
    const existingKey = workflowActionKeys.current.get(signature);
    const key = existingKey ?? idempotencyKey();
    workflowActionKeys.current.set(signature, key);
    try {
      const result = await operation(key);
      workflowActionKeys.current.delete(signature);
      return result;
    } catch (error) {
      if (
        error instanceof AdminRequestError
        && (error.code === "WORKFLOW_STALE" || error.code === "WRONG_STATE")
      ) {
        workflowActionKeys.current.delete(signature);
      }
      throw error;
    }
  };

  const runCompletionAction = async <T,>(operation: () => Promise<T>): Promise<T> => {
    const result = await operation();
    await Promise.allSettled([
      refresh(),
      detail.refetch(),
      completionReview.refetch(),
    ]);
    return result;
  };

  if (!workspaceSlug) return <p className="text-sm text-[var(--color-soft-ink)]">{t("app.admin.activeMission.route.selectReview")}</p>;
  if (detail.isLoading) return <p className="text-sm">{t("app.admin.activeMission.route.loadingWorkflow")}</p>;
  if (detail.isError || !detail.data) return <p role="alert" className="text-sm font-bold text-red-700">{t("app.admin.activeMission.route.workflowError")}</p>;

  const handleWorkflowError = (error: unknown) => {
    if (error instanceof AdminAuthError) reportAuthError(error);
    if (error instanceof AdminRequestError
      && (error.code === "WORKFLOW_STALE" || error.code === "WRONG_STATE")) {
      void Promise.all([
        detail.refetch(),
        completionReview.refetch(),
      ]).then(([{ data }]) => {
        const selected = data?.workItems.find((item) => item.id === workItemId)
          ?? data?.workItems.find((item) => PUBLICATION_STATES.has(item.state));
        setSelectedAttemptId(selected?.current_proof_attempt_id ?? undefined);
      });
    }
  };

  const analyticsProperties: RewardHandoffAnalyticsProperties | null = workflowState && missionId ? {
    missionId,
    locale: lang === "zh" ? "zh" as const : "en" as const,
    deviceCategory: getDeviceCategory(),
    workflowState,
    contractSource,
    hasPoints,
    hasCash,
    hasXp,
  } : null;

  const completionBusy = approveCompletion.isPending
    || backfillRewardContract.isPending
    || cancelRewardHandoff.isPending;
  const completionPanel = (
    workflowState
    && workflowRevision !== null
    && submissionId
    && completionProjection?.completionEligibility
  ) ? (
    <MissionCompletionReview
      workflowId={workflowId}
      workflowState={workflowState}
      workflowRevision={workflowRevision}
      rewardContract={completionProjection.rewardContract ?? null}
      eligibility={completionProjection.completionEligibility}
      pendingReward={completionProjection.pendingReward ?? null}
      busy={completionBusy}
      onBackfill={(input) => runCompletionAction(() => backfillRewardContract.mutateAsync({
          workflowId,
          submissionId,
          workspace: workspaceSlug,
          ...input,
        }))}
      onApprove={async (input) => {
        const result = await runCompletionAction(
          () => approveCompletion.mutateAsync({
            workflowId,
            submissionId,
            workspace: workspaceSlug,
            ...input,
          }),
        );
        if (analyticsProperties) {
          trackActivationEvent("mission_completion_approved", analyticsProperties);
        }
        return result;
      }}
      onCancel={async (input) => {
        const result = await runCompletionAction(
          () => cancelRewardHandoff.mutateAsync({
            workflowId,
            submissionId,
            workspace: workspaceSlug,
            ...input,
          }),
        );
        if (analyticsProperties) {
          trackActivationEvent("mission_reward_pending_cancelled", analyticsProperties);
        }
        return result;
      }}
      onActionError={handleWorkflowError}
    />
  ) : null;

  const selectedItem = detail.data.workItems.find((item) => item.id === workItemId)
    ?? detail.data.workItems.find((item) => PUBLICATION_STATES.has(item.state));
  const isPublicationReview = Boolean(selectedItem && PUBLICATION_STATES.has(selectedItem.state)
    && (selectedItem.state === "approved_to_publish"
      || detail.data.proofAttempts?.some((attempt) => attempt.workItemId === selectedItem.id)));
  const proofBusy = startProofReview.isPending || requestProofCorrection.isPending
    || verifyProof.isPending || refreshProofMetadata.isPending;

  if (isPublicationReview && staff?.userId && selectedItem) {
    return (
      <div className="min-w-0 space-y-6">
       <PublicationProofReview
        workflow={detail.data}
        selectedWorkItemId={selectedItem.id}
        selectedAttemptId={selectedAttemptId}
        currentOperatorId={staff.userId}
        busy={proofBusy}
        onClaim={(input) => runWorkflowAction("claim", input, (key) => startProofReview.mutateAsync({
          workflowId, workspace: workspaceSlug, ...input, idempotencyKey: key,
        }))}
        onRequestCorrection={(input) => runWorkflowAction("request-correction", input, (key) => requestProofCorrection.mutateAsync({
          workflowId, workspace: workspaceSlug, ...input, idempotencyKey: key,
        }))}
        onVerify={(input) => runWorkflowAction("verify", input, (key) => verifyProof.mutateAsync({
          workflowId, workspace: workspaceSlug, ...input, idempotencyKey: key,
        }))}
        onRefreshMetadata={(input) => runWorkflowAction("refresh-metadata", input, (key) => refreshProofMetadata.mutateAsync({
          workflowId, workspace: workspaceSlug, ...input, idempotencyKey: key,
        }))}
        onSetInstructions={(input) => runWorkflowAction("set-instructions", input, async (key) => {
          const result = await setActiveMissionPublicationInstructions(workflowId, input.workItemId, {
            workspace: workspaceSlug,
            expectedState: input.expectedState,
            expectedRevision: input.expectedRevision,
            idempotencyKey: key,
            overrideReason: input.overrideReason,
            instructions: input.instructions,
          });
          await refresh();
          return result;
        })}
        onSetupExistingInstructions={(input) => runWorkflowAction("setup-existing-instructions", input, async (key) => {
          const result = await setupActiveMissionPublicationInstructions(
            workflowId,
            input.workItemId,
            {
              workspace: workspaceSlug,
              expectedState: input.expectedState,
              expectedRevision: input.expectedRevision,
              idempotencyKey: key,
              instructions: input.instructions,
            },
          );
          await refresh();
          return result;
        })}
        onActionError={handleWorkflowError}
      />
       {completionPanel}
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-6">
     <ActiveMissionReview
      workflow={detail.data}
      selectedWorkItemId={workItemId}
      onStartReview={async (input) => {
        const result = await startActiveMissionReview(workflowId, input.workItemId, { workspace: workspaceSlug, expectedState: input.expectedState });
        await refresh();
        return result;
      }}
      onRequestRevision={async (input) => {
        const result = await requestActiveMissionRevision(workflowId, input.workItemId, { workspace: workspaceSlug, ...input });
        await refresh();
        return result;
      }}
      onGrantRevision={async (input) => {
        const result = await grantActiveMissionRevision(workflowId, input.workItemId, { workspace: workspaceSlug, reason: input.reason, grantedCount: input.grantedCount });
        await refresh();
        return result;
      }}
      onApproveVersion={async (input) => {
        const result = await approveActiveMissionVersion(workflowId, input.workItemId, { workspace: workspaceSlug, expectedState: input.expectedState, versionId: input.versionId });
        await refresh();
        return result;
      }}
      onMarkShipped={async (input) => {
        const result = await markActiveMissionShipped(workflowId, { workspace: workspaceSlug, note: input.note });
        await refresh();
        return result;
      }}
      onActionError={(error) => {
        if (error instanceof AdminAuthError) reportAuthError(error);
      }}
    />
     {completionPanel}
    </div>
  );
}
