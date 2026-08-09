import { createFileRoute } from "@tanstack/react-router";
import { ApiError } from "@/lib/api";
import {
  type SubmissionWorkspace,
  type WorkItem,
  useSaveCreatorDraft,
  useSubmissionWorkspace,
} from "@/lib/queries/creatorStudio";
import { SkeletonCard } from "@/components/SkeletonCard";

export const Route = createFileRoute("/_app/my/$submissionId")({ component: CreatorStudioSubmissionRoute });

function CreatorStudioSubmissionRoute() {
  const { submissionId } = Route.useParams();
  const workspace = useSubmissionWorkspace(submissionId);

  if (workspace.isLoading) {
    return <div data-testid="creator-studio-loading" className="mx-auto w-full max-w-lg p-4 lg:max-w-5xl"><SkeletonCard className="h-96" /></div>;
  }

  if (workspace.isError) {
    if (workspace.error instanceof ApiError && workspace.error.status === 404) {
      return <main className="mx-auto max-w-lg p-4"><p>Creator Studio submission not found.</p></main>;
    }
    return (
      <main className="mx-auto max-w-lg space-y-3 p-4" role="alert">
        <p>Unable to load Creator Studio workspace.</p>
        <button type="button" className="underline" onClick={() => workspace.refetch()}>Retry</button>
      </main>
    );
  }

  if (!workspace.data) return <main className="mx-auto max-w-lg p-4"><p>Creator Studio submission not found.</p></main>;
  return <CreatorStudioWorkbench submissionId={submissionId} workspace={workspace.data} />;
}

export function CreatorStudioWorkbench({ submissionId, workspace }: { submissionId: string; workspace: SubmissionWorkspace }) {
  const activeWorkItem = [...workspace.workItems].sort((left, right) => left.position - right.position)
    .find((item) => item.id === workspace.nextAction?.workItemId) ?? workspace.workItems[0];

  return (
    <main className="mx-auto max-w-lg space-y-4 p-4 lg:max-w-5xl">
      <header>
        <h1 className="font-display text-xl font-bold">{workspace.brief.title}</h1>
        {workspace.brief.requirements.length > 0 && <p className="mt-1 text-sm text-[var(--color-soft-ink)]">{workspace.brief.requirements.join(" · ")}</p>}
      </header>
      {activeWorkItem ? <CreatorStudioWorkItem submissionId={submissionId} workItem={activeWorkItem} nextActionLabel={workspace.nextAction?.label} /> : <p>No work items are available.</p>}
    </main>
  );
}

function CreatorStudioWorkItem({ submissionId, workItem, nextActionLabel }: { submissionId: string; workItem: WorkItem; nextActionLabel?: string }) {
  const saveDraft = useSaveCreatorDraft(submissionId, workItem.id);
  const draftInvalid = saveDraft.error instanceof ApiError && saveDraft.error.code === "draft_invalid";

  return (
    <section aria-label={`Work item: ${workItem.title}`} className="pastel-card space-y-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4">
      <h2 className="font-heading font-bold">{workItem.title}</h2>
      <p className="text-sm">{workItem.instructions}</p>
      <div aria-label="Creator Studio draft editor" className="rounded-[var(--radius)] border border-[var(--color-ink)] p-3 text-sm">Draft editor</div>
      {nextActionLabel && <p className="font-heading text-sm">{nextActionLabel}</p>}
      {workItem.reviewFeedback.status === "unavailable" && <p className="text-sm">Review feedback is temporarily unavailable.</p>}
      {draftInvalid && <p role="alert" className="text-sm text-[var(--color-magenta)]">{saveDraft.error.message}</p>}
    </section>
  );
}
