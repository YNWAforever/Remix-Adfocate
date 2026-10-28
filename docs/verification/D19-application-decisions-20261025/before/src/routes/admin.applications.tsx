import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AdminAuthError,
  acceptApplication,
  adminKeys,
  declineApplication,
  fetchApplications,
  type Application,
} from "@/lib/admin";
import { useAdminAuth } from "@/components/admin/AdminAuthContext";
import { useAdminWorkspace } from "@/components/admin/AdminWorkspaceContext";
import { ReviewBadge, ShortlistBadge } from "@/components/operator/OperatorBadges";
import { useI18n } from "@/lib/i18n";
import { RequestFeedback, canShowPreviousData } from "@/components/RequestFeedback";

export const Route = createFileRoute("/admin/applications")({ component: ApplicationsTab });

function ApplicationsTab() {
  const { t } = useI18n();
  const { authed, reportAuthError } = useAdminAuth();
  const { workspace } = useAdminWorkspace();
  const qc = useQueryClient();
  const apps = useQuery({
    queryKey: adminKeys.applications(workspace),
    queryFn: () => fetchApplications(workspace),
    enabled: authed,
    retry: false,
  });
  const visibleApps = canShowPreviousData(apps.error) ? apps.data : undefined;
  useEffect(() => {
    if (apps.error instanceof AdminAuthError) reportAuthError(apps.error);
  }, [apps.error, reportAuthError]);

  const decide = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "accept" | "decline" }) =>
      action === "accept" ? acceptApplication(id) : declineApplication(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: adminKeys.applications(workspace) }),
  });

  if (apps.isLoading) return <p className="text-sm">{t("common.loading")}</p>;

  return (
    <div className="space-y-3">
      <RequestFeedback error={apps.error} stale={Boolean(visibleApps)} retry={() => void apps.refetch()} />
      <RequestFeedback error={decide.error} />
      {!apps.isError && visibleApps?.applications.length === 0 && <p role="status" className="text-sm text-[var(--color-soft-ink)]">{t("app.admin.applicationsEmpty")}</p>}
      {visibleApps?.applications.map((a: Application) => (
        <div
          key={a.id}
          className="flex min-h-[88px] flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3"
        >
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-heading font-bold">{a.creators.display_name}</p>
              {a.creator_review?.status ? <ReviewBadge status={a.creator_review.status} /> : null}
              {a.mission_shortlist?.status ? (
                <ShortlistBadge status={a.mission_shortlist.status as "shortlisted" | "invited" | "dismissed" | "accepted" | "declined"} />
              ) : (
                <span className="rounded-full border-2 border-[var(--color-ink)] bg-white px-2 py-0.5 text-xs font-bold">not shortlisted</span>
              )}
            </div>
            <p className="text-sm text-[var(--color-soft-ink)]">{a.missions.title}</p>
            {a.mission_id ? (
              <a href={`/operator/missions/${a.mission_id}`} className="text-xs font-bold underline">Mission selection</a>
            ) : null}
          </div>
          <div className="flex shrink-0 gap-2">
            <button aria-label={t("app.admin.applicationsAccept")} disabled={decide.isPending || apps.isError || apps.isFetching} onClick={() => decide.mutate({ id: a.id, action: "accept" })} className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-3 py-1 font-heading font-bold">{t("app.admin.applicationsAccept")}</button>
            <button aria-label={t("app.admin.applicationsDecline")} disabled={decide.isPending || apps.isError || apps.isFetching} onClick={() => decide.mutate({ id: a.id, action: "decline" })} className="rounded-full border-2 border-[var(--color-ink)] bg-white px-3 py-1 font-heading font-bold">{t("app.admin.applicationsDecline")}</button>
          </div>
        </div>
      ))}
    </div>
  );
}
