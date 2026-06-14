import { createFileRoute, Link } from "@tanstack/react-router";
import { Target, Gift, Receipt, CalendarCheck } from "lucide-react";
import { useBalance, useMe, useMissions } from "@/lib/queries/kocmax";
import { useRealtimeBalance } from "@/lib/useRealtimeBalance";
import { PointsBalanceCard } from "@/components/PointsBalanceCard";
import { MissionCard } from "@/components/MissionCard";

export const Route = createFileRoute("/_app/home")({ component: Home });

function Home() {
  const me = useMe();
  const balance = useBalance();
  const missions = useMissions();
  useRealtimeBalance(me.data?.id);

  return (
    <div className="mx-auto max-w-lg space-y-6 p-4">
      <section className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-acid)] p-6 text-[var(--color-ink)] shadow-[4px_4px_0_0_var(--color-ink)]">
        <span className="font-mono text-[11px] uppercase tracking-[0.18em]">ADFOCATE · KOCMAX</span>
        <h1 className="mt-2 font-display text-3xl font-bold leading-[1.05]">賺取積分<br/>兌換心儀獎賞</h1>
        <p className="mt-2 text-sm">購物賺積分 · 完成任務 · 兌換獎賞</p>
      </section>

      {balance.isError && <p className="text-sm text-[var(--color-magenta)]">積分載入失敗</p>}
      <PointsBalanceCard balance={balance.data?.balance ?? 0} availableTo={balance.data?.available_to} loading={balance.isLoading} />

      <section className="grid grid-cols-2 gap-3">
        {[
          { to: "/mission", label: "限時任務", icon: Target },
          { to: "/redemption", label: "積分兌換", icon: Gift },
          { to: "/wallet", label: "積分記錄", icon: Receipt },
          { to: "/explore", label: "探索獎賞", icon: CalendarCheck },
        ].map((a) => {
          const Icon = a.icon;
          return (
            <Link key={a.label} to={a.to} aria-label={a.label} className="pastel-card flex items-center gap-2 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4 font-heading font-semibold">
              <Icon size={20} aria-hidden /> {a.label}
            </Link>
          );
        })}
      </section>

      <section>
        <h2 className="mb-2 font-heading font-bold">精選任務</h2>
        {missions.isError && <p className="text-sm text-[var(--color-magenta)]">載入失敗</p>}
        <div className="space-y-2">
          {missions.data?.slice(0, 3).map((m) => (
            <Link key={m.id} to="/mission/$missionSlug" params={{ missionSlug: m.slug }}>
              <MissionCard title={m.title} category={m.category} points={m.points_reward} deadline={m.deadline} />
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
