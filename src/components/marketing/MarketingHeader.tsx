import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Menu, X, Sparkles } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { LangToggle } from "@/components/LangToggle";
import { supabase } from "@/lib/supabase";

const NAV: { to: string; key: string }[] = [
  { to: "/creators", key: "nav.creators" },
  { to: "/brands", key: "nav.brands" },
  { to: "/packages", key: "nav.packages" },
  { to: "/stories", key: "nav.stories" },
  { to: "/playbooks", key: "nav.playbooks" },
  { to: "/contact", key: "nav.contact" },
];

export function MarketingHeader() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [authed, setAuthed] = useState(false);

  // Intentional one-shot read: no onAuthStateChange subscription because this
  // header is used on public/SSG marketing pages. The app shell re-validates
  // auth on entry, so a single check here is sufficient to show the right CTA.
  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active) setAuthed(Boolean(data.session));
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <header className="sticky top-0 z-50 border-b-2 border-[var(--color-ink)] bg-[var(--color-paper)]/90 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 lg:px-8">
        <Link to="/" className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl border-2 border-[var(--color-ink)] bg-[var(--color-acid)]">
            <Sparkles className="h-5 w-5" />
          </span>
          <span className="font-display text-lg font-bold sm:text-xl">Adfocate</span>
        </Link>

        <nav className="hidden items-center gap-0.5 lg:flex" aria-label={t("common.mainNav")}>
          {NAV.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              className="rounded-full px-3 py-2 text-sm font-semibold text-[var(--color-soft-ink)] hover:text-[var(--color-ink)]"
              activeProps={{ className: "text-[var(--color-ink)]" }}
            >
              {t(l.key)}
            </Link>
          ))}
        </nav>

        <div className="flex shrink-0 items-center gap-2.5">
          <LangToggle />
          {authed ? (
            <Link to="/home" className="btn-primary hidden sm:inline-flex">
              {t("cta.toApp")}
            </Link>
          ) : (
            <>
              <Link to="/login" className="hidden text-sm font-semibold sm:inline-flex">
                {t("cta.login")}
              </Link>
              <Link to="/login" className="btn-primary hidden sm:inline-flex">
                {t("cta.join")} <Sparkles className="h-3.5 w-3.5" />
              </Link>
            </>
          )}
          <button
            type="button"
            className="lg:hidden"
            aria-label={open ? t("common.close") : t("common.menu")}
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <X /> : <Menu />}
          </button>
        </div>
      </div>

      {open && (
        <nav className="border-t-2 border-[var(--color-ink)] bg-[var(--color-paper)] px-4 py-3 lg:hidden" aria-label={t("common.mobileNav")}>
          {NAV.map((l) => (
            <Link key={l.to} to={l.to} onClick={() => setOpen(false)} className="block py-2 font-semibold">
              {t(l.key)}
            </Link>
          ))}
          <div className="mt-2 flex gap-2">
            {authed ? (
              <Link to="/home" className="btn-primary flex-1" onClick={() => setOpen(false)}>
                {t("cta.toApp")}
              </Link>
            ) : (
              <Link to="/login" className="btn-primary flex-1" onClick={() => setOpen(false)}>
                {t("cta.join")}
              </Link>
            )}
          </div>
        </nav>
      )}
    </header>
  );
}
