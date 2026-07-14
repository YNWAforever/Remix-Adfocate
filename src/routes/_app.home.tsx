import { useEffect, useMemo, useRef } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CalendarCheck, Gift, Receipt, Sparkles, Target } from "lucide-react";
import { ActivationProgressCard } from "@/components/ActivationProgressCard";
import { ActiveMissionSummary } from "@/components/ActiveMissionSummary";
import { EarningsSummaryCard } from "@/components/EarningsSummaryCard";
import { LangToggle } from "@/components/LangToggle";
import { MissionCard } from "@/components/MissionCard";
import { NewsCard } from "@/components/news/NewsCard";
import { NextBestActionCard } from "@/components/NextBestActionCard";
import { PointsBalanceCard } from "@/components/PointsBalanceCard";
import { trackActivationEvent } from "@/lib/activationAnalytics";
import { contentKeys, fetchNews } from "@/lib/content";
import { useI18n } from "@/lib/i18n";
import { LEVELS, levelIndex } from "@/lib/levels";
import { useBalance } from "@/lib/queries/kocmax";
import { useCreatorActivation } from "@/lib/useCreatorActivation";
import { useRealtimeBalance } from "@/lib/useRealtimeBalance";

export const Route = createFileRoute("/_app/home")({ component: Home });

function Home() {
  const activation = useCreatorActivation();
  const me = activation.me.data;
  const balance = useBalance();
  useRealtimeBalance(me?.id);
  const { t, lang } = useI18n();
  const news = useQuery({
    queryKey: contentKeys.news({ kind: "announcement", lang }),
    queryFn: () => fetchNews({ kind: "announcement", lang }),
  });

  const unlockedRecommendations = useMemo(
    () =>
      (activation.recommendations.data ?? []).filter(
        (mission) => !mission.locked,
      ),
    [activation.recommendations.data],
  );
  const effectiveLevel = me?.effective_level ?? me?.level;
  const dashboardViews = useRef(new Set<string>());
  const actionViews = useRef(new Set<string>());
  const recommendationViews = useRef(new Set<string>());

  useEffect(() => {
    const key = `${lang}:${effectiveLevel ?? ""}`;
    if (dashboardViews.current.has(key)) return;
    dashboardViews.current.add(key);
    trackActivationEvent("dashboard_viewed", {
      locale: lang,
      ...(effectiveLevel ? { creatorLevel: effectiveLevel } : {}),
    });
  }, [effectiveLevel, lang]);

  useEffect(() => {
    const action = activation.snapshot.nextAction;
    const key = `${lang}:${action.kind}:${action.missionId ?? ""}`;
    if (actionViews.current.has(key)) return;
    actionViews.current.add(key);
    trackActivationEvent("activation_action_viewed", {
      locale: lang,
      actionKind: action.kind,
    });
  }, [activation.snapshot.nextAction, lang]);

  useEffect(() => {
    for (const mission of unlockedRecommendations) {
      const key = `${lang}:${mission.id}`;
      if (recommendationViews.current.has(key)) continue;
      recommendationViews.current.add(key);
      trackActivationEvent("mission_recommendation_viewed", {
        locale: lang,
        missionId: mission.id,
        missionType: mission.mission_type,
      });
    }
  }, [lang, unlockedRecommendations]);

  const quickLinks = [
    { to: "/mission", labelKey: "app.home.quickMission" as const, icon: Target },
    { to: "/redemption", labelKey: "app.home.quickRedemption" as const, icon: Gift },
    { to: "/wallet", labelKey: "app.home.quickWalletHistory" as const, icon: Receipt },
    { to: "/explore", labelKey: "app.home.quickExplore" as const, icon: CalendarCheck },
  ];

  return (
    <div className="mx-auto w-full max-w-lg space-y-6 p-4 lg:max-w-5xl">
      <header className="space-y-4">
        <div className="flex items-center justify-end gap-2">
          <LangToggle className="lg:hidden" />
          {effectiveLevel ? (
            <Link
              to="/passport"
              aria-label={t("app.home.passportAriaLabel")}
              className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-3 py-1 font-mono text-xs font-bold"
            >
              {(() => {
                const level = LEVELS[levelIndex(effectiveLevel)];
                return <>{level.emoji} {t(level.labelKey)}</>;
              })()}
            </Link>
          ) : null}
          <Link
            to="/profile"
            aria-label={t("app.home.profileAriaLabel")}
            className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border-2 border-[var(--color-ink)] bg-white font-heading font-bold shadow-[2px_2px_0_0_var(--color-ink)]"
          >
            {me?.avatar_url ? (
              <img src={me.avatar_url} alt="" className="h-full w-full object-cover" />
            ) : (
              (me?.display_name?.[0] ?? "?").toUpperCase()
            )}
          </Link>
        </div>
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.18em]">
            ADFOCATE · KOCMAX
          </p>
          <h1 className="mt-1 font-display text-2xl font-bold">
            {t("app.home.welcomeBack", {
              name: me?.display_name || t("app.home.profileAriaLabel"),
            })}
          </h1>
          <p className="mt-1 text-sm text-[var(--color-soft-ink)]">
            {t("app.home.welcomeCompactBody")}
          </p>
        </div>
      </header>

      <NextBestActionCard
        action={activation.snapshot.nextAction}
        locale={lang}
        onAction={(action) =>
          trackActivationEvent("activation_action_clicked", {
            locale: lang,
            actionKind: action.kind,
          })
        }
      />

      <ActiveMissionSummary
        missions={activation.activeMissions.data ?? []}
        isLoading={activation.activeMissions.loading}
        isError={Boolean(activation.activeMissions.error)}
        onRetry={() => void activation.activeMissions.refetch()}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <EarningsSummaryCard
          earnings={activation.earnings.data}
          locale={lang}
          isLoading={activation.earnings.loading}
          isError={Boolean(activation.earnings.error)}
          onRetry={() => void activation.earnings.refetch()}
        />
        <div>
          {balance.isError ? (
            <p className="mb-2 text-sm text-[var(--color-magenta)]" role="alert">
              {t("common.balanceError")}
            </p>
          ) : null}
          <PointsBalanceCard
            balance={balance.data?.balance ?? 0}
            availableTo={balance.data?.available_to}
            loading={balance.isLoading || balance.isError}
          />
        </div>
      </div>

      <section className="space-y-3" aria-labelledby="suitable-missions-heading">
        <h2 id="suitable-missions-heading" className="font-heading text-lg font-bold">
          {t("app.home.suitableMissions")}
        </h2>
        {activation.recommendations.loading ? (
          <p role="status" className="text-sm text-[var(--color-soft-ink)]">
            {t("app.home.recommendationsLoading")}
          </p>
        ) : activation.recommendations.error ? (
          <div role="alert" className="text-sm">
            <p>{t("app.home.recommendationsError")}</p>
            <button
              type="button"
              onClick={() => void activation.recommendations.refetch()}
              className="mt-3 min-h-11 rounded-full border-2 border-[var(--color-ink)] px-4 py-2 font-bold"
            >
              {t("app.home.recommendationsRetry")}
            </button>
          </div>
        ) : unlockedRecommendations.length ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {unlockedRecommendations.map((mission) => (
              <a
                key={mission.id}
                href={`/mission/${mission.slug}`}
                className="block rounded-[var(--radius)] no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                <MissionCard
                  title={mission.title}
                  category={mission.category ?? undefined}
                  points={mission.points_reward}
                  cashReward={mission.cash_reward}
                  deadline={mission.deadline}
                  missionType={mission.mission_type}
                  matchRationale={mission.rationale}
                  matchScore={mission.fit_score}
                  status={t("app.home.recommendationUnlocked")}
                />
              </a>
            ))}
          </div>
        ) : (
          <p className="text-sm text-[var(--color-soft-ink)]">
            {t("app.home.recommendationsEmpty")}
          </p>
        )}
      </section>

      {activation.readiness.loading ? (
        <section className="pastel-card rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-5">
          <h2 className="font-heading text-lg font-bold">
            {t("app.activation.progress.heading")}
          </h2>
          <p role="status" className="mt-3 text-sm text-[var(--color-soft-ink)]">
            {t("app.home.readinessLoading")}
          </p>
        </section>
      ) : activation.readiness.error ? (
        <section className="pastel-card rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-5">
          <h2 className="font-heading text-lg font-bold">
            {t("app.activation.progress.heading")}
          </h2>
          <div role="alert" className="mt-3 text-sm">
            <p>{t("app.home.readinessError")}</p>
            <button
              type="button"
              onClick={() => void activation.readiness.refetch()}
              className="mt-3 min-h-11 rounded-full border-2 border-[var(--color-ink)] px-4 py-2 font-bold"
            >
              {t("app.home.readinessRetry")}
            </button>
          </div>
        </section>
      ) : (
        <ActivationProgressCard snapshot={activation.snapshot} />
      )}

      {news.data?.items.length ? (
        <section className="space-y-2">
          <h2 className="font-heading font-bold">{t("app.home.newsHeading")}</h2>
          <div className="grid gap-3 lg:grid-cols-2">
            {news.data.items.slice(0, 2).map((item) => (
              <NewsCard key={item.id} item={item} />
            ))}
          </div>
        </section>
      ) : null}

      <nav className="grid grid-cols-2 gap-3" aria-label={t("app.home.quickMission")}>
        {quickLinks.map((item) => {
          const Icon = item.icon;
          const label = t(item.labelKey);
          return (
            <Link
              key={item.labelKey}
              to={item.to}
              aria-label={label}
              className="pastel-card flex items-center gap-2 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4 font-heading font-semibold"
            >
              <Icon size={20} aria-hidden="true" /> {label}
            </Link>
          );
        })}
      </nav>

      <Link
        to="/match"
        aria-label={t("app.home.matchAriaLabel")}
        className="flex items-center justify-center gap-2 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-magenta)] p-4 font-heading text-lg font-bold text-white shadow-[4px_4px_0_0_var(--color-ink)]"
      >
        <Sparkles size={20} aria-hidden="true" /> {t("app.home.matchCta")}
      </Link>
    </div>
  );
}
