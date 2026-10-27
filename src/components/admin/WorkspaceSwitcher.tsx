import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchWorkspaces, adminMissionKeys, AdminAuthError } from "@/lib/admin";
import { useAdminAuth } from "./AdminAuthContext";
import { useAdminWorkspace } from "./AdminWorkspaceContext";
import { useStaffAccess } from "./StaffAccessContext";

export function WorkspaceSwitcher() {
  const { authed, reportAuthError } = useAdminAuth();
  const { workspace, workspaceSlug, setWorkspace } = useAdminWorkspace();
  const access=useStaffAccess();
  const ws = useQuery({
    queryKey: adminMissionKeys.workspaces,
    queryFn: fetchWorkspaces,
    enabled: authed && (!access || Boolean(access.access?.workspace)),
    retry: false,
  });
  useEffect(() => {
    if (ws.error instanceof AdminAuthError) reportAuthError(ws.error);
  }, [ws.error, reportAuthError]);
  useEffect(() => {
    if (!ws.data) return;
    if (!workspace && ws.data.workspaces.length === 1) {
      const only = ws.data.workspaces[0]; setWorkspace(only.id, only.slug); return;
    }
    if (!workspace) return;
    const selected = ws.data.workspaces.find((item) => item.id === workspace);
    if (!selected) {
      setWorkspace("", "");
      return;
    }
    if (selected.slug !== workspaceSlug) setWorkspace(workspace, selected.slug);
  }, [setWorkspace, workspace, workspaceSlug, ws.data]);

  if(access?.access?.workspace===null)return <span className="text-sm">{access.can("content.manage")?"Platform content / 平台內容":"No workspace membership / 未有工作空間membership；請聯絡owner"}</span>;
  if(access&&!access.access)return null;
  if (ws.isError) return <div role="alert" className="space-y-2 text-sm">
    <p>無法載入工作空間。若已登入但未獲分配，請聯絡 workspace owner。 / Workspace access could not be loaded. Ask the owner to check membership.</p>
    <button type="button" onClick={() => void ws.refetch()}>重試 / Retry</button>
  </div>;
  if (ws.isLoading) return <span role="status">載入工作空間 / Loading workspaces…</span>;
  if (ws.data?.workspaces.length === 0) return <p role="alert">未有獲授權的工作空間 / No authorized workspace. Contact the workspace owner.</p>;

  return (
    <select
      aria-label="workspace"
      className="min-h-11 max-w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white px-2 py-1 text-sm"
      value={workspace}
      onChange={(e) => {
        const id = e.target.value;
        const selected = ws.data?.workspaces.find((item) => item.id === id);
        setWorkspace(id, selected?.slug ?? "");
      }}
    >
      {ws.data?.workspaces.length !== 1 && <option value="">全部已授權範圍 / All authorized workspaces</option>}
      {(ws.data?.workspaces ?? []).map((w) => (
        <option key={w.id} value={w.id}>{w.name}</option>
      ))}
    </select>
  );
}
