// src/routes/admin.missions.new.tsx
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AdminAuthError, AdminRequestError, adminMissionKeys, createMission, fetchWorkspaces, type MissionDraftInput } from "@/lib/admin";
import { useAdminAuth } from "@/components/admin/AdminAuthContext";
import { useAdminWorkspace } from "@/components/admin/AdminWorkspaceContext";
import { useStaffAccess } from "@/components/admin/StaffAccessContext";
import { MissionEditor } from "@/components/admin/MissionEditor";
import { useMissionEditorNavigation } from "@/components/admin/useMissionEditorNavigation";

export const Route = createFileRoute("/admin/missions/new")({ component: NewMission });

type EditorScope = { identity: string; key: string; workspaceId: string };

function NewMission() {
  const { authed, staff } = useAdminAuth();
  const { workspace } = useAdminWorkspace();
  const access = useStaffAccess();
  const identity = staff?.userId ? JSON.stringify([staff.userId, workspace]) : null;
  const resolvedWorkspace = access?.access?.workspace;
  const matchingWorkspace = Boolean(resolvedWorkspace
    && (!workspace || workspace === resolvedWorkspace.id || workspace === resolvedWorkspace.slug));
  const canManage = Boolean(authed && identity && access?.access && !access.loading && !access.error
    && matchingWorkspace && access.can("mission.manage"));
  const denied = Boolean(authed && identity && resolvedWorkspace && access && !access.loading && !access.error
    && (!matchingWorkspace || !access.can("mission.manage")));
  const scopeKey = canManage && resolvedWorkspace ? JSON.stringify([identity, resolvedWorkspace.id]) : null;
  const [retainedScope, setRetainedScope] = useState<EditorScope | null>(null);
  useEffect(() => {
    if (!authed || !identity || denied || (retainedScope && retainedScope.identity !== identity)) {
      setRetainedScope(null);
    } else if (scopeKey && resolvedWorkspace && retainedScope?.key !== scopeKey) {
      setRetainedScope({ identity, key: scopeKey, workspaceId: resolvedWorkspace.id });
    }
  }, [authed, identity, denied, scopeKey, resolvedWorkspace, retainedScope]);

  const accessState = !authed || !identity || !access
    ? <p role="alert" className="text-sm text-red-600">無法確認任務權限。</p>
    : access.loading
      ? <p role="status" className="text-sm">正在確認任務權限…</p>
      : <div role="alert" className="space-y-2 text-sm text-red-600">
          <p>任務權限暫時無法確認。</p>
          <button type="button" className="underline" onClick={() => void access.refresh()}>重試權限檢查</button>
        </div>;
  if (denied) return <div role="alert" className="space-y-2 text-sm">
    <p>你沒有建立任務的權限。</p>
    <Link to="/admin" className="underline">返回管理首頁</Link>
  </div>;

  const scope = scopeKey && identity && resolvedWorkspace
    ? { identity, key: scopeKey, workspaceId: resolvedWorkspace.id }
    : authed && identity && retainedScope?.identity === identity ? retainedScope : null;
  if (!scope) return accessState;
  return <div className="space-y-4">
    {!canManage && accessState}
    <div key="mission-controls" hidden={!canManage} aria-hidden={!canManage}>
      <AuthorizedNewMissionEditor key={scope.key} scope={scope} canManage={canManage} />
    </div>
  </div>;
}

/** Keep this form mounted only for the same authorized staff/workspace lifetime. */
function AuthorizedNewMissionEditor({ scope, canManage }: { scope: EditorScope; canManage: boolean }) {
  const { reportAuthError } = useAdminAuth();
  const navigate = useNavigate();
  const editorNavigation = useMissionEditorNavigation();
  const currentAuthority = useRef(false);
  useLayoutEffect(() => {
    currentAuthority.current = canManage;
    return () => { currentAuthority.current = false; };
  }, [canManage]);
  const ws = useQuery({ queryKey: [...adminMissionKeys.workspaces, scope.key], queryFn: fetchWorkspaces, enabled: canManage, retry: false });
  useEffect(() => { if (ws.error instanceof AdminAuthError) reportAuthError(ws.error); }, [ws.error, reportAuthError]);
  const create = useMutation({
    mutationFn: (body: MissionDraftInput) => {
      // A retained callback must recheck committed authority, including after unmount.
      if (!currentAuthority.current || body.workspace_id !== scope.workspaceId) {
        throw new AdminRequestError("無法確認目前工作區的任務權限。", "STAFF_CAPABILITY_REQUIRED", undefined, 403);
      }
      return createMission(body);
    },
    onSuccess: () => {
      if (!currentAuthority.current) return;
      editorNavigation.saved(); return navigate({ to: "/admin/missions" });
    },
  });
  const workspaces = ws.data?.workspaces.filter(item => item.id === scope.workspaceId) ?? [];
  return (
    <div className="space-y-4">
      <h1 className="font-display text-lg font-bold">新任務（草稿）</h1>
      {/* Mount the editor only once workspaces are fetched — its initial workspace_id is
          captured at mount, so rendering before the query resolves leaves it empty. */}
      {workspaces.length ? (
        <MissionEditor mode="create" workspaces={workspaces} saving={create.isPending || !canManage} onDirtyChange={editorNavigation.changed}
          onSave={(body) => create.mutateAsync(body)} />
      ) : ws.error || ws.data ? (
        <div role="alert" className="space-y-2 text-sm text-red-600">
          <p>無法載入目前工作區。</p>
          <button type="button" className="underline" disabled={!canManage} onClick={() => void ws.refetch()}>重試載入</button>
        </div>
      ) : (
        <p className="text-sm text-[var(--color-soft-ink)]">載入中…</p>
      )}
    </div>
  );
}
