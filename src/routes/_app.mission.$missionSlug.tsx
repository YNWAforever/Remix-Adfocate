import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Star, Clock } from "lucide-react";
import { useMission, useMyMissions, useJoinMission, useSubmitMission } from "@/lib/queries/kocmax";
import { BadgePill } from "@/components/BadgePill";
import { SkeletonCard } from "@/components/SkeletonCard";

export const Route = createFileRoute("/_app/mission/$missionSlug")({ component: MissionDetail });

const STATUS_LABEL: Record<string, string> = {
  joined: "進行中", submitted: "審批中", under_review: "審批中",
  approved: "已通過", rejected: "未通過", expired: "已過期",
};

function MissionDetail() {
  const { missionSlug } = Route.useParams();
  const m = useMission(missionSlug);
  const mine = useMyMissions();
  const join = useJoinMission(missionSlug);
  const submit = useSubmitMission(missionSlug);
  const [urls, setUrls] = useState("");

  if (m.isLoading) return <div className="p-4"><SkeletonCard className="h-96" /></div>;
  if (m.isError || !m.data) return (
    <div className="flex flex-col items-center gap-4 p-8 text-center">
      <p className="text-sm text-[var(--color-magenta)]">無法載入任務</p>
      <Link to="/mission" className="text-sm underline">返回列表</Link>
    </div>
  );

  const sub = mine.data?.find((s) => s.missions.slug === missionSlug);
  const isApplication = m.data.access_type === "application";

  async function onSubmit() {
    const list = urls.split("\n").map((u) => u.trim()).filter(Boolean);
    if (list.length === 0) return;
    await submit.mutateAsync({ content_urls: list });
    setUrls("");
  }

  return (
    <div className="mx-auto max-w-lg pb-6">
      <header className="glass-panel sticky top-0 z-30 flex items-center gap-3 border-b-2 border-[var(--color-ink)] p-3">
        <Link to="/mission" aria-label="返回" className="grid h-9 w-9 place-items-center rounded-full border-2 border-[var(--color-ink)] bg-white"><ArrowLeft size={18} /></Link>
        <h1 className="truncate font-heading font-semibold">{m.data.title}</h1>
      </header>
      <div className="space-y-4 p-4">
        {m.data.category && <BadgePill>{m.data.category}</BadgePill>}
        <h2 className="font-display text-xl font-bold">{m.data.title}</h2>
        <section className="pastel-card rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4">
          <h3 className="mb-1 font-heading font-bold">任務詳情</h3>
          <p className="text-sm text-[var(--color-soft-ink)]">{m.data.description}</p>
        </section>
        <section className="pastel-card flex items-center gap-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4">
          <Star className="text-[var(--color-magenta)]" aria-hidden />
          <div><p className="font-heading font-bold">獎勵積分</p><p className="font-display text-lg">{m.data.points_reward} 積分</p></div>
        </section>
        {m.data.deadline && (
          <section className="pastel-card flex items-center gap-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4">
            <Clock aria-hidden />
            <div><p className="font-heading font-bold">截止日期</p><p>{m.data.deadline.slice(0, 10)}</p></div>
          </section>
        )}

        {/* Action zone */}
        {isApplication ? (
          <button disabled className="block w-full cursor-not-allowed rounded-full border-2 border-[var(--color-ink)] bg-gray-200 py-3 text-center font-heading font-bold text-[var(--color-soft-ink)]">需要申請 · 即將推出</button>
        ) : !sub ? (
          <button onClick={() => join.mutateAsync()} disabled={join.isPending} className="btn-primary block w-full rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] py-3 text-center font-heading font-bold text-[var(--color-ink)]">{join.isPending ? "處理中…" : "加入任務"}</button>
        ) : sub.status === "joined" ? (
          <section className="pastel-card space-y-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4">
            <h3 className="font-heading font-bold">提交內容</h3>
            <textarea value={urls} onChange={(e) => setUrls(e.target.value)} rows={3} placeholder="貼上你的內容連結（每行一條）" className="w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] p-2 text-sm" />
            <button onClick={onSubmit} disabled={submit.isPending} className="btn-primary block w-full rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] py-3 text-center font-heading font-bold text-[var(--color-ink)]">{submit.isPending ? "提交中…" : "提交內容"}</button>
          </section>
        ) : (
          <section className="pastel-card flex items-center justify-between rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4">
            <span className="font-heading font-bold">狀態</span>
            <span className="font-display">{STATUS_LABEL[sub.status] ?? sub.status}{sub.status === "approved" ? ` · +${sub.points_awarded} 積分` : ""}</span>
          </section>
        )}
      </div>
    </div>
  );
}
