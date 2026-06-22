import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AdminAuthError, adminKeys, fetchEngagedUsers, type EngagedCreator } from "@/lib/admin";
import { useAdminAuth } from "@/components/admin/AdminAuthContext";
import { useAdminWorkspace } from "@/components/admin/AdminWorkspaceContext";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/admin/engaged")({ component: EngagedTab });

function EngagedTab() {
  const { t } = useI18n();
  const { secret, reportAuthError } = useAdminAuth();
  const { workspace } = useAdminWorkspace();
  const q = useQuery({
    queryKey: adminKeys.engaged(workspace),
    queryFn: () => fetchEngagedUsers(workspace),
    enabled: !!secret,
    retry: false,
  });
  useEffect(() => {
    if (q.error instanceof AdminAuthError) reportAuthError(q.error);
  }, [q.error, reportAuthError]);

  if (q.isLoading) return <p className="text-sm">{t("common.loading")}</p>;
  if (q.data?.creators.length === 0) return <p className="text-sm text-[var(--color-soft-ink)]">{t("app.admin.engagedEmpty")}</p>;

  return (
    <div className="space-y-3">
      {q.data?.creators.map((c) => <EngagedCard key={c.id} creator={c} />)}
    </div>
  );
}

function EngagedCard({ creator }: { creator: EngagedCreator }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  const stageLabel = useMemo<Record<string, string>>(
    () => ({
      joined: t("app.admin.engagedStageJoined"),
      submitted: t("app.admin.engagedStageSubmitted"),
      under_review: t("app.admin.engagedStageUnderReview"),
    }),
    [t],
  );

  return (
    <div className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex w-full flex-wrap items-center justify-between gap-3 p-3 text-left">
        <div className="flex items-center gap-3">
          <span className="font-heading font-bold">{creator.displayName ?? t("app.admin.engagedUnnamed")}</span>
          <span className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-sky)] px-2 py-0.5 text-xs font-bold">{creator.level}</span>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm text-[var(--color-soft-ink)]">
          <span>{t("app.admin.engagedActive", { n: creator.activeCount })}</span>
          <span>{t("app.admin.engagedCompleted", { n: creator.completedCount })}</span>
          <span>{t("app.admin.engagedPoints", { n: creator.pointsEarned })}</span>
        </div>
      </button>
      {open && (
        <ul className="space-y-2 border-t-2 border-[var(--color-ink)] p-3">
          {creator.activeMissions.map((m) => (
            <li key={m.submissionId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="font-bold">{m.missionTitle}</span>
              <span className="rounded-full border-2 border-[var(--color-ink)] bg-white px-2 py-0.5 text-xs font-bold">{stageLabel[m.status] ?? m.status}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
