// src/routes/admin.missions.$missionId.tsx
import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AdminAuthError, adminMissionKeys, fetchAdminMission, updateMission, type MissionDraftInput } from "@/lib/admin";
import { useAdminAuth } from "@/components/admin/AdminAuthContext";
import { MissionEditor } from "@/components/admin/MissionEditor";
import { MissionManage } from "@/components/admin/MissionManage";

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
  const [tab, setTab] = useState<"edit" | "manage">(
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("tab") === "manage" ? "manage" : "edit",
  );
  const selectTab = (next: "edit" | "manage") => {
    setTab(next);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (next === "manage") url.searchParams.set("tab", "manage");
    else url.searchParams.delete("tab");
    window.history.replaceState(null, "", url.toString());
  };

  if (q.isLoading) return <p className="text-sm">載入中…</p>;
  if (!q.data) return <p className="text-sm text-red-600">找不到任務。</p>;
  const m = q.data.mission;
  const engaged = (m.filled ?? 0) > 0; // server is authoritative; this drives the disabled hints
  const tabBtn = "rounded-[var(--radius)] border-2 border-[var(--color-ink)] px-3 py-1 text-sm font-bold";
  return (
    <div className="space-y-4">
      <h1 className="font-display text-lg font-bold">{m.title}</h1>
      <div className="flex gap-2">
        <button type="button" className={`${tabBtn} ${tab === "edit" ? "bg-[var(--color-acid)]" : "bg-white"}`} onClick={() => selectTab("edit")}>編輯</button>
        <button type="button" className={`${tabBtn} ${tab === "manage" ? "bg-[var(--color-acid)]" : "bg-white"}`} onClick={() => selectTab("manage")}>管理</button>
      </div>
      {tab === "edit" ? (
        <MissionEditor mode="edit" initial={m} engaged={engaged} saving={update.isPending}
          onSave={(body) => update.mutateAsync(body)} />
      ) : (
        <MissionManage missionId={missionId} />
      )}
    </div>
  );
}
