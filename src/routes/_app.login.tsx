import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/lib/supabase";
import { finishAuth } from "@/lib/auth-flow";
import { WHATSAPP_LOGIN, GOOGLE_LOGIN } from "@/lib/features";
import { useI18n } from "@/lib/i18n";
import { BoldValue } from "@/components/RichText";

export const Route = createFileRoute("/_app/login")({ component: Login });

/** Normalise a HK number to E.164. Accepts "9123 4567", "+85291234567", etc. */
function toHkE164(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  return `+852${digits}`;
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
  const [error, setError] = useState<string | null>(null);

  async function sendOtp(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const { error } = await supabase.auth.signInWithOtp({
      phone: toHkE164(phone),
      options: { channel: "whatsapp" },
    });
    setBusy(false);
    if (error) { setError(error.message); return; }
    setStage("code");
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const { error } = await supabase.auth.verifyOtp({ phone: toHkE164(phone), token: code.trim(), type: "sms" });
    if (error) { setBusy(false); setError(error.message); return; }
    try {
      await finishAuth(navigate);
    } catch {
      setBusy(false);
      setError(t("app.login.authError"));
    }
  }

  // Until WhatsApp OTP is live, email magic-link is the primary (working) method.
  if (!WHATSAPP_LOGIN) {
    return (
      <AuthShell>
        <span className="sticker">{tx("CREATOR ACCESS", "創作者登入")}</span>
        <h1 className="mt-4 font-display text-3xl font-bold text-[var(--color-ink)]">
          {t("app.login.title")}
        </h1>
        <p className="mt-2 text-sm text-[var(--color-soft-ink)]">{t("app.login.emailHint")}</p>
        <div className="mt-5">
          <EmailAndGoogle />
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <span className="sticker">{tx("CREATOR ACCESS", "創作者登入")}</span>
      <h1 className="mt-4 font-display text-3xl font-bold text-[var(--color-ink)]">
        {t("app.login.title")}
      </h1>
      {error && <p className="mt-3 text-sm text-[var(--color-magenta)]">{error}</p>}

      {stage === "phone" ? (
        <form onSubmit={sendOtp} className="mt-4 space-y-3">
          <p className="text-sm text-[var(--color-soft-ink)]">{t("app.login.whatsappHint")}</p>
          <div className="flex items-center gap-2">
            <span className="rounded-xl border-2 border-[var(--color-ink)] bg-white px-3 py-3 font-mono text-sm">+852</span>
            <input
              type="tel"
              required
              autoComplete="tel"
              inputMode="numeric"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="9123 4567"
              className="w-full rounded-xl border-2 border-[var(--color-ink)] bg-white p-3"
              aria-label={t("app.login.phoneAriaLabel")}
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            className="btn-primary w-full disabled:opacity-50"
          >
            {busy ? t("app.login.sending") : t("app.login.sendOtpCta")}
          </button>
          <p className="pt-1 text-center font-mono text-xs uppercase tracking-wide text-[var(--color-soft-ink)]">
            {tx("WhatsApp · No password · Hong Kong", "WhatsApp · 免密碼 · 香港")}
          </p>
        </form>
      ) : (
        <form onSubmit={verify} className="mt-4 space-y-3">
          <p className="text-sm text-[var(--color-soft-ink)]">
            <BoldValue template={t("app.login.otpSentTo")} value={toHkE164(phone)} />
          </p>
          <input
            type="text"
            required
            autoComplete="one-time-code"
            inputMode="numeric"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={t("app.login.codePlaceholder")}
            className="w-full rounded-xl border-2 border-[var(--color-ink)] bg-white p-3 text-center font-mono text-2xl tracking-[0.4em]"
            aria-label={t("app.login.codeAriaLabel")}
          />
          <button
            type="submit"
            disabled={busy}
            className="btn-primary w-full disabled:opacity-50"
          >
            {busy ? t("common.signingIn") : t("app.login.verifyCta")}
          </button>
          <button
            type="button"
            onClick={() => { setStage("phone"); setCode(""); setError(null); }}
            className="w-full rounded-full border-2 border-[var(--color-ink)] bg-white py-2 text-center text-sm font-bold text-[var(--color-ink)]"
          >
            {t("app.login.changePhone")}
          </button>
        </form>
      )}

      <div className="pt-4">
        <button
          type="button"
          onClick={() => setShowSecondary((s) => !s)}
          className="w-full text-center text-sm text-[var(--color-soft-ink)] underline"
        >
          {t("app.login.otherMethods")}
        </button>
        {showSecondary && <EmailAndGoogle />}
      </div>
    </AuthShell>
  );
}

/** Email magic-link (always available) + Google (only when GOOGLE_LOGIN is on). */
function EmailAndGoogle() {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setBusy(false);
    if (error) { setError(error.message); return; }
    setSent(true);
  }

  async function google() {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  }

  return (
    <div className="mt-3 space-y-3 rounded-xl border-2 border-[var(--color-ink)] bg-white p-4">
      {error && <p className="text-sm text-[var(--color-magenta)]">{error}</p>}
      {sent ? (
        <p className="text-sm text-[var(--color-soft-ink)]">
          <BoldValue template={t("app.login.magicLinkSent")} value={email.trim()} />
        </p>
      ) : (
        <form onSubmit={sendLink} className="space-y-2">
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full rounded-xl border-2 border-[var(--color-ink)] bg-white p-3"
            aria-label={t("app.login.emailAriaLabel")}
          />
          <button
            type="submit"
            disabled={busy}
            className="btn-ink w-full disabled:opacity-50"
          >
            {busy ? t("app.login.sending") : t("app.login.emailCta")}
          </button>
        </form>
      )}
      {GOOGLE_LOGIN && (
        <button
          type="button"
          onClick={google}
          className="w-full rounded-full border-2 border-[var(--color-ink)] bg-white py-2 font-heading font-bold text-[var(--color-ink)]"
        >
          {t("app.login.googleCta")}
        </button>
      )}
    </div>
  );
}
