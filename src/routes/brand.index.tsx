import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useBrandAuth } from "@/components/brand/BrandAuthContext";
import { brandKeys, fetchBrandMissions } from "@/lib/brand";
import { useI18n } from "@/lib/i18n";
import { RequestFeedback, useCanShowPreviousData } from "@/components/RequestFeedback";

export const Route = createFileRoute("/brand/")({ component: BrandDashboard });

function BrandDashboard() {
  const { t } = useI18n();
  const { brand } = useBrandAuth();
  const missions = useQuery({ queryKey: brandKeys.missions(""), queryFn: () => fetchBrandMissions(""), retry: false });
  const data = useCanShowPreviousData(missions, brandKeys.missions("")) ? missions.data : undefined;
  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold">{brand.workspaceName}</h1>
      <div className="space-y-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4">
        <RequestFeedback error={missions.error} stale={Boolean(data)} retry={() => void missions.refetch()} />
        {missions.isLoading && <p role="status">{t("common.loading")}</p>}
        {data && <p className="text-sm text-[var(--color-soft-ink)]">{t("app.brand.missionCount", { count: data.missions.length })}</p>}
        <div className="flex flex-wrap gap-2">
          <Link to="/brand/missions" className="rounded-full border-2 border-[var(--color-ink)] bg-white px-4 py-1.5 font-heading font-bold">{t("app.brand.navMissions")}</Link>
          <Link to="/brand/missions/new" className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-4 py-1.5 font-heading font-bold">{t("app.brand.newMission")}</Link>
        </div>
      </div>
    </div>
  );
}
