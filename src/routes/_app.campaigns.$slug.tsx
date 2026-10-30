import { Link, createFileRoute } from "@tanstack/react-router";
import { useCampaign, useCampaignLeaderboard } from "@/lib/queries/kocmax";
import { useI18n } from "@/lib/i18n";
import { ApiError } from "@/lib/api";
import { formatCreatorDate } from "@/lib/creatorFormatting";

export const Route = createFileRoute("/_app/campaigns/$slug")({ component: CampaignDetail });

function CampaignDetail() {
  const { slug } = Route.useParams();
  const { t, lang } = useI18n();
  const { data, isLoading, isError, error, refetch } = useCampaign(slug);
  const { data: board = [] } = useCampaignLeaderboard(slug);

  if (isLoading) return <div role="status" className="p-4 text-muted-foreground">{t("common.loading")}</div>;
  if (isError || !data) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <div role="alert" className="mx-auto max-w-3xl space-y-3 p-4">
        <p>{t(notFound ? "app.campaigns.notFound" : "common.loadFailed")}</p>
        <div className="flex gap-3 text-sm font-semibold underline underline-offset-4">
          {!notFound && <button type="button" onClick={() => void refetch()}>{t("common.retry")}</button>}
          <Link to="/campaigns">{t("app.campaigns.backToList")}</Link>
        </div>
      </div>
    );
  }

  const { campaign, missions, my_progress } = data;
  const pct = Math.min(
    100,
    Math.round((my_progress.approved / Math.max(1, campaign.goal_target)) * 100),
  );

  return (
    <div className="mx-auto max-w-3xl p-4 space-y-6">
      {/* Header */}
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">{campaign.title}</h1>
        {campaign.description && (
          <p className="text-sm text-muted-foreground">{campaign.description}</p>
        )}
        <p className="text-xs text-muted-foreground">
          {t("app.campaigns.endsIn")}: {formatCreatorDate(campaign.ends_at, lang) ?? campaign.ends_at}
        </p>
      </header>

      {/* Goal progress */}
      <section className="rounded-xl border p-4 space-y-2">
        <div className="text-sm">
          {t("app.campaigns.goalProgress", {
            x: my_progress.approved,
            y: campaign.goal_target,
          })}
        </div>
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div
            className="h-2 rounded-full bg-primary"
            style={{ width: `${pct}%` }}
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t("app.campaigns.goalProgress", { x: my_progress.approved, y: campaign.goal_target })}
          />
        </div>
        {my_progress.goal_reached && (
          <div className="text-xs text-green-600">✓ {t("app.campaigns.completionBonus")}</div>
        )}
      </section>

      {/* Rewards */}
      <section className="rounded-xl border p-4 space-y-2">
        <h2 className="text-sm font-semibold">
          {t("app.campaigns.completionBonus")} · {t("app.campaigns.prizes")}
        </h2>
        <div className="text-sm text-muted-foreground">
          +{campaign.completion_bonus_points} pts · +{campaign.completion_bonus_xp} XP
        </div>
        {campaign.prize_tiers.length > 0 && (
          <ul className="text-sm space-y-1">
            {campaign.prize_tiers.map((tr) => (
              <li key={`${tr.rank_from}-${tr.rank_to}`}>
                #{tr.rank_from}
                {tr.rank_to !== tr.rank_from ? `–${tr.rank_to}` : ""}: HK${tr.cash} ·{" "}
                {tr.points} pts · {tr.xp} XP
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Missions in this campaign */}
      {missions.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">{t("app.campaigns.missions")}</h2>
          {missions.map((m) => (
            <div key={m.mission_id} className="rounded-xl border p-3 text-sm">
              {m.missions?.title}
            </div>
          ))}
        </section>
      )}

      {/* Leaderboard */}
      {board.length > 0 && (
        <section className="space-y-1">
          <h2 className="text-sm font-semibold">{t("app.campaigns.leaderboard")}</h2>
          {board.map((row) => (
            <div
              key={row.creator_id}
              className={`flex justify-between rounded-lg p-2 text-sm ${
                row.rank === my_progress.rank ? "bg-primary/10 font-semibold" : ""
              }`}
            >
              <span>
                #{row.rank} {row.display_name || "—"}{" "}
                {row.movement == null ? (
                  <span className="text-xs text-muted-foreground" aria-label={t("app.campaign.lb.new")}>{t("app.campaign.lb.new")}</span>
                ) : row.movement > 0 ? (
                  <span className="text-xs text-emerald-600" aria-label={t("app.campaign.lb.up", { n: row.movement })}>↑{row.movement}</span>
                ) : row.movement < 0 ? (
                  <span className="text-xs text-muted-foreground" aria-label={t("app.campaign.lb.down", { n: -row.movement })}>↓{-row.movement}</span>
                ) : (
                  <span className="text-xs text-muted-foreground" aria-label={t("app.campaign.lb.same")}>—</span>
                )}
              </span>
              <span>{row.approved}</span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
