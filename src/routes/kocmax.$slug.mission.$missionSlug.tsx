import { createFileRoute, Link } from "@tanstack/react-router";
import { useMission } from "@/lib/queries/kocmax";

export const Route = createFileRoute("/kocmax/$slug/mission/$missionSlug")({ component: MissionDetail });

function MissionDetail() {
  const { slug, missionSlug } = Route.useParams();
  const { data, isLoading, isError } = useMission(missionSlug);
  if (isLoading) return <div className="p-4"><div className="skeleton-card h-40" /></div>;
  if (isError || !data) return (
    <div className="p-8">任務不存在 <Link to="/kocmax/$slug/mission" params={{ slug }} className="underline">返回</Link></div>
  );
  return (
    <div className="p-4 space-y-4">
      <Link to="/kocmax/$slug/mission" params={{ slug }} className="text-sm underline">← 返回</Link>
      <h1 className="text-xl font-bold">{data.title}</h1>
      <p className="text-sm">{data.description}</p>
      <div className="rounded border p-4 bg-white">{data.points_reward} 積分 · {data.category}</div>
    </div>
  );
}
