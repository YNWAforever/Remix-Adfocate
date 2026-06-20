import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ShoppingBag,
  Package,
  Sparkles,
  ArrowRight,
  Coins,
  Percent,
  Gift,
  Monitor,
  Camera,
  Megaphone,
  Rocket,
  TrendingUp,
} from "lucide-react";
import { legacyAffiliateSteps, localized } from "@/data/legacyAdfocateContent";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_site/earn")({
  component: EarnPage,
});

const subSections = [
  {
    to: "/login" as const,
    icon: ShoppingBag,
    label: "Adfoplace",
    title: "The creator opportunity marketplace",
    desc: "Affiliate, coupon, product drops, UGC, live commerce — discover open offers from real brands and apply in one click.",
    accent: "bg-brand-pink/10 text-brand-pink border-brand-pink/30",
  },
  {
    to: "/packages" as const,
    icon: Package,
    label: "Packages",
    title: "Set your rate. Sell your work.",
    desc: "Publish ready-to-buy packages — sponsored posts, reels, livestreams, UGC bundles — with transparent pricing.",
    accent: "bg-brand-mint/10 text-brand-mint border-brand-mint/30",
  },
  {
    to: "/stories" as const,
    icon: Sparkles,
    label: "Stories",
    title: "How creators are earning today",
    desc: "Real numbers, real campaigns, real creators across beauty, food, fashion, tech, and lifestyle.",
    accent: "bg-brand-lilac/10 text-brand-lilac border-brand-lilac/30",
  },
] as const;

const monetization = [
  { icon: Coins, label: "Campaign Fees" },
  { icon: Percent, label: "Affiliate Commissions" },
  { icon: Gift, label: "Coupon Rewards" },
  { icon: Monitor, label: "Live Commerce" },
  { icon: Camera, label: "UGC Licensing" },
  { icon: Megaphone, label: "Ambassador Retainers" },
  { icon: Rocket, label: "Product Drops" },
  { icon: TrendingUp, label: "Capital Readiness" },
];

function EarnPage() {
  const { lang } = useI18n();

  return (
    <div className="relative">
      {/* Pillar hero */}
      <section className="relative overflow-hidden pt-12 pb-16 sm:pt-20 sm:pb-24">
        <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
          <div
            className="absolute -top-20 -left-20 w-[420px] h-[420px] rounded-full"
            style={{
              background: "radial-gradient(circle, rgba(255,143,163,0.18) 0%, transparent 70%)",
            }}
          />
          <div
            className="absolute top-1/3 -right-32 w-[480px] h-[480px] rounded-full"
            style={{
              background: "radial-gradient(circle, rgba(169,156,245,0.16) 0%, transparent 70%)",
            }}
          />
        </div>
        <div className="relative mx-auto max-w-5xl px-4 sm:px-6 text-center">
          <span className="inline-block font-mono text-[11px] tracking-[0.25em] uppercase text-brand-pink border-2 border-brand-pink/30 rounded-full px-4 py-1.5 mb-6 bg-white/80">
            Pillar 02 · Monetization
          </span>
          <h1 className="font-display text-foreground mb-6">
            Turn your influence
            <br />
            into income.
          </h1>
          <p className="text-lg sm:text-xl text-soft-ink max-w-2xl mx-auto leading-relaxed">
            Eight income streams in one place. Pick the ones that fit your audience, set your rate,
            and let the platform match you with brands.
          </p>
          <div className="flex flex-wrap gap-3 justify-center mt-8">
            <Link
              to="/login"
              className="pill-btn inline-flex items-center gap-2 px-6 py-3 rounded-full bg-primary text-primary-foreground font-semibold text-sm"
            >
              Browse Adfoplace <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              to="/packages"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-full border-2 border-muted bg-white text-foreground font-semibold text-sm"
            >
              Build a Package
            </Link>
          </div>
        </div>
      </section>

      {/* Sub-sections */}
      <section className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 pb-20">
        <div className="grid md:grid-cols-3 gap-5">
          {subSections.map(({ to, icon: Icon, label, title, desc, accent }) => (
            <Link
              key={to}
              to={to}
              className="pastel-card group flex flex-col gap-4 p-7 hover:border-brand-pink/40"
            >
              <span
                className={`inline-flex items-center gap-2 self-start px-3 py-1 rounded-full border text-[11px] font-mono tracking-[0.15em] uppercase ${accent}`}
              >
                <Icon className="h-3.5 w-3.5" /> {label}
              </span>
              <h3 className="font-display text-2xl text-foreground leading-snug">{title}</h3>
              <p className="text-sm text-soft-ink leading-relaxed flex-1">{desc}</p>
              <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-pink group-hover:gap-2.5 transition-all">
                Open <ArrowRight className="h-4 w-4" />
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* Affiliate pathway */}
      <section className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 pb-20">
        <div className="rounded-3xl bg-white border-2 border-gray-200 p-6 sm:p-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between mb-6">
            <div>
              <span className="font-mono text-[11px] tracking-[0.25em] uppercase text-soft-ink">
                {localized({ en: "Affiliate programme model", zh: "Affiliate 計劃流程" }, lang)}
              </span>
              <h2 className="font-display text-foreground mt-2 text-3xl sm:text-4xl">
                {localized(
                  {
                    en: "Make content shoppable, trackable, and repeatable.",
                    zh: "讓內容可購物、可追蹤、可重複優化。",
                  },
                  lang,
                )}
              </h2>
            </div>
            <Link
              to="/login"
              className="inline-flex items-center gap-2 text-sm font-semibold text-brand-pink"
            >
              {localized({ en: "Browse offers", zh: "瀏覽 Offer" }, lang)}{" "}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            {legacyAffiliateSteps.map((step) => (
              <article key={step.id} className="rounded-2xl bg-cream/60 border border-gray-200 p-4">
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-brand-pink mb-2">
                  {localized(step.step, lang)}
                </p>
                <h3 className="font-heading font-bold text-sm text-foreground">
                  {localized(step.title, lang)}
                </h3>
                <p className="mt-2 text-xs text-soft-ink leading-relaxed">
                  {localized(step.description, lang)}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Monetization stack */}
      <section className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 pb-24">
        <div className="text-center mb-10">
          <span className="font-mono text-[11px] tracking-[0.25em] uppercase text-soft-ink">
            Monetization stack
          </span>
          <h2 className="font-display text-foreground mt-3">Eight ways to earn.</h2>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {monetization.map(({ icon: Icon, label }) => (
            <div key={label} className="pastel-card flex flex-col items-start gap-3 p-5">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-muted">
                <Icon className="h-5 w-5 text-brand-pink" />
              </span>
              <span className="font-display text-base text-foreground leading-tight">{label}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
