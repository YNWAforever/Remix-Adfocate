import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AdminAuthError, adminKeys, fetchEngagedUsers, type EngagedCreator } from "@/lib/admin";
import { useAdminAuth } from "@/components/admin/AdminAuthContext";

export const Route = createFileRoute("/admin/engaged")({ component: EngagedTab });

const STAGE_LABEL: Record<string, string> = {
  joined: "已加入",
  submitted: "已提交",
  under_review: "審核中",
};

function EngagedTab() {
  const { secret, reportAuthError } = useAdminAuth();
  const q = useQuery({ queryKey: adminKeys.engaged, queryFn: fetchEngagedUsers, enabled: !!secret, retry: false });
  useEffect(() => {
    if (q.error instanceof AdminAuthError) reportAuthError(q.error);
  }, [q.error, reportAuthError]);

  if (q.isLoading) return <p className="text-sm">載入中…</p>;
  if (q.data?.creators.length === 0) return <p className="text-sm text-[var(--color-soft-ink)]">暫無活躍創作者</p>;

  return (
    <div className="space-y-3">
      {q.data?.creators.map((c) => <EngagedCard key={c.id} creator={c} />)}
    </div>
  );
}

function EngagedCard({ creator }: { creator: EngagedCreator }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex w-full flex-wrap items-center justify-between gap-3 p-3 text-left">
        <div className="flex items-center gap-3">
          <span className="font-heading font-bold">{creator.displayName ?? "未命名創作者"}</span>
          <span className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-sky)] px-2 py-0.5 text-xs font-bold">{creator.level}</span>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm text-[var(--color-soft-ink)]">
          <span>進行中 {creator.activeCount}</span>
          <span>已完成 {creator.completedCount}</span>
          <span>{creator.pointsEarned} 分</span>
        </div>
      </button>
      {open && (
        <ul className="space-y-2 border-t-2 border-[var(--color-ink)] p-3">
          {creator.activeMissions.map((m) => (
            <li key={m.submissionId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="font-bold">{m.missionTitle}</span>
              <span className="rounded-full border-2 border-[var(--color-ink)] bg-white px-2 py-0.5 text-xs font-bold">{STAGE_LABEL[m.status] ?? m.status}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
