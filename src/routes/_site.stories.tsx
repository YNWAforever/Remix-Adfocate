import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Sparkles, Star, Globe, Award } from "lucide-react";
import { legacyStoryCards, localized } from "@/data/legacyAdfocateContent";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_site/stories")({
  component: StoriesPage,
});

const colorAccentMap: Record<
  string,
  { dot: string; pillBg: string; pillText: string; pillBorder: string; decorColor: string }
> = {
  pink: {
    dot: "bg-brand-pink",
    pillBg: "bg-brand-pink/10",
    pillText: "text-brand-pink",
    pillBorder: "border-brand-pink/20",
    decorColor: "rgba(255,181,194,0.06)",
  },
  yellow: {
    dot: "bg-brand-yellow",
    pillBg: "bg-brand-yellow/10",
    pillText: "text-yellow-700",
    pillBorder: "border-brand-yellow/20",
    decorColor: "rgba(254,240,138,0.1)",
  },
  mint: {
    dot: "bg-brand-mint",
    pillBg: "bg-brand-mint/10",
    pillText: "text-mint-700",
    pillBorder: "border-brand-mint/20",
    decorColor: "rgba(167,243,208,0.08)",
  },
  blue: {
    dot: "bg-brand-blue",
    pillBg: "bg-brand-blue/10",
    pillText: "text-brand-blue",
    pillBorder: "border-brand-blue/20",
    decorColor: "rgba(186,230,253,0.06)",
  },
  lilac: {
    dot: "bg-brand-lilac",
    pillBg: "bg-brand-lilac/10",
    pillText: "text-purple-600",
    pillBorder: "border-brand-lilac/20",
    decorColor: "rgba(196,181,253,0.08)",
  },
};

function StoriesPage() {
  return (
    <div>
      <HeroSection />
      <StoriesGridSection />
      <BottomCTASection />
    </div>
  );
}

function HeroSection() {
  return (
    <section className="relative overflow-hidden pt-8 pb-12 sm:pt-20 sm:pb-24">
      <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
        <div
          className="absolute top-0 right-0 w-[500px] h-[500px] rounded-full"
          style={{
            background: "radial-gradient(circle, rgba(255,181,194,0.15) 0%, transparent 65%)",
          }}
        />
        <div
          className="absolute bottom-0 -left-32 w-[400px] h-[400px] rounded-full"
          style={{
            background: "radial-gradient(circle, rgba(196,181,253,0.12) 0%, transparent 65%)",
          }}
        />
        <div
          className="absolute top-1/2 left-1/3 w-[350px] h-[350px] rounded-full"
          style={{
            background: "radial-gradient(circle, rgba(254,240,138,0.1) 0%, transparent 60%)",
          }}
        />
      </div>

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl">
          <span className="inline-block font-mono text-[10px] uppercase tracking-[0.2em] text-brand-pink border-2 border-brand-pink/30 rounded-full px-3 py-1.5 bg-white mb-6">
            Stories
          </span>
          <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl text-foreground max-w-3xl leading-[1.05] mb-5">
            Success Stories<span className="text-brand-pink">.</span>
          </h1>
          <p className="text-soft-ink text-sm sm:text-base max-w-xl mb-6 leading-relaxed">
            A snapshot of brand work across beauty, travel, retail, community, and F&B — powered by
            Adfocate creator activations.
          </p>
        </div>
      </div>
    </section>
  );
}

function StoriesGridSection() {
  const { lang } = useI18n();

  return (
    <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12 border-t border-gray-200">
      <div className="space-y-8 sm:space-y-12">
        {legacyStoryCards.map((story, i) => {
          const clr = colorAccentMap[story.color] ?? colorAccentMap.pink;
          const isLeft = i % 2 === 0;

          return (
            <div
              key={story.id}
              className={cn(
                "flex flex-col gap-6 items-center",
                isLeft ? "lg:flex-row" : "lg:flex-row-reverse",
                "stagger-" + Math.min(i + 1, 8),
                "animate-slide-up",
              )}
            >
              {/* Decorative element */}
              <div className="hidden lg:flex items-center justify-center shrink-0 relative">
                <div
                  className="h-28 w-28 rounded-full flex items-center justify-center relative"
                  style={{
                    background: `radial-gradient(circle, ${clr.decorColor} 40%, transparent 80%)`,
                  }}
                >
                  <span
                    className={cn(
                      "h-16 w-16 rounded-full flex items-center justify-center",
                      clr.pillBg,
                    )}
                  >
                    <Star className={cn("h-7 w-7", clr.pillText)} />
                  </span>
                </div>
              </div>

              {/* Story card */}
              <article className="game-card border-2 border-gray-200 bg-white p-5 sm:p-7 flex-1 max-w-2xl">
                <div className="flex items-center gap-3 mb-4">
                  <span
                    className={cn(
                      "text-[10px] font-mono font-bold tracking-[0.1em] uppercase px-3 py-1 rounded-full border",
                      clr.pillBg,
                      clr.pillText,
                      clr.pillBorder,
                    )}
                  >
                    {localized(story.industry, lang)}
                  </span>
                  <span className={cn("h-2.5 w-2.5 rounded-full", clr.dot)} />
                  <span className="text-[10px] font-mono text-soft-ink">
                    {localized({ en: "Portfolio proof", zh: "過往案例" }, lang)}
                  </span>
                </div>

                <h2 className="font-display text-2xl sm:text-3xl text-foreground mb-3">
                  {story.client}
                </h2>
                <p className="text-sm text-soft-ink leading-relaxed mb-4">
                  {localized(story.activation, lang)}
                </p>

                <div className="grid gap-2 sm:grid-cols-2 text-[11px] text-soft-ink font-mono">
                  <span className="inline-flex items-center gap-1">
                    <Globe className="h-3.5 w-3.5" />
                    {story.year ? story.year : localized(story.product, lang)}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Award className="h-3.5 w-3.5" />
                    {story.service ? localized(story.service, lang) : localized(story.proof, lang)}
                  </span>
                </div>

                <a
                  href={story.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={cn(
                    "mt-4 inline-flex items-center gap-1.5 text-sm font-heading font-bold hover:gap-2 transition-all",
                    clr.pillText,
                  )}
                >
                  {localized({ en: "Reference", zh: "參考來源" }, lang)}{" "}
                  <ArrowRight className="h-4 w-4" />
                </a>
              </article>
            </div>
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
            background: "radial-gradient(circle, rgba(255,181,194,0.2) 0%, transparent 60%)",
          }}
        />
        <div
          className="absolute bottom-0 left-0 w-[300px] h-[300px] rounded-full"
          style={{
            background: "radial-gradient(circle, rgba(167,243,208,0.15) 0%, transparent 60%)",
          }}
        />

        <div className="relative grid gap-6 lg:grid-cols-[1fr_auto] items-center">
          <div>
            <h2 className="font-display text-2xl sm:text-3xl text-white leading-tight">
              Want to be our next success story?
            </h2>
            <p className="text-gray-300 mt-2">
              Join Adfocate as a creator or brand and start building verified creator activations
              that drive real results.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <Link
              to="/contact"
              className="inline-flex items-center justify-center gap-2 h-13 px-7 rounded-full bg-primary text-primary-foreground font-bold text-sm hover:bg-rose-hover transition-colors"
            >
              <Sparkles className="h-4 w-4" /> Start Your Story
            </Link>
            <Link
              to="/creators"
              className="inline-flex items-center justify-center h-13 px-7 rounded-full bg-white text-foreground font-bold text-sm border-2 border-white hover:bg-gray-100 transition-colors"
            >
              Join as Creator
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
