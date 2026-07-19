import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { DeliverableNavigator } from "@/components/active-mission/DeliverableNavigator";
import { DraftEditor } from "@/components/active-mission/DraftEditor";
import { FulfillmentCard } from "@/components/active-mission/FulfillmentCard";
import { VersionTimeline } from "@/components/active-mission/VersionTimeline";
import { WorkspaceHeader } from "@/components/active-mission/WorkspaceHeader";
import { deriveNextAction } from "@/lib/activeMission";
import { ApiError } from "@/lib/api";
import {
  useActiveMissionWorkspace,
  useConfirmMissionReceipt,
  useCreateDraftAssetGrant,
  useFinalizeDraftAsset,
  useSaveMissionDraft,
  useSubmitMissionWorkItem,
  type DraftAssetUploadGrant,
} from "@/lib/queries/activeMission";
import { supabase } from "@/lib/supabase";

type CreatorWorkspaceSearch = { item?: string };

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
  const editorRef = useRef<HTMLDivElement>(null);
  const workspace = workspaceQuery.data;

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

  useEffect(() => {
    if (!activeId || selectedId === activeId) return;
    setSelectedId(activeId);
  }, [activeId, selectedId]);

  if (workspaceQuery.isLoading) {
    return (
      <main aria-label="Loading active mission" role="status" className="mx-auto w-full max-w-6xl p-4 sm:p-6">
        <div className="h-44 animate-pulse rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white" />
      </main>
    );
  }

  if (workspaceQuery.isError || !workspace) {
    const kind = errorKind(workspaceQuery.error);
    if (kind === "missing") return <WorkspaceProblem title="Mission not found" body="This active mission is unavailable or no longer belongs to your account." />;
    if (kind === "forbidden") return <WorkspaceProblem title="Access denied" body="You do not have access to this active mission." />;
    return (
      <WorkspaceProblem title="We couldn’t load this mission" body="Your work is still safe. Try loading the workspace again.">
        <button type="button" onClick={() => void workspaceQuery.refetch()} className="min-h-11 rounded-full border-2 border-[var(--color-ink)] px-5 py-2 font-bold">Try again</button>
      </WorkspaceProblem>
    );
  }

  if (workspace.workItems.length === 0 || !activeItem || !nextAction) {
    return <WorkspaceProblem title="Mission setup needs attention" body="No deliverables are available for this active mission. Contact support before continuing." alert />;
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

  return (
    <main className="mx-auto w-full max-w-6xl space-y-5 p-4 pb-8 sm:p-6">
      <WorkspaceHeader workspace={workspace} nextAction={nextAction} onPrimaryAction={(action) => {
        if (action.workItemId) selectItem(action.workItemId);
        editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }} />

      {workspace.workflow.state === "approved_to_publish" ? (
        <p role="status" className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-acid)] p-4 font-heading font-bold">Approved to publish — rewards are not issued yet</p>
      ) : null}

      <FulfillmentCard fulfillment={workspace.fulfillment} isConfirming={confirmReceipt.isPending} onConfirmReceipt={() => confirmReceipt.mutateAsync()} />

      <div className="grid min-w-0 gap-5 md:grid-cols-[15rem_minmax(0,1fr)] md:items-start">
        <DeliverableNavigator items={workspace.workItems} selectedId={activeItem.id} onSelect={selectItem} />
        <div ref={editorRef} className="min-w-0 space-y-5 scroll-mt-24">
          <DraftEditor key={activeItem.id} item={activeItem} conflict={saveDraft.conflict?.workItemId === activeItem.id ? saveDraft.conflict : null} onSave={(input) => saveDraft.mutateAsync(input)} onSubmit={(input) => submitItem.mutateAsync(input)} onUploadFile={uploadFile} />
          <VersionTimeline versions={[]} events={workspace.events.filter((event) => !event.workItemId || event.workItemId === activeItem.id)} />
        </div>
      </div>
    </main>
  );
}

function WorkspaceProblem({ title, body, alert = false, children }: { title: string; body: string; alert?: boolean; children?: React.ReactNode }) {
  return (
    <main role={alert ? "alert" : undefined} className="mx-auto flex min-h-[50vh] w-full max-w-lg flex-col items-start justify-center gap-4 p-6">
      <h1 className="font-heading text-2xl font-bold">{title}</h1>
      <p className="text-sm text-[var(--color-soft-ink)]">{body}</p>
      {children}
      <Link to="/my" className="min-h-11 py-2 font-bold underline">Back to my missions</Link>
    </main>
  );
}
