import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useBrandAuth } from "@/components/brand/BrandAuthContext";
import { brandKeys, fetchBrandMissions } from "@/lib/brand";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/brand/")({ component: BrandDashboard });

function BrandDashboard() {
  const { t } = useI18n();
  const { brand } = useBrandAuth();
  const missions = useQuery({ queryKey: brandKeys.missions(""), queryFn: () => fetchBrandMissions(""), retry: false });
  const count = missions.data?.missions.length ?? 0;
  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold">{brand.workspaceName}</h1>
      <div className="space-y-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4">
        <p className="text-sm text-[var(--color-soft-ink)]">{t("app.brand.missionCount", { count })}</p>
        <div className="flex flex-wrap gap-2">
          <Link to="/brand/missions" className="rounded-full border-2 border-[var(--color-ink)] bg-white px-4 py-1.5 font-heading font-bold">{t("app.brand.navMissions")}</Link>
          <Link to="/brand/missions/new" className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-4 py-1.5 font-heading font-bold">{t("app.brand.newMission")}</Link>
        </div>
      </div>
    </div>
  );
}
