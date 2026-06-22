import { useCallback, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { useI18n } from "@/lib/i18n";
import type { AdminStaff } from "./AdminAuthContext";

type Phase = "loading" | "signed_out" | "not_staff" | "authed";

export function StaffAuthGate({ children }: { children: (staff: AdminStaff) => ReactNode }) {
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>("loading");
  const [staff, setStaff] = useState<AdminStaff | null>(null);

  const check = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) { setPhase("signed_out"); return; }
    const res = await fetch("/api/admin/me", { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 200) {
      const body = (await res.json()) as { staff: AdminStaff };
      setStaff(body.staff);
      setPhase("authed");
    } else if (res.status === 403) {
      setPhase("not_staff");
    } else {
      setPhase("signed_out");
    }
  }, []);

  useEffect(() => {
    void check();
    const { data } = supabase.auth.onAuthStateChange(() => void check());
    return () => data.subscription.unsubscribe();
  }, [check]);

  const signIn = () =>
    supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback?next=/admin` },
    });

  if (phase === "authed" && staff) return <>{children(staff)}</>;

  if (phase === "not_staff") {
    return (
      <div className="mx-auto max-w-sm space-y-3 p-6 text-center">
        <h1 className="font-display text-xl font-bold">{t("app.admin.title")}</h1>
        <p className="text-sm text-[var(--color-magenta)]">{t("app.admin.notStaff")}</p>
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
