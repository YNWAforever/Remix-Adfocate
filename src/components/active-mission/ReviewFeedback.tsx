import { useId } from "react";
import { useI18n } from "@/lib/i18n";

export type RequiredChangeView = {
  id: string;
  requirementId: string | null;
  text: string;
  createdAt: string;
};

export type MissionRequirementView = {
  id: string;
  label: string;
  required: boolean;
};

function stringField(record: Record<string, unknown>, fields: string[]): string | null {
  for (const field of fields) {
    const value = record[field];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export function normalizeRequirements(
  requirements: Array<Record<string, unknown>>,
  fallbackLabel: (index: number) => string = (index) => `Requirement ${index + 1}`,
): MissionRequirementView[] {
  return requirements.map((requirement, index) => ({
    id: stringField(requirement, ["id", "key", "requirementId"]) ?? `requirement-${index + 1}`,
    label: stringField(requirement, ["label", "text", "title", "requirement"]) ?? fallbackLabel(index),
    required: typeof requirement.required === "boolean" ? requirement.required : true,
  }));
}

type ReviewFeedbackProps = {
  requirements: Array<Record<string, unknown>>;
  changes: readonly RequiredChangeView[];
};

export function ReviewFeedback({ requirements, changes }: ReviewFeedbackProps) {
  const headingId = useId();
  const { t } = useI18n();
  if (changes.length === 0) return null;
  const normalized = normalizeRequirements(requirements, (index) => t("app.activeMission.feedback.requirement", { number: index + 1 }));
  const knownRequirementIds = new Set(normalized.map(({ id }) => id));
  const generalChanges = changes.filter(({ requirementId }) => !requirementId || !knownRequirementIds.has(requirementId));

  return (
    <section aria-labelledby={headingId} className="s-card peach s-stack">
      <h3 id={headingId}>{t("app.activeMission.feedback.title")}</h3>
      <ul className="s-version-list">
        {normalized.map((requirement) => {
          const matchingChanges = changes.filter(({ requirementId }) => requirementId === requirement.id);
          return (
            <li key={requirement.id} className="s-version-entry">
              <p className="s-version-entry-title">{requirement.label}</p>
              {matchingChanges.length > 0 ? (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                  {matchingChanges.map((change) => <li key={change.id} className="break-words">{change.text}</li>)}
                </ul>
              ) : <p className="mt-1 text-sm text-[var(--color-soft-ink)]">{t("app.activeMission.feedback.noneForRequirement")}</p>}
            </li>
          );
        })}
        {generalChanges.length > 0 ? (
          <li className="rounded-xl border border-[var(--color-ink)] bg-white p-3">
            <p className="font-semibold">{t("app.activeMission.feedback.general")}</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
              {generalChanges.map((change) => <li key={change.id} className="break-words">{change.text}</li>)}
            </ul>
          </li>
        ) : null}
      </ul>
    </section>
  );
}
