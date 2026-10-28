// src/routes/admin.missions.index.tsx
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AdminAuthError, AdminRequestError, adminMissionKeys, closeMission, deleteMissionDraft,
  duplicateMission, fetchAdminMissions, publishMission, type AdminMissionRow,
} from "@/lib/admin";
import { useAdminAuth } from "@/components/admin/AdminAuthContext";
import { useAdminWorkspace } from "@/components/admin/AdminWorkspaceContext";
import { RequestFeedback, useCanShowPreviousData } from "@/components/RequestFeedback";

export const Route = createFileRoute("/admin/missions/")({ component: MissionsList });

const STATUSES = ["", "draft", "active", "closed"] as const;
const STATUS_LABEL: Record<string, string> = { "": "全部", draft: "草稿", active: "進行中", closed: "已關閉" };

function MissionsList() {
  const { authed, reportAuthError } = useAdminAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { workspace } = useAdminWorkspace();
  const [status, setStatus] = useState("");

  const list = useQuery({
    queryKey: adminMissionKeys.list(workspace, status),
    queryFn: () => fetchAdminMissions(workspace, status),
    enabled: authed,
    retry: false,
  });
  const visibleMissions = useCanShowPreviousData(list, adminMissionKeys.list(workspace, status)) ? list.data : undefined;
  useEffect(() => {
    if (list.error instanceof AdminAuthError) reportAuthError(list.error);
  }, [list.error, reportAuthError]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin-missions"] });
  const onErr = (e: unknown) => {
    if (e instanceof AdminAuthError) { reportAuthError(e); return; }
    window.alert(e instanceof AdminRequestError ? e.message : "操作失敗");
  };
  const publish = useMutation({ mutationFn: (id: string) => publishMission(id), onSuccess: invalidate, onError: onErr });
  const close = useMutation({ mutationFn: (id: string) => closeMission(id), onSuccess: invalidate, onError: onErr });
  const remove = useMutation({ mutationFn: (id: string) => deleteMissionDraft(id), onSuccess: invalidate, onError: onErr });
  const duplicate = useMutation({
    mutationFn: (id: string) => duplicateMission(id),
    onSuccess: (res) => {
      invalidate();
      navigate({ to: "/admin/missions/$missionId", params: { missionId: res.mission.id } });
    },
    onError: onErr,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="狀態" value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white px-2 text-sm">
          {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <Link to="/admin/missions/new" className="ml-auto rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-3 py-1 font-heading font-bold">+ 新任務</Link>
      </div>

      {list.isLoading ? <p className="text-sm">載入中…</p> : null}
      <RequestFeedback error={list.error} stale={Boolean(visibleMissions)} retry={() => void list.refetch()} />
      <RequestFeedback error={publish.error ?? close.error ?? remove.error ?? duplicate.error} />
      {!list.isError && visibleMissions?.missions.length === 0 ? <p className="text-sm text-[var(--color-soft-ink)]">此品牌尚未有任務。</p> : null}

      <div className="space-y-3">
        {visibleMissions?.missions.map((m: AdminMissionRow) => (
          <div key={m.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-heading font-bold">{m.title}</p>
                <span className="rounded-full border-2 border-[var(--color-ink)] px-2 py-0.5 text-xs font-bold">{STATUS_LABEL[m.status]}</span>
                <span className="rounded-full border-2 border-[var(--color-ink)] bg-white px-2 py-0.5 text-xs">{m.mission_type}</span>
                {m.engaged ? <span className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-2 py-0.5 text-xs font-bold">已有參與</span> : null}
              </div>
              <p className="text-xs text-[var(--color-soft-ink)]">{m.slug} · {m.points_reward} 分{m.cash_reward ? ` / $${m.cash_reward}` : ""} · {m.filled}/{m.quota} · {m.deadline ?? "無截止"}</p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <button onClick={() => navigate({ to: "/admin/missions/$missionId", params: { missionId: m.id } })} className="rounded-full border-2 border-[var(--color-ink)] bg-white px-3 py-1 font-heading font-bold">編輯</button>
              {m.status === "draft" ? <button disabled={publish.isPending} onClick={() => publish.mutate(m.id)} className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-3 py-1 font-heading font-bold">發佈</button> : null}
              {m.status === "active" ? <button disabled={close.isPending} onClick={() => { if (window.confirm("關閉此任務？將停止新報名。")) close.mutate(m.id); }} className="rounded-full border-2 border-[var(--color-ink)] bg-white px-3 py-1 font-heading font-bold">關閉</button> : null}
              {m.status === "draft" ? <button disabled={remove.isPending} onClick={() => { if (window.confirm("刪除此草稿？")) remove.mutate(m.id); }} className="rounded-full border-2 border-[var(--color-ink)] bg-white px-3 py-1 font-heading font-bold">刪除</button> : null}
              <button disabled={duplicate.isPending} onClick={() => duplicate.mutate(m.id)} className="rounded-full border-2 border-[var(--color-ink)] bg-white px-3 py-1 font-heading font-bold">複製</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
