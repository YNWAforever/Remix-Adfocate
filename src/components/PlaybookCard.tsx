import type { AcademyPlaybook, AcademyResource } from "@/lib/academy";

type Props = { item: AcademyPlaybook | AcademyResource };

function isPlaybook(item: AcademyPlaybook | AcademyResource): item is AcademyPlaybook {
  // creatorAngle is playbook-only meta (resources carry only { type, fileUrl }); no unsafe cast.
  return "creatorAngle" in (item.meta ?? {});
}

export function PlaybookCard({ item }: Props) {
  if (isPlaybook(item)) {
    const levels = item.meta.levels ?? [];
    return (
      <div className="pastel-card flex min-w-0 flex-col gap-2 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3 [overflow-wrap:anywhere]">
        <div className="flex items-center gap-2">
          <span className="text-2xl" aria-hidden>{item.emoji}</span>
          <h3 className="min-w-0 font-heading font-semibold">{item.title}</h3>
        </div>
        {item.meta.creatorAngle && (
          <p className="text-sm text-[var(--color-soft-ink)]">{item.meta.creatorAngle}</p>
        )}
        <div className="flex flex-wrap gap-1">
          {levels.map((lvl, i) => (
            <span key={i} className="inline-block rounded-full border border-[var(--color-ink)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide">
              {lvl}
            </span>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3 [overflow-wrap:anywhere]">
      <span className="text-2xl" aria-hidden>{item.emoji}</span>
      <div className="min-w-0 flex-1">
        <h3 className="font-heading font-semibold leading-snug">{item.title}</h3>
        <p className="text-xs text-[var(--color-soft-ink)]">{item.meta.type}</p>
      </div>
    </div>
  );
}
