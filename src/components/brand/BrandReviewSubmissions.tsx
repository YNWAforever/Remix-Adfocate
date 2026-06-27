import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n";
import { useBrandAuth } from "@/components/brand/BrandAuthContext";
import {
  BrandAuthError,
  brandKeys,
  fetchBrandSubmissions,
  approveBrandSubmission,
  rejectBrandSubmission,
} from "@/lib/brand";
import { BrandBudgetBanner } from "@/components/brand/BrandBudgetCard";
import { AdminRequestError } from "@/lib/admin";
import type { Submission } from "@/lib/admin";

export function BrandReviewSubmissions() {
  const { t } = useI18n();
  const { reportAuthError } = useBrandAuth();
  const qc = useQueryClient();
  const subs = useQuery({
    queryKey: brandKeys.submissions("submitted"),
    queryFn: () => fetchBrandSubmissions("submitted"),
    retry: false,
  });
  useEffect(() => {
    if (subs.error instanceof BrandAuthError) reportAuthError(subs.error);
  }, [subs.error, reportAuthError]);

  if (subs.isLoading) return <p className="text-sm">載入中…</p>;
  if (subs.data?.submissions.length === 0)
    return <p className="text-sm text-[var(--color-soft-ink)]">{t("app.brand.review.submissionsEmpty")}</p>;

  return (
    <div className="space-y-3">
      <BrandBudgetBanner />
      {subs.data?.submissions.map((s) => (
        <BrandSubmissionCard
          key={s.id}
          submission={s}
          onDone={() => qc.invalidateQueries({ queryKey: brandKeys.submissions("submitted") })}
        />
      ))}
    </div>
  );
}

function BrandSubmissionCard({ submission, onDone }: { submission: Submission; onDone: () => void }) {
  const { t } = useI18n();
  const { reportAuthError } = useBrandAuth();
  const [rating, setRating] = useState("");
  const [notes, setNotes] = useState("");
  const onErr = (e: unknown) => {
    if (e instanceof BrandAuthError) { reportAuthError(e); return; }
    window.alert(e instanceof AdminRequestError ? e.message : "操作失敗");
  };
  const approve = useMutation({
    mutationFn: () => approveBrandSubmission(submission.id, { notes: notes || undefined, rating: rating ? Number(rating) : undefined }),
    onSuccess: onDone,
    onError: onErr,
  });
  const reject = useMutation({ mutationFn: () => rejectBrandSubmission(submission.id, notes || undefined), onSuccess: onDone, onError: onErr });
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
        <select
          aria-label={t("app.brand.review.ratingLabel")}
          value={rating}
          onChange={(e) => setRating(e.target.value)}
          className="h-9 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white px-2 text-sm"
        >
          <option value="">{t("app.brand.review.ratingPlaceholder")}</option>
          <option value="1">1★</option>
          <option value="2">2★</option>
          <option value="3">3★</option>
          <option value="4">4★</option>
          <option value="5">5★</option>
        </select>
        <input
          aria-label={t("app.brand.review.notesLabel")}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={t("app.brand.review.notesPlaceholder")}
          className="h-9 min-w-0 flex-1 rounded-[var(--radius)] border-2 border-[var(--color-ink)] px-2 text-sm"
        />
        <button
          aria-label={t("app.brand.review.approve")}
          disabled={busy}
          onClick={() => approve.mutate()}
          className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-3 py-1 font-heading font-bold"
        >
          {t("app.brand.review.approve")}
        </button>
        <button
          aria-label={t("app.brand.review.reject")}
          disabled={busy}
          onClick={() => reject.mutate()}
          className="rounded-full border-2 border-[var(--color-ink)] bg-white px-3 py-1 font-heading font-bold"
        >
          {t("app.brand.review.reject")}
        </button>
      </div>
    </div>
  );
}
