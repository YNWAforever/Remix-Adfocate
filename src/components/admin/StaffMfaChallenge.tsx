import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useI18n } from "@/lib/i18n";

type Enrollment = { qr: string; secret: string };

/**
 * Staff MFA gate: enrols TOTP on first use, then challenges it. The server only
 * treats the session as authorized after Supabase upgrades it to AAL2.
 */
export function StaffMfaChallenge({ onVerified, signOut }: { onVerified: () => void; signOut: () => Promise<void> }) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      const listed = await supabase.auth.mfa.listFactors();
      if (!active) return;
      if (listed.error) {
        setError(t("app.admin.mfaUnavailable"));
        setLoading(false);
        return;
      }
      const factors = (listed.data?.totp ?? []) as Array<{ id: string; status: string }>;
      const verified = factors.find((factor) => factor.status === "verified");
      for (const factor of factors) {
        if (factor.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: factor.id });
      }
      if (verified) {
        setFactorId(verified.id);
        setLoading(false);
        return;
      }
      const enrolled = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "KOCmax staff" });
      if (!active) return;
      if (enrolled.error) {
        setError(t("app.admin.mfaUnavailable"));
        setLoading(false);
        return;
      }
      setFactorId(enrolled.data.id);
      setEnrollment({ qr: enrolled.data.totp.qr_code, secret: enrolled.data.totp.secret });
      setLoading(false);
    })();
    return () => { active = false; };
  }, [t]);

  async function verify() {
    if (!factorId || busy) return;
    if (!/^\d{6}$/.test(code)) {
      setError(t("app.admin.mfaCodeInvalid"));
      return;
    }
    setBusy(true);
    setError("");
    const challenge = await supabase.auth.mfa.challenge({ factorId });
    if (challenge.error) {
      setBusy(false);
      setError(t("app.admin.mfaUnavailable"));
      return;
    }
    const verified = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.data.id,
      code,
    });
    if (verified.error) {
      setBusy(false);
      setError(t("app.admin.mfaCodeInvalid"));
      return;
    }
    await supabase.auth.refreshSession();
    setBusy(false);
    onVerified();
  }

  return (
    <div className="mx-auto max-w-sm space-y-3 p-6">
      <h1 className="text-center font-display text-xl font-bold">{t("app.admin.mfaTitle")}</h1>
      {loading ? (
        <p role="status" className="text-sm text-[var(--color-soft-ink)]">{t("common.loading")}</p>
      ) : (
        <>
          <p className="text-sm text-[var(--color-soft-ink)]">
            {enrollment ? t("app.admin.mfaEnrollHint") : t("app.admin.mfaChallengeHint")}
          </p>
          {enrollment && (
            <div className="space-y-2 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3 text-center">
              <img src={enrollment.qr} alt={t("app.admin.mfaQrAlt")} className="mx-auto h-40 w-40" />
              <p className="break-all text-xs text-[var(--color-soft-ink)]">
                {t("app.admin.mfaSecretLabel")}: <code>{enrollment.secret}</code>
              </p>
            </div>
          )}
          <label className="block text-sm font-bold" htmlFor="staff-mfa-code">{t("app.admin.mfaCodeLabel")}</label>
          <input
            id="staff-mfa-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            onKeyDown={(event) => { if (event.key === "Enter") void verify(); }}
            className="h-10 w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] px-2 text-sm"
          />
          {error && <p role="alert" className="text-sm text-[var(--color-magenta)]">{error}</p>}
          <button
            type="button"
            disabled={busy || loading}
            onClick={() => void verify()}
            className="block w-full rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] py-2 font-heading font-bold"
          >
            {busy ? t("common.processing") : t("app.admin.mfaVerify")}
          </button>
        </>
      )}
      <button type="button" onClick={() => void signOut()} className="block w-full rounded-full border-2 border-[var(--color-ink)] py-2 font-heading font-bold">
        {t("app.admin.signOut")}
      </button>
    </div>
  );
}
