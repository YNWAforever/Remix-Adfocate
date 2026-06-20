import { Link } from "@tanstack/react-router";
import { Mail, Sparkles } from "lucide-react";
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

const COLS: { headKey: string; links: { to: string; key: string }[] }[] = [
  {
    headKey: "footer.platform",
    links: [
      { to: "/creators", key: "nav.creators" },
      { to: "/brands", key: "nav.brands" },
      { to: "/packages", key: "nav.packages" },
    ],
  },
  {
    headKey: "footer.growth",
    links: [
      { to: "/earn", key: "nav.earn" },
      { to: "/stories", key: "nav.stories" },
      { to: "/playbooks", key: "nav.playbooks" },
    ],
  },
  {
    headKey: "footer.company",
    links: [
      { to: "/contact", key: "nav.contact" },
      { to: "/legal/terms", key: "footer.terms" },
      { to: "/legal/privacy", key: "footer.privacy" },
    ],
  },
];

export function Footer() {
  const { t } = useI18n();
  return (
    <footer className="mt-24 bg-[var(--color-foreground)] text-[var(--color-paper)]">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-16 sm:grid-cols-2 lg:grid-cols-4 lg:px-8">
        <div className="sm:col-span-2 lg:col-span-1">
          <Link to="/" className="mb-4 flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--color-acid)] text-[var(--color-ink)]">
              <Sparkles className="h-5 w-5" />
            </span>
            <span className="font-display text-xl text-[var(--color-paper)]">Adfocate</span>
          </Link>
          <p className="text-sm text-[var(--color-paper)]/70">{t("footer.tagline")}</p>
          <div className="mt-4 flex gap-3">
            <a href="https://www.instagram.com/" aria-label="Instagram" className="text-[var(--color-paper)]/70 hover:text-[var(--color-acid)]"><InstagramIcon className="h-5 w-5" /></a>
            <a href="https://www.youtube.com/" aria-label="YouTube" className="text-[var(--color-paper)]/70 hover:text-[var(--color-acid)]"><YoutubeIcon className="h-5 w-5" /></a>
            <a href={`mailto:${legacyContact.email}`} aria-label="Email" className="text-[var(--color-paper)]/70 hover:text-[var(--color-acid)]"><Mail className="h-5 w-5" /></a>
          </div>
        </div>
        {COLS.map((col) => (
          <div key={col.headKey}>
            <h4 className="mb-4 font-mono text-xs uppercase tracking-wider text-[var(--color-acid)]">{t(col.headKey)}</h4>
            <ul className="space-y-2.5 text-sm">
              {col.links.map((l) => (
                <li key={l.to}>
                  <Link to={l.to} className="text-[var(--color-paper)]/70 hover:text-[var(--color-acid)]">{t(l.key)}</Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-[var(--color-paper)]/15 px-4 py-6 text-center text-xs text-[var(--color-paper)]/50 lg:px-8">
        © {"2026"} Adfocate · {t("footer.disclaimer")}
      </div>
    </footer>
  );
}
