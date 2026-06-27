// src/routes/admin.campaigns.index.tsx
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AdminAuthError, AdminRequestError, adminKeys, closeCampaign, fetchCampaigns,
  publishCampaign, settleCampaign, type AdminCampaign,
} from "@/lib/admin";
import { useAdminAuth } from "@/components/admin/AdminAuthContext";
import { useAdminWorkspace } from "@/components/admin/AdminWorkspaceContext";

export const Route = createFileRoute("/admin/campaigns/")({ component: CampaignsList });

const STATUSES = ["", "draft", "active", "closed"] as const;
const STATUS_LABEL: Record<string, string> = {
  "": "全部", draft: "草稿", active: "進行中", closed: "已關閉", settled: "已結算",
};

function CampaignsList() {
  const { authed, reportAuthError } = useAdminAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { workspace } = useAdminWorkspace();
  const [status, setStatus] = useState("");

  const list = useQuery({
    queryKey: adminKeys.campaigns(workspace, status),
    queryFn: () => fetchCampaigns(workspace, status),
    enabled: authed,
    retry: false,
  });
  useEffect(() => {
    if (list.error instanceof AdminAuthError) reportAuthError(list.error);
  }, [list.error, reportAuthError]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin-campaigns"] });
  const onErr = (e: unknown) => {
    if (e instanceof AdminAuthError) { reportAuthError(e); return; }
    if (e instanceof AdminRequestError && e.code === "insufficient_budget") {
      window.alert("預算不足，請增值後再結算");
      return;
    }
    window.alert(e instanceof AdminRequestError ? e.message : "操作失敗");
  };
  const publish = useMutation({ mutationFn: (id: string) => publishCampaign(id), onSuccess: invalidate, onError: onErr });
  const close = useMutation({ mutationFn: (id: string) => closeCampaign(id), onSuccess: invalidate, onError: onErr });
  const settle = useMutation({ mutationFn: (id: string) => settleCampaign(id), onSuccess: invalidate, onError: onErr });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="狀態" value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white px-2 text-sm">
          {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <Link to="/admin/campaigns/new" className="ml-auto rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-3 py-1 font-heading font-bold">+ 新挑戰</Link>
      </div>

      {list.isLoading ? <p className="text-sm">載入中…</p> : null}
      {list.data?.campaigns.length === 0 ? <p className="text-sm text-[var(--color-soft-ink)]">此品牌尚未有挑戰。</p> : null}

      <div className="space-y-3">
        {list.data?.campaigns.map((c: AdminCampaign) => (
          <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-heading font-bold">{c.title}</p>
                <span className="rounded-full border-2 border-[var(--color-ink)] px-2 py-0.5 text-xs font-bold">{STATUS_LABEL[c.status] ?? c.status}</span>
              </div>
              <p className="text-xs text-[var(--color-soft-ink)]">{c.slug} · 目標 {c.goal_target} · {(c.prize_tiers?.length ?? 0)} 個獎品階級 · {c.ends_at ? c.ends_at.slice(0, 10) : "無截止"}</p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <button onClick={() => navigate({ to: "/admin/campaigns/$id", params: { id: c.id } })} className="rounded-full border-2 border-[var(--color-ink)] bg-white px-3 py-1 font-heading font-bold">編輯</button>
              {c.status === "draft" ? <button disabled={publish.isPending} onClick={() => publish.mutate(c.id)} className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-3 py-1 font-heading font-bold">發佈</button> : null}
              {c.status === "active" ? <button disabled={close.isPending} onClick={() => { if (window.confirm("關閉此挑戰？將停止新參與。")) close.mutate(c.id); }} className="rounded-full border-2 border-[var(--color-ink)] bg-white px-3 py-1 font-heading font-bold">關閉</button> : null}
              {c.status === "closed" ? <button disabled={settle.isPending} onClick={() => { if (window.confirm("結算此挑戰？將派發獎勵與獎品。")) settle.mutate(c.id); }} className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-3 py-1 font-heading font-bold">結算</button> : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
