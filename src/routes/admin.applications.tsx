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
import { ReviewBadge, ShortlistBadge } from "@/components/operator/OperatorBadges";

export const Route = createFileRoute("/admin/applications")({ component: ApplicationsTab });

function ApplicationsTab() {
  const { secret, reportAuthError } = useAdminAuth();
  const qc = useQueryClient();
  const apps = useQuery({ queryKey: adminKeys.applications, queryFn: fetchApplications, enabled: !!secret, retry: false });
  useEffect(() => {
    if (apps.error instanceof AdminAuthError) reportAuthError(apps.error);
  }, [apps.error, reportAuthError]);

  const decide = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "accept" | "decline" }) =>
      action === "accept" ? acceptApplication(id) : declineApplication(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: adminKeys.applications }),
  });

  if (apps.isLoading) return <p className="text-sm">載入中…</p>;
  if (apps.data?.applications.length === 0) return <p className="text-sm text-[var(--color-soft-ink)]">暫無待審批申請</p>;

  return (
    <div className="space-y-3">
      {apps.data?.applications.map((a: Application) => (
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
            <button aria-label="接受" disabled={decide.isPending} onClick={() => decide.mutate({ id: a.id, action: "accept" })} className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-3 py-1 font-heading font-bold">接受</button>
            <button aria-label="拒絕" disabled={decide.isPending} onClick={() => decide.mutate({ id: a.id, action: "decline" })} className="rounded-full border-2 border-[var(--color-ink)] bg-white px-3 py-1 font-heading font-bold">拒絕</button>
          </div>
        </div>
      ))}
    </div>
  );
}
