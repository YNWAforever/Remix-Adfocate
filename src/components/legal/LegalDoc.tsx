import { useI18n } from "@/lib/i18n";
import type { Doc } from "@/components/legal/legalContent";

export function LegalDoc({ doc }: { doc: Doc }) {
  const { lang } = useI18n();
  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 px-4 py-12">
      <h1 className="font-display text-3xl font-bold">{doc.title[lang]}</h1>
      <article className="pastel-card space-y-4 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-5 text-sm leading-[1.65] text-[var(--color-soft-ink)]">
        <p>{doc.intro[lang]}</p>
        {doc.sections.map((s) => (
          <div key={s.heading.en}>
            <h2 className="font-heading font-bold text-[var(--color-ink)]">{s.heading[lang]}</h2>
            <p>{s.body[lang]}</p>
          </div>
        ))}
      </article>
    </div>
  );
}
