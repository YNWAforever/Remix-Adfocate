import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchMissionActivity, acceptApplication, declineApplication, approveSubmission, rejectSubmission,
  adminMissionKeys, adminKeys, AdminAuthError, AdminRequestError,
} from "@/lib/admin";
import { useAdminAuth } from "./AdminAuthContext";
import { useAdminWorkspace } from "./AdminWorkspaceContext";

export function MissionManage({ missionId }: { missionId: string }) {
  const { authed, reportAuthError } = useAdminAuth();
  const { workspace } = useAdminWorkspace();
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: adminMissionKeys.activity(missionId),
    queryFn: () => fetchMissionActivity(missionId),
    enabled: authed,
    retry: false,
  });
  useEffect(() => {
    if (q.error instanceof AdminAuthError) reportAuthError(q.error);
  }, [q.error, reportAuthError]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: adminMissionKeys.activity(missionId) });
    qc.invalidateQueries({ queryKey: adminMissionKeys.detail(missionId) });
    qc.invalidateQueries({ queryKey: adminKeys.applications(workspace) });
    qc.invalidateQueries({ queryKey: adminKeys.submissions("submitted", workspace) });
    qc.invalidateQueries({ queryKey: adminKeys.engaged(workspace) });
  };
  const onErr = (e: unknown) => {
    if (e instanceof AdminAuthError) { reportAuthError(e); return; }
    window.alert(e instanceof AdminRequestError ? e.message : "操作失敗");
  };

  // Decline and return both require a reason the creator will see; cancelling or leaving it
  // empty leaves the item pending.
  const askReason = () => window.prompt("原因（Creator 會看到） / Reason (shown to the creator)")?.trim() ?? "";

  const accept = useMutation({ mutationFn: (id: string) => acceptApplication(id), onSuccess: invalidate, onError: onErr });
  const decline = useMutation({ mutationFn: (v: { id: string; notes: string }) => declineApplication(v.id, v.notes), onSuccess: invalidate, onError: onErr });
  const approve = useMutation({ mutationFn: (id: string) => approveSubmission(id, {}), onSuccess: invalidate, onError: onErr });
  const reject = useMutation({ mutationFn: (v: { id: string; notes: string }) => rejectSubmission(v.id, v.notes), onSuccess: invalidate, onError: onErr });

  if (q.isLoading) return <p className="text-sm">載入中…</p>;
  if (!q.data) return <p className="text-sm text-red-600">找不到任務活動。</p>;
  const a = q.data;

  const btn = "rounded-[var(--radius)] border-2 border-[var(--color-ink)] px-2 py-0.5 text-sm font-bold";

  return (
    <div className="space-y-4">
      <div className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3 text-sm">
        狀態：{a.mission.status} ・ 名額 {a.fill.filled}/{a.fill.quota}
      </div>

      <section className="space-y-2">
        <h2 className="font-bold">申請者（{a.applicants.length}）</h2>
        {a.applicants.map((row) => (
          <div key={row.id} className="flex items-center justify-between rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-2">
            <span>{row.creators.display_name}</span>
            <span className="flex gap-2">
              <button type="button" className={`${btn} bg-[var(--color-acid)]`} onClick={() => accept.mutate(row.id)} disabled={accept.isPending}>接受</button>
              <button type="button" className={`${btn} bg-white`} onClick={() => { const notes = askReason(); if (notes) decline.mutate({ id: row.id, notes }); }} disabled={decline.isPending}>拒絕</button>
            </span>
          </div>
        ))}
      </section>

      <section className="space-y-2">
        <h2 className="font-bold">待審內容（{a.submissions.length}）</h2>
        {a.submissions.map((row) => (
          <div key={row.id} className="flex items-center justify-between rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-2">
            <span>{row.creators.display_name}</span>
            <span className="flex gap-2">
              <button type="button" className={`${btn} bg-[var(--color-acid)]`} onClick={() => approve.mutate(row.id)} disabled={approve.isPending}>批准</button>
              <button type="button" className={`${btn} bg-white`} onClick={() => { const notes = askReason(); if (notes) reject.mutate({ id: row.id, notes }); }} disabled={reject.isPending}>退回</button>
            </span>
          </div>
        ))}
      </section>

      <section className="space-y-2">
        <h2 className="font-bold">已參與（{a.engaged.length}）</h2>
        {a.engaged.map((row) => (
          <div key={row.id} className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-2 text-sm">
            {row.creators.display_name} ・ {row.status}
          </div>
        ))}
      </section>
    </div>
  );
}
