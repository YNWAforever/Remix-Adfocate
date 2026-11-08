import { createFileRoute, Link } from "@tanstack/react-router";
import { useCampaigns, type Campaign } from "@/lib/queries/kocmax";
import { useI18n } from "@/lib/i18n";
import { RequestFeedback, useCanShowPreviousData } from "@/components/RequestFeedback";
import { formatCreatorDate } from "@/lib/creatorFormatting";
import { Flag } from "lucide-react";

export const Route = createFileRoute("/_app/campaigns/")({ component: CampaignsList });

function CampaignsList() {
  const { t } = useI18n();
  const q = useCampaigns();
  const showSavedCampaigns = useCanShowPreviousData(q, ["campaigns"]);
  const campaigns = (showSavedCampaigns ? q.data : undefined) ?? [];
  const { isLoading } = q;
  const now = new Date().toISOString();
  const active = campaigns.filter((c) => c.status === "active" && c.starts_at <= now);
  const upcoming = campaigns.filter((c) => c.status === "active" && c.starts_at > now);
  const empty = !isLoading && !q.isError && active.length === 0 && upcoming.length === 0;

  if (isLoading) return <div className="p-4 text-muted-foreground">…</div>;

  return (
    <div className="s-stack">
      <h1>{t("app.campaigns.title")}</h1>
      <RequestFeedback error={q.error} stale={Boolean(q.data && showSavedCampaigns)} retry={() => void q.refetch()} />
      {empty ? (
        <p className="s-empty">
          {t("app.campaigns.empty")}
        </p>
      ) : (
        <>
          <CampaignSection title={t("app.campaigns.active")} items={active} />
          <CampaignSection title={t("app.campaigns.upcoming")} items={upcoming} />
        </>
      )}
    </div>
  );
}

function CampaignSection({ title, items }: { title: string; items: Campaign[] }) {
  const { lang } = useI18n();
  if (!items.length) return null;
  return (
    <section className="s-stack" style={{ gap: 10 }}>
      <h2 style={{ margin: 0 }}><span className="s-eyebrow">{title}</span></h2>
      <div className="s-grid">{items.map((c) => (
        <Link key={c.slug} to="/campaigns/$slug" params={{ slug: c.slug }} className="s-task">
          <span className="s-task-icon"><Flag size={22} aria-hidden /></span>
          <h3>{c.title}</h3>
          <p className="s-muted">{formatCreatorDate(c.ends_at, lang) ?? c.ends_at}</p>
        </Link>
      ))}</div>
    </section>
  );
}
