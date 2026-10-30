import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { CreatorProfileMediaPanel } from "@/components/CreatorProfileMediaPanel";
import { MarketingConsentToggle } from "@/components/ConsentGate";
import { AccountDataControls } from "@/components/AccountDataControls";
import { FilterPillsMulti } from "@/components/FilterPills";
import { IdentityHeader } from "@/components/IdentityHeader";
import { LangToggle } from "@/components/LangToggle";
import { LevelChip } from "@/components/LevelChip";
import { SocialTrustPanel } from "@/components/SocialTrustPanel";
import { useI18n } from "@/lib/i18n";
import { categoryLabelKey, platformDisplayLabelKey } from "@/lib/labels";
import { useMe, useUpdateProfile, type SocialHandle } from "@/lib/queries/kocmax";
import { supabase } from "@/lib/supabase";
import { useCanShowPreviousData } from "@/components/RequestFeedback";

export const Route = createFileRoute("/_app/profile")({ component: Profile });

const CATEGORIES = ["美容", "餐飲", "生活", "科技", "旅遊", "媽媽", "寵物"] as const;
const PLATFORMS = ["Instagram", "小紅書", "TikTok", "YouTube"] as const;
const CARD = "rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4 shadow-[4px_4px_0_0_var(--color-ink)]";

function Profile() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const me = useMe();
  const showSavedProfile = useCanShowPreviousData(me, ["me"]);
  const update = useUpdateProfile();

  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [handles, setHandles] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const platforms = [...new Set<string>([...(me.data?.social_handles ?? []).map(item => item.platform), ...PLATFORMS.filter(platform => !(me.data?.social_handles ?? []).some(item => item.platform.toLowerCase() === platform.toLowerCase()))])];

  function startEdit() {
    const d = me.data;
    setDisplayName(d?.display_name ?? "");
    setCategories(d?.categories ?? []);
    const seeded: Record<string, string> = {};
    for (const s of d?.social_handles ?? []) seeded[s.platform] = s.handle;
    setHandles(seeded);
    setError(null);
    setEditing(true);
  }

  async function save() {
    setError(null);
    const existing = me.data?.social_handles ?? [];
    const social_handles: SocialHandle[] = [...existing];
    for (const p of platforms) {
      const handle = (handles[p] ?? "").trim();
      let index = -1;
      social_handles.forEach((row, position) => { if (row.platform === p) index = position; });
      if (index >= 0 && social_handles[index].handle === handle) continue;
      if (!handle) {
        for (let i = social_handles.length - 1; i >= 0; i--) if (social_handles[i].platform === p) social_handles.splice(i, 1);
      } else {
        const next = { platform: p, handle, followers: null, verified: false };
        if (index >= 0) social_handles[index] = next;
        else social_handles.push(next);
      }
    }
    try {
      await update.mutateAsync({ display_name: displayName.trim() || undefined, categories, social_handles });
      setEditing(false);
    } catch {
      setError(t("common.saveError"));
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    qc.clear();
    navigate({ to: "/login" });
  }

  async function copyReferral() {
    const code = me.data?.referral_code;
    if (!code) return;
    await navigator.clipboard?.writeText(code);
    setCopied(true);
  }

  if (me.isLoading) {
    return (
      <div className="mx-auto max-w-lg p-4">
        <p className="text-sm text-[var(--color-soft-ink)]">{t("common.loading")}</p>
      </div>
    );
  }
  if (!me.data || !showSavedProfile) {
    return (
      <div className="mx-auto max-w-lg p-4">
        <p role="alert" className="text-sm text-[var(--color-magenta)]">{t("common.loadFailed")}</p>
        <button type="button" className="btn-primary" onClick={() => void me.refetch()}>{t("common.retry")}</button>
      </div>
    );
  }

  const d = me.data;

  return (
    <div className="mx-auto w-full max-w-lg space-y-6 p-4 lg:max-w-5xl">
      <section className={`${CARD} p-5`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <IdentityHeader
            name={d.display_name ?? "KOC"}
            avatarUrl={d.avatar_url}
            actions={
              !editing && (
                <>
                  <button
                    type="button"
                    onClick={startEdit}
                    className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-4 py-2 text-sm font-heading font-bold"
                  >
                    {t("app.profile.edit")}
                  </button>
                  <button
                    type="button"
                    onClick={signOut}
                    className="rounded-full border-2 border-[var(--color-ink)] bg-white px-4 py-2 text-sm font-heading font-bold text-[var(--color-magenta)]"
                  >
                    {t("app.profile.signOut")}
                  </button>
                </>
              )
            }
          >
            <LevelChip xp={d.xp} effectiveLevelId={d.effective_level} />
          </IdentityHeader>
          <LangToggle />
        </div>
      </section>

      {me.isError ? <div role="alert" className="text-sm"><p>{t("app.social.loadError")}</p><button type="button" onClick={() => void me.refetch()}>{t("common.retry")}</button></div> : null}
      {error && <p role="alert" className="text-sm text-[var(--color-magenta)]">{error}</p>}

      {!editing ? (
        <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
          <div className="space-y-6">
            <section className="space-y-2">
              <h2 className="font-heading font-bold">{t("app.profile.categories")}</h2>
              {d.categories?.length ? (
                <div className="flex flex-wrap gap-2">
                  {d.categories.map((c) => (
                    <span key={c} className="rounded-full border-2 border-[var(--color-ink)] bg-white px-3 py-1 text-sm">
                      {t(categoryLabelKey(c))}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-[var(--color-soft-ink)]">{t("app.profile.notSet")}</p>
              )}
            </section>

            <section className="space-y-3">
              <SocialTrustPanel presentations={d.social_accounts} legacyHandles={d.social_handles} />
            </section>
          </div>

          <div className="space-y-6">
            <CreatorProfileMediaPanel />

            <section className={`space-y-2 ${CARD}`}>
              <h2 className="font-heading font-bold">{t("app.profile.referralCode")}</h2>
              <div className="flex items-center gap-2">
                <span className="font-mono text-lg font-bold tracking-widest">{d.referral_code ?? "—"}</span>
                <button
                  type="button"
                  onClick={copyReferral}
                  disabled={!d.referral_code}
                  aria-label={t("app.profile.copyReferralAria")}
                  className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-3 py-1 text-xs font-bold disabled:opacity-50"
                >
                  {copied ? t("app.profile.copied") : t("app.profile.copyCode")}
                </button>
              </div>
              <p className="text-sm text-[var(--color-soft-ink)]">{t("app.profile.referralNote")}</p>
            </section>

            <section className="grid grid-cols-2 gap-3">
              <Link
                to="/my"
                className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4 text-center font-heading font-semibold"
              >
                {t("app.profile.myMissions")}
              </Link>
              <Link
                to="/redemption/history"
                className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4 text-center font-heading font-semibold"
              >
                {t("app.profile.redemptionHistory")}
              </Link>
            </section>
          </div>
        </div>
      ) : (
        <fieldset disabled={update.isPending} aria-busy={update.isPending} className="mx-auto min-w-0 w-full max-w-lg space-y-6">
          <section className="space-y-2">
            <h2 className="font-heading font-bold">{t("app.profile.displayName")}</h2>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              aria-label={t("app.profile.displayName")}
              className="w-full rounded-xl border-2 border-[var(--color-ink)] bg-white p-3"
            />
          </section>

          <section className="space-y-2">
            <h2 className="font-heading font-bold">{t("app.profile.categories")}</h2>
            <FilterPillsMulti options={CATEGORIES} value={categories} onChange={setCategories} renderLabel={(v) => t(categoryLabelKey(v))} />
          </section>

          <section className="space-y-2">
            <h2 className="font-heading font-bold">{t("app.profile.socialAccounts")}</h2>
            <p className="text-xs">{t("app.social.legacyEditHelp")}</p>
            <div className="space-y-2">
              {platforms.map((p) => (
                <input
                  key={p}
                  value={handles[p] ?? ""}
                  onChange={(e) => setHandles((h) => ({ ...h, [p]: e.target.value }))}
                  placeholder={t("common.platformHandleLabel", { platform: t(platformDisplayLabelKey(p)) })}
                  aria-label={t("common.platformHandleLabel", { platform: t(platformDisplayLabelKey(p)) })}
                  className="w-full rounded-xl border-2 border-[var(--color-ink)] bg-white p-3"
                />
              ))}
            </div>
          </section>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setError(null);
              }}
              className="flex-1 rounded-full border-2 border-[var(--color-ink)] bg-white py-3 font-heading font-bold"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              onClick={save}
              disabled={update.isPending}
              className="btn-primary flex-1 rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] py-3 font-heading font-bold text-[var(--color-ink)] disabled:opacity-50"
            >
              {update.isPending ? t("app.profile.saving") : t("app.profile.save")}
            </button>
          </div>
        </fieldset>
      )}
      <section className={`${CARD} p-5`}>
        <MarketingConsentToggle />
      </section>
      <section className={`${CARD} p-5`}>
        <AccountDataControls />
      </section>
    </div>
  );
}
