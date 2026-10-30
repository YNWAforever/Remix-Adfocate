import { createFileRoute, Link } from "@tanstack/react-router";
import { STUDIO_THREADS } from "@/lib/features";
import { StudioWorkspace } from "@/components/studio/StudioWorkspace";
export const Route = createFileRoute("/_app/studio")({
  validateSearch: (search: Record<string, unknown>): { thread?: string } => ({ thread: typeof search.thread === "string" ? search.thread : undefined }),
  component: StudioRoute,
});
function StudioRoute() { const { thread }=Route.useSearch(); return STUDIO_THREADS ? <StudioWorkspace threadId={thread}/> : <div className="s-card"><h1>工作室準備中 / Studio is coming</h1><Link className="s-btn" to="/my">繼續我的任務 / Continue missions</Link></div>; }
