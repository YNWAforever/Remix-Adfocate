import { useEffect, useState } from "react";
import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { Menu, X, Sparkles, ArrowLeft } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { LangToggle } from "@/components/LangToggle";
import { AudienceToggle, type Audience } from "@/components/marketing/AudienceToggle";
import { useHomeAudience } from "@/components/marketing/homeAudience";
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
  const { t, lang } = useI18n();
  const tx = (en: string, zh: string) => (lang === "en" ? en : zh);
  const [open, setOpen] = useState(false);
  const [authed, setAuthed] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { audience, setAudience } = useHomeAudience();
  const navigate = useNavigate();

  // The header is the single control surface across the marketing site: a
  // centered creator/brand toggle everywhere, plus an in-page section-anchor
  // row on the homepage. The old page-nav list is dropped so there's one
  // consistent nav; other pages are reached from in-page CTAs and the footer.
  const isHome = pathname === "/";

  // Toggle selects the audience; off the homepage it also returns to "/" so the
  // switch always lands on the matching home view (the provider state persists
  // across _site navigations).
  const selectAudience = (next: Audience) => {
    setAudience(next);
    if (!isHome) navigate({ to: "/" });
  };

  const sectionLinks =
    audience === "brand"
      ? [
          { id: "goals", label: tx("Goals", "目標") },
          { id: "services", label: tx("Services", "服務方案") },
          { id: "compare", label: tx("Compare", "對比") },
          { id: "dashboard", label: "Dashboard" },
          { id: "cases", label: tx("Cases", "案例") },
        ]
      : [
          { id: "value", label: tx("Core Value", "核心價值") },
          { id: "how", label: tx("How it works", "運作方式") },
          { id: "passport", label: tx("Passport", "創作者履歷") },
          { id: "levels", label: tx("Growth Ladder", "成長階梯") },
        ];

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

        <AudienceToggle
          audience={audience}
          onChange={selectAudience}
          className="hidden md:inline-flex"
        />

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

      {/* Homepage second row: section-anchor nav (+ the toggle on mobile, where
          it doesn't fit in the top row). Smooth scroll is global CSS. */}
      {isHome && (
        <div className="border-t border-[var(--color-ink)]/12 bg-[var(--color-paper)]/70">
          <div className="mx-auto flex max-w-7xl items-center gap-2 overflow-x-auto px-4 py-2 lg:px-8">
            <AudienceToggle
              audience={audience}
              onChange={selectAudience}
              className="shrink-0 md:hidden"
            />
            <span className="mx-1 h-5 w-px shrink-0 bg-[var(--color-ink)]/15 md:hidden" aria-hidden="true" />
            <nav
              className="flex items-center gap-1"
              aria-label={tx("Jump to section", "跳至區塊")}
            >
              {sectionLinks.map((l) => (
                <a
                  key={l.id}
                  href={`#${l.id}`}
                  className="whitespace-nowrap rounded-full px-3 py-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--color-soft-ink)] transition-colors hover:bg-[var(--color-ink)] hover:text-[var(--color-paper)]"
                >
                  {l.label}
                </a>
              ))}
            </nav>
          </div>
        </div>
      )}

      {open && (
        <nav className="border-t-2 border-[var(--color-ink)] bg-[var(--color-paper)] px-4 py-3 lg:hidden" aria-label={t("common.mobileNav")}>
          {!isHome && (
            <Link to="/" onClick={() => setOpen(false)} className="flex items-center gap-1.5 py-2 font-semibold">
              <ArrowLeft className="h-4 w-4" /> {tx("Home", "返回首頁")}
            </Link>
          )}
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
