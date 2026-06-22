import { CalendarClock, FileText, Mail, ShieldCheck } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { Doc } from "@/components/legal/legalContent";

/** Stable, URL-safe anchor id from a section's English heading. */
function slugify(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/^\s*\d+[.)]\s*/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function LegalDoc({ doc }: { doc: Doc }) {
  const { t, lang } = useI18n();
  const tx = (en: string, zh: string) => (lang === "en" ? en : zh);

  const sections = doc.sections.map((s, i) => ({
    ...s,
    index: i + 1,
    id: slugify(s.heading.en) || `section-${i + 1}`,
  }));

  return (
    <div className="bg-[var(--color-paper)]">
      {/* ── HEADER BAND ───────────────────────────────────── */}
      <header className="relative overflow-hidden border-b-2 border-[var(--color-ink)]">
        <div className="dot-pattern absolute inset-0 opacity-40" aria-hidden="true" />
        <div className="relative mx-auto max-w-5xl px-4 py-14 sm:px-6 md:py-20 lg:px-8">
          <nav aria-label={tx("Breadcrumb", "麵包屑導覽")} className="mb-6">
            <ol className="flex flex-wrap items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-soft-ink)]">
              <li>{t("nav.home")}</li>
              <li aria-hidden="true">/</li>
              <li>{tx("Legal", "法律")}</li>
              <li aria-hidden="true">/</li>
              <li className="text-[var(--color-ink)]">{doc.title[lang]}</li>
            </ol>
          </nav>

          <h1 className="font-display text-4xl font-bold sm:text-5xl md:text-6xl">
            {doc.title[lang]}
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-[var(--color-soft-ink)] sm:text-lg">
            {doc.intro[lang]}
          </p>

          <div className="mt-7 flex flex-wrap items-center gap-3">
            {doc.updated && (
              <span className="tag-mono">
                <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
                {tx("Updated", "更新於")} {doc.updated[lang]}
              </span>
            )}
            <span className="tag-mono">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              {tx("Powered by KOCmax · HK", "KOCmax 提供 · 香港")}
            </span>
          </div>
        </div>
      </header>

      {/* ── BODY: STICKY TOC + DOCUMENT ───────────────────── */}
      <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 md:py-16 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-12">
          {/* Numbered Table of Contents (sticky on desktop) */}
          <aside className="lg:sticky lg:top-24 lg:self-start">
            <nav
              aria-label={tx("Table of contents", "目錄")}
              className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-ink)] p-5 text-[var(--color-paper)]"
            >
              <p className="mb-4 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-acid)]">
                {tx("Contents", "目錄")}
              </p>
              <ol className="space-y-1">
                {sections.map((s) => (
                  <li key={s.id}>
                    <a
                      href={`#${s.id}`}
                      className="group flex items-start gap-3 rounded-lg px-2 py-1.5 text-sm leading-snug transition-colors hover:bg-white/10"
                    >
                      <span
                        className="font-mono text-xs font-bold tabular-nums text-[var(--color-acid)]"
                        aria-hidden="true"
                      >
                        {String(s.index).padStart(2, "0")}
                      </span>
                      <span className="text-[var(--color-paper)]/90 group-hover:text-[var(--color-paper)]">
                        {s.heading[lang].replace(/^\s*\d+[.)]\s*/, "")}
                      </span>
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          </aside>

          {/* Document: intro + one card per section */}
          <div className="space-y-6">
            <p className="text-base leading-[1.7] text-[var(--color-soft-ink)]">
              {doc.intro[lang]}
            </p>

            {sections.map((s) => (
              <section
                key={s.id}
                id={s.id}
                className="pastel-card scroll-mt-24 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-6 sm:p-7"
              >
                <div className="mb-3 flex items-baseline gap-3">
                  <span
                    className="font-mono text-2xl font-bold tabular-nums text-[var(--color-magenta)]"
                    aria-hidden="true"
                  >
                    {String(s.index).padStart(2, "0")}
                  </span>
                  <h2 className="font-heading text-lg font-bold text-[var(--color-ink)] sm:text-xl">
                    {s.heading[lang].replace(/^\s*\d+[.)]\s*/, "")}
                  </h2>
                </div>
                <p className="text-sm leading-[1.7] text-[var(--color-soft-ink)] sm:text-base">
                  {s.body[lang]}
                </p>
              </section>
            ))}

            {/* Optional highlighted callout */}
            {doc.callout && (
              <section className="pastel-card rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-acid)] p-6 sm:p-7">
                <h2 className="font-heading text-lg font-bold text-[var(--color-ink)] sm:text-xl">
                  {doc.callout.heading[lang]}
                </h2>
                <p className="mt-2 text-sm font-medium leading-[1.7] text-[var(--color-ink)] sm:text-base">
                  {doc.callout.body[lang]}
                </p>
              </section>
            )}

            {/* Dashed contact card */}
            {doc.contact && (
              <section className="flex flex-col items-start gap-4 rounded-[var(--radius)] border-2 border-dashed border-[var(--color-ink)] bg-white/60 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-7">
                <div className="flex items-start gap-3">
                  <span
                    className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)]"
                    aria-hidden="true"
                  >
                    <Mail className="h-5 w-5 text-[var(--color-ink)]" />
                  </span>
                  <div>
                    <p className="font-heading text-base font-bold text-[var(--color-ink)]">
                      {doc.contact.label[lang]}
                    </p>
                    <p className="font-mono text-xs uppercase tracking-[0.12em] text-[var(--color-soft-ink)]">
                      {tx("We usually reply within 2 business days", "一般於兩個工作天內回覆")}
                    </p>
                  </div>
                </div>
                <a href={`mailto:${doc.contact.email}`} className="btn-ink shrink-0">
                  <FileText className="h-4 w-4" aria-hidden="true" />
                  {doc.contact.email}
                </a>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
