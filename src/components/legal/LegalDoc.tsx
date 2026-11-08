import { CalendarClock, FileText, Mail, ShieldCheck } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useStudioText } from "@/components/studio/StudioPrimitives";
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
  const tx = useStudioText();
  const sections = doc.sections.map((section, i) => ({
    ...section,
    index: i + 1,
    id: slugify(section.heading.en) || `section-${i + 1}`,
  }));

  return (
    <div className="s-public-main s-stack">
      <section className="s-stack">
        <nav aria-label={tx("路徑", "Breadcrumb")}>
          <ol className="s-legal-breadcrumb">
            <li>{t("nav.home")}</li>
            <li aria-hidden="true">/</li>
            <li>{tx("法務", "Legal")}</li>
            <li aria-hidden="true">/</li>
            <li aria-current="page">{doc.title[lang]}</li>
          </ol>
        </nav>
        <span className="s-tag mint">📄 {tx("法務 · LEGAL", "Legal")}</span>
        <h1>{doc.title[lang]}</h1>
        <p>{doc.intro[lang]}</p>
        <div className="s-row">
          {doc.updated && <span className="s-tag ghost"><CalendarClock size={13} aria-hidden/> {tx("更新", "Updated")} {doc.updated[lang]}</span>}
          <span className="s-tag ghost"><ShieldCheck size={13} aria-hidden/> {tx("KOCmax · 香港", "KOCmax · HK")}</span>
        </div>
      </section>

      <div className="s-legal-grid">
        <aside className="s-card s-stack" aria-label={tx("目錄", "Table of contents")}>
          <h2>{tx("目錄", "Contents")}</h2>
          <ol className="s-legal-toc">
            {sections.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`}>{section.heading[lang].replace(/^\s*\d+[.)]\s*/, "")}</a>
              </li>
            ))}
          </ol>
        </aside>

        <div className="s-stack">
          {sections.map((section) => (
            <section key={section.id} id={section.id} className="s-card s-stack s-legal-section">
              <div className="s-between">
                <h2>{section.heading[lang].replace(/^\s*\d+[.)]\s*/, "")}</h2>
                <span className="s-tag ghost">{String(section.index).padStart(2, "0")}</span>
              </div>
              <p style={{ whiteSpace: "pre-wrap" }}>{section.body[lang]}</p>
            </section>
          ))}

          {doc.callout && (
            <section className="s-card lilac s-stack">
              <h2>{doc.callout.heading[lang]}</h2>
              <p style={{ whiteSpace: "pre-wrap" }}>{doc.callout.body[lang]}</p>
            </section>
          )}

          {doc.contact && (
            <section className="s-card s-between">
              <div className="s-row">
                <span aria-hidden className="s-task-icon"><Mail size={18}/></span>
                <div className="s-stack" style={{ gap: 2 }}>
                  <h2>{doc.contact.label[lang]}</h2>
                  <small>{tx("一般於 2 個工作天內回覆", "We usually reply within 2 business days")}</small>
                </div>
              </div>
              <a className="s-btn s-primary" href={`mailto:${doc.contact.email}`}>
                <FileText size={15} aria-hidden/> {doc.contact.email}
              </a>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
