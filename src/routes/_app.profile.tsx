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
    <div className="s-stack">
      <section className="s-card s-stack">
        <div className="s-between" style={{ alignItems: "flex-start" }}>
          <IdentityHeader
            name={d.display_name ?? "KOC"}
            avatarUrl={d.avatar_url}
            actions={
              !editing && (
                <>
                  <button
                    type="button"
                    onClick={startEdit}
                    className="s-btn s-primary"
                  >
                    {t("app.profile.edit")}
                  </button>
                  <button
                    type="button"
                    onClick={signOut}
                    className="s-btn"
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
        <div className="s-note" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
          <span>
            <span className="s-muted">{t("app.profile.referralCode")}</span>{" "}
            <strong style={{ letterSpacing: 2 }}>{d.referral_code ?? "—"}</strong>
          </span>
          <button
            type="button"
            onClick={copyReferral}
            disabled={!d.referral_code}
            aria-label={t("app.profile.copyReferralAria")}
            className="s-btn"
            style={{ minHeight: 40, padding: "6px 14px" }}
          >
            {copied ? t("app.profile.copied") : t("app.profile.copyCode")}
          </button>
        </div>
        <p className="s-muted">{t("app.profile.referralNote")}</p>
      </section>

      {me.isError ? <div role="alert" className="text-sm"><p>{t("app.social.loadError")}</p><button type="button" onClick={() => void me.refetch()}>{t("common.retry")}</button></div> : null}
      {error && <p role="alert" className="text-sm text-[var(--color-magenta)]">{error}</p>}

      {!editing ? (
        <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
          <div className="space-y-6">
            <section className="s-card s-stack">
              <h2>{t("app.profile.categories")}</h2>
              {d.categories?.length ? (
                <div className="flex flex-wrap gap-2">
                  {d.categories.map((c) => (
                    <span key={c} className="s-tag ghost">
                      {t(categoryLabelKey(c))}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-[var(--color-soft-ink)]">{t("app.profile.notSet")}</p>
              )}
            </section>

            <SocialTrustPanel presentations={d.social_accounts} legacyHandles={d.social_handles} />
          </div>

          <div className="space-y-6">
            <CreatorProfileMediaPanel />

            <div className="s-grid">
              <Link to="/my" className="s-btn">{t("app.profile.myMissions")}</Link>
              <Link to="/redemption/history" className="s-btn">{t("app.profile.redemptionHistory")}</Link>
            </div>
          </div>
        </div>
      ) : (
        <fieldset disabled={update.isPending} aria-busy={update.isPending} className="s-stack">
          <section className="s-card s-stack">
            <h2>{t("app.profile.displayName")}</h2>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              aria-label={t("app.profile.displayName")}
              className="w-full rounded-xl border-2 border-[var(--color-ink)] bg-white p-3"
            />
          </section>

          <section className="s-card s-stack">
            <h2>{t("app.profile.categories")}</h2>
            <FilterPillsMulti options={CATEGORIES} value={categories} onChange={setCategories} renderLabel={(v) => t(categoryLabelKey(v))} />
          </section>

          <section className="s-card s-stack">
            <h2>{t("app.profile.socialAccounts")}</h2>
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
              className="s-btn"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              onClick={save}
              disabled={update.isPending}
              className="s-btn s-primary"
            >
              {update.isPending ? t("app.profile.saving") : t("app.profile.save")}
            </button>
          </div>
        </fieldset>
      )}
      <section className="s-card">
        <MarketingConsentToggle />
      </section>
      <section className="s-card">
        <AccountDataControls />
      </section>
    </div>
  );
}
