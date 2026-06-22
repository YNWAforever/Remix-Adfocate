// src/routes/admin.missions.$missionId.tsx
import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AdminAuthError, adminMissionKeys, fetchAdminMission, updateMission, type MissionDraftInput } from "@/lib/admin";
import { useAdminAuth } from "@/components/admin/AdminAuthContext";
import { MissionEditor } from "@/components/admin/MissionEditor";

export const Route = createFileRoute("/admin/missions/$missionId")({ component: EditMission });

function EditMission() {
  const { missionId } = useParams({ from: "/admin/missions/$missionId" });
  const { secret, reportAuthError } = useAdminAuth();
  const navigate = useNavigate();
  const q = useQuery({
    queryKey: adminMissionKeys.detail(missionId),
    queryFn: () => fetchAdminMission(missionId),
    enabled: !!secret, retry: false,
  });
  useEffect(() => { if (q.error instanceof AdminAuthError) reportAuthError(q.error); }, [q.error, reportAuthError]);
  const update = useMutation({
    mutationFn: (body: MissionDraftInput) => updateMission(missionId, body),
    onSuccess: () => navigate({ to: "/admin/missions" }),
  });

  if (q.isLoading) return <p className="text-sm">載入中…</p>;
  if (!q.data) return <p className="text-sm text-red-600">找不到任務。</p>;
  const m = q.data.mission;
  const engaged = (m.filled ?? 0) > 0; // server is authoritative; this drives the disabled hints
  return (
    <div className="space-y-4">
      <h1 className="font-display text-lg font-bold">編輯任務 — {m.title}</h1>
      <MissionEditor mode="edit" initial={m} engaged={engaged} saving={update.isPending}
        onSave={(body) => update.mutateAsync(body)} />
    </div>
  );
}
