import { createFileRoute, Link } from "@tanstack/react-router";
import { STUDIO_THREADS } from "@/lib/features";
import { StudioWorkspace } from "@/components/studio/StudioWorkspace";
import { GROWTH_SKILLS, type GrowthSkillId } from "@/lib/creatorGrowth/skillManifest";

export type StudioSearch = Readonly<{
  thread?: string;
  skill?: GrowthSkillId;
}>;

function isGrowthSkillId(value: unknown): value is GrowthSkillId {
  return GROWTH_SKILLS.some((skill) => skill.id === value);
}

function parseThreadId(value: unknown): string | undefined {
  return typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)
    ? value
    : undefined;
}

export function parseStudioSearch(search: Record<string, unknown>): StudioSearch {
  return {
    thread: parseThreadId(search.thread),
    skill: isGrowthSkillId(search.skill) ? search.skill : undefined,
  };
}

export const Route = createFileRoute("/_app/studio")({
  validateSearch: parseStudioSearch,
  component: StudioRoute,
});
function StudioRoute() {
  const { thread, skill } = Route.useSearch();
  return STUDIO_THREADS
    ? <StudioWorkspace threadId={thread} skill={skill}/>
    : <div className="s-card"><h1>工作室準備中 / Studio is coming</h1><Link className="s-btn" to="/my">繼續我的任務 / Continue missions</Link></div>;
}
