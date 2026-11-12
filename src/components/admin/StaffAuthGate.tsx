import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { useI18n } from "@/lib/i18n";
import type { AdminStaff } from "./AdminAuthContext";
import { StaffMfaChallenge } from "./StaffMfaChallenge";

type Phase = "loading" | "signing_out" | "sign_out_error" | "signed_out" | "not_staff" | "unavailable" | "authed" | "mfa";
const SIGN_OUT_PENDING_KEY = "kocmax:staff-sign-out-pending";

function hasPendingSignOut() {
  try { return typeof window !== "undefined" && window.sessionStorage.getItem(SIGN_OUT_PENDING_KEY) === "1"; }
  catch { return false; }
}

function markPendingSignOut(pending: boolean) {
  try {
    if (pending) window.sessionStorage.setItem(SIGN_OUT_PENDING_KEY, "1");
    else window.sessionStorage.removeItem(SIGN_OUT_PENDING_KEY);
  } catch { /* The in-memory latch still protects this mounted view. */ }
}

export function StaffAuthGate({ children, refreshKey = 0, onIdentityChange }: { children: (staff: AdminStaff, signOut: () => Promise<void>) => ReactNode; refreshKey?: number; onIdentityChange?: () => void }) {
  const { t, lang } = useI18n();
  const [phase, setPhase] = useState<Phase>(() => hasPendingSignOut() ? "sign_out_error" : "loading");
  const [staff, setStaff] = useState<AdminStaff | null>(null);
  const sequence = useRef(0);
  const sessionOwner = useRef<string | null>(null);
  const signingOut = useRef(false);
  const blockedAfterSignOut = useRef(hasPendingSignOut());

  const check = useCallback(async (preserveView = false) => {
    if (signingOut.current || blockedAfterSignOut.current) return;
    const request = ++sequence.current;
    if (!preserveView) {
      setPhase("loading");
      setStaff(null);
    }
    try {
    const { data, error } = await supabase.auth.getSession();
    if (request !== sequence.current) return;
    if (error) { setPhase("unavailable"); return; }
    sessionOwner.current = data.session?.user?.id ?? null;
    const token = data.session?.access_token;
    if (!token) { setStaff(null); setPhase("signed_out"); return; }
    const res = await fetch("/api/admin/me", { headers: { Authorization: `Bearer ${token}` } });
    if (request !== sequence.current) return;
    if (res.status === 200) {
      const body = (await res.json()) as { staff: AdminStaff; mfa_required?: boolean };
      if (request !== sequence.current) return;
      setStaff(body.staff);
      setPhase(body.mfa_required ? "mfa" : "authed");
    } else if (res.status === 403) {
      const body = (await res.clone().json().catch(() => null)) as { code?: string } | null;
      setStaff(null);
      setPhase(body?.code === "mfa_required" ? "mfa" : "not_staff");
    } else if (res.status === 401) {
      setStaff(null);
      setPhase("signed_out");
    } else {
      setPhase("unavailable");
    }
    } catch { if (request === sequence.current) setPhase("unavailable"); }
  }, []);

  const reconcileSignOut = useCallback(async () => {
    const request = ++sequence.current;
    try {
      const { data, error } = await supabase.auth.getSession();
      if (request !== sequence.current) return;
      if (error || data.session) {
        setPhase("sign_out_error");
      } else {
        sessionOwner.current = null;
        blockedAfterSignOut.current = false;
        markPendingSignOut(false);
        setPhase("signed_out");
      }
    } catch {
      if (request === sequence.current) setPhase("sign_out_error");
    } finally {
      if (request === sequence.current) signingOut.current = false;
    }
  }, []);

  const signOut = useCallback(async () => {
    if (signingOut.current) return;
    signingOut.current = true;
    blockedAfterSignOut.current = true;
    markPendingSignOut(true);
    sequence.current++;
    setStaff(null);
    setPhase("signing_out");
    onIdentityChange?.();

    try {
      await supabase.auth.signOut();
    } catch {
      // The session read below decides whether sign-out actually took effect.
    }
    await reconcileSignOut();
  }, [onIdentityChange, reconcileSignOut]);

  useEffect(() => {
    const requests = sequence;
    if (blockedAfterSignOut.current) {
      onIdentityChange?.();
      void reconcileSignOut();
    } else {
      void check();
    }
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (signingOut.current || blockedAfterSignOut.current) {
        if (_event === "SIGNED_OUT" && !signingOut.current) void reconcileSignOut();
        return;
      }
      const owner = session?.user?.id ?? null;
      const sameOwner = owner !== null && owner === sessionOwner.current;
      sessionOwner.current = owner;
      if (!sameOwner) onIdentityChange?.();
      // Same-user events also fire on token refresh and tab focus. Revalidate
      // access without unmounting the editor or clearing its cached reads.
      void check(sameOwner);
    });
    return () => { requests.current++; data.subscription.unsubscribe(); };
  }, [check, refreshKey, onIdentityChange, reconcileSignOut]);

  const signIn = () =>
    supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback?next=/admin` },
    });

  const unavailable = (
    <div role="alert" className="mx-auto max-w-sm space-y-3 p-6 text-center">
      <p>{lang === "zh" ? "暫時無法核實營運服務，請重試。" : "Staff service is temporarily unavailable. Please retry."}</p>
      <button type="button" onClick={() => void check(Boolean(staff))}>{lang === "zh" ? "重試" : "Retry"}</button>
    </div>
  );

  // A same-user revalidation outage hides the view without discarding drafts.
  // Definitive denials and identity changes clear staff and unmount the view.
  if (staff && (phase === "authed" || phase === "unavailable")) return <>
    <div hidden={phase !== "authed"}>{children(staff, signOut)}</div>
    {phase === "unavailable" && unavailable}
  </>;
  if (phase === "unavailable") return unavailable;

  if (phase === "mfa") {
    return <StaffMfaChallenge onVerified={() => void check()} signOut={signOut} />;
  }

  if (phase === "sign_out_error") return (
    <div role="alert" className="mx-auto max-w-sm space-y-3 p-6 text-center">
      <p>{lang === "zh" ? "暫時無法登出，請重試。" : "Unable to sign out. Please retry."}</p>
      <button type="button" onClick={() => void signOut()}>{lang === "zh" ? "重試" : "Retry"}</button>
    </div>
  );

  if (phase === "not_staff") {
    return (
      <div className="mx-auto max-w-sm space-y-3 p-6 text-center">
        <h1 className="font-display text-xl font-bold">{t("app.admin.title")}</h1>
        <p role="alert" className="text-sm text-[var(--color-magenta)]">{t("app.admin.notStaff")}</p>
        <button type="button" onClick={() => void check()}>{lang === "zh" ? "重新核實權限" : "Check access again"}</button>
        <button
          type="button"
          onClick={() => void signOut()}
          className="rounded-full border-2 border-[var(--color-ink)] px-6 py-2 font-heading font-bold"
        >
          {t("app.admin.signOut")}
        </button>
      </div>
    );
  }

  if (phase === "signed_out") {
    return (
      <div className="mx-auto max-w-sm space-y-3 p-6 text-center">
        <h1 className="font-display text-xl font-bold">{t("app.admin.title")}</h1>
        <p className="text-sm text-[var(--color-soft-ink)]">{t("app.admin.authPromptAdmin")}</p>
        <button
          type="button"
          onClick={signIn}
          className="block w-full rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] py-2 font-heading font-bold"
        >
          {t("app.admin.signInGoogle")}
        </button>
      </div>
    );
  }

  if (phase === "signing_out") return <div role="status" className="p-8 text-sm text-[var(--color-soft-ink)]">{lang === "zh" ? "正在登出…" : "Signing out…"}</div>;

  return <div className="p-8 text-sm text-[var(--color-soft-ink)]">{t("common.signingIn")}</div>;
}
