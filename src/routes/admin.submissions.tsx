import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AdminAuthError,
  adminKeys,
  approveSubmission,
  fetchSubmissions,
  rejectSubmission,
  type Submission,
} from "@/lib/admin";
import { useAdminAuth } from "@/components/admin/AdminAuthContext";
import { useAdminWorkspace } from "@/components/admin/AdminWorkspaceContext";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/admin/submissions")({ component: SubmissionsTab });

function SubmissionsTab() {
  const { t } = useI18n();
  const { authed, reportAuthError } = useAdminAuth();
  const { workspace } = useAdminWorkspace();
  const qc = useQueryClient();
  const subs = useQuery({
    queryKey: adminKeys.submissions("submitted", workspace),
    queryFn: () => fetchSubmissions("submitted", workspace),
    enabled: authed,
    retry: false,
  });
  useEffect(() => {
    if (subs.error instanceof AdminAuthError) reportAuthError(subs.error);
  }, [subs.error, reportAuthError]);

  if (subs.isLoading) return <p className="text-sm">{t("common.loading")}</p>;
  if (subs.data?.submissions.length === 0) return <p className="text-sm text-[var(--color-soft-ink)]">{t("app.admin.submissionsEmpty")}</p>;

  return (
    <div className="space-y-3">
      {subs.data?.submissions.map((s) => (
        <SubmissionCard
          key={s.id}
          submission={s}
          onDone={() => qc.invalidateQueries({ queryKey: adminKeys.submissions("submitted", workspace) })}
        />
      ))}
    </div>
  );
}

function SubmissionCard({ submission, onDone }: { submission: Submission; onDone: () => void }) {
  const { t } = useI18n();
  const [rating, setRating] = useState("");
  const [notes, setNotes] = useState("");
  const approve = useMutation({
    mutationFn: () => approveSubmission(submission.id, { notes: notes || undefined, rating: rating ? Number(rating) : undefined }),
    onSuccess: onDone,
  });
  const reject = useMutation({ mutationFn: () => rejectSubmission(submission.id, notes || undefined), onSuccess: onDone });
  const busy = approve.isPending || reject.isPending;

  return (
    <div className="space-y-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-heading font-bold">{submission.creators.display_name}</p>
        <p className="text-sm text-[var(--color-soft-ink)]">{submission.missions.title}</p>
      </div>
      <ul className="space-y-1 text-sm">
        {submission.content_urls.map((url) => (
          <li key={url}>
            <a href={url} target="_blank" rel="noreferrer" className="font-bold underline break-all">{url}</a>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label={t("app.admin.submissionsRatingLabel")} value={rating} onChange={(e) => setRating(e.target.value)} className="h-9 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white px-2 text-sm">
          <option value="">{t("app.admin.submissionsRatingPlaceholder")}</option>
          <option value="1">1★</option>
          <option value="2">2★</option>
          <option value="3">3★</option>
          <option value="4">4★</option>
          <option value="5">5★</option>
        </select>
        <input aria-label={t("app.admin.submissionsNotesLabel")} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("app.admin.submissionsNotesPlaceholder")} className="h-9 min-w-0 flex-1 rounded-[var(--radius)] border-2 border-[var(--color-ink)] px-2 text-sm" />
        <button aria-label={t("app.admin.submissionsApprove")} disabled={busy} onClick={() => approve.mutate()} className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-3 py-1 font-heading font-bold">{t("app.admin.submissionsApprove")}</button>
        <button aria-label={t("app.admin.submissionsDecline")} disabled={busy} onClick={() => reject.mutate()} className="rounded-full border-2 border-[var(--color-ink)] bg-white px-3 py-1 font-heading font-bold">{t("app.admin.submissionsDecline")}</button>
      </div>
    </div>
  );
}
