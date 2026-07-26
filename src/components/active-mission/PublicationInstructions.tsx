import { useId } from "react";
import type { MissionPublicationView } from "@/lib/activeMission";

type Props = {
  publication: MissionPublicationView;
};

function displayPlatform(value: string): string {
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : "Not specified";
}

function approvedVersionLabel(id: string | null): string {
  if (!id) return "Approved version";
  const match = id.match(/(\d+)$/);
  return match ? `Approved version ${match[1]}` : "Approved version";
}

function evidenceRequired(policy: Readonly<Record<string, unknown>>): boolean {
  return policy.required === true
    || policy.evidenceRequired === true
    || policy.minimumCount === 1;
}

export function PublicationInstructions({ publication }: Props) {
  const headingId = useId();
  const { instructions } = publication;
  return (
    <section aria-labelledby={headingId} className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-5 shadow-[var(--shadow-sm)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-heading text-xs font-bold uppercase tracking-[0.16em] text-[var(--color-soft-ink)]">Frozen guidance</p>
          <h2 id={headingId} className="mt-1 font-heading text-xl font-bold">Publication instructions</h2>
        </div>
        <span className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-3 py-1 text-xs font-bold">
          {approvedVersionLabel(publication.approvedVersionId)}
        </span>
      </div>

      <dl className="mt-5 grid gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-bold uppercase tracking-wide text-[var(--color-soft-ink)]">Platform</dt>
          <dd className="mt-1 font-semibold">{displayPlatform(publication.platform)}</dd>
        </div>
        <div>
          <dt className="text-xs font-bold uppercase tracking-wide text-[var(--color-soft-ink)]">Expected account</dt>
          <dd className="mt-1 font-semibold">{instructions.expectedAccount ?? "Use your approved account"}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs font-bold uppercase tracking-wide text-[var(--color-soft-ink)]">Publication deadline</dt>
          <dd className="mt-1">
            <time dateTime={instructions.publishDueAt}>{new Date(instructions.publishDueAt).toLocaleString()}</time>
          </dd>
        </div>
      </dl>

      <div className="mt-5 rounded-2xl bg-[var(--color-paper)] p-4">
        <p className="whitespace-pre-wrap text-sm leading-6">{instructions.publicationInstructions}</p>
      </div>

      {instructions.requiredDisclosures.length > 0 ? (
        <div className="mt-5">
          <h3 className="font-heading text-sm font-bold">Required disclosures</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {instructions.requiredDisclosures.map((disclosure) => <li key={disclosure}>{disclosure}</li>)}
          </ul>
        </div>
      ) : null}

      <p className="mt-5 rounded-xl border border-[var(--color-ink)] px-3 py-2 text-sm font-semibold">
        {evidenceRequired(instructions.proofEvidencePolicy) ? "Evidence is required" : "Evidence is optional"}
      </p>
    </section>
  );
}
