import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Star, Clock } from "lucide-react";
import { useMission } from "@/lib/queries/kocmax";
import { BadgePill } from "@/components/BadgePill";

export const Route = createFileRoute("/kocmax/$slug/mission/$missionSlug")({ component: MissionDetail });

function MissionDetail() {
  const { slug, missionSlug } = Route.useParams();
  const m = useMission(missionSlug);
  return (
    <div className="mx-auto max-w-lg pb-6">
      <header className="glass-panel sticky top-0 z-30 flex items-center gap-3 border-b-2 border-[var(--color-ink)] p-3">
        <Link to="/kocmax/$slug/mission" params={{ slug }} aria-label="返回" className="grid h-9 w-9 place-items-center rounded-full border-2 border-[var(--color-ink)] bg-white"><ArrowLeft size={18} /></Link>
        <h1 className="truncate font-heading font-semibold">{m.data?.title ?? "任務"}</h1>
      </header>
      <div className="space-y-4 p-4">
        {m.data?.category && <BadgePill>{m.data.category}</BadgePill>}
        <h2 className="font-display text-xl font-bold">{m.data?.title}</h2>
        <section className="pastel-card rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4">
          <h3 className="mb-1 font-heading font-bold">任務詳情</h3>
          <p className="text-sm text-[var(--color-soft-ink)]">{m.data?.description}</p>
        </section>
        <section className="pastel-card flex items-center gap-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4">
          <Star className="text-[var(--color-magenta)]" aria-hidden />
          <div><p className="font-heading font-bold">獎勵積分</p><p className="font-display text-lg">{m.data?.points_reward} 積分</p></div>
        </section>
        {m.data?.deadline && (
          <section className="pastel-card flex items-center gap-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4">
            <Clock aria-hidden />
            <div><p className="font-heading font-bold">截止日期</p><p>{m.data.deadline.slice(0, 10)}</p></div>
          </section>
        )}
        <Link to="/kocmax/$slug/login" params={{ slug }} className="btn-primary block rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] py-3 text-center font-heading font-bold text-[var(--color-ink)]">開始任務</Link>
      </div>
    </div>
  );
}
