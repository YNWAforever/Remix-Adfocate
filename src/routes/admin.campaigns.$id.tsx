// src/routes/admin.campaigns.$id.tsx
import { createFileRoute, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AdminAuthError, AdminRequestError, adminKeys, attachCampaignMission, closeCampaign,
  detachCampaignMission, fetchCampaign, publishCampaign, settleCampaign, updateCampaign,
  type AdminCampaignMission, type CampaignDraftInput,
} from "@/lib/admin";
import { useAdminAuth } from "@/components/admin/AdminAuthContext";
import {
  PrizeTierEditor, fromPrizeTiers, toPrizeTiers, validateTiersClient, type DraftTier,
} from "@/components/admin/CampaignPrizeTiers";

export const Route = createFileRoute("/admin/campaigns/$id")({ component: EditCampaign });

// datetime-local wants "YYYY-MM-DDTHH:mm"; the API returns ISO strings.
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function EditCampaign() {
  const { id } = useParams({ from: "/admin/campaigns/$id" });
  const { authed, reportAuthError } = useAdminAuth();
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: adminKeys.campaignDetail(id),
    queryFn: () => fetchCampaign(id),
    enabled: authed,
    retry: false,
  });
  useEffect(() => { if (q.error instanceof AdminAuthError) reportAuthError(q.error); }, [q.error, reportAuthError]);

  // Local edit state — hydrated once the campaign loads.
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [goalTarget, setGoalTarget] = useState(1);
  const [bonusPoints, setBonusPoints] = useState(0);
  const [bonusXp, setBonusXp] = useState(0);
  const [tiers, setTiers] = useState<DraftTier[]>([]);
  const [tierError, setTierError] = useState<string | null>(null);
  const [missionId, setMissionId] = useState("");
  const [hydratedFor, setHydratedFor] = useState<string | null>(null);

  const campaign = q.data?.campaign;
  useEffect(() => {
    if (!campaign || hydratedFor === campaign.id) return;
    setTitle(campaign.title ?? "");
    setSlug(campaign.slug ?? "");
    setDescription(campaign.description ?? "");
    setStartsAt(toLocalInput(campaign.starts_at));
    setEndsAt(toLocalInput(campaign.ends_at));
    setGoalTarget(campaign.goal_target ?? 1);
    setBonusPoints(campaign.completion_bonus_points ?? 0);
    setBonusXp(campaign.completion_bonus_xp ?? 0);
    setTiers(fromPrizeTiers(campaign.prize_tiers ?? []));
    setHydratedFor(campaign.id);
  }, [campaign, hydratedFor]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: adminKeys.campaignDetail(id) });
    qc.invalidateQueries({ queryKey: ["admin-campaigns"] });
  };
  const onErr = (e: unknown) => {
    if (e instanceof AdminAuthError) { reportAuthError(e); return; }
    if (e instanceof AdminRequestError && e.code === "insufficient_budget") {
      window.alert("預算不足，請增值後再結算");
      return;
    }
    window.alert(e instanceof AdminRequestError ? e.message : "操作失敗");
  };

  const save = useMutation({
    mutationFn: (patch: Partial<CampaignDraftInput>) => updateCampaign(id, patch),
    onSuccess: invalidate,
  });
  const publish = useMutation({ mutationFn: () => publishCampaign(id), onSuccess: invalidate, onError: onErr });
  const close = useMutation({ mutationFn: () => closeCampaign(id), onSuccess: invalidate, onError: onErr });
  const settle = useMutation({ mutationFn: () => settleCampaign(id), onSuccess: invalidate, onError: onErr });
  const attach = useMutation({
    mutationFn: (mid: string) => attachCampaignMission(id, mid),
    onSuccess: () => { setMissionId(""); invalidate(); },
    onError: onErr,
  });
  const detach = useMutation({ mutationFn: (mid: string) => detachCampaignMission(id, mid), onSuccess: invalidate, onError: onErr });

  if (q.isLoading) return <p className="text-sm">載入中…</p>;
  if (!campaign) return <p className="text-sm text-red-600">找不到挑戰。</p>;

  // Edit-lock matrix: once not a draft, config fields freeze. ends_at stays editable
  // (extend-only; the server re-validates). slug locks too.
  const locked = campaign.status !== "draft";
  const fieldErrors = save.error instanceof AdminRequestError ? save.error.fields ?? {} : {};

  const onSave = (e: React.FormEvent) => {
    e.preventDefault();
    const tierCheck = validateTiersClient(tiers);
    if (!tierCheck.ok) { setTierError(tierCheck.error ?? "獎品階級無效"); return; }
    setTierError(null);
    // When locked, only send the fields the server still accepts (title/description/ends_at).
    const patch: Partial<CampaignDraftInput> = locked
      ? {
          title: title.trim(),
          description: description.trim() || null,
          ends_at: endsAt ? new Date(endsAt).toISOString() : campaign.ends_at,
        }
      : {
          slug: slug.trim(),
          title: title.trim(),
          description: description.trim() || null,
          starts_at: startsAt ? new Date(startsAt).toISOString() : "",
          ends_at: endsAt ? new Date(endsAt).toISOString() : "",
          goal_target: Number(goalTarget),
          completion_bonus_points: Number(bonusPoints),
          completion_bonus_xp: Number(bonusXp),
          prize_tiers: toPrizeTiers(tiers),
        };
    save.mutate(patch);
  };

  const field = "h-9 w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white px-2 text-sm disabled:opacity-50";
  const labelCls = "block text-xs font-bold text-[var(--color-soft-ink)]";
  const errCls = "text-xs text-red-600";
  const STATUS_LABEL: Record<string, string> = { draft: "草稿", active: "進行中", closed: "已關閉", settled: "已結算" };
  const missions = (q.data?.missions ?? []) as AdminCampaignMission[];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="font-display text-lg font-bold">{campaign.title}</h1>
        <span className="rounded-full border-2 border-[var(--color-ink)] px-2 py-0.5 text-xs font-bold">{STATUS_LABEL[campaign.status] ?? campaign.status}</span>
        <span className="text-xs text-[var(--color-soft-ink)]">參與者：{q.data?.participants ?? 0}</span>
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2">
        {campaign.status === "draft" ? <button disabled={publish.isPending} onClick={() => publish.mutate()} className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-3 py-1 font-heading font-bold">發佈</button> : null}
        {campaign.status === "active" ? <button disabled={close.isPending} onClick={() => { if (window.confirm("關閉此挑戰？")) close.mutate(); }} className="rounded-full border-2 border-[var(--color-ink)] bg-white px-3 py-1 font-heading font-bold">關閉</button> : null}
        {campaign.status === "closed" ? <button disabled={settle.isPending} onClick={() => { if (window.confirm("結算此挑戰？將派發獎勵與獎品。")) settle.mutate(); }} className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-3 py-1 font-heading font-bold">結算</button> : null}
      </div>

      {locked ? <p className="text-xs text-[var(--color-soft-ink)]">挑戰已開始：設定欄位已鎖定，只可調整標題、描述與延長結束時間。</p> : null}

      <form onSubmit={onSave} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="block space-y-1">
              <span className={labelCls}>Slug</span>
              <input aria-label="Slug" value={slug} disabled={locked} onChange={(e) => setSlug(e.target.value)} className={field} />
            </label>
            {fieldErrors.slug ? <p className={errCls}>{fieldErrors.slug}</p> : null}
          </div>
          <div className="space-y-1">
            <label className="block space-y-1">
              <span className={labelCls}>標題</span>
              <input aria-label="標題" value={title} onChange={(e) => setTitle(e.target.value)} className={field} />
            </label>
            {fieldErrors.title ? <p className={errCls}>{fieldErrors.title}</p> : null}
          </div>
        </div>
        <label className="block space-y-1">
          <span className={labelCls}>描述</span>
          <textarea aria-label="描述" value={description} onChange={(e) => setDescription(e.target.value)} className="w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white px-2 py-1 text-sm" rows={2} />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="block space-y-1">
              <span className={labelCls}>開始時間</span>
              <input aria-label="開始時間" type="datetime-local" value={startsAt} disabled={locked} onChange={(e) => setStartsAt(e.target.value)} className={field} />
            </label>
            {fieldErrors.starts_at ? <p className={errCls}>{fieldErrors.starts_at}</p> : null}
          </div>
          <div className="space-y-1">
            <label className="block space-y-1">
              <span className={labelCls}>結束時間{locked ? "（只可延長）" : ""}</span>
              <input aria-label="結束時間" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className={field} />
            </label>
            {fieldErrors.ends_at ? <p className={errCls}>{fieldErrors.ends_at}</p> : null}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <label className="block space-y-1">
              <span className={labelCls}>目標 (goal_target)</span>
              <input aria-label="目標" type="number" min={1} value={goalTarget} disabled={locked} onChange={(e) => setGoalTarget(Number(e.target.value))} className={field} />
            </label>
            {fieldErrors.goal_target ? <p className={errCls}>{fieldErrors.goal_target}</p> : null}
          </div>
          <div className="space-y-1">
            <label className="block space-y-1">
              <span className={labelCls}>完成獎勵分數</span>
              <input aria-label="完成獎勵分數" type="number" min={0} value={bonusPoints} disabled={locked} onChange={(e) => setBonusPoints(Number(e.target.value))} className={field} />
            </label>
            {fieldErrors.completion_bonus_points ? <p className={errCls}>{fieldErrors.completion_bonus_points}</p> : null}
          </div>
          <div className="space-y-1">
            <label className="block space-y-1">
              <span className={labelCls}>完成獎勵 XP</span>
              <input aria-label="完成獎勵 XP" type="number" min={0} value={bonusXp} disabled={locked} onChange={(e) => setBonusXp(Number(e.target.value))} className={field} />
            </label>
            {fieldErrors.completion_bonus_xp ? <p className={errCls}>{fieldErrors.completion_bonus_xp}</p> : null}
          </div>
        </div>

        <PrizeTierEditor tiers={tiers} onChange={setTiers} disabled={locked} />
        {tierError ? <p className={errCls}>{tierError}</p> : null}
        {fieldErrors.prize_tiers ? <p className={errCls}>{fieldErrors.prize_tiers}</p> : null}

        {save.error instanceof AdminRequestError && !Object.keys(fieldErrors).length ? (
          <p className={errCls}>{save.error.message}</p>
        ) : null}

        <button type="submit" disabled={save.isPending} className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-4 py-1.5 font-heading font-bold">儲存</button>
      </form>

      {/* Mission attach/detach */}
      <div className="space-y-2 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
        <p className="font-heading font-bold">挑戰任務</p>
        {missions.length === 0 ? <p className="text-xs text-[var(--color-soft-ink)]">尚未連結任務。</p> : null}
        <div className="space-y-1">
          {missions.map((m) => (
            <div key={m.mission_id} className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 truncate">{m.missions?.title ?? m.mission_id} <span className="text-xs text-[var(--color-soft-ink)]">({m.missions?.slug ?? m.mission_id})</span></span>
              <button type="button" disabled={detach.isPending} onClick={() => detach.mutate(m.mission_id)} className="shrink-0 rounded-full border-2 border-[var(--color-ink)] bg-white px-2 py-0.5 text-xs font-bold">移除</button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <input aria-label="mission-id" value={missionId} onChange={(e) => setMissionId(e.target.value)} placeholder="Mission ID" className="h-8 flex-1 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white px-2 text-sm" />
          <button type="button" disabled={!missionId.trim() || attach.isPending} onClick={() => attach.mutate(missionId.trim())} className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-3 py-1 text-sm font-bold">連結任務</button>
        </div>
      </div>
    </div>
  );
}
