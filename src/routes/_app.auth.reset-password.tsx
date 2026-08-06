import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AuthFeedback } from "@/components/AuthFeedback";
import { supabase } from "@/lib/supabase";
import { finishAuth } from "@/lib/auth-flow";
import { useI18n } from "@/lib/i18n";
import { classifyAuthError, type AuthFeedbackState } from "@/lib/authFeedback";

export const Route = createFileRoute("/_app/auth/reset-password")({ component: ResetPassword });

/** Mirrors the minimum the login page advertises, so both forms reject the same passwords. */
const MIN_PASSWORD_LENGTH = 8;

function feedbackForError(error: unknown): AuthFeedbackState {
  if (error && typeof error === "object") {
    const authError = error as { code?: unknown; message?: unknown; status?: unknown };
    return classifyAuthError({
      code: typeof authError.code === "string" ? authError.code : null,
      message: typeof authError.message === "string" ? authError.message : null,
      status: typeof authError.status === "number" ? authError.status : null,
    });
  }
  return classifyAuthError({ message: error instanceof Error ? error.message : null });
}

const fieldClassName =
  "w-full rounded-xl border-2 border-[var(--color-ink)] bg-white p-3 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--color-cyan)]/45";

function ResetPassword() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [stage, setStage] = useState<"verifying" | "form" | "saved">("verifying");
  const [feedback, setFeedback] = useState<AuthFeedbackState | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [reveal, setReveal] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A recovery link is single-use: a re-render must never replay the exchange,
  // because the second attempt fails and would strand a working session.
  const startedRef = useRef(false);
  const submittingRef = useRef(false);

  const verifyLink = useCallback(async () => {
    setFeedback(null);
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (!code) {
      setFeedback(classifyAuthError({
        code: params.get("error_code") ?? params.get("error") ?? "malformed_callback",
        message: params.get("error_description"),
      }));
      return;
    }

    try {
      // Recovery mails land here as PKCE: the exchange installs the short-lived
      // session that authorises the updateUser below. Nothing may sign it out
      // before the new password is saved.
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) {
        setFeedback(feedbackForError(error));
        return;
      }
      setStage("form");
    } catch (error) {
      setFeedback(feedbackForError(error));
    }
  }, []);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void verifyLink();
  }, [verifyLink]);

  const completeSignIn = useCallback(async () => {
    setFeedback(null);
    try {
      await finishAuth(navigate);
    } catch (error) {
      setFeedback(feedbackForError(error));
    }
  }, [navigate]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    // The ref (not `busy`) is the guard: a second submit can arrive before React
    // has re-rendered the disabled button, and two updateUser calls would race.
    if (submittingRef.current) return;

    const tooShort = password.length < MIN_PASSWORD_LENGTH;
    const mismatched = password !== confirm;
    setPasswordError(tooShort ? "app.resetPassword.tooShort" : null);
    setConfirmError(mismatched ? "app.resetPassword.mismatch" : null);
    if (tooShort || mismatched) return;

    submittingRef.current = true;
    setBusy(true);
    setFeedback(null);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setFeedback(feedbackForError(error));
        return;
      }
      setStage("saved");
      await completeSignIn();
    } catch (error) {
      setFeedback(feedbackForError(error));
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  }

  const retry =
    stage === "verifying"
      ? () => void verifyLink()
      : stage === "form"
        ? () => setFeedback(null)
        : () => void completeSignIn();

  return (
    <main className="relative flex min-h-screen items-center justify-center px-6">
      <div className="dot-pattern absolute inset-0 opacity-30" aria-hidden="true" />
      <div className="pastel-card relative z-10 w-full max-w-sm space-y-5 p-8">
        <span className="sticker">ADFOCATE</span>
        <h1 className="font-display text-lg font-bold text-[var(--color-ink)]">
          {t("app.resetPassword.title")}
        </h1>

        {stage === "verifying" && !feedback && (
          <>
            <div
              className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-[var(--color-ink)] border-t-transparent motion-reduce:animate-none"
              aria-hidden="true"
            />
            <p role="status" aria-live="polite" className="text-sm text-[var(--color-soft-ink)]">
              {t("app.resetPassword.verifying")}
            </p>
          </>
        )}

        {feedback && (
          <div id="reset-password-feedback">
            <AuthFeedback feedback={feedback} onRetry={retry} />
          </div>
        )}

        {stage === "form" && (
          <form onSubmit={save} className="space-y-3 text-left" aria-busy={busy}>
            <p id="reset-password-help" className="text-sm text-[var(--color-soft-ink)]">
              {t("app.resetPassword.help")}
            </p>

            <label
              htmlFor="reset-password-new"
              className="block font-heading text-sm font-bold text-[var(--color-ink)]"
            >
              {t("app.resetPassword.newLabel")}
            </label>
            {passwordError && (
              <p
                id="reset-password-new-error"
                role="alert"
                className="text-sm font-bold text-[var(--color-magenta)]"
              >
                {t(passwordError)}
              </p>
            )}
            <input
              id="reset-password-new"
              type={reveal ? "text" : "password"}
              required
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={fieldClassName}
              aria-describedby="reset-password-help"
              aria-errormessage={passwordError ? "reset-password-new-error" : undefined}
              aria-invalid={Boolean(passwordError)}
            />

            <label
              htmlFor="reset-password-confirm"
              className="block font-heading text-sm font-bold text-[var(--color-ink)]"
            >
              {t("app.resetPassword.confirmLabel")}
            </label>
            {confirmError && (
              <p
                id="reset-password-confirm-error"
                role="alert"
                className="text-sm font-bold text-[var(--color-magenta)]"
              >
                {t(confirmError)}
              </p>
            )}
            <input
              id="reset-password-confirm"
              type={reveal ? "text" : "password"}
              required
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className={fieldClassName}
              aria-errormessage={confirmError ? "reset-password-confirm-error" : undefined}
              aria-invalid={Boolean(confirmError)}
            />

            <button
              type="button"
              onClick={() => setReveal((v) => !v)}
              aria-pressed={reveal}
              className="rounded-full px-1 text-sm text-[var(--color-soft-ink)] underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--color-cyan)]/45"
            >
              {reveal ? t("app.login.hidePassword") : t("app.login.showPassword")}
            </button>

            <button
              type="submit"
              disabled={busy}
              className="btn-primary w-full focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--color-cyan)]/45 disabled:opacity-50 motion-reduce:transition-none"
            >
              {busy ? t("app.resetPassword.saving") : t("app.resetPassword.cta")}
            </button>
            {busy && (
              <p role="status" aria-live="polite" className="sr-only">
                {t("app.resetPassword.saving")}
              </p>
            )}
          </form>
        )}

        {stage === "saved" && !feedback && (
          <p role="status" aria-live="polite" className="text-sm text-[var(--color-soft-ink)]">
            {t("app.resetPassword.success")}
          </p>
        )}
      </div>
    </main>
  );
}
