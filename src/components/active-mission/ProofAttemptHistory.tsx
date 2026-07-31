import { useEffect, useId, useRef } from "react";
import type { MissionPublicationView, PublicationProofAttemptView } from "@/lib/activeMission";
import { useI18n } from "@/lib/i18n";

export type ProofAttemptHistoryVariant = "standard" | "reward_pending" | "reward_reassessment";

type Props = {
  publication: MissionPublicationView;
  variant?: ProofAttemptHistoryVariant;
  autoFocusVerifiedHeading?: boolean;
};

type Translate = (key: string, params?: Record<string, string | number>) => string;

const CATEGORY_KEYS: Record<string, string> = {
  access: "app.activeMission.proofHistory.category.access",
  platform: "app.activeMission.proofHistory.category.platform",
  account: "app.activeMission.proofHistory.category.account",
  content: "app.activeMission.proofHistory.category.content",
  timing: "app.activeMission.proofHistory.category.timing",
  disclosure: "app.activeMission.proofHistory.category.disclosure",
  evidence: "app.activeMission.proofHistory.category.evidence",
  other: "app.activeMission.proofHistory.category.other",
};

const VERIFIED_BODY_KEYS: Record<ProofAttemptHistoryVariant, string> = {
  standard: "app.activeMission.proofHistory.verifiedBody.standard",
  reward_pending: "app.activeMission.proofHistory.verifiedBody.rewardPending",
  reward_reassessment: "app.activeMission.proofHistory.verifiedBody.rewardReassessment",
};

function displayTime(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function Metadata({ attempt, t }: { attempt: PublicationProofAttemptView; t: Translate }) {
  if (attempt.metadataStatus !== "available") {
    return (
      <p className="rounded-xl border border-amber-700 bg-amber-50 p-3 text-sm text-amber-950">
        {t("app.activeMission.proofHistory.metadataUnavailable")}
      </p>
    );
  }
  const title = typeof attempt.metadataSnapshot.pageTitle === "string"
    ? attempt.metadataSnapshot.pageTitle
    : null;
  return title ? (
    <p className="text-sm">
      <span className="font-bold">{t("app.activeMission.proofHistory.previewTitle")}:</span>{" "}{title}
    </p>
  ) : null;
}

function AttemptCard({
  attempt,
  accepted,
  locale,
  t,
}: {
  attempt: PublicationProofAttemptView;
  accepted: boolean;
  locale: string;
  t: Translate;
}) {
  const headingId = useId();
  return (
    <article aria-labelledby={headingId} className="rounded-2xl border-2 border-[var(--color-ink)] bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={headingId} className="font-heading text-lg font-bold">
          {t("app.activeMission.proofHistory.attempt", { number: attempt.attemptNumber })}
        </h3>
        <div className="flex gap-2">
          {accepted ? (
            <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-900">
              {t("app.activeMission.proofHistory.acceptedAttempt", { number: attempt.attemptNumber })}
            </span>
          ) : null}
          {attempt.submittedLate ? (
            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-950">
              {t("app.activeMission.proofHistory.submittedLate")}
            </span>
          ) : null}
        </div>
      </div>

      <p className="mt-2 text-xs text-[var(--color-soft-ink)]">
        {t("app.activeMission.proofHistory.submittedAt")}{" "}
        <time dateTime={attempt.submittedAt}>{displayTime(attempt.submittedAt, locale)}</time>
      </p>

      <ul className="mt-4 space-y-2">
        <li>
          <a href={attempt.primaryUrl} target="_blank" rel="noreferrer" className="font-bold underline">
            {t("app.activeMission.proofHistory.primaryUrl")}
          </a>
        </li>
        {attempt.additionalUrls.map((url, index) => (
          <li key={url}>
            <a href={url} target="_blank" rel="noreferrer" className="font-bold underline">
              {t("app.activeMission.proofHistory.additionalUrl", { number: index + 1 })}
            </a>
          </li>
        ))}
      </ul>

      <div className="mt-4"><Metadata attempt={attempt} t={t} /></div>

      {attempt.evidence.length > 0 ? (
        <div className="mt-4">
          <h4 className="font-heading text-sm font-bold">{t("app.activeMission.proofHistory.privateEvidence")}</h4>
          <ul className="mt-2 space-y-1 text-sm">
            {attempt.evidence.map((asset) => (
              <li key={asset.id}>
                <a href={asset.signedUrl} target="_blank" rel="noreferrer" className="font-semibold underline">{asset.originalFilename}</a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {attempt.corrections.length > 0 ? (
        <div className="mt-4 rounded-xl bg-[var(--color-paper)] p-4">
          <h4 className="font-heading text-sm font-bold">{t("app.activeMission.proofHistory.requiredCorrections")}</h4>
          {attempt.review?.creatorResponseDeadline ? (
            <dl className="mt-2 text-sm">
              <dt className="font-bold">{t("app.activeMission.proofHistory.responseDeadline")}</dt>
              <dd><time dateTime={attempt.review.creatorResponseDeadline}>{displayTime(attempt.review.creatorResponseDeadline, locale)}</time></dd>
            </dl>
          ) : null}
          <ol className="mt-3 space-y-3">
            {attempt.corrections.map((correction) => (
              <li key={correction.id}>
                <span className="rounded-full border border-[var(--color-ink)] bg-white px-2 py-0.5 text-xs font-bold">
                  {t(CATEGORY_KEYS[correction.category] ?? CATEGORY_KEYS.other)}
                </span>
                <p className="mt-1 text-sm">{correction.text}</p>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </article>
  );
}

export function ProofAttemptHistory({
  publication,
  variant = "standard",
  autoFocusVerifiedHeading = true,
}: Props) {
  const headingId = useId();
  const attempts = [...publication.attempts].sort((left, right) => right.attemptNumber - left.attemptNumber);
  const verifiedHeadingRef = useRef<HTMLHeadingElement>(null);
  const { lang, localeReady, t } = useI18n();
  const locale = lang === "zh" ? "zh-HK" : "en-US";

  useEffect(() => {
    if (autoFocusVerifiedHeading && localeReady && publication.state === "proof_verified") {
      verifiedHeadingRef.current?.focus();
    }
  }, [autoFocusVerifiedHeading, localeReady, publication.state, publication.acceptedAttempt?.id]);

  return (
    <section aria-labelledby={headingId} className="space-y-4">
      {publication.state === "proof_verified" ? (
        <div className="rounded-[var(--radius)] border-2 border-emerald-800 bg-emerald-50 p-5">
          <h2 ref={verifiedHeadingRef} id={headingId} tabIndex={-1} className="font-heading text-xl font-bold text-emerald-950">
            {t("app.activeMission.proofHistory.verifiedTitle")}
          </h2>
          <p className="mt-2 text-sm text-emerald-950">{t(VERIFIED_BODY_KEYS[variant])}</p>
        </div>
      ) : (
        <h2 id={headingId} className="font-heading text-xl font-bold">{t("app.activeMission.proofHistory.title")}</h2>
      )}

      {attempts.length === 0 ? (
        <p className="text-sm text-[var(--color-soft-ink)]">{t("app.activeMission.proofHistory.empty")}</p>
      ) : attempts.map((attempt) => (
        <AttemptCard
          key={attempt.id}
          attempt={attempt}
          accepted={attempt.id === publication.acceptedAttempt?.id}
          locale={locale}
          t={t}
        />
      ))}
    </section>
  );
}
