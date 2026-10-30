import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { LEGAL_VERSIONS } from "@/lib/legalVersions";
import { supabase } from "@/lib/supabase";

export type ConsentStatus = {
  required: { terms: string; privacy: string };
  needsAcceptance: boolean;
  marketing: { granted: boolean; recordedAt: string | null };
};

export const consentKey = ["me", "consents"] as const;

export function useConsents(enabled = true) {
  return useQuery({ queryKey: consentKey, queryFn: () => apiFetch<ConsentStatus>("/me/consents"), enabled, staleTime: 5 * 60_000 });
}

/**
 * Blocking dialog until the creator accepts the current Terms and Privacy Policy (F-008).
 * Shown for new and existing accounts alike; a newer document version asks again. If the
 * status cannot be loaded the app stays usable and the dialog appears on the next load.
 */
export function ConsentGate({ enabled }: { enabled: boolean }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const consents = useConsents(enabled);
  const [agreed, setAgreed] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const accept = useMutation({
    mutationFn: () => apiFetch("/me/consents", {
      method: "POST",
      body: JSON.stringify({ terms_version: LEGAL_VERSIONS.terms, privacy_version: LEGAL_VERSIONS.privacy, marketing }),
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: consentKey }),
  });
  const open = enabled && consents.data?.needsAcceptance === true;
  useEffect(() => { if (open) headingRef.current?.focus(); }, [open]);
  if (!open) return null;

  async function signOut() {
    await supabase.auth.signOut();
    qc.clear();
    window.location.assign("/login");
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="consent-title" aria-describedby="consent-body"
        className="w-full max-w-md space-y-4 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-6 shadow-[4px_4px_0_0_var(--color-ink)]">
        <h2 id="consent-title" ref={headingRef} tabIndex={-1} className="font-heading text-xl font-black">{t("app.consent.title")}</h2>
        <p id="consent-body" className="text-sm text-[var(--color-soft-ink)]">{t("app.consent.body")}</p>
        <ul className="space-y-1 text-sm font-semibold underline underline-offset-4">
          <li><a href="/legal/terms" target="_blank" rel="noreferrer">{t("app.consent.termsLink")}</a></li>
          <li><a href="/legal/privacy" target="_blank" rel="noreferrer">{t("app.consent.privacyLink")}</a></li>
        </ul>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-1" />
          <span>{t("app.consent.agree")}</span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} className="mt-1" />
          <span>{t("app.consent.marketing")}</span>
        </label>
        {accept.isError && <p role="alert" className="text-sm text-[var(--color-magenta)]">{t("common.saveError")}</p>}
        <div className="flex items-center justify-between gap-3">
          <button type="button" onClick={() => void signOut()} className="text-sm font-semibold underline underline-offset-4">{t("app.profile.signOut")}</button>
          <button type="button" disabled={!agreed || accept.isPending} onClick={() => accept.mutate()}
            className="btn-primary rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-5 py-2 font-heading font-bold disabled:opacity-50">
            {accept.isPending ? t("common.processing") : t("app.consent.accept")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Grant or withdraw marketing consent at any time (profile page). */
export function MarketingConsentToggle() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const consents = useConsents();
  const toggle = useMutation({
    mutationFn: (granted: boolean) => apiFetch("/me/consents/marketing", { method: "POST", body: JSON.stringify({ granted }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: consentKey }),
  });
  if (!consents.data) return null;
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={consents.data.marketing.granted} disabled={toggle.isPending}
        onChange={(e) => toggle.mutate(e.target.checked)} />
      <span>{t("app.consent.marketingToggle")}</span>
    </label>
  );
}
