import { Link } from "@tanstack/react-router";
import { Camera, Film, Mail, Sparkles } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { legacyContact } from "@/data/legacyAdfocateContent";

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
            <a href="https://www.instagram.com/" aria-label="Instagram" className="text-[var(--color-paper)]/70 hover:text-[var(--color-acid)]"><Camera className="h-5 w-5" /></a>
            <a href="https://www.youtube.com/" aria-label="YouTube" className="text-[var(--color-paper)]/70 hover:text-[var(--color-acid)]"><Film className="h-5 w-5" /></a>
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
