import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AdminRequestError } from "@/lib/admin";
import { BrandAuthError, createBrandCampaign, type BrandCampaignDraft } from "@/lib/brand";
import { useBrandAuth } from "@/components/brand/BrandAuthContext";
import { PrizeTierEditor, toPrizeTiers, validateTiersClient, type DraftTier } from "@/components/admin/CampaignPrizeTiers";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/brand/campaigns/new")({ component: NewBrandCampaign });

function NewBrandCampaign() {
  const { t } = useI18n();
  const { reportAuthError } = useBrandAuth();
  const navigate = useNavigate();

  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [goalTarget, setGoalTarget] = useState(1);
  const [bonusPoints, setBonusPoints] = useState(0);
  const [bonusXp, setBonusXp] = useState(0);
  const [tiers, setTiers] = useState<DraftTier[]>([]);
  const [tierError, setTierError] = useState<string | null>(null);

  const onErr = (e: unknown) => {
    if (e instanceof BrandAuthError) { reportAuthError(e); return; }
    window.alert(e instanceof AdminRequestError ? e.message : "操作失敗");
  };

  const create = useMutation({
    mutationFn: (body: Partial<BrandCampaignDraft>) => createBrandCampaign(body),
    onSuccess: (res) => navigate({ to: "/brand/campaigns/$id", params: { id: res.campaign.id } }),
    onError: onErr,
  });
  const fieldErrors = create.error instanceof AdminRequestError ? create.error.fields ?? {} : {};

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const tierCheck = validateTiersClient(tiers);
    if (!tierCheck.ok) { setTierError(tierCheck.error ?? "獎品階級無效"); return; }
    setTierError(null);
    const body: Partial<BrandCampaignDraft> = {
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
    create.mutate(body);
  };

  const field = "h-9 w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white px-2 text-sm";
  const labelCls = "block text-xs font-bold text-[var(--color-soft-ink)]";
  const errCls = "text-xs text-red-600";

  return (
    <div className="space-y-4">
      <h1 className="font-display text-lg font-bold">{t("app.brand.campaigns.new")}（草稿）</h1>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="block space-y-1">
              <span className={labelCls}>Slug</span>
              <input aria-label="Slug" value={slug} onChange={(e) => setSlug(e.target.value)} className={field} />
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
              <input aria-label="開始時間" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className={field} />
            </label>
            {fieldErrors.starts_at ? <p className={errCls}>{fieldErrors.starts_at}</p> : null}
          </div>
          <div className="space-y-1">
            <label className="block space-y-1">
              <span className={labelCls}>結束時間</span>
              <input aria-label="結束時間" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className={field} />
            </label>
            {fieldErrors.ends_at ? <p className={errCls}>{fieldErrors.ends_at}</p> : null}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <label className="block space-y-1">
              <span className={labelCls}>目標 (goal_target)</span>
              <input aria-label="目標" type="number" min={1} value={goalTarget} onChange={(e) => setGoalTarget(Number(e.target.value))} className={field} />
            </label>
            {fieldErrors.goal_target ? <p className={errCls}>{fieldErrors.goal_target}</p> : null}
          </div>
          <label className="block space-y-1">
            <span className={labelCls}>完成獎勵分數</span>
            <input aria-label="完成獎勵分數" type="number" min={0} value={bonusPoints} onChange={(e) => setBonusPoints(Number(e.target.value))} className={field} />
          </label>
          <label className="block space-y-1">
            <span className={labelCls}>完成獎勵 XP</span>
            <input aria-label="完成獎勵 XP" type="number" min={0} value={bonusXp} onChange={(e) => setBonusXp(Number(e.target.value))} className={field} />
          </label>
        </div>

        <PrizeTierEditor tiers={tiers} onChange={setTiers} disabled={false} />
        {tierError ? <p className={errCls}>{tierError}</p> : null}
        {fieldErrors.prize_tiers ? <p className={errCls}>{fieldErrors.prize_tiers}</p> : null}
        {fieldErrors.reward ? <p className={errCls}>{fieldErrors.reward}</p> : null}

        {create.error instanceof AdminRequestError && !Object.keys(fieldErrors).length ? (
          <p className={errCls}>{create.error.message}</p>
        ) : null}

        <div className="flex gap-2">
          <button type="submit" disabled={create.isPending} className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-4 py-1.5 font-heading font-bold">建立草稿</button>
        </div>
      </form>
    </div>
  );
}
