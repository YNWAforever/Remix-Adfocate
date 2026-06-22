import { Link } from "@tanstack/react-router";
import { Mail, ArrowUpRight } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { legacyContact } from "@/data/legacyAdfocateContent";

function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
    </svg>
  );
}
function YoutubeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z" />
      <polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02" />
    </svg>
  );
}
function TikTokIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M16.5 5.82A4.78 4.78 0 0 1 15.3 3h-2.9v11.4a2.45 2.45 0 1 1-2.45-2.45c.17 0 .33.02.49.05V9.05a5.34 5.34 0 0 0-.49-.02 5.36 5.36 0 1 0 5.36 5.36V8.74a7.62 7.62 0 0 0 4.44 1.42V7.27a4.79 4.79 0 0 1-3.25-1.45z" />
    </svg>
  );
}
function FacebookIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M22 12a10 10 0 1 0-11.56 9.88v-6.99H7.9V12h2.54V9.8c0-2.5 1.49-3.89 3.78-3.89 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56V12h2.78l-.44 2.89h-2.34v6.99A10 10 0 0 0 22 12z" />
    </svg>
  );
}

// Four-column reorg. Every existing link `to` is preserved; column headers reuse
// existing dict keys where they fit and add inline-bilingual headers where the
// comp asks for a new grouping (Creators).
type Col = {
  /** dict key for the heading, OR null when using an inline-bilingual header */
  headKey: string | null;
  /** inline-bilingual header (used only when headKey is null) */
  headTx?: { en: string; zh: string };
  links: { to: string; key: string }[];
};

const COLS: Col[] = [
  {
    // Product / Platform
    headKey: "footer.platform",
    links: [
      { to: "/brands", key: "nav.brands" },
      { to: "/packages", key: "nav.packages" },
      { to: "/stories", key: "nav.stories" },
    ],
  },
  {
    // Creators (new grouping from the comp)
    headKey: null,
    headTx: { en: "Creators", zh: "創作者" },
    links: [
      { to: "/creators", key: "nav.creators" },
      { to: "/earn", key: "nav.earn" },
    ],
  },
  {
    // Growth / resources
    headKey: "footer.growth",
    links: [{ to: "/playbooks", key: "nav.playbooks" }],
  },
  {
    // Company
    headKey: "footer.company",
    links: [
      { to: "/contact", key: "nav.contact" },
      { to: "/legal/terms", key: "footer.terms" },
      { to: "/legal/privacy", key: "footer.privacy" },
    ],
  },
];

export function Footer() {
  const { t, lang, setLang } = useI18n();
  const tx = (en: string, zh: string) => (lang === "en" ? en : zh);

  return (
    <footer className="mt-24 bg-[var(--color-ink)] text-[var(--color-paper)]">
      {/* Top band: wordmark + tagline + lang toggle */}
      <div className="mx-auto max-w-7xl px-4 pt-16 lg:px-8">
        <div className="flex flex-col gap-10 border-b border-[var(--color-paper)]/15 pb-12 md:flex-row md:items-end md:justify-between">
          <div className="max-w-md">
            <Link to="/" className="inline-flex items-baseline" aria-label="Adfocate home">
              <span className="font-display text-4xl tracking-tight text-[var(--color-paper)] sm:text-5xl">
                Adfocate
              </span>
              <span className="font-display text-4xl text-[var(--color-acid)] sm:text-5xl">.</span>
            </Link>
            <p className="mt-4 text-sm leading-relaxed text-[var(--color-paper)]/70">
              {t("footer.tagline")}
            </p>
            <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-acid)]">
              {tx("Powered by KOCmax · Hong Kong", "由 KOCmax 提供 · 香港")}
            </p>
          </div>

          {/* Language toggle — wired to setLang, preserves existing i18n */}
          <div
            className="inline-flex shrink-0 items-center gap-1 self-start rounded-full border-2 border-[var(--color-paper)]/25 p-1 md:self-auto"
            role="group"
            aria-label={tx("Language", "語言")}
          >
            <button
              type="button"
              onClick={() => setLang("en")}
              aria-pressed={lang === "en"}
              className={
                "rounded-full px-4 py-1.5 font-mono text-xs uppercase tracking-wider transition " +
                (lang === "en"
                  ? "bg-[var(--color-acid)] text-[var(--color-ink)]"
                  : "text-[var(--color-paper)]/70 hover:text-[var(--color-paper)]")
              }
            >
              EN
            </button>
            <button
              type="button"
              onClick={() => setLang("zh")}
              aria-pressed={lang === "zh"}
              className={
                "rounded-full px-4 py-1.5 font-mono text-xs uppercase tracking-wider transition " +
                (lang === "zh"
                  ? "bg-[var(--color-acid)] text-[var(--color-ink)]"
                  : "text-[var(--color-paper)]/70 hover:text-[var(--color-paper)]")
              }
            >
              繁體
            </button>
          </div>
        </div>
      </div>

      {/* Four link columns */}
      <div className="mx-auto max-w-7xl px-4 py-14 lg:px-8">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          {COLS.map((col, i) => (
            <div key={col.headKey ?? `col-${i}`}>
              <h2 className="mb-4 font-mono text-xs uppercase tracking-wider text-[var(--color-acid)]">
                {col.headKey ? t(col.headKey) : tx(col.headTx!.en, col.headTx!.zh)}
              </h2>
              <ul className="space-y-2.5 text-sm">
                {col.links.map((l) => (
                  <li key={l.to}>
                    <Link
                      to={l.to}
                      className="group inline-flex items-center gap-1 text-[var(--color-paper)]/70 transition hover:text-[var(--color-acid)]"
                    >
                      {t(l.key)}
                      <ArrowUpRight className="h-3.5 w-3.5 opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100" aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {/* Disclaimer band */}
      <div className="mx-auto max-w-7xl px-4 lg:px-8">
        <p className="border-t border-[var(--color-paper)]/15 py-6 text-xs leading-relaxed text-[var(--color-paper)]/45">
          {t("footer.disclaimer")}
        </p>
      </div>

      {/* Bottom bar: copyright + social */}
      <div className="border-t border-[var(--color-paper)]/15">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-4 py-6 sm:flex-row lg:px-8">
          <p className="font-mono text-[11px] uppercase tracking-wider text-[var(--color-paper)]/50">
            {tx("© 2026 Adfocate · KOCmax · All rights reserved", "© 2026 Adfocate · KOCmax · 版權所有")}
          </p>
          <div className="flex items-center gap-3">
            <a href="https://www.instagram.com/" aria-label="Instagram" className="text-[var(--color-paper)]/70 transition hover:text-[var(--color-acid)]">
              <InstagramIcon className="h-5 w-5" />
            </a>
            <a href="https://www.youtube.com/" aria-label="YouTube" className="text-[var(--color-paper)]/70 transition hover:text-[var(--color-acid)]">
              <YoutubeIcon className="h-5 w-5" />
            </a>
            <a href="https://www.tiktok.com/" aria-label="TikTok" className="text-[var(--color-paper)]/70 transition hover:text-[var(--color-acid)]">
              <TikTokIcon className="h-5 w-5" />
            </a>
            <a href="https://www.facebook.com/" aria-label="Facebook" className="text-[var(--color-paper)]/70 transition hover:text-[var(--color-acid)]">
              <FacebookIcon className="h-5 w-5" />
            </a>
            <a href={`mailto:${legacyContact.email}`} aria-label={tx("Email us", "電郵聯絡")} className="text-[var(--color-paper)]/70 transition hover:text-[var(--color-acid)]">
              <Mail className="h-5 w-5" />
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
