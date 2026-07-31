import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { DeliverableNavigator } from "@/components/active-mission/DeliverableNavigator";
import { DraftEditor } from "@/components/active-mission/DraftEditor";
import { FulfillmentCard } from "@/components/active-mission/FulfillmentCard";
import { ProofAttemptHistory } from "@/components/active-mission/ProofAttemptHistory";
import { RewardPendingCard } from "@/components/active-mission/RewardPendingCard";
import { ProofSubmissionForm, type ProofEvidenceAsset } from "@/components/active-mission/ProofSubmissionForm";
import { PublicationInstructions } from "@/components/active-mission/PublicationInstructions";
import { VersionTimeline } from "@/components/active-mission/VersionTimeline";
import { WorkspaceHeader } from "@/components/active-mission/WorkspaceHeader";
import { deriveNextAction, type PublicationProofAttemptView } from "@/lib/activeMission";
import { ApiError } from "@/lib/api";
import { trackActivationEvent } from "@/lib/activationAnalytics";
import {
  creatorPublicationTimingBucket,
  publicationAnalyticsBase,
  publicationMetadataStatus,
} from "@/lib/publicationProofAnalytics";
import { useI18n } from "@/lib/i18n";
import { creatorRewardExperience } from "@/lib/rewardHandoff";
import {
  useActiveMissionWorkspace,
  useConfirmMissionReceipt,
  useCreateDraftAssetGrant,
  useFinalizeDraftAsset,
  useMissionPublication,
  useProofEvidenceUpload,
  useSubmitPublicationProof,
  useSaveMissionDraft,
  useSubmitMissionWorkItem,
  type DraftAssetUploadGrant,
  type CreateProofEvidenceGrantInput,
} from "@/lib/queries/activeMission";
import { supabase } from "@/lib/supabase";

type CreatorWorkspaceSearch = { item?: string };

const PUBLICATION_STATES = new Set([
  "approved_to_publish",
  "proof_submitted",
  "proof_under_review",
  "proof_correction_requested",
  "proof_verified",
]);

const PUBLICATION_STATE_LABEL_KEYS = {
  approved_to_publish: "app.activeMission.publication.status.ready",
  proof_submitted: "app.activeMission.publication.status.submitted",
  proof_under_review: "app.activeMission.publication.status.underReview",
  proof_correction_requested: "app.activeMission.publication.status.correctionRequested",
  proof_verified: "app.activeMission.publication.status.verified",
} as const;

type ProofEvidenceGrant = {
  asset: { id: string; storageObjectPath: string };
  token: string;
};

function isProofEvidenceMimeType(value: string): value is CreateProofEvidenceGrantInput["contentType"] {
  return ["image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4", "video/quicktime", "video/webm"].includes(value);
}

export const Route = createFileRoute("/_app/my/$submissionId")({
  validateSearch: (search: Record<string, unknown>): CreatorWorkspaceSearch => ({
    ...(typeof search.item === "string" && search.item.trim() ? { item: search.item } : {}),
  }),
  component: CreatorMissionWorkspace,
});

async function sha256(file: File): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function errorKind(error: unknown): "missing" | "forbidden" | "recoverable" {
  if (error instanceof ApiError && (error.status === 404 || error.code === "WORKFLOW_NOT_FOUND")) return "missing";
  if (error instanceof ApiError && (error.status === 403 || error.code === "NOT_AUTHORIZED")) return "forbidden";
  return "recoverable";
}

export function CreatorMissionWorkspace() {
  const { t, lang } = useI18n();
  const { submissionId } = Route.useParams();
  const search = useSearch({ from: "/_app/my/$submissionId" });
  const navigate = useNavigate({ from: "/my/$submissionId" });
  const workspaceQuery = useActiveMissionWorkspace(submissionId);
  const saveDraft = useSaveMissionDraft(submissionId);
  const confirmReceipt = useConfirmMissionReceipt(submissionId);
  const createGrant = useCreateDraftAssetGrant(submissionId);
  const finalizeAsset = useFinalizeDraftAsset(submissionId);
  const submitItem = useSubmitMissionWorkItem(submissionId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const evidenceUpload = useProofEvidenceUpload(submissionId);
  const proofSubmit = useSubmitPublicationProof(submissionId);
  const [proofEvidence, setProofEvidence] = useState<ProofEvidenceAsset[]>([]);
  const clearProofConflict = proofSubmit.clearConflict;
  const proofEvidenceScope = useRef<string | null>(null);
  const instructionAnalyticsRef = useRef(new Set<string>());
  const proofFormAnalyticsRef = useRef(new Set<string>());
  const editorRef = useRef<HTMLDivElement>(null);
  const workspace = workspaceQuery.data;
  const pendingReward = workspace?.pendingReward ?? null;
  const rewardExperience = workspace
    ? creatorRewardExperience(workspace.workflow.state, pendingReward)
    : null;
  const showRewardExperience = rewardExperience !== null;

  const nextAction = workspace ? deriveNextAction(workspace) : null;
  const validSearchId = workspace?.workItems.some(({ id }) => id === search.item) ? search.item! : null;
  const validSelectedId = workspace?.workItems.some(({ id }) => id === selectedId) ? selectedId : null;
  const defaultId = workspace
    ? (workspace.workItems.some(({ id }) => id === nextAction?.workItemId) ? nextAction?.workItemId : null)
      ?? workspace.workItems[0]?.id
      ?? null
    : null;
  const activeId = validSearchId ?? validSelectedId ?? defaultId;
  const activeItem = workspace?.workItems.find(({ id }) => id === activeId) ?? null;
  const publicationWorkItemId = activeItem
    && (showRewardExperience || PUBLICATION_STATES.has(activeItem.state))
    ? activeItem.id
    : "";
  const publicationQuery = useMissionPublication(submissionId, publicationWorkItemId);
  const publication = publicationQuery.data;

  useEffect(() => {
    if (!activeId || selectedId === activeId) return;
    setSelectedId(activeId);
  }, [activeId, selectedId]);
  useEffect(() => {
    if (proofEvidenceScope.current === publicationWorkItemId) return;
    proofEvidenceScope.current = publicationWorkItemId;
    setProofEvidence([]);
  }, [publicationWorkItemId]);

  useEffect(() => {
    clearProofConflict?.();
  }, [publicationWorkItemId, clearProofConflict]);

  useEffect(() => {
    if (!publication || instructionAnalyticsRef.current.has(publication.workItemId)) return;
    const analytics = publicationAnalyticsBase({
      locale: lang,
      missionType: workspace?.mission.missionType,
      platform: publication.platform,
      state: publication.state,
    });
    if (!analytics) return;
    instructionAnalyticsRef.current.add(publication.workItemId);
    trackActivationEvent("publication_instructions_viewed", analytics);
  }, [lang, publication, workspace?.mission.missionType]);

  if (workspaceQuery.isLoading) {
    return (

      <main aria-label={t("app.activeMission.route.loading")} role="status" className="mx-auto w-full max-w-6xl p-4 sm:p-6">
        <div className="h-44 animate-pulse rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white" />
      </main>
    );
  }

  if (workspaceQuery.isError || !workspace) {
    const kind = errorKind(workspaceQuery.error);
    if (kind === "missing") return <WorkspaceProblem title={t("app.activeMission.route.notFoundTitle")} body={t("app.activeMission.route.notFoundBody")} />;
    if (kind === "forbidden") return <WorkspaceProblem title={t("app.activeMission.route.deniedTitle")} body={t("app.activeMission.route.deniedBody")} />;
    return (
      <WorkspaceProblem title={t("app.activeMission.route.loadErrorTitle")} body={t("app.activeMission.route.loadErrorBody")}>
        <button type="button" onClick={() => void workspaceQuery.refetch()} className="min-h-11 rounded-full border-2 border-[var(--color-ink)] px-5 py-2 font-bold">{t("app.activeMission.route.tryAgain")}</button>
      </WorkspaceProblem>
    );
  }

  if (workspace.workItems.length === 0 || !activeItem || !nextAction) {
    return <WorkspaceProblem title={t("app.activeMission.route.setupTitle")} body={t("app.activeMission.route.setupBody")} alert />;
  }

  function selectItem(workItemId: string) {
    setSelectedId(workItemId);
    void navigate({ search: (current) => ({ ...current, item: workItemId }), replace: true });
  }

  async function uploadFile(file: File) {
    const grant = await createGrant.mutateAsync({ workItemId: activeItem!.id, fileName: file.name, contentType: file.type, sizeBytes: file.size }) as DraftAssetUploadGrant;
    const uploaded = await supabase.storage.from("mission-draft-assets").uploadToSignedUrl(
      grant.asset.storageObjectPath,
      grant.token,
      file,
      { contentType: file.type, upsert: false },
    );
    if (uploaded.error) throw uploaded.error;
    await finalizeAsset.mutateAsync({ workItemId: activeItem!.id, assetId: grant.asset.id, checksum: await sha256(file) });
  }

  async function uploadProofEvidence(file: File) {
    if (!publication || !isProofEvidenceMimeType(file.type)) throw new Error("Unsupported proof evidence");
    const temporaryId = `upload-${crypto.randomUUID()}`;
    setProofEvidence((current) => [...current, { id: temporaryId, name: file.name, status: "uploading" }]);
    try {
      const grant = await evidenceUpload.createGrant.mutateAsync({
        workItemId: publication.workItemId,
        expectedState: publication.state,
        expectedRevision: publication.revision,
        idempotencyKey: crypto.randomUUID(),
        fileName: file.name,
        contentType: file.type,
        sizeBytes: file.size,
      }) as ProofEvidenceGrant;
      const uploaded = await supabase.storage.from("mission-publication-proof-assets").uploadToSignedUrl(
        grant.asset.storageObjectPath,
        grant.token,
        file,
        { contentType: file.type, upsert: false },
      );
      if (uploaded.error) throw uploaded.error;
      await evidenceUpload.finalize.mutateAsync({
        workItemId: publication.workItemId,
        assetId: grant.asset.id,
        expectedState: publication.state,
        expectedRevision: publication.revision,
        idempotencyKey: crypto.randomUUID(),
        checksum: await sha256(file),
      });
      setProofEvidence((current) => current.map((asset) =>
        asset.id === temporaryId
          ? { id: grant.asset.id, name: file.name, status: "uploaded" }
          : asset));
    } catch (error) {
      setProofEvidence((current) => current.map((asset) =>
        asset.id === temporaryId
          ? { ...asset, status: "failed", error: "Upload failed" }
          : asset));
      throw error;
    }
  }

  const showPublicationForm = publication?.state === "approved_to_publish"
    || publication?.state === "proof_correction_requested";
  const proofConflict = proofSubmit.conflict;
  const canRetryPreservedProof = proofConflict?.currentPublication.state === "approved_to_publish"
    || proofConflict?.currentPublication.state === "proof_correction_requested";

  function trackSuccessfulProofOutcome(
    attempt: PublicationProofAttemptView,
    platform: unknown,
  ): number {
    const analytics = publicationAnalyticsBase({
      locale: lang,
      missionType: workspace?.mission.missionType,
      platform,
      state: "proof_submitted",
    });
    if (!analytics) return attempt.attemptNumber;
    const metadataStatus = publicationMetadataStatus(attempt.metadataStatus);
    const properties = {
      ...analytics,
      timingBucket: attempt.submittedLate ? "late" as const : "on_time" as const,
      attemptNumber: attempt.attemptNumber,
      urlCount: 1 + attempt.additionalUrls.length,
      evidenceCount: attempt.evidence.length,
      lateness: attempt.submittedLate ? "late" as const : "on_time" as const,
      metadataStatus,
    };
    trackActivationEvent(
      attempt.attemptNumber > 1
        ? "publication_proof_resubmitted"
        : "publication_proof_submitted",
      properties,
    );
    if (attempt.metadataStatus === "unavailable") {
      trackActivationEvent("publication_proof_metadata_unavailable", {
        ...analytics,
        attemptNumber: attempt.attemptNumber,
        metadataStatus: "unavailable",
      });
    }
    return attempt.attemptNumber;
  }
  async function retryPreservedProof() {
    if (!proofConflict || !canRetryPreservedProof) return;
    const result = await proofSubmit.mutateAsync({
      ...proofConflict.localProof,
      expectedState: proofConflict.currentPublication.state,
      expectedRevision: proofConflict.currentPublication.revision,
      idempotencyKey: crypto.randomUUID(),
    });
    const attemptNumber = trackSuccessfulProofOutcome(
      result.attempt,
      proofConflict.currentPublication.platform,
    );
    const analytics = publicationAnalyticsBase({
      locale: lang,
      missionType: workspace?.mission.missionType,
      platform: proofConflict.currentPublication.platform,
      state: proofConflict.currentPublication.state,
    });
    if (!analytics) return;
    trackActivationEvent("publication_proof_recovery_used", {
      ...analytics,
      attemptNumber,
      recoveryCategory: "stale_conflict",
    });
  }

  function trackProofFormStart() {
    if (!publication || proofFormAnalyticsRef.current.has(publication.workItemId)) return;
    const analytics = publicationAnalyticsBase({
      locale: lang,
      missionType: workspace?.mission.missionType,
      platform: publication.platform,
      state: publication.state,
    });
    if (!analytics) return;
    proofFormAnalyticsRef.current.add(publication.workItemId);
    trackActivationEvent("publication_proof_form_started", {
      ...analytics,
      timingBucket: creatorPublicationTimingBucket(publication.instructions.publishDueAt),
      attemptNumber: (publication.currentAttempt?.attemptNumber ?? 0) + 1,
    });
  }

  function reviewPreservedProof() {
    clearProofConflict();
  }


  return (
    <main className="mx-auto w-full max-w-6xl space-y-5 p-4 pb-8 sm:p-6">
      <WorkspaceHeader workspace={workspace} nextAction={nextAction} onPrimaryAction={(action) => {

        if (action.workItemId) selectItem(action.workItemId);
        editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }} />

      {workspace.workflow.state === "approved_to_publish" ? (
        <p role="status" className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-acid)] p-4 font-heading font-bold">{t("app.activeMission.route.approvedRewardNeutral")}</p>
      ) : null}

      <FulfillmentCard fulfillment={workspace.fulfillment} isConfirming={confirmReceipt.isPending} onConfirmReceipt={() => confirmReceipt.mutateAsync()} />

      <div className="grid min-w-0 gap-5 md:grid-cols-[15rem_minmax(0,1fr)] md:items-start">
        <DeliverableNavigator items={workspace.workItems} selectedId={activeItem.id} onSelect={selectItem} />
        <div ref={editorRef} className="min-w-0 space-y-5 scroll-mt-24">
          {showRewardExperience && pendingReward ? (
            <>
              {publicationQuery.isLoading ? (
                <div role="status" className="h-44 animate-pulse rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white" aria-label={t("app.activeMission.publication.loading")} />
              ) : publicationQuery.isError || !publication ? (
                <div role="alert" className="rounded-[var(--radius)] border-2 border-red-700 bg-red-50 p-4">
                  <p className="font-bold">{t("app.activeMission.publication.loadError")}</p>
                  <button type="button" onClick={() => void publicationQuery.refetch()} className="mt-3 min-h-11 rounded-full border-2 border-[var(--color-ink)] px-4 py-2 font-bold">{t("common.retry")}</button>
                </div>
              ) : (
                <ProofAttemptHistory
                  publication={publication}
                  variant={rewardExperience ?? "reward_pending"}
                  autoFocusVerifiedHeading={false}
                />
              )}
              <VersionTimeline
                versions={activeItem.versions ?? []}
                events={workspace.events.filter((event) => !event.workItemId || event.workItemId === activeItem.id)}
              />
              <RewardPendingCard
                missionTitle={workspace.mission.title}
                pendingReward={pendingReward}
                supportHref={`/contact?topic=reward-pending&submission=${encodeURIComponent(submissionId)}`}
              />
            </>
          ) : publicationWorkItemId ? (
            publicationQuery.isLoading ? (
              <div role="status" className="h-44 animate-pulse rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white" aria-label={t("app.activeMission.publication.loading")} />
            ) : publicationQuery.isError || !publication ? (
              <div role="alert" className="rounded-[var(--radius)] border-2 border-red-700 bg-red-50 p-4">
                <p className="font-bold">{t("app.activeMission.publication.loadError")}</p>
                <button type="button" onClick={() => void publicationQuery.refetch()} className="mt-3 min-h-11 rounded-full border-2 border-[var(--color-ink)] px-4 py-2 font-bold">{t("common.retry")}</button>
              </div>
            ) : (
              <>
                <PublicationInstructions publication={publication} />
                {publication.state === "proof_submitted" || publication.state === "proof_under_review" ? (
                  <p role="status" className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-paper)] p-4 font-semibold">
                    {t("app.activeMission.publication.reviewing")}
                  </p>
                ) : null}
                {proofConflict ? (
                  <section role="alert" className="rounded-[var(--radius)] border-2 border-amber-800 bg-amber-50 p-5">
                    <h2 className="font-heading text-xl font-bold text-amber-950">{t("app.activeMission.publication.recovery.changedTitle")}</h2>
                    <p className="mt-2 text-sm text-amber-950">
                      {t("app.activeMission.publication.recovery.changedBody")}
                    </p>
                    <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                      <div>
                        <dt className="font-bold">{t("app.activeMission.publication.recovery.currentState")}</dt>
                        <dd>{t(PUBLICATION_STATE_LABEL_KEYS[
                          proofConflict.currentPublication.state as keyof typeof PUBLICATION_STATE_LABEL_KEYS
                        ])}</dd>
                      </div>
                      <div>
                        <dt className="font-bold">{t("app.activeMission.publication.recovery.primaryUrl")}</dt>
                        <dd className="break-all">{proofConflict.localProof.primaryUrl}</dd>
                      </div>
                    </dl>
                    <p className="mt-4 text-sm font-semibold">
                      {t("app.activeMission.publication.recovery.selectionPreserved")}
                    </p>
                    <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                      {canRetryPreservedProof ? (
                        <button type="button" onClick={() => void retryPreservedProof()} className="min-h-11 rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-4 py-2 font-bold">
                          {t("app.activeMission.publication.recovery.retryPreserved")}
                        </button>
                      ) : null}
                      <button type="button" onClick={reviewPreservedProof} className="min-h-11 rounded-full border-2 border-[var(--color-ink)] bg-white px-4 py-2 font-bold">
                        {canRetryPreservedProof
                          ? t("app.activeMission.publication.recovery.reviewSubmission")
                          : t("app.activeMission.publication.recovery.dismiss")}
                      </button>
                    </div>
                  </section>
                ) : null}
                {showPublicationForm ? (
                  <ProofSubmissionForm
                    key={publication.workItemId}
                    publication={publication}
                    evidenceAssets={proofEvidence}
                    isSubmitting={proofSubmit.isPending || Boolean(proofConflict)}
                    onUploadFile={uploadProofEvidence}
                    onStart={trackProofFormStart}
                    onSubmit={async (value) => {
                      const result = await proofSubmit.mutateAsync({
                        workItemId: publication.workItemId,
                        expectedState: publication.state,
                        expectedRevision: publication.revision,
                        idempotencyKey: crypto.randomUUID(),
                        ...value,
                      });
                      trackSuccessfulProofOutcome(result.attempt, publication.platform);
                      return result;
                    }}
                  />
                ) : null}
                <ProofAttemptHistory publication={publication} />
              </>
            )
          ) : (
            <>
              <DraftEditor
                key={activeItem.id}
                item={activeItem}
                requiredChanges={activeItem.requiredChanges ?? []}
                revisionDeadline={activeItem.revisionDeadline ?? null}
                existingAssetCount={(activeItem.draftAssets ?? []).length}
                conflict={saveDraft.conflict?.workItemId === activeItem.id ? saveDraft.conflict : null}
                onSave={(input) => saveDraft.mutateAsync(input)}
                onSubmit={(input) => submitItem.mutateAsync(input)}
                onReconcileSubmit={() => workspaceQuery.refetch()}
                onUploadFile={uploadFile}
              />
              <VersionTimeline versions={activeItem.versions ?? []} events={workspace.events.filter((event) => !event.workItemId || event.workItemId === activeItem.id)} />
            </>
          )}
        </div>
      </div>
    </main>
  );
}

export function WorkspaceProblem({ title, body, alert = false, children }: { title: string; body: string; alert?: boolean; children?: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <main role={alert ? "alert" : undefined} className="mx-auto flex min-h-[50vh] w-full max-w-lg flex-col items-start justify-center gap-4 p-6">
      <h1 className="font-heading text-2xl font-bold">{title}</h1>
      <p className="text-sm text-[var(--color-soft-ink)]">{body}</p>
      {children}
      <Link to="/my" className="min-h-11 py-2 font-bold underline">{t("app.activeMission.route.back")}</Link>
    </main>
  );
}
