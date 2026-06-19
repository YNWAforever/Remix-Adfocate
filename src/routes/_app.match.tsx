import { createFileRoute, Link } from "@tanstack/react-router";
import { Sparkles, Lock } from "lucide-react";
import { useMissionMatch } from "@/lib/queries/kocmax";
import { MissionCard } from "@/components/MissionCard";

export const Route = createFileRoute("/_app/match")({ component: Match });

function Match() {
  const match = useMissionMatch();
  const empty = !match.isLoading && !match.isError && (match.data?.length ?? 0) === 0;

  return (
    <div className="mx-auto w-full max-w-lg space-y-4 p-4 lg:max-w-5xl">
      <header>
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-soft-ink)]">ADFOCATE · KOCMAX</span>
        <h1 className="mt-1 flex items-center gap-2 font-display text-2xl font-bold leading-tight">
          <Sparkles size={22} aria-hidden /> 今日整乜好？
        </h1>
        <p className="mt-1 text-sm text-[var(--color-soft-ink)]">為你揀選最啱嘅任務</p>
      </header>

      {match.isLoading && <p className="text-sm text-[var(--color-soft-ink)]">載入中…</p>}
      {match.isError && <p className="text-sm text-[var(--color-magenta)]">載入失敗，請重試</p>}
      {empty && (
        <p className="rounded-[var(--radius)] border-2 border-dashed border-[var(--color-ink)] p-6 text-center text-sm text-[var(--color-soft-ink)]">
          暫時冇啱你嘅任務，遲啲再嚟睇睇
        </p>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        {match.data?.map((m) => (
          <Link
            key={m.id}
            to="/mission/$missionSlug"
            params={{ missionSlug: m.slug }}
            className={m.locked ? "block opacity-60" : "block"}
          >
            <MissionCard title={m.title} category={m.category ?? undefined} points={m.points_reward} deadline={m.deadline ?? undefined} />
            <div className="mt-1 flex items-center gap-2">
              <span className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-2 py-0.5 font-mono text-xs font-bold">
                {m.fit_score}% 啱你
              </span>
              <span className="flex items-center gap-1 text-xs text-[var(--color-soft-ink)]">
                {m.locked && <Lock size={12} aria-hidden />}
                {m.rationale}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
