import { Link } from "@tanstack/react-router";
import { useI18n } from "@/lib/i18n";
import type { AcademyDoc, GuideCategory } from "@/lib/academy";

type Props = {
  docs: AcademyDoc[];
  readIds: Set<string>;
};

const CATEGORY_ORDER: GuideCategory[] = ["start", "missions", "rewards", "account"];
const CATEGORY_LABEL_KEY: Record<GuideCategory, string> = {
  start: "app.guide.cat.start",
  missions: "app.guide.cat.missions",
  rewards: "app.guide.cat.rewards",
  account: "app.guide.cat.account",
};

export function GuideDocList({ docs, readIds }: Props) {
  const { t } = useI18n();
  const grouped = CATEGORY_ORDER.map((cat) => ({
    cat,
    docs: docs.filter((d) => d.category === cat),
  })).filter((g) => g.docs.length > 0);

  return (
    <div className="flex flex-col gap-4">
      {grouped.map(({ cat, docs: catDocs }) => (
        <section key={cat}>
          <h4 className="mb-1.5 font-mono text-[11px] uppercase tracking-widest text-[var(--color-soft-ink)]">
            {t(CATEGORY_LABEL_KEY[cat])}
          </h4>
          <ul className="flex flex-col gap-1">
            {catDocs.map((doc) => (
              <li key={doc.slug}>
                <Link
                  to="/guide/doc/$slug"
                  params={{ slug: doc.slug }}
                  className="flex items-center gap-2 rounded-lg border border-[var(--color-ink)] bg-white px-3 py-2 no-underline hover:opacity-90 transition-opacity"
                >
                  <span aria-hidden>{doc.emoji}</span>
                  <span className="flex-1 font-heading text-sm">{doc.title}</span>
                  {readIds.has(doc.slug) && (
                    <span className="text-xs text-[var(--color-soft-ink)]" aria-label={t("app.guide.read")}>✓</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
