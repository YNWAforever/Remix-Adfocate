import { createFileRoute, Link } from "@tanstack/react-router";
import { useRedemptions } from "@/lib/queries/kocmax";
import { SkeletonCard } from "@/components/SkeletonCard";

export const Route = createFileRoute("/_app/redemption/history")({ component: RedemptionHistory });

function RedemptionHistory() {
  const q = useRedemptions();
  return (
    <div className="mx-auto w-full max-w-lg space-y-4 p-4 lg:max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold">兌換記錄</h1>
        <Link to="/redemption" className="text-sm font-bold text-[var(--color-magenta)]">返回兌換</Link>
      </div>
      {q.isLoading && <SkeletonCard className="h-24" />}
      {q.isError && <p className="text-sm text-[var(--color-magenta)]">記錄載入失敗</p>}
      <ul className="space-y-2">
        {q.data?.map((r) => (
          <li key={r.id} className="pastel-card rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
            <div className="flex items-center justify-between">
              <p className="font-heading font-semibold">{r.redemption_gifts?.name ?? "獎賞"}</p>
              <span className="font-display font-bold text-[var(--color-magenta)]">-{r.points_spent}</span>
            </div>
            <p className="mt-1 font-mono text-sm">兌換碼：{r.code ?? "—"}</p>
            <p className="text-xs text-[var(--color-soft-ink)]">{r.created_at.slice(0, 10)}</p>
          </li>
        ))}
        {!q.isLoading && !q.isError && q.data?.length === 0 && (
          <li className="text-sm text-[var(--color-soft-ink)]">暫無兌換記錄</li>
        )}
      </ul>
    </div>
  );
}
