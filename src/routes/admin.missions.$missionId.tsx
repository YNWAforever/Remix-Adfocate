// src/routes/admin.missions.$missionId.tsx
import { createFileRoute, Link, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useState, type ComponentProps } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AdminAuthError, adminMissionKeys, fetchAdminMission, updateMission, type AdminMission, type MissionDraftInput } from "@/lib/admin";
import { useAdminAuth } from "@/components/admin/AdminAuthContext";
import { useAdminWorkspace } from "@/components/admin/AdminWorkspaceContext";
import { useStaffAccess } from "@/components/admin/StaffAccessContext";
import { MissionEditor } from "@/components/admin/MissionEditor";
import { MissionManage } from "@/components/admin/MissionManage";
import { useMissionEditorNavigation } from "@/components/admin/useMissionEditorNavigation";

export const Route = createFileRoute("/admin/missions/$missionId")({ component: EditMission });

function EditMission() {
  const { missionId } = useParams({ from: "/admin/missions/$missionId" });
  const { authed, staff, reportAuthError } = useAdminAuth();
  const { workspace } = useAdminWorkspace();
  const access = useStaffAccess();
  const navigate = useNavigate();
  const editorNavigation = useMissionEditorNavigation();
  const q = useQuery({
    queryKey: adminMissionKeys.detail(missionId),
    queryFn: () => fetchAdminMission(missionId),
    enabled: authed, retry: false,
  });
  useEffect(() => { if (q.error instanceof AdminAuthError) reportAuthError(q.error); }, [q.error, reportAuthError]);
  const update = useMutation({
    // The version must be the one the form was filled from, not the latest refetch (F-022).
    mutationFn: ({ body, version }: { body: MissionDraftInput; version: string }) =>
      updateMission(missionId, { ...body, expected_updated_at: version }),
    onSuccess: () => { editorNavigation.saved(); return navigate({ to: "/admin/missions" }); },
  });
  const [tab, setTab] = useState<"edit" | "manage">(
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("tab") === "manage" ? "manage" : "edit",
  );
  const editorIdentity = staff?.userId && workspace ? JSON.stringify([staff.userId, workspace, missionId]) : null;
  const matchingWorkspace = access?.access?.workspace?.id === workspace;
  const matchingMission = !q.data || q.data.mission.workspace_id === workspace;
  const canManage = Boolean(authed && editorIdentity && access?.access && !access.loading && !access.error
    && matchingWorkspace && matchingMission && access.can("mission.manage"));
  const denied = Boolean(authed && access?.access && !access.loading && !access.error
    && (!matchingWorkspace || !matchingMission || !access.can("mission.manage")));
  const [authorizedEditorKey, setAuthorizedEditorKey] = useState<string | null>(null);
  useEffect(() => {
    if (!authed || !editorIdentity || denied || (authorizedEditorKey && authorizedEditorKey !== editorIdentity)) {
      setAuthorizedEditorKey(null);
    } else if (canManage && q.data) {
      setAuthorizedEditorKey(editorIdentity);
    }
  }, [authed, editorIdentity, authorizedEditorKey, denied, canManage, q.data]);
  const selectTab = (next: "edit" | "manage") => {
    if (next === tab || !editorNavigation.confirmDiscard()) return;
    setTab(next);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (next === "manage") url.searchParams.set("tab", "manage");
    else url.searchParams.delete("tab");
    window.history.replaceState(null, "", url.toString());
  };

  const accessUnavailable = !authed || !editorIdentity || !access || access.loading || Boolean(access.error) || !access.access;
  const accessState = !authed || !editorIdentity || !access
    ? <p role="alert" className="text-sm text-red-600">無法確認任務權限。</p>
    : access.loading
      ? <p role="status" className="text-sm">正在確認任務權限…</p>
      : <div role="alert" className="space-y-2 text-sm text-red-600">
          <p>任務權限暫時無法確認。</p>
          <button type="button" className="underline" onClick={() => void access.refresh()}>重試權限檢查</button>
        </div>;
  if (denied) return (
    <div role="alert" className="space-y-2 text-sm">
      <p>你沒有編輯此任務的權限。</p>
      <Link to="/admin" className="underline">返回管理首頁</Link>
    </div>
  );
  if (accessUnavailable && !(authed && tab === "edit" && authorizedEditorKey === editorIdentity && q.data)) return accessState;
  if (q.isLoading) return <p className="text-sm">載入中…</p>;
  if (!q.data) return <p className="text-sm text-red-600">找不到任務。</p>;
  const m = q.data.mission;
  const engaged = (m.filled ?? 0) > 0; // server is authoritative; this drives the disabled hints
  const tabBtn = "rounded-[var(--radius)] border-2 border-[var(--color-ink)] px-3 py-1 text-sm font-bold";
  return (
    <div className="space-y-4">
      {accessUnavailable && accessState}
      <div key="mission-controls" hidden={accessUnavailable} aria-hidden={accessUnavailable}>
        <h1 className="font-display text-lg font-bold">{m.title}</h1>
        <div className="flex gap-2">
          <button type="button" className={`${tabBtn} ${tab === "edit" ? "bg-[var(--color-acid)]" : "bg-white"}`} onClick={() => selectTab("edit")}>編輯</button>
          <button type="button" className={`${tabBtn} ${tab === "manage" ? "bg-[var(--color-acid)]" : "bg-white"}`} onClick={() => selectTab("manage")}>管理</button>
        </div>
        {tab === "edit" ? (
          <VersionedMissionEditor key={editorIdentity ?? m.id} initial={m} engaged={engaged} saving={update.isPending || accessUnavailable} onDirtyChange={editorNavigation.changed}
            onSave={(body, version) => update.mutateAsync({ body, version })} />
        ) : (
          <MissionManage missionId={missionId} />
        )}
      </div>
    </div>
  );
}

/** MissionEditor reads `initial` once at mount; pin the matching version for the same lifetime. */
function VersionedMissionEditor({ initial, onSave, ...rest }: Omit<ComponentProps<typeof MissionEditor>, "mode" | "onSave"> & {
  initial: AdminMission; onSave: (body: MissionDraftInput, version: string) => Promise<unknown>;
}) {
  const [version] = useState(initial.updated_at);
  return <MissionEditor mode="edit" initial={initial} {...rest} onSave={(body) => onSave(body, version)} />;
}
