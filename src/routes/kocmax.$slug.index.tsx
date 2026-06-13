import { createFileRoute } from "@tanstack/react-router";
import { useBalance, useMe, useMissions } from "@/lib/queries/kocmax";
import { useRealtimeBalance } from "@/lib/useRealtimeBalance";

export const Route = createFileRoute("/kocmax/$slug/")({ component: Home });

function Home() {
  const me = useMe();
  const balance = useBalance();
  const missions = useMissions();
  useRealtimeBalance(me.data?.id);

  return (
    <div className="p-4 space-y-6">
      <section className="rounded-xl bg-[var(--color-acid)] p-6 text-[var(--color-ink)]">
        <p className="text-sm">我的積分</p>
        {balance.isLoading ? <div className="skeleton-acid h-9 w-24" />
          : <p className="text-3xl font-bold">{balance.data?.balance ?? 0}</p>}
        {balance.data?.available_to && <p className="text-xs mt-1">到期：{balance.data.available_to.slice(0, 10)}</p>}
      </section>
      <section>
        <h2 className="font-bold mb-2">精選任務</h2>
        {missions.isError && <p className="text-sm text-[var(--color-magenta)]">載入失敗</p>}
        <ul className="space-y-2">
          {missions.data?.slice(0, 3).map((m) => (
            <li key={m.id} className="rounded border p-3 bg-white">
              <p className="font-medium">{m.title}</p>
              <p className="text-sm">{m.points_reward} 積分 · {m.category}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
