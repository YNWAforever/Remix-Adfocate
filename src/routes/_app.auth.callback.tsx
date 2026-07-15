import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AuthFeedback } from "@/components/AuthFeedback";
import { supabase } from "@/lib/supabase";
import { finishAuth } from "@/lib/auth-flow";
import { useI18n } from "@/lib/i18n";
import { getDeviceCategory, trackActivationEvent } from "@/lib/activationAnalytics";
import { classifyAuthError, type AuthFeedbackState } from "@/lib/authFeedback";

export const Route = createFileRoute("/_app/auth/callback")({ component: Callback });

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

function authMethod(provider: unknown): "email_magic_link" | "whatsapp" | "google" | "unknown" {
  if (provider === "email") return "email_magic_link";
  if (provider === "phone") return "whatsapp";
  if (provider === "google") return "google";
  return "unknown";
}

function Callback() {
  const { t, lang, localeReady } = useI18n();
  const tx = (en: string, zh: string) => (lang === "en" ? en : zh);
  const navigate = useNavigate();
  const [feedback, setFeedback] = useState<AuthFeedbackState | null>(null);
  const langRef = useRef(lang);
  const startedRef = useRef(false);
  const exchangedMethodRef = useRef<ReturnType<typeof authMethod> | null>(null);

  useEffect(() => {
    langRef.current = lang;
  }, [lang]);

  const runCallback = useCallback(async () => {
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
      let method = exchangedMethodRef.current;
      if (method === null) {
        // PKCE landing for Google / magic-link: exchange the `?code=` for a session.
        const { data, error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          setFeedback(feedbackForError(error));
          return;
        }
        const next = params.get("next");
        // Only an exact /admin or /admin/* path skips creator bootstrap (the staff Google
        // sign-in flow). A strict match avoids /adminfoo and keeps a genuine creator flow
        // from accidentally skipping bootstrap on a crafted next param.
        if (next && /^\/admin(\/|$)/.test(next)) {
          // Staff Google login: do not run creator bootstrap (which would create a creator row).
          navigate({ to: next });
          return;
        }
        method = authMethod(data.session?.user.app_metadata.provider);
        exchangedMethodRef.current = method;
      }
      const result = await finishAuth(navigate);
      if (result.created) {
        trackActivationEvent("signup_completed", {
          locale: langRef.current,
          deviceCategory: getDeviceCategory(),
          method,
        });
      }
    } catch (error) {
      setFeedback(feedbackForError(error));
    }
  }, [navigate]);

  useEffect(() => {
    if (!localeReady || startedRef.current) return;
    startedRef.current = true;
    void runCallback();
  }, [localeReady, runCallback]);

  if (feedback) {
    return (
      <main className="relative flex min-h-screen items-center justify-center px-6">
        <div className="dot-pattern absolute inset-0 opacity-30" aria-hidden="true" />
        <div className="pastel-card relative z-10 w-full max-w-sm space-y-5 p-8 text-center">
          <span className="sticker">ADFOCATE</span>
          <h1 className="font-display text-lg font-bold text-[var(--color-ink)]">
            {t("app.auth.callbackError")}
          </h1>
          <AuthFeedback feedback={feedback} onRetry={() => void runCallback()} />
        </div>
      </main>
    );
  }
  return (
    <main className="relative flex min-h-screen items-center justify-center px-6">
      <div className="dot-pattern absolute inset-0 opacity-30" aria-hidden="true" />
      <div className="pastel-card relative z-10 w-full max-w-sm space-y-5 p-8 text-center">
        <span className="sticker">ADFOCATE</span>
        <div
          className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-[var(--color-ink)] border-t-transparent motion-reduce:animate-none"
          aria-hidden="true"
        />
        <p role="status" aria-live="polite" className="font-display text-lg font-bold text-[var(--color-ink)]">
          {t("common.signingIn")}
        </p>
        <p className="tag-mono text-[var(--color-soft-ink)]">
          {tx("Securing your session", "正在建立連線")}
        </p>
      </div>
    </main>
  );
}
