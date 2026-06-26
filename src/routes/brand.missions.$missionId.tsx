import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { MissionEditor } from "@/components/admin/MissionEditor";
import { useBrandAuth } from "@/components/brand/BrandAuthContext";
import { brandKeys, fetchBrandMission, updateBrandMission } from "@/lib/brand";
import type { MissionDraftInput } from "@/lib/admin";

export const Route = createFileRoute("/brand/missions/$missionId")({ component: BrandMissionEdit });

function BrandMissionEdit() {
  const { missionId } = Route.useParams();
  const { brand } = useBrandAuth();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: brandKeys.mission(missionId), queryFn: () => fetchBrandMission(missionId), retry: false });
  if (q.isLoading) return <p className="text-sm">載入中…</p>;
  if (q.error || !q.data) return <p className="text-sm text-[var(--color-soft-ink)]">無法載入任務。</p>;
  const mission = q.data.mission;
  return (
    <MissionEditor
      mode="edit"
      initial={mission}
      workspaces={[{ id: mission.workspace_id, name: brand.workspaceName }]}
      engaged={(mission.filled ?? 0) > 0}
      onSave={async (body: MissionDraftInput) => {
        const res = await updateBrandMission(missionId, body);
        navigate({ to: "/brand/missions" });
        return res;
      }}
    />
  );
}
