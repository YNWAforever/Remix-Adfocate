import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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
  const { workspace } = useAdminWorkspace();
  const queryClient = useQueryClient();
  const key = ["admin-active-mission", workspace, workflowId] as const;
  const { t } = useI18n();
  const [selectedAttemptId, setSelectedAttemptId] = useState<string>();
  const startProofReview = useStartProofReview();
  const requestProofCorrection = useRequestProofCorrection();
  const verifyProof = useVerifyProof();
  const refreshProofMetadata = useRefreshProofMetadata();
  const detail = useQuery({
    queryKey: key,
    queryFn: () => fetchActiveMissionWorkflow(workflowId, workspace),
    enabled: authed && Boolean(workspace),
    retry: false,
  });

  useEffect(() => {
    if (detail.error instanceof AdminAuthError) reportAuthError(detail.error);
  }, [detail.error, reportAuthError]);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: key }),
      queryClient.invalidateQueries({ queryKey: ["admin-active-missions", workspace] }),
    ]);
  };

  if (!workspace) return <p className="text-sm text-[var(--color-soft-ink)]">{t("app.admin.activeMission.route.selectReview")}</p>;
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
        onClaim={(input) => startProofReview.mutateAsync({
          workflowId, workspace, ...input, idempotencyKey: idempotencyKey(),
        })}
        onRequestCorrection={(input) => requestProofCorrection.mutateAsync({
          workflowId, workspace, ...input, idempotencyKey: idempotencyKey(),
        })}
        onVerify={(input) => verifyProof.mutateAsync({
          workflowId, workspace, ...input, idempotencyKey: idempotencyKey(),
        })}
        onRefreshMetadata={(input) => refreshProofMetadata.mutateAsync({
          workflowId, workspace, ...input, idempotencyKey: idempotencyKey(),
        })}
        onSetInstructions={async (input) => {
          const result = await setActiveMissionPublicationInstructions(workflowId, input.workItemId, {
            workspace,
            expectedState: input.expectedState,
            expectedRevision: input.expectedRevision,
            idempotencyKey: idempotencyKey(),
            overrideReason: input.overrideReason,
            instructions: input.instructions,
          });
          await refresh();
          return result;
        }}
        onSetupExistingInstructions={async (input) => {
          const result = await setupActiveMissionPublicationInstructions(
            workflowId,
            input.workItemId,
            {
              workspace,
              expectedState: input.expectedState,
              expectedRevision: input.expectedRevision,
              idempotencyKey: idempotencyKey(),
              instructions: input.instructions,
            },
          );
          await refresh();
          return result;
        }}
        onActionError={handleProofError}
      />
    );
  }

  return (
    <ActiveMissionReview
      workflow={detail.data}
      selectedWorkItemId={workItemId}
      onStartReview={async (input) => {
        const result = await startActiveMissionReview(workflowId, input.workItemId, { workspace, expectedState: input.expectedState });
        await refresh();
        return result;
      }}
      onRequestRevision={async (input) => {
        const result = await requestActiveMissionRevision(workflowId, input.workItemId, { workspace, ...input });
        await refresh();
        return result;
      }}
      onGrantRevision={async (input) => {
        const result = await grantActiveMissionRevision(workflowId, input.workItemId, { workspace, reason: input.reason, grantedCount: input.grantedCount });
        await refresh();
        return result;
      }}
      onApproveVersion={async (input) => {
        const result = await approveActiveMissionVersion(workflowId, input.workItemId, { workspace, expectedState: input.expectedState, versionId: input.versionId });
        await refresh();
        return result;
      }}
      onMarkShipped={async (input) => {
        const result = await markActiveMissionShipped(workflowId, { workspace, note: input.note });
        await refresh();
        return result;
      }}
      onActionError={(error) => {
        if (error instanceof AdminAuthError) reportAuthError(error);
      }}
    />
  );
}
