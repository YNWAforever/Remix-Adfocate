import { createFileRoute, Link } from "@tanstack/react-router";
import { Target, Gift, Receipt, CalendarCheck, Sparkles } from "lucide-react";
import { useBalance, useMe, useMissions } from "@/lib/queries/kocmax";
import { useRealtimeBalance } from "@/lib/useRealtimeBalance";
import { PointsBalanceCard } from "@/components/PointsBalanceCard";
import { MissionCard } from "@/components/MissionCard";
import { LangToggle } from "@/components/LangToggle";
import { LEVELS, levelIndex } from "@/lib/levels";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_app/home")({ component: Home });

function Home() {
  const me = useMe();
  const balance = useBalance();
  const missions = useMissions();
  useRealtimeBalance(me.data?.id);
  const { t } = useI18n();

  const quickLinks = [
    { to: "/mission", labelKey: "app.home.quickMission" as const, icon: Target },
    { to: "/redemption", labelKey: "app.home.quickRedemption" as const, icon: Gift },
    { to: "/wallet", labelKey: "app.home.quickWalletHistory" as const, icon: Receipt },
    { to: "/explore", labelKey: "app.home.quickExplore" as const, icon: CalendarCheck },
  ];

  return (
    <div className="mx-auto w-full max-w-lg space-y-6 p-4 lg:max-w-5xl">
      <div className="flex items-center justify-end gap-2">
        <LangToggle className="lg:hidden" />
        {me.data?.level && (
          <Link
            to="/passport"
            aria-label={t("app.home.passportAriaLabel")}
            className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-3 py-1 font-mono text-xs font-bold"
          >
            {LEVELS[levelIndex(me.data.level)].emoji} {me.data.level}
          </Link>
        )}
        <Link
          to="/profile"
          aria-label={t("app.home.profileAriaLabel")}
          className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border-2 border-[var(--color-ink)] bg-white font-heading font-bold shadow-[2px_2px_0_0_var(--color-ink)]"
        >
          {me.data?.avatar_url ? (
            <img src={me.data.avatar_url} alt="" className="h-full w-full object-cover" />
          ) : (
            (me.data?.display_name?.[0] ?? "?").toUpperCase()
          )}
        </Link>
      </div>

      <section className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-acid)] p-6 text-[var(--color-ink)] shadow-[4px_4px_0_0_var(--color-ink)]">
        <span className="font-mono text-[11px] uppercase tracking-[0.18em]">ADFOCATE · KOCMAX</span>
        <h1 className="mt-2 font-display text-3xl font-bold leading-[1.05]" style={{ whiteSpace: "pre-line" }}>{t("app.home.heroTitle")}</h1>
        <p className="mt-2 text-sm">{t("app.home.heroBody")}</p>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          {balance.isError && <p className="text-sm text-[var(--color-magenta)]">{t("common.balanceError")}</p>}
          <PointsBalanceCard balance={balance.data?.balance ?? 0} availableTo={balance.data?.available_to} loading={balance.isLoading} />

          <Link
            to="/match"
            aria-label={t("app.home.matchAriaLabel")}
            className="flex items-center justify-center gap-2 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-magenta)] p-4 font-heading text-lg font-bold text-white shadow-[4px_4px_0_0_var(--color-ink)]"
          >
            <Sparkles size={20} aria-hidden /> {t("app.home.matchCta")}
          </Link>

          <section className="grid grid-cols-2 gap-3">
            {quickLinks.map((a) => {
              const Icon = a.icon;
              const label = t(a.labelKey);
              return (
                <Link key={a.labelKey} to={a.to} aria-label={label} className="pastel-card flex items-center gap-2 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4 font-heading font-semibold">
                  <Icon size={20} aria-hidden /> {label}
                </Link>
              );
            })}
          </section>
        </div>

        <section>
          <h2 className="mb-2 font-heading font-bold">{t("app.home.featuredMissions")}</h2>
          {missions.isError && <p className="text-sm text-[var(--color-magenta)]">{t("app.mission.loadFailed")}</p>}
          <div className="space-y-2">
            {missions.data?.slice(0, 3).map((m) => (
              <Link key={m.id} to="/mission/$missionSlug" params={{ missionSlug: m.slug }}>
                <MissionCard title={m.title} category={m.category} points={m.points_reward} deadline={m.deadline} />
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
