import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/lib/supabase";
import { authRedirectUrl, finishAuth } from "@/lib/auth-flow";
import { WHATSAPP_LOGIN, GOOGLE_LOGIN } from "@/lib/features";
import { useI18n } from "@/lib/i18n";
import { trackActivationEvent } from "@/lib/activationAnalytics";
import { classifyAuthError, type AuthFeedbackState } from "@/lib/authFeedback";
import { AuthFeedback } from "@/components/AuthFeedback";
import { BoldValue } from "@/components/RichText";

export const Route = createFileRoute("/_app/login")({ component: Login,
  validateSearch: (search: Record<string, unknown>): { next?: string; ref?: string } => ({ next: typeof search.next === "string" ? search.next : undefined, ref: typeof search.ref === "string" ? search.ref : undefined }),
});

/** Fast local guard only; Supabase enforces its own minimum server-side. */
const MIN_PASSWORD_LENGTH = 8;

/** Normalise a HK number to E.164. Accepts "9123 4567", "+85291234567", etc. */
function toHkE164(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  return `+852${digits}`;
}

function feedbackForError(error: unknown): AuthFeedbackState {
  if (error && typeof error === "object") {
    const authError = error as {
      code?: unknown;
      message?: unknown;
      status?: unknown;
    };
    return classifyAuthError({
      code: typeof authError.code === "string" ? authError.code : null,
      message: typeof authError.message === "string" ? authError.message : null,
      status: typeof authError.status === "number" ? authError.status : null,
    });
  }
  return classifyAuthError({
    message: error instanceof Error ? error.message : null,
  });
}

/** Branded full-bleed shell: dot canvas + centered pastel card. */
function AuthShell({ children }: { children: React.ReactNode }) {
  const { lang, setLang } = useI18n();
  const tx = (en: string, zh: string) => (lang === "en" ? en : zh);
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[var(--color-paper)] px-4 py-10">
      <div
        aria-hidden
        className="dot-pattern pointer-events-none absolute inset-0 z-0 opacity-30"
      />
      <div className="relative z-10 w-full max-w-md">
        <div className="mb-4 flex items-center justify-between">
          <span className="font-display text-xl font-bold tracking-tight text-[var(--color-ink)]">
            Adfocate<span className="text-[var(--color-magenta)]">.</span>
          </span>
          <button
            type="button"
            onClick={() => setLang(lang === "en" ? "zh" : "en")}
            className="tag-mono"
            aria-label={tx("Switch language", "切換語言")}
          >
            EN · 繁
          </button>
        </div>
        <div className="pastel-card p-6 sm:p-8">{children}</div>
      </div>
    </div>
  );
}

function Login() {
  const { t, lang } = useI18n();
  const tx = (en: string, zh: string) => (lang === "en" ? en : zh);
  const navigate = useNavigate();

  const [showSecondary, setShowSecondary] = useState(false);

  // WhatsApp-OTP state (only exercised when WHATSAPP_LOGIN is enabled).
  const [stage, setStage] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<AuthFeedbackState | null>(null);

  async function sendOtp(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFeedback(null);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        phone: toHkE164(phone),
        options: { channel: "whatsapp" },
      });
      if (error) {
        setFeedback(feedbackForError(error));
        return;
      }
      setStage("code");
    } catch (error) {
      setFeedback(feedbackForError(error));
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFeedback(null);
    try {
      const { error } = await supabase.auth.verifyOtp({
        phone: toHkE164(phone),
        token: code.trim(),
        type: "sms",
      });
      if (error) {
        setFeedback(feedbackForError(error));
        return;
      }
      await finishAuth(navigate);
    } catch (error) {
      setFeedback(feedbackForError(error));
    } finally {
      setBusy(false);
    }
  }

  // Until WhatsApp OTP is live, email + password is the primary method, with the
  // magic link kept as a peer for creators who never set one.
  if (!WHATSAPP_LOGIN) {
    return (
      <AuthShell>
        <span className="sticker">{tx("CREATOR ACCESS", "創作者登入")}</span>
        <h1 className="mt-4 font-display text-3xl font-bold text-[var(--color-ink)]">
          {t("app.login.title")}
        </h1>
        <PasswordAuth />
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <span className="sticker">{tx("CREATOR ACCESS", "創作者登入")}</span>
      <h1 className="mt-4 font-display text-3xl font-bold text-[var(--color-ink)]">
        {t("app.login.title")}
      </h1>
      {stage === "phone" ? (
        <form onSubmit={sendOtp} className="mt-4 space-y-3" aria-busy={busy}>
          <label htmlFor="login-phone" className="block font-heading text-sm font-bold text-[var(--color-ink)]">
            {t("app.login.phoneLabel")}
          </label>
          <p id="login-phone-help" className="text-sm text-[var(--color-soft-ink)]">
            {t("app.login.phoneHelp")}
          </p>
          {feedback && (
            <div id="login-phone-error">
              <AuthFeedback feedback={feedback} onRetry={() => setFeedback(null)} />
            </div>
          )}
          <div className="flex items-center gap-2">
            <span className="rounded-xl border-2 border-[var(--color-ink)] bg-white px-3 py-3 font-mono text-sm">+852</span>
            <input
              id="login-phone"
              disabled={busy}
              type="tel"
              required
              autoComplete="tel"
              inputMode="numeric"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="9123 4567"
              className="w-full rounded-xl border-2 border-[var(--color-ink)] bg-white p-3 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--color-cyan)]/45"
              aria-describedby="login-phone-help"
              aria-errormessage={feedback ? "login-phone-error" : undefined}
              aria-invalid={Boolean(feedback)}
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            className="btn-primary w-full focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--color-cyan)]/45 disabled:opacity-50 motion-reduce:transition-none"
          >
            {busy ? t("app.login.sending") : t("app.login.sendOtpCta")}
          </button>
          {busy && <p role="status" aria-live="polite" className="sr-only">{t("app.login.sendingStatus")}</p>}
          <p className="pt-1 text-center font-mono text-xs uppercase tracking-wide text-[var(--color-soft-ink)]">
            {tx("WhatsApp · No password · Hong Kong", "WhatsApp · 免密碼 · 香港")}
          </p>
        </form>
      ) : (
        <form onSubmit={verify} className="mt-4 space-y-3" aria-busy={busy}>
          <p className="text-sm text-[var(--color-soft-ink)]">
            <BoldValue template={t("app.login.otpSentTo")} value={toHkE164(phone)} />
          </p>
          <label htmlFor="login-code" className="block font-heading text-sm font-bold text-[var(--color-ink)]">
            {t("app.login.codeLabel")}
          </label>
          <p id="login-code-help" className="text-sm text-[var(--color-soft-ink)]">{t("app.login.codeHelp")}</p>
          {feedback && (
            <div id="login-code-error">
              <AuthFeedback feedback={feedback} onRetry={() => setFeedback(null)} />
            </div>
          )}
          <input
            id="login-code"
            disabled={busy}
            type="text"
            required
            autoComplete="one-time-code"
            inputMode="numeric"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={t("app.login.codePlaceholder")}
            className="w-full rounded-xl border-2 border-[var(--color-ink)] bg-white p-3 text-center font-mono text-2xl tracking-[0.4em] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--color-cyan)]/45"
            aria-describedby="login-code-help"
            aria-errormessage={feedback ? "login-code-error" : undefined}
            aria-invalid={Boolean(feedback)}
          />
          <button
            type="submit"
            disabled={busy}
            className="btn-primary w-full focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--color-cyan)]/45 disabled:opacity-50 motion-reduce:transition-none"
          >
            {busy ? t("common.signingIn") : t("app.login.verifyCta")}
          </button>
          {busy && <p role="status" aria-live="polite" className="sr-only">{t("common.signingIn")}</p>}
          <button
            type="button"
            onClick={() => { setStage("phone"); setCode(""); setFeedback(null); }}
            disabled={busy}
            className="w-full rounded-full border-2 border-[var(--color-ink)] bg-white py-2 text-center text-sm font-bold text-[var(--color-ink)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--color-cyan)]/45"
          >
            {t("app.login.changePhone")}
          </button>
        </form>
      )}

      <div className="pt-4">
        <button
          type="button"
          onClick={() => setShowSecondary((s) => !s)}
          className="w-full text-center text-sm text-[var(--color-soft-ink)] underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--color-cyan)]/45"
        >
          {t("app.login.otherMethods")}
        </button>
        {showSecondary && (
          <>
            <PasswordAuth />
          </>
        )}
      </div>
    </AuthShell>
  );
}

type PasswordMode = "signIn" | "signUp" | "forgot" | "magicLink";

/**
 * Email + password, plus the reset request. Sign-up signs the creator straight in
 * because Supabase runs with email confirmations disabled; the session-less branch
 * only matters if a project turns confirmations back on.
 */
function PasswordAuth() {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const [mode, setMode] = useState<PasswordMode>("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<AuthFeedbackState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Each mode owns its result: a stale error or "link sent" must never follow the
  // creator into the next form.
  function switchMode(next: PasswordMode) {
    setMode(next);
    setFeedback(null);
    setNotice(null);
    setRevealed(false);
  }

  function fail(error: unknown) {
    const nextFeedback = feedbackForError(error);
    setFeedback(nextFeedback);
    trackActivationEvent("auth_link_failed", {
      locale: lang,
      method: mode === "magicLink" ? "email_magic_link" : "email_password",
      errorCategory: nextFeedback.category,
    });
  }

  function begin() {
    setBusy(true);
    setFeedback(null);
    setNotice(null);
    trackActivationEvent("auth_link_requested", {
      locale: lang,
      method: mode === "magicLink" ? "email_magic_link" : "email_password",
    });
  }

  async function signIn() {
    begin();
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) {
        fail(error);
        return;
      }
      await finishAuth(navigate);
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  }

  async function signUp() {
    if (password.length < MIN_PASSWORD_LENGTH) {
      setNotice(null);
      setFeedback(classifyAuthError({ code: "weak_password" }));
      return;
    }
    begin();
    try {
      const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
      if (error) {
        fail(error);
        return;
      }
      if (!data.session) {
        // Reachable only where email confirmations are enabled for the project.
        setNotice(t("app.login.magicLinkSent"));
        return;
      }
      await finishAuth(navigate);
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  }

  async function requestReset() {
    begin();
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: authRedirectUrl("/auth/reset-password"),
      });
      if (error) {
        fail(error);
        return;
      }
      setNotice(t("app.login.forgotSent"));
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  }

  async function requestLink() {
    if (busy) return;
    setBusy(true);
    setFeedback(null);
    setNotice(null);
    trackActivationEvent("auth_link_requested", {
      locale: lang,
      method: "email_magic_link",
    });
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: authRedirectUrl("/auth/callback") },
      });
      if (error) {
        const nextFeedback = feedbackForError(error);
        setFeedback(nextFeedback);
        trackActivationEvent("auth_link_failed", {
          locale: lang,
          method: "email_magic_link",
          errorCategory: nextFeedback.category,
        });
        return;
      }
      setNotice(t("app.login.magicLinkSent"));
    } catch (error) {
      const nextFeedback = feedbackForError(error);
      setFeedback(nextFeedback);
      trackActivationEvent("auth_link_failed", {
        locale: lang,
        method: "email_magic_link",
        errorCategory: nextFeedback.category,
      });
    } finally {
      setBusy(false);
    }
  }


  async function google() {
    if (busy) return;
    setBusy(true);
    setFeedback(null);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: authRedirectUrl("/auth/callback") },
      });
      if (error) setFeedback(feedbackForError(error));
    } catch (error) {
      setFeedback(feedbackForError(error));
    } finally { setBusy(false); }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (mode === "magicLink") { void requestLink(); return; }
    if (mode === "forgot") {
      void requestReset();
      return;
    }
    if (mode === "signUp") {
      void signUp();
      return;
    }
    void signIn();
  }

  const heading =
    mode === "magicLink" ? t("app.login.magicLinkHeading") : mode === "forgot"
      ? t("app.login.forgotTitle")
      : mode === "signUp"
        ? t("app.login.signUpHeading")
        : t("app.login.passwordHeading");
  const cta =
    mode === "magicLink" ? t(notice ? "app.login.resendLink" : "app.login.emailCta") : mode === "forgot"
      ? t("app.login.forgotCta")
      : mode === "signUp"
        ? t("app.login.signUpCta")
        : t("app.login.passwordCta");
  const busyLabel =
    mode === "forgot" || mode === "magicLink"
      ? t("app.login.sending")
      : mode === "signUp"
        ? t("app.login.signingUp")
        : t("common.signingIn");
  // Point aria-invalid at the field the error is actually about; a rate limit or an
  // unknown failure blames neither.
  const emailInvalid =
    feedback?.category === "invalid_credentials" || feedback?.category === "email_taken";
  const passwordInvalid =
    feedback?.category === "invalid_credentials" || feedback?.category === "weak_password";

  return (
    <section
      aria-labelledby="login-password-heading"
      className="mt-5 space-y-3 rounded-xl border-2 border-[var(--color-ink)] bg-white p-4"
    >
      <h2
        id="login-password-heading"
        className="font-heading text-base font-bold text-[var(--color-ink)]"
      >
        {heading}
      </h2>
      {feedback && (
        <div id="login-password-error">
          <AuthFeedback feedback={feedback} onRetry={() => mode === "magicLink" ? void requestLink() : setFeedback(null)} />
        </div>
      )}
      {notice && (
        <p role="status" aria-live="polite" className="text-sm text-[var(--color-soft-ink)]">
          <BoldValue template={notice} value={email.trim()} />
        </p>
      )}
      <form onSubmit={submit} className="space-y-2" aria-busy={busy}>
        <label
          htmlFor="login-password-email"
          className="block font-heading text-sm font-bold text-[var(--color-ink)]"
        >
          {t("app.login.emailLabel")}
        </label>
        {(mode === "forgot" || mode === "magicLink") && (
          <p id="login-forgot-help" className="text-sm text-[var(--color-soft-ink)]">
            {t(mode === "magicLink" ? "app.login.emailHelp" : "app.login.forgotHelp")}
          </p>
        )}
        <input
          id="login-password-email"
          disabled={busy}
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="w-full rounded-xl border-2 border-[var(--color-ink)] bg-white p-3 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--color-cyan)]/45"
          aria-describedby={mode === "forgot" || mode === "magicLink" ? "login-forgot-help" : undefined}
          aria-errormessage={emailInvalid ? "login-password-error" : undefined}
          aria-invalid={emailInvalid}
        />
        {(mode === "signIn" || mode === "signUp") && (
          <>
            <label
              htmlFor="login-password"
              className="block font-heading text-sm font-bold text-[var(--color-ink)]"
            >
              {t("app.login.passwordLabel")}
            </label>
            <p id="login-password-help" className="text-sm text-[var(--color-soft-ink)]">
              {t("app.login.passwordHelp")}
            </p>
            <div className="flex items-center gap-2">
              <input
                id="login-password"
                disabled={busy}
                type={revealed ? "text" : "password"}
                required
                autoComplete={mode === "signUp" ? "new-password" : "current-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border-2 border-[var(--color-ink)] bg-white p-3 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--color-cyan)]/45"
                aria-describedby="login-password-help"
                aria-errormessage={passwordInvalid ? "login-password-error" : undefined}
                aria-invalid={passwordInvalid}
              />
              <button
                type="button"
                onClick={() => setRevealed((r) => !r)}
                disabled={busy}
                aria-pressed={revealed}
                className="shrink-0 rounded-xl border-2 border-[var(--color-ink)] bg-white px-3 py-3 text-xs font-bold text-[var(--color-ink)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--color-cyan)]/45"
              >
                {revealed ? t("app.login.hidePassword") : t("app.login.showPassword")}
              </button>
            </div>
          </>
        )}
        <button
          type="submit"
          disabled={busy}
          className="btn-primary w-full focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--color-cyan)]/45 disabled:opacity-50 motion-reduce:transition-none"
        >
          {busy ? busyLabel : cta}
        </button>
        {busy && (
          <p role="status" aria-live="polite" className="sr-only">
            {busyLabel}
          </p>
        )}
      </form>
      <div className="space-y-2">
        <button type="button" disabled={busy} onClick={() => switchMode(mode === "magicLink" ? "signIn" : "magicLink")}
          className="w-full rounded-full border-2 border-[var(--color-ink)] bg-white py-2 text-sm font-bold disabled:opacity-50">
          {t(mode === "magicLink" ? "app.login.choosePassword" : "app.login.chooseMagicLink")}
        </button>
        {mode === "signIn" && (
          <button
            type="button"
            onClick={() => switchMode("forgot")}
            disabled={busy}
            className="w-full text-center text-sm text-[var(--color-soft-ink)] underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--color-cyan)]/45 disabled:opacity-50"
          >
            {t("app.login.forgotPasswordCta")}
          </button>
        )}
        <button
          type="button"
          onClick={() => switchMode(mode === "signIn" ? "signUp" : "signIn")}
          disabled={busy}
          className="w-full rounded-full border-2 border-[var(--color-ink)] bg-white py-2 text-center text-sm font-bold text-[var(--color-ink)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--color-cyan)]/45 disabled:opacity-50"
        >
          {mode === "signIn"
            ? t("app.login.switchToSignUp")
            : mode === "signUp"
              ? t("app.login.switchToSignIn")
              : t("app.login.backToSignIn")}
        </button>
      </div>
      {GOOGLE_LOGIN ? <button type="button" onClick={google} disabled={busy}
        className="w-full rounded-full border-2 border-[var(--color-ink)] bg-white py-2 font-heading font-bold disabled:opacity-50">{t("app.login.googleCta")}</button> : null}
    </section>
  );
}

/** Email magic-link (always available) + Google (only when GOOGLE_LOGIN is on). */
