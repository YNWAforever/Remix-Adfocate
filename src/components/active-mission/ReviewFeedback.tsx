import { useId } from "react";

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

export function normalizeRequirements(requirements: Array<Record<string, unknown>>): MissionRequirementView[] {
  return requirements.map((requirement, index) => ({
    id: stringField(requirement, ["id", "key", "requirementId"]) ?? `requirement-${index + 1}`,
    label: stringField(requirement, ["label", "text", "title", "requirement"]) ?? `Requirement ${index + 1}`,
    required: typeof requirement.required === "boolean" ? requirement.required : true,
  }));
}

type ReviewFeedbackProps = {
  requirements: Array<Record<string, unknown>>;
  changes: readonly RequiredChangeView[];
};

export function ReviewFeedback({ requirements, changes }: ReviewFeedbackProps) {
  const headingId = useId();
  if (changes.length === 0) return null;
  const normalized = normalizeRequirements(requirements);
  const knownRequirementIds = new Set(normalized.map(({ id }) => id));
  const generalChanges = changes.filter(({ requirementId }) => !requirementId || !knownRequirementIds.has(requirementId));

  return (
    <section aria-labelledby={headingId} className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-pink)] p-4">
      <h3 id={headingId} className="font-heading text-lg font-bold">Changes requested</h3>
      <ul className="mt-3 space-y-3">
        {normalized.map((requirement) => {
          const matchingChanges = changes.filter(({ requirementId }) => requirementId === requirement.id);
          return (
            <li key={requirement.id} className="rounded-xl border border-[var(--color-ink)] bg-white p-3">
              <p className="font-semibold">{requirement.label}</p>
              {matchingChanges.length > 0 ? (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                  {matchingChanges.map((change) => <li key={change.id} className="break-words">{change.text}</li>)}
                </ul>
              ) : <p className="mt-1 text-sm text-[var(--color-soft-ink)]">No change requested for this requirement.</p>}
            </li>
          );
        })}
        {generalChanges.length > 0 ? (
          <li className="rounded-xl border border-[var(--color-ink)] bg-white p-3">
            <p className="font-semibold">General feedback</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
              {generalChanges.map((change) => <li key={change.id} className="break-words">{change.text}</li>)}
            </ul>
          </li>
        ) : null}
      </ul>
    </section>
  );
}
