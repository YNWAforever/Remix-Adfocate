import { useI18n } from "@/lib/i18n";
import { guideDocs, type GuideCategory } from "@/data/guideDocs";
import { getRead } from "@/lib/guideProgress";

type Props = {
  creatorId?: string | null;
};

const CATEGORY_ORDER: GuideCategory[] = ["start", "missions", "rewards", "account"];

const CATEGORY_LABEL_KEY: Record<GuideCategory, string> = {
  start: "app.guide.cat.start",
  missions: "app.guide.cat.missions",
  rewards: "app.guide.cat.rewards",
  account: "app.guide.cat.account",
};

export function GuideDocList({ creatorId }: Props) {
  const { t } = useI18n();
  const read = getRead(creatorId);

  const grouped = CATEGORY_ORDER.map((cat) => ({
    cat,
    docs: guideDocs.filter((d) => d.category === cat),
  })).filter((g) => g.docs.length > 0);

  return (
    <div className="flex flex-col gap-4">
      {grouped.map(({ cat, docs }) => (
        <section key={cat}>
          <h4 className="mb-1.5 font-mono text-[11px] uppercase tracking-widest text-[var(--color-soft-ink)]">
            {t(CATEGORY_LABEL_KEY[cat]) !== CATEGORY_LABEL_KEY[cat]
              ? t(CATEGORY_LABEL_KEY[cat])
              : cat}
          </h4>
          <ul className="flex flex-col gap-1">
            {docs.map((doc) => {
              const isRead = read.has(doc.id);
              return (
                <li key={doc.id}>
                  <a
                    href={`/guide/doc/${doc.id}`}
                    className="flex items-center gap-2 rounded-lg border border-[var(--color-ink)] bg-white px-3 py-2 no-underline hover:opacity-90 transition-opacity"
                  >
                    <span aria-hidden>{doc.emoji}</span>
                    <span className="flex-1 font-heading text-sm">{t(doc.titleKey)}</span>
                    {isRead && (
                      <span className="text-xs text-[var(--color-soft-ink)]" aria-label={t("app.guide.read")}>
                        ✓
                      </span>
                    )}
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
