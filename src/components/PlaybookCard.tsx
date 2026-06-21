import { useI18n } from "@/lib/i18n";
import { localized } from "@/data/legacyAdfocateContent";
import type { Playbook, Resource } from "@/data/academy";

type Props = {
  item: Playbook | Resource;
};

function isPlaybook(item: Playbook | Resource): item is Playbook {
  return "industry" in item;
}

export function PlaybookCard({ item }: Props) {
  const { lang } = useI18n();

  if (isPlaybook(item)) {
    return (
      <div className="pastel-card flex flex-col gap-2 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
        <div className="flex items-center gap-2">
          <span className="text-2xl" aria-hidden>{item.emoji}</span>
          <h3 className="font-heading font-semibold">{localized(item.industry, lang)}</h3>
        </div>
        <p className="text-sm text-[var(--color-soft-ink)]">{localized(item.creatorAngle, lang)}</p>
        <div className="flex flex-wrap gap-1">
          {item.levels.map((lvl) => (
            <span
              key={lvl.en}
              className="inline-block rounded-full border border-[var(--color-ink)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide"
            >
              {localized(lvl, lang)}
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
        <h3 className="font-heading font-semibold leading-snug">{localized(item.title, lang)}</h3>
        <p className="text-xs text-[var(--color-soft-ink)]">{localized(item.type, lang)}</p>
      </div>
    </div>
  );
}
