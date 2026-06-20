import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, Sparkles, ArrowRight, Package } from "lucide-react";
import { legacyActivationServices, localized } from "@/data/legacyAdfocateContent";
import { packages } from "@/data/mockData";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_site/packages")({
  component: PackagesPage,
});

const colorAccentMap: Record<
  string,
  {
    border: string;
    bg: string;
    dot: string;
    badgeBg: string;
    badgeText: string;
    badgeBorder: string;
    deliverableDot: string;
    ctaBg: string;
    ctaText: string;
    ctaHover: string;
  }
> = {
  pink: {
    border: "border-brand-pink/30 hover:border-brand-pink",
    bg: "bg-brand-pink/5",
    dot: "bg-brand-pink",
    badgeBg: "bg-brand-pink/10",
    badgeText: "text-brand-pink",
    badgeBorder: "border-brand-pink/20",
    deliverableDot: "text-brand-pink",
    ctaBg: "bg-brand-pink",
    ctaText: "text-white",
    ctaHover: "hover:bg-primary/85",
  },
  yellow: {
    border: "border-brand-yellow/30 hover:border-brand-yellow",
    bg: "bg-brand-yellow/5",
    dot: "bg-brand-yellow",
    badgeBg: "bg-brand-yellow/10",
    badgeText: "text-yellow-700",
    badgeBorder: "border-brand-yellow/20",
    deliverableDot: "text-brand-yellow",
    ctaBg: "bg-brand-yellow",
    ctaText: "text-foreground",
    ctaHover: "hover:bg-butter/85",
  },
  mint: {
    border: "border-brand-mint/30 hover:border-brand-mint",
    bg: "bg-brand-mint/5",
    dot: "bg-brand-mint",
    badgeBg: "bg-brand-mint/10",
    badgeText: "text-mint-700",
    badgeBorder: "border-brand-mint/20",
    deliverableDot: "text-brand-mint",
    ctaBg: "bg-brand-mint",
    ctaText: "text-foreground",
    ctaHover: "hover:bg-mint/85",
  },
  blue: {
    border: "border-brand-blue/30 hover:border-brand-blue",
    bg: "bg-brand-blue/5",
    dot: "bg-brand-blue",
    badgeBg: "bg-brand-blue/10",
    badgeText: "text-brand-blue",
    badgeBorder: "border-brand-blue/20",
    deliverableDot: "text-brand-blue",
    ctaBg: "bg-brand-blue",
    ctaText: "text-white",
    ctaHover: "hover:bg-brand-blue/90",
  },
  lilac: {
    border: "border-brand-lilac/30 hover:border-brand-lilac",
    bg: "bg-brand-lilac/5",
    dot: "bg-brand-lilac",
    badgeBg: "bg-brand-lilac/10",
    badgeText: "text-purple-600",
    badgeBorder: "border-brand-lilac/20",
    deliverableDot: "text-brand-lilac",
    ctaBg: "bg-brand-lilac",
    ctaText: "text-white",
    ctaHover: "hover:bg-brand-lilac/90",
  },
};

function PackagesPage() {
  return (
    <div>
      <HeroSection />
      <LegacyServiceMapSection />
      <PackagesGridSection />
      <BottomCTASection />
    </div>
  );
}

function LegacyServiceMapSection() {
  const { lang } = useI18n();

  return (
    <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-10 border-t border-gray-200">
      <div className="rounded-2xl border-2 border-foreground bg-white p-5 sm:p-7 shadow-[4px_4px_0_0_#0A0A0A]">
        <div className="grid gap-5 lg:grid-cols-[280px_1fr] items-start">
          <div>
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-brand-lilac">
              {localized({ en: "Service map", zh: "服務對照" }, lang)}
            </span>
            <h2 className="font-display text-2xl sm:text-3xl text-foreground mt-2 leading-tight">
              {localized(
                {
                  en: "Proven agency services, packaged into repeatable creator workflows.",
                  zh: "把實戰服務，整理成可重複的創作者流程。",
                },
                lang,
              )}
            </h2>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {legacyActivationServices.map((service) => (
              <Link
                key={service.id}
                to="/contact"
                className="rounded-xl border border-gray-200 bg-cream/40 p-3 hover:border-brand-lilac/40 transition-colors"
              >
                <p className="font-heading font-bold text-xs text-foreground leading-snug">
                  {localized(service.title, lang)}
                </p>
                <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.12em] text-soft-ink">
                  {service.modernHome}
                </p>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function HeroSection() {
  return (
    <section className="relative overflow-hidden pt-8 pb-12 sm:pt-20 sm:pb-24">
      <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
        <div
          className="absolute top-0 right-0 w-[500px] h-[500px] rounded-full"
          style={{
            background: "radial-gradient(circle, rgba(196,181,253,0.18) 0%, transparent 65%)",
          }}
        />
        <div
          className="absolute bottom-0 -left-32 w-[400px] h-[400px] rounded-full"
          style={{
            background: "radial-gradient(circle, rgba(186,230,253,0.12) 0%, transparent 65%)",
          }}
        />
      </div>

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl">
          <span className="inline-block font-mono text-[10px] uppercase tracking-[0.2em] text-brand-lilac border-2 border-brand-lilac/30 rounded-full px-3 py-1.5 bg-white mb-6">
            Packages
          </span>
          <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl text-foreground max-w-3xl leading-[1.05] mb-5">
            Campaign Packages<span className="text-brand-lilac">.</span>
          </h1>
          <p className="text-soft-ink text-sm sm:text-base max-w-xl mb-8 leading-relaxed">
            Productized creator campaign formats. Pick a starting package, or mix and match with the
            Adfocate team for your specific brand goals.
          </p>
          <Link
            to="/contact"
            className="inline-flex items-center gap-2 h-13 px-8 rounded-full bg-primary text-primary-foreground font-bold text-sm hover:bg-rose-hover transition-colors"
          >
            <Sparkles className="h-4 w-4" /> Plan a Campaign
          </Link>
        </div>
      </div>
    </section>
  );
}

function PackagesGridSection() {
  return (
    <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12 border-t border-gray-200">
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {packages.map((pkg, i) => {
          const clr = colorAccentMap[pkg.color] ?? colorAccentMap.pink;

          return (
            <article
              key={pkg.id}
              className={cn(
                "game-card flex flex-col gap-3.5 group",
                clr.border,
                clr.bg,
                "stagger-" + Math.min(i + 1, 8),
                "animate-slide-up",
              )}
            >
              <div className="flex items-center justify-between">
                <span
                  className={cn(
                    "text-[10px] font-mono font-bold tracking-[0.15em] uppercase px-2.5 py-1 rounded-full border",
                    clr.badgeBg,
                    clr.badgeText,
                    clr.badgeBorder,
                  )}
                >
                  Package
                </span>
                <span className={cn("h-2.5 w-2.5 rounded-full", clr.dot)} />
              </div>

              <h3 className="font-heading font-bold text-sm text-foreground leading-snug">
                {pkg.title}
              </h3>

              <div className="rounded-lg bg-white border border-gray-200 px-3 py-2">
                <span className="text-[10px] font-mono uppercase tracking-[0.1em] text-soft-ink">
                  Best For
                </span>
                <p className="text-xs text-foreground font-heading font-semibold mt-0.5">
                  {pkg.bestFor}
                </p>
              </div>

              <div>
                <span className="text-[10px] font-mono uppercase tracking-[0.1em] text-soft-ink mb-2 block">
                  Deliverables
                </span>
                <ul className="space-y-1.5">
                  {pkg.deliverables.map((d) => (
                    <li key={d} className="flex items-start gap-2 text-xs text-foreground">
                      <Check className={cn("h-3.5 w-3.5 mt-0.5 shrink-0", clr.deliverableDot)} />
                      <span>{d}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <Link
                to="/contact"
                className={cn(
                  "mt-auto inline-flex items-center justify-center gap-1.5 h-10 rounded-full text-sm font-heading font-bold transition-all duration-200 group-hover:scale-[1.02] active:scale-[0.98]",
                  clr.ctaBg,
                  clr.ctaText,
                  clr.ctaHover,
                )}
              >
                Talk to us <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function BottomCTASection() {
  return (
    <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 pb-20">
      <div className="relative rounded-3xl overflow-hidden p-8 sm:p-12 lg:p-14 bg-gradient-to-br from-charcoal via-ink to-charcoal shadow-lg">
        <div
          className="absolute top-0 right-0 w-[300px] h-[300px] rounded-full"
          style={{
            background: "radial-gradient(circle, rgba(196,181,253,0.2) 0%, transparent 60%)",
          }}
        />
        <div
          className="absolute bottom-0 left-0 w-[300px] h-[300px] rounded-full"
          style={{
            background: "radial-gradient(circle, rgba(255,181,194,0.15) 0%, transparent 60%)",
          }}
        />

        <div className="relative grid gap-6 lg:grid-cols-[1fr_auto] items-center">
          <div>
            <h2 className="font-display text-2xl sm:text-3xl text-white leading-tight">
              Need a custom campaign package?
            </h2>
            <p className="text-gray-300 mt-2">
              Tell us your goal, budget, and timeline. We will design a tailored creator package for
              your brand, category, and audience.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <Link
              to="/contact"
              className="inline-flex items-center justify-center gap-2 h-13 px-7 rounded-full bg-secondary text-secondary-foreground font-bold text-sm hover:bg-brand-lilac/90 transition-colors"
            >
              <Package className="h-4 w-4" /> Request Custom Package
            </Link>
            <Link
              to="/playbooks"
              className="inline-flex items-center justify-center h-13 px-7 rounded-full bg-white text-foreground font-bold text-sm border-2 border-white hover:bg-gray-100 transition-colors"
            >
              Browse Playbooks
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
