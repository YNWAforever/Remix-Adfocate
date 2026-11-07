import { useI18n } from "@/lib/i18n";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { MissionEditor } from "@/components/admin/MissionEditor";
import { useBrandAuth } from "@/components/brand/BrandAuthContext";
import { createBrandMission } from "@/lib/brand";
import type { MissionDraftInput } from "@/lib/admin";
import { useQueryClient } from "@tanstack/react-query";

export const Route = createFileRoute("/brand/missions/new")({ component: BrandMissionNew });

function BrandMissionNew() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { t } = useI18n();
  const { brand } = useBrandAuth();
  return (
    <><h1>{t("app.brand.newMission")}</h1><MissionEditor
      mode="create"
      workspaces={[{ id: brand.workspaceId, name: brand.workspaceName }]}
      onSave={async (body: MissionDraftInput) => {
        const res = await createBrandMission(body);
        await qc.invalidateQueries({ queryKey: ["brand-missions"] });
        navigate({ to: "/brand/missions" });
        return res;
      }}
    /></>
  );
}
