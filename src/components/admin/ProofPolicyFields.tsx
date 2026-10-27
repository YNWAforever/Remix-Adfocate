import { useState } from "react";
import { publicationEvidenceRequired } from "@/lib/activeMission";
import { useI18n } from "@/lib/i18n";

export function parseProofPolicy(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch { return null; }
}

type Props = {
  policy: Record<string, unknown>;
  rawValue: string;
  position: number;
  onChange: (nextPolicy: Record<string, unknown>) => void;
  onRawChange: (value: string) => void;
};

/** Adapts the existing non-empty-policy evidence gate; advanced rules stay intact. */
export function ProofPolicyFields({ policy, rawValue, position, onChange, onRawChange }: Props) {
  const { t } = useI18n();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const parsed = parseProofPolicy(rawValue);
  const current = parsed ?? policy;
  const hasAdvanced = Object.keys(current).some((key) => key !== "required" || current[key] !== true);
  return (
    <div className="space-y-2">
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" aria-label={t("app.admin.missionEditor.evidenceRequiredAria", { position })}
          checked={publicationEvidenceRequired(current)} disabled={hasAdvanced || !parsed}
          onChange={(event) => onChange(event.target.checked ? { required: true } : {})} />
        {t("app.admin.missionEditor.evidenceRequired")}
      </label>
      <p className="text-xs text-[var(--color-soft-ink)]">{t("app.admin.missionEditor.evidenceHelp")}</p>
      {hasAdvanced ? <p className="text-sm font-semibold">{t("app.admin.missionEditor.advancedPreserved")}</p> : null}
      <details open={advancedOpen || !parsed} onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}>
        <summary className="cursor-pointer py-2 text-sm font-bold">{t("app.admin.missionEditor.advancedPolicy")}</summary>
        <p className="mb-2 text-xs text-[var(--color-soft-ink)]">{t("app.admin.missionEditor.advancedHelp")}</p>
        <label className="block text-sm">{t("app.admin.missionEditor.proofEvidencePolicy")}
          <textarea aria-label={t("app.admin.missionEditor.proofEvidencePolicyAria", { position })}
            className="w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] p-2 font-mono text-sm"
            rows={4} value={rawValue} aria-invalid={!parsed} onChange={(event) => onRawChange(event.target.value)} />
        </label>
      </details>
    </div>
  );
}
