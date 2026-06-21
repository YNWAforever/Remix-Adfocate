import type { Playbook, Resource } from "@/data/academy";

type Props = {
  item: Playbook | Resource;
};

function isPlaybook(item: Playbook | Resource): item is Playbook {
  return "industry" in item;
}

export function PlaybookCard({ item }: Props) {
  if (isPlaybook(item)) {
    return (
      <div className="pastel-card flex flex-col gap-2 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
        <div className="flex items-center gap-2">
          <span className="text-2xl" aria-hidden>{item.emoji}</span>
          <h3 className="font-heading font-semibold">{item.industry}</h3>
        </div>
        <p className="text-sm text-[var(--color-soft-ink)]">{item.creatorAngle}</p>
        <div className="flex flex-wrap gap-1">
          {item.levels.map((lvl) => (
            <span
              key={lvl}
              className="inline-block rounded-full border border-[var(--color-ink)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide"
            >
              {lvl}
            </span>
          ))}
        </div>
      </div>
    );
  }

  // Resource
  return (
    <div className="flex items-center gap-2 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
      <span className="text-2xl" aria-hidden>{item.emoji}</span>
      <div className="min-w-0 flex-1">
        <h3 className="font-heading font-semibold leading-snug">{item.title}</h3>
        <p className="text-xs text-[var(--color-soft-ink)]">{item.type}</p>
      </div>
    </div>
  );
}
