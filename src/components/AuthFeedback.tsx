import { Link } from "@tanstack/react-router";

import { useI18n } from "@/lib/i18n";
import type { AuthFeedbackState } from "@/lib/authFeedback";

type AuthFeedbackProps = {
  feedback: AuthFeedbackState;
  onRetry?: () => void;
  loginTo?: "/login";
  requestNewLinkTo?: "/login";
};

const actionClassName =
  "inline-flex min-h-11 items-center justify-center rounded-full border-2 border-[var(--color-ink)] px-5 py-2 font-heading text-sm font-bold focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--color-cyan)]/45";

export function AuthFeedback({
  feedback,
  onRetry,
  loginTo = "/login",
  requestNewLinkTo = "/login",
}: AuthFeedbackProps) {
  const { t } = useI18n();
  const titleId = `auth-feedback-${feedback.category}-title`;
  const bodyId = `auth-feedback-${feedback.category}-body`;

  return (
    <section
      role="alert"
      aria-live="assertive"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      className="space-y-3 rounded-xl border-2 border-[var(--color-magenta)] bg-[var(--color-card)] p-4 text-left"
    >
      <h2 id={titleId} className="font-display text-lg font-bold text-[var(--color-ink)]">
        {t(feedback.titleKey)}
      </h2>
      <p id={bodyId} className="text-sm leading-relaxed text-[var(--color-soft-ink)]">
        {t(feedback.bodyKey)}
      </p>
      {feedback.action === "retry" && (
        <button
          type="button"
          onClick={onRetry}
          disabled={!onRetry}
          className={`${actionClassName} bg-[var(--color-ink)] text-white disabled:opacity-50`}
        >
          {t(feedback.actionKey)}
        </button>
      )}
      {feedback.action === "request_new_link" && (
        <Link
          to={requestNewLinkTo}
          className={`${actionClassName} bg-[var(--color-magenta)] text-white`}
        >
          {t(feedback.actionKey)}
        </Link>
      )}
      {feedback.action === "back_to_login" && (
        <Link
          to={loginTo}
          className={`${actionClassName} bg-[var(--color-ink)] text-white`}
        >
          {t(feedback.actionKey)}
        </Link>
      )}
    </section>
  );
}
