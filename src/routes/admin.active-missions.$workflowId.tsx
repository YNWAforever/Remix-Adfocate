import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ActiveMissionReview } from "@/components/admin/ActiveMissionReview";
import { PublicationProofReview } from "@/components/admin/PublicationProofReview";
import { useAdminAuth } from "@/components/admin/AdminAuthContext";
import { useAdminWorkspace } from "@/components/admin/AdminWorkspaceContext";
import {
  AdminAuthError,
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

function idempotencyKey() {
  return globalThis.crypto.randomUUID();
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
  const { t } = useI18n();
  const [selectedAttemptId, setSelectedAttemptId] = useState<string>();
  const proofActionKeys = useRef(new Map<string, string>());
  const startProofReview = useStartProofReview();
  const requestProofCorrection = useRequestProofCorrection();
  const verifyProof = useVerifyProof();
  const refreshProofMetadata = useRefreshProofMetadata();
  const detail = useQuery({
    queryKey: key,
    queryFn: () => fetchActiveMissionWorkflow(workflowId, workspaceSlug),
    enabled: authed && Boolean(workspaceSlug),
    retry: false,
  });

  useEffect(() => {
    if (detail.error instanceof AdminAuthError) reportAuthError(detail.error);
  }, [detail.error, reportAuthError]);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: key }),
      queryClient.invalidateQueries({ queryKey: ["admin-active-missions", workspaceSlug] }),
    ]);
  };

  const runProofAction = async <T,>(
    action: string,
    input: unknown,
    operation: (key: string) => Promise<T>,
  ): Promise<T> => {
    const signature = `${action}:${JSON.stringify(input)}`;
    const existingKey = proofActionKeys.current.get(signature);
    const key = existingKey ?? idempotencyKey();
    proofActionKeys.current.set(signature, key);
    try {
      const result = await operation(key);
      proofActionKeys.current.delete(signature);
      return result;
    } catch (error) {
      if (
        error instanceof AdminRequestError
        && (error.code === "WORKFLOW_STALE" || error.code === "WRONG_STATE")
      ) {
        proofActionKeys.current.delete(signature);
      }
      throw error;
    }
  };

  if (!workspaceSlug) return <p className="text-sm text-[var(--color-soft-ink)]">{t("app.admin.activeMission.route.selectReview")}</p>;
  if (detail.isLoading) return <p className="text-sm">{t("app.admin.activeMission.route.loadingWorkflow")}</p>;
  if (detail.isError || !detail.data) return <p role="alert" className="text-sm font-bold text-red-700">{t("app.admin.activeMission.route.workflowError")}</p>;

  const handleProofError = (error: unknown) => {
    if (error instanceof AdminAuthError) reportAuthError(error);
    if (error instanceof AdminRequestError
      && (error.code === "WORKFLOW_STALE" || error.code === "WRONG_STATE")) {
      void detail.refetch().then(({ data }) => {
        const selected = data?.workItems.find((item) => item.id === workItemId)
          ?? data?.workItems.find((item) => PUBLICATION_STATES.has(item.state));
        setSelectedAttemptId(selected?.current_proof_attempt_id ?? undefined);
      });
    }
  };

  const selectedItem = detail.data.workItems.find((item) => item.id === workItemId)
    ?? detail.data.workItems.find((item) => PUBLICATION_STATES.has(item.state));
  const isPublicationReview = Boolean(selectedItem && PUBLICATION_STATES.has(selectedItem.state)
    && (selectedItem.state === "approved_to_publish"
      || detail.data.proofAttempts?.some((attempt) => attempt.workItemId === selectedItem.id)));
  const proofBusy = startProofReview.isPending || requestProofCorrection.isPending
    || verifyProof.isPending || refreshProofMetadata.isPending;

  if (isPublicationReview && staff?.userId && selectedItem) {
    return (
      <PublicationProofReview
        workflow={detail.data}
        selectedWorkItemId={selectedItem.id}
        selectedAttemptId={selectedAttemptId}
        currentOperatorId={staff.userId}
        busy={proofBusy}
        onClaim={(input) => runProofAction("claim", input, (key) => startProofReview.mutateAsync({
          workflowId, workspace: workspaceSlug, ...input, idempotencyKey: key,
        }))}
        onRequestCorrection={(input) => runProofAction("request-correction", input, (key) => requestProofCorrection.mutateAsync({
          workflowId, workspace: workspaceSlug, ...input, idempotencyKey: key,
        }))}
        onVerify={(input) => runProofAction("verify", input, (key) => verifyProof.mutateAsync({
          workflowId, workspace: workspaceSlug, ...input, idempotencyKey: key,
        }))}
        onRefreshMetadata={(input) => runProofAction("refresh-metadata", input, (key) => refreshProofMetadata.mutateAsync({
          workflowId, workspace: workspaceSlug, ...input, idempotencyKey: key,
        }))}
        onSetInstructions={(input) => runProofAction("set-instructions", input, async (key) => {
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
        onSetupExistingInstructions={(input) => runProofAction("setup-existing-instructions", input, async (key) => {
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
        onActionError={handleProofError}
      />
    );
  }

  return (
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
  );
}
