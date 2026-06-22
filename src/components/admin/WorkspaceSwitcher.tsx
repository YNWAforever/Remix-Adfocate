import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchWorkspaces, adminMissionKeys, AdminAuthError } from "@/lib/admin";
import { useAdminAuth } from "./AdminAuthContext";
import { useAdminWorkspace } from "./AdminWorkspaceContext";

export function WorkspaceSwitcher() {
  const { secret, reportAuthError } = useAdminAuth();
  const { workspace, setWorkspace } = useAdminWorkspace();
  const ws = useQuery({
    queryKey: adminMissionKeys.workspaces,
    queryFn: fetchWorkspaces,
    enabled: !!secret,
    retry: false,
  });
  useEffect(() => {
    if (ws.error instanceof AdminAuthError) reportAuthError(ws.error);
  }, [ws.error, reportAuthError]);

  return (
    <select
      aria-label="workspace"
      className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white px-2 py-1 text-sm"
      value={workspace}
      onChange={(e) => setWorkspace(e.target.value)}
    >
      <option value="">全部 / All workspaces</option>
      {(ws.data?.workspaces ?? []).map((w) => (
        <option key={w.id} value={w.id}>{w.name}</option>
      ))}
    </select>
  );
}
