import { createFileRoute, Link } from "@tanstack/react-router";
import { useCampaigns, type Campaign } from "@/lib/queries/kocmax";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_app/campaigns/")({ component: CampaignsList });

function CampaignsList() {
  const { t } = useI18n();
  const { data: campaigns = [], isLoading } = useCampaigns();
  const now = new Date().toISOString();
  const active = campaigns.filter((c) => c.status === "active" && c.starts_at <= now);
  const upcoming = campaigns.filter((c) => c.status === "active" && c.starts_at > now);
  const empty = !isLoading && active.length === 0 && upcoming.length === 0;

  if (isLoading) return <div className="p-4 text-muted-foreground">…</div>;

  return (
    <div className="mx-auto max-w-3xl p-4 space-y-6">
      <h1 className="text-2xl font-bold">{t("app.campaigns.title")}</h1>
      {empty ? (
        <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
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
  if (!items.length) return null;
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase text-muted-foreground">{title}</h2>
      {items.map((c) => (
        <Link
          key={c.slug}
          to="/campaigns/$slug"
          params={{ slug: c.slug }}
          className="block rounded-xl border p-4 hover:bg-muted/50 transition-colors"
        >
          <div className="font-semibold">{c.title}</div>
          <div className="text-xs text-muted-foreground mt-1">{c.ends_at}</div>
        </Link>
      ))}
    </section>
  );
}
