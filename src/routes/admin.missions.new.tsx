// src/routes/admin.missions.new.tsx
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AdminAuthError, adminMissionKeys, createMission, fetchWorkspaces, type MissionDraftInput } from "@/lib/admin";
import { useAdminAuth } from "@/components/admin/AdminAuthContext";
import { MissionEditor } from "@/components/admin/MissionEditor";

export const Route = createFileRoute("/admin/missions/new")({ component: NewMission });

function NewMission() {
  const { authed, reportAuthError } = useAdminAuth();
  const navigate = useNavigate();
  const ws = useQuery({ queryKey: adminMissionKeys.workspaces, queryFn: fetchWorkspaces, enabled: authed, retry: false });
  useEffect(() => { if (ws.error instanceof AdminAuthError) reportAuthError(ws.error); }, [ws.error, reportAuthError]);
  const create = useMutation({
    mutationFn: (body: MissionDraftInput) => createMission(body),
    onSuccess: () => navigate({ to: "/admin/missions" }),
  });
  return (
    <div className="space-y-4">
      <h1 className="font-display text-lg font-bold">新任務（草稿）</h1>
      {/* Mount the editor only once workspaces are fetched — its initial workspace_id is
          captured at mount, so rendering before the query resolves leaves it empty. */}
      {ws.data ? (
        <MissionEditor mode="create" workspaces={ws.data.workspaces ?? []} saving={create.isPending}
          onSave={(body) => create.mutateAsync(body)} />
      ) : (
        <p className="text-sm text-[var(--color-soft-ink)]">載入中…</p>
      )}
    </div>
  );
}
