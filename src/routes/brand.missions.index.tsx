import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AdminRequestError } from "@/lib/admin";
import {
  BrandAuthError, brandKeys, closeBrandMission, deleteBrandMission, fetchBrandMissions,
  publishBrandMission, type BrandMission,
} from "@/lib/brand";
import { useBrandAuth } from "@/components/brand/BrandAuthContext";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/brand/missions/")({ component: BrandMissionsList });

const STATUSES = ["", "draft", "active", "closed"] as const;
const STATUS_LABEL: Record<string, string> = { "": "全部", draft: "草稿", active: "進行中", closed: "已關閉" };

function BrandMissionsList() {
  const { t } = useI18n();
  const { reportAuthError } = useBrandAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [status, setStatus] = useState("");

  const list = useQuery({ queryKey: brandKeys.missions(status), queryFn: () => fetchBrandMissions(status), retry: false });
  useEffect(() => {
    if (list.error instanceof BrandAuthError) reportAuthError(list.error);
  }, [list.error, reportAuthError]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["brand-missions"] });
  const onErr = (e: unknown) => {
    if (e instanceof BrandAuthError) { reportAuthError(e); return; }
    window.alert(e instanceof AdminRequestError ? e.message : "操作失敗");
  };
  const publish = useMutation({ mutationFn: (id: string) => publishBrandMission(id), onSuccess: invalidate, onError: onErr });
  const close = useMutation({ mutationFn: (id: string) => closeBrandMission(id), onSuccess: invalidate, onError: onErr });
  const remove = useMutation({ mutationFn: (id: string) => deleteBrandMission(id), onSuccess: invalidate, onError: onErr });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="狀態" value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white px-2 text-sm">
          {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <Link to="/brand/missions/new" className="ml-auto rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-3 py-1 font-heading font-bold">+ {t("app.brand.newMission")}</Link>
      </div>

      {list.isLoading ? <p className="text-sm">載入中…</p> : null}
      {list.data?.missions.length === 0 ? <p className="text-sm text-[var(--color-soft-ink)]">尚未有任務。</p> : null}

      <div className="space-y-3">
        {list.data?.missions.map((m: BrandMission) => (
          <div key={m.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-heading font-bold">{m.title}</p>
                <span className="rounded-full border-2 border-[var(--color-ink)] px-2 py-0.5 text-xs font-bold">{STATUS_LABEL[m.status] ?? m.status}</span>
                <span className="rounded-full border-2 border-[var(--color-ink)] bg-white px-2 py-0.5 text-xs">{m.mission_type}</span>
              </div>
              <p className="text-xs text-[var(--color-soft-ink)]">{m.slug} · {m.points_reward} 分{m.cash_reward ? ` / $${m.cash_reward}` : ""} · {m.filled}/{m.quota} · {m.deadline ?? "無截止"}</p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <button onClick={() => navigate({ to: "/brand/missions/$missionId", params: { missionId: m.id } })} className="rounded-full border-2 border-[var(--color-ink)] bg-white px-3 py-1 font-heading font-bold">編輯</button>
              {m.status === "draft" ? <button disabled={publish.isPending} onClick={() => publish.mutate(m.id)} className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-3 py-1 font-heading font-bold">發佈</button> : null}
              {m.status === "active" ? <button disabled={close.isPending} onClick={() => { if (window.confirm("關閉此任務？將停止新報名。")) close.mutate(m.id); }} className="rounded-full border-2 border-[var(--color-ink)] bg-white px-3 py-1 font-heading font-bold">關閉</button> : null}
              {m.status === "draft" ? <button disabled={remove.isPending} onClick={() => { if (window.confirm("刪除此草稿？")) remove.mutate(m.id); }} className="rounded-full border-2 border-[var(--color-ink)] bg-white px-3 py-1 font-heading font-bold">刪除</button> : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
