import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { MissionEditor } from "@/components/admin/MissionEditor";
import { useBrandAuth } from "@/components/brand/BrandAuthContext";
import { createBrandMission } from "@/lib/brand";
import type { MissionDraftInput } from "@/lib/admin";

export const Route = createFileRoute("/brand/missions/new")({ component: BrandMissionNew });

function BrandMissionNew() {
  const navigate = useNavigate();
  const { brand } = useBrandAuth();
  return (
    <MissionEditor
      mode="create"
      workspaces={[{ id: brand.workspaceId, name: brand.workspaceName }]}
      onSave={async (body: MissionDraftInput) => {
        const res = await createBrandMission(body);
        navigate({ to: "/brand/missions" });
        return res;
      }}
    />
  );
}
