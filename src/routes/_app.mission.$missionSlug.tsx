import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Lightbulb } from "lucide-react";
import { useMission, useMyMissions, useJoinMission, useSubmitMission, useApplyMission, useMe } from "@/lib/queries/kocmax";
import { BadgePill } from "@/components/BadgePill";
import { SkeletonCard } from "@/components/SkeletonCard";
import { HookPanel } from "@/components/HookPanel";
import { MissionFacts } from "@/components/MissionFacts";
import { MissionBrief } from "@/components/MissionBrief";
import { missionTypeLabel } from "@/lib/missionMeta";

export const Route = createFileRoute("/_app/mission/$missionSlug")({ component: MissionDetail });

const STATUS_LABEL: Record<string, string> = {
  applied: "審批中",
  joined: "進行中", submitted: "審批中", under_review: "審批中",
  approved: "已通過", rejected: "未通過", expired: "已過期", declined: "未獲接受",
};

function MissionDetail() {
  const { missionSlug } = Route.useParams();
  const m = useMission(missionSlug);
  const mine = useMyMissions();
  const join = useJoinMission(missionSlug);
  const submit = useSubmitMission(missionSlug);
  const apply = useApplyMission(missionSlug);
  const me = useMe();
  const [urls, setUrls] = useState("");
  const [showHooks, setShowHooks] = useState(false);

  if (m.isLoading) return <div className="mx-auto max-w-lg p-4 lg:max-w-5xl"><SkeletonCard className="h-96" /></div>;
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
    <div className="mx-auto max-w-lg pb-6 lg:max-w-5xl">
      <header className="glass-panel sticky top-0 z-30 flex items-center gap-3 border-b-2 border-[var(--color-ink)] p-3">
        <Link to="/mission" aria-label="返回" className="grid h-9 w-9 place-items-center rounded-full border-2 border-[var(--color-ink)] bg-white"><ArrowLeft size={18} /></Link>
        <h1 className="truncate font-heading font-semibold">{m.data.title}</h1>
      </header>

      <div className="p-4 lg:grid lg:grid-cols-[1.5fr_1fr] lg:items-start lg:gap-6">
        {/* Left column: title + brief */}
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {m.data.category && <BadgePill>{m.data.category}</BadgePill>}
            <span className="rounded-full border-2 border-[var(--color-ink)] bg-white px-3 py-1 text-xs font-heading font-bold">{missionTypeLabel(m.data.mission_type)}</span>
          </div>
          <h2 className="font-display text-xl font-bold">{m.data.title}</h2>
          <MissionBrief mission={m.data} />
        </div>

        {/* Right column (desktop): facts + action zone + hooks; stacks below on mobile */}
        <div className="mt-4 space-y-4 lg:mt-0">
          <MissionFacts mission={m.data} creatorLevel={me.data?.level} />

          {/* Action zone */}
          {!sub ? (
            isApplication ? (
              <button onClick={() => apply.mutateAsync()} disabled={apply.isPending} className="btn-primary block w-full rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] py-3 text-center font-heading font-bold text-[var(--color-ink)]">{apply.isPending ? "處理中…" : "申請任務"}</button>
            ) : (
              <button onClick={() => join.mutateAsync()} disabled={join.isPending} className="btn-primary block w-full rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] py-3 text-center font-heading font-bold text-[var(--color-ink)]">{join.isPending ? "處理中…" : "加入任務"}</button>
            )
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

          {!isApplication && (
            <>
              <button
                onClick={() => setShowHooks((v) => !v)}
                aria-label="生成內容靈感"
                className="flex w-full items-center justify-center gap-2 rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-magenta)] py-3 text-center font-heading font-bold text-white"
              >
                <Lightbulb size={18} aria-hidden /> 生成內容靈感
              </button>
              {showHooks && <HookPanel missionSlug={missionSlug} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
