import { createFileRoute } from "@tanstack/react-router";
import { SkeletonCard } from "@/components/SkeletonCard";
import { CreatorStudioWorkbench } from "@/components/creator-studio/CreatorStudioWorkbench";
import { ApiError } from "@/lib/api";
import { useSubmissionWorkspace } from "@/lib/queries/creatorStudio";

export const Route = createFileRoute("/_app/my/$submissionId")({ component: CreatorStudioSubmissionRoute });

function CreatorStudioSubmissionRoute() {
  const { submissionId } = Route.useParams();
  const workspace = useSubmissionWorkspace(submissionId);

  if (workspace.isLoading) return <div data-testid="creator-studio-loading" className="mx-auto w-full max-w-lg p-4 lg:max-w-5xl"><SkeletonCard className="h-96" /></div>;
  if (workspace.isError) {
    if (workspace.error instanceof ApiError && workspace.error.status === 404) return <main className="mx-auto max-w-lg p-4"><p>Creator Studio submission not found.</p></main>;
    return <main className="mx-auto max-w-lg space-y-3 p-4" role="alert"><p>Unable to load Creator Studio workspace.</p><button type="button" className="underline" onClick={() => workspace.refetch()}>Retry</button></main>;
  }
  if (!workspace.data) return <main className="mx-auto max-w-lg p-4"><p>Creator Studio submission not found.</p></main>;
  return <CreatorStudioWorkbench submissionId={submissionId} workspace={workspace.data} />;
}
