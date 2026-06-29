import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AdminRequestError } from "@/lib/admin";
import {
  BrandAuthError, brandCampaignKeys, closeBrandCampaign, fetchBrandCampaigns,
  publishBrandCampaign, type BrandCampaign,
} from "@/lib/brand";
import { useBrandAuth } from "@/components/brand/BrandAuthContext";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/brand/campaigns/")({ component: BrandCampaignsList });

const STATUSES = ["", "draft", "active", "closed", "settled"] as const;
const STATUS_LABEL: Record<string, string> = {
  "": "全部", draft: "草稿", active: "進行中", closed: "已關閉", settled: "已結算",
};

function BrandCampaignsList() {
  const { t } = useI18n();
  const { reportAuthError } = useBrandAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [status, setStatus] = useState("");

  const list = useQuery({ queryKey: brandCampaignKeys.list(status), queryFn: () => fetchBrandCampaigns(status), retry: false });
  useEffect(() => {
    if (list.error instanceof BrandAuthError) reportAuthError(list.error);
  }, [list.error, reportAuthError]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["brand-campaigns"] });
  const onErr = (e: unknown) => {
    if (e instanceof BrandAuthError) { reportAuthError(e); return; }
    window.alert(e instanceof AdminRequestError ? e.message : "操作失敗");
  };
  const publish = useMutation({ mutationFn: (id: string) => publishBrandCampaign(id), onSuccess: invalidate, onError: onErr });
  const close = useMutation({ mutationFn: (id: string) => closeBrandCampaign(id), onSuccess: invalidate, onError: onErr });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="font-display text-lg font-bold">{t("app.brand.campaigns.title")}</h1>
        <select aria-label="狀態" value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white px-2 text-sm">
          {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <Link to="/brand/campaigns/new" className="ml-auto rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-3 py-1 font-heading font-bold">+ {t("app.brand.campaigns.new")}</Link>
      </div>

      {list.isLoading ? <p className="text-sm">載入中…</p> : null}
      {list.data?.campaigns.length === 0 ? <p className="text-sm text-[var(--color-soft-ink)]">尚未有挑戰。</p> : null}

      <div className="space-y-3">
        {list.data?.campaigns.map((c: BrandCampaign) => (
          <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-heading font-bold">{c.title}</p>
                <span className="rounded-full border-2 border-[var(--color-ink)] px-2 py-0.5 text-xs font-bold">{STATUS_LABEL[c.status] ?? c.status}</span>
              </div>
              <p className="text-xs text-[var(--color-soft-ink)]">{c.slug} · 目標 {c.goal_target} · {(c.prize_tiers?.length ?? 0)} 個獎品階級 · {c.ends_at ? c.ends_at.slice(0, 10) : "無截止"}</p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <button onClick={() => navigate({ to: "/brand/campaigns/$id", params: { id: c.id } })} className="rounded-full border-2 border-[var(--color-ink)] bg-white px-3 py-1 font-heading font-bold">編輯</button>
              {c.status === "draft" ? <button disabled={publish.isPending} onClick={() => publish.mutate(c.id)} className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-3 py-1 font-heading font-bold">發佈</button> : null}
              {c.status === "active" ? <button disabled={close.isPending} onClick={() => { if (window.confirm("關閉此挑戰？將停止新參與。")) close.mutate(c.id); }} className="rounded-full border-2 border-[var(--color-ink)] bg-white px-3 py-1 font-heading font-bold">關閉</button> : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
