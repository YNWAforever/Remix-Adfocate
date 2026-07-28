import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchWorkspaces, adminMissionKeys, AdminAuthError } from "@/lib/admin";
import { useAdminAuth } from "./AdminAuthContext";
import { useAdminWorkspace } from "./AdminWorkspaceContext";

export function WorkspaceSwitcher() {
  const { authed, reportAuthError } = useAdminAuth();
  const { workspace, workspaceSlug, setWorkspace } = useAdminWorkspace();
  const ws = useQuery({
    queryKey: adminMissionKeys.workspaces,
    queryFn: fetchWorkspaces,
    enabled: authed,
    retry: false,
  });
  useEffect(() => {
    if (ws.error instanceof AdminAuthError) reportAuthError(ws.error);
  }, [ws.error, reportAuthError]);
  useEffect(() => {
    if (!ws.data || !workspace) return;
    const selected = ws.data.workspaces.find((item) => item.id === workspace);
    const canonicalSlug = selected?.slug ?? "";
    if (canonicalSlug !== workspaceSlug || !selected) {
      setWorkspace(workspace, canonicalSlug);
    }
  }, [setWorkspace, workspace, workspaceSlug, ws.data]);

  return (
    <select
      aria-label="workspace"
      className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white px-2 py-1 text-sm"
      value={workspace}
      onChange={(e) => {
        const id = e.target.value;
        const selected = ws.data?.workspaces.find((item) => item.id === id);
        setWorkspace(id, selected?.slug ?? "");
      }}
    >
      <option value="">全部 / All workspaces</option>
      {(ws.data?.workspaces ?? []).map((w) => (
        <option key={w.id} value={w.id}>{w.name}</option>
      ))}
    </select>
  );
}
