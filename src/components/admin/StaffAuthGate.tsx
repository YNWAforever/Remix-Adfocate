import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { useI18n } from "@/lib/i18n";
import type { AdminStaff } from "./AdminAuthContext";

type Phase = "loading" | "signed_out" | "not_staff" | "unavailable" | "authed";

export function StaffAuthGate({ children, refreshKey = 0, onIdentityChange }: { children: (staff: AdminStaff) => ReactNode; refreshKey?: number; onIdentityChange?: () => void }) {
  const { t, lang } = useI18n();
  const [phase, setPhase] = useState<Phase>("loading");
  const [staff, setStaff] = useState<AdminStaff | null>(null);
  const sequence = useRef(0);

  const check = useCallback(async () => {
    const request = ++sequence.current;
    setPhase("loading");
    setStaff(null);
    try {
    const { data, error } = await supabase.auth.getSession();
    if (request !== sequence.current) return;
    if (error) { setPhase("unavailable"); return; }
    const token = data.session?.access_token;
    if (!token) { setPhase("signed_out"); return; }
    const res = await fetch("/api/admin/me", { headers: { Authorization: `Bearer ${token}` } });
    if (request !== sequence.current) return;
    if (res.status === 200) {
      const body = (await res.json()) as { staff: AdminStaff };
      if (request !== sequence.current) return;
      setStaff(body.staff);
      setPhase("authed");
    } else if (res.status === 403) {
      setPhase("not_staff");
    } else if (res.status === 401) {
      setPhase("signed_out");
    } else {
      setPhase("unavailable");
    }
    } catch { if (request === sequence.current) setPhase("unavailable"); }
  }, []);

  useEffect(() => {
    const requests = sequence;
    void check();
    const { data } = supabase.auth.onAuthStateChange(() => { onIdentityChange?.(); void check(); });
    return () => { requests.current++; data.subscription.unsubscribe(); };
  }, [check, refreshKey, onIdentityChange]);

  const signIn = () =>
    supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback?next=/admin` },
    });

  if (phase === "authed" && staff) return <>{children(staff)}</>;

  if (phase === "unavailable") return (
    <div role="alert" className="mx-auto max-w-sm space-y-3 p-6 text-center">
      <p>{lang === "zh" ? "暫時無法核實營運服務，請重試。" : "Staff service is temporarily unavailable. Please retry."}</p>
      <button type="button" onClick={() => void check()}>{lang === "zh" ? "重試" : "Retry"}</button>
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
          onClick={() => supabase.auth.signOut()}
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

  return <div className="p-8 text-sm text-[var(--color-soft-ink)]">{t("common.signingIn")}</div>;
}
