import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, ArrowUpRight, Sparkles, TrendingUp, Globe, Award } from "lucide-react";
import { legacyStoryCards, localized } from "@/data/legacyAdfocateContent";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_site/stories")({
  component: StoriesPage,
});

// Map each legacy story card's `color` to art-direction tokens reusing the
// existing design-system classes. pink/lilac have no .game-card-* hover
// variant, so they fall back to a colored top accent border.
const colorAccentMap: Record<
  string,
  { card: string; topBorder: string; tagBg: string; tagText: string; dot: string }
> = {
  pink: {
    card: "game-card",
    topBorder: "border-t-[6px] border-t-[var(--color-magenta)]",
    tagBg: "bg-[var(--color-magenta)]",
    tagText: "text-white",
    dot: "bg-[var(--color-magenta)]",
  },
  yellow: {
    card: "game-card game-card-yellow",
    topBorder: "border-t-[6px] border-t-[var(--color-acid)]",
    tagBg: "bg-[var(--color-acid)]",
    tagText: "text-[var(--color-ink)]",
    dot: "bg-[var(--color-acid)]",
  },
  mint: {
    card: "game-card game-card-mint",
    topBorder: "border-t-[6px] border-t-[var(--color-cyan)]",
    tagBg: "bg-[var(--color-cyan)]",
    tagText: "text-[var(--color-ink)]",
    dot: "bg-[var(--color-cyan)]",
  },
  blue: {
    card: "game-card game-card-blue",
    topBorder: "border-t-[6px] border-t-[var(--color-violet)]",
    tagBg: "bg-[var(--color-violet)]",
    tagText: "text-white",
    dot: "bg-[var(--color-violet)]",
  },
  lilac: {
    card: "game-card",
    topBorder: "border-t-[6px] border-t-[var(--color-violet)]",
    tagBg: "bg-[var(--color-violet)]",
    tagText: "text-white",
    dot: "bg-[var(--color-violet)]",
  },
};

function StoriesPage() {
  return (
    <div>
      <HeroSection />
      <StoriesGridSection />
      <DualCTASection />
    </div>
  );
}

/* §26 — HERO: centered statement, metric-led, paper + dot-grid */
function HeroSection() {
  const { lang } = useI18n();
  const tx = (en: string, zh: string) => (lang === "en" ? en : zh);

  return (
    <section className="relative overflow-hidden">
      <div className="absolute inset-0 dot-pattern opacity-[0.5]" aria-hidden="true" />
      <div className="relative mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 pt-14 pb-16 sm:pt-24 sm:pb-24 text-center">
        <span className="sticker mb-6">{tx("Stories", "案例")}</span>

        <h1 className="font-display text-5xl sm:text-6xl lg:text-7xl text-[var(--color-ink)] leading-[1.02] tracking-tight">
          {tx("Results talk", "成績說話")}
          <span className="text-[var(--color-magenta)]">.</span>
        </h1>

        <p className="mt-6 text-base sm:text-lg text-[var(--color-soft-ink)] max-w-2xl mx-auto leading-relaxed">
          {/* Preserved original hero supporting copy */}
          {tx(
            "A snapshot of brand work across beauty, travel, retail, community, and F&B — powered by Adfocate creator activations.",
            "橫跨美妝、旅遊、零售、社群及餐飲嘅品牌案例一覽 — 全部由 Adfocate 創作者激活推動。",
          )}
        </p>

        {/* metric-led proof row */}
        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <span className="metric-badge metric-up">
            <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />
            {legacyStoryCards.length} {tx("brand cases", "個品牌案例")}
          </span>
          <span className="tag-mono">{tx("5 industries", "5 大行業")}</span>
          <span className="tag-mono">{tx("HK · since 2019", "香港 · 由 2019")}</span>
        </div>
      </div>
    </section>
  );
}

/* §27 — STORY CARDS: mosaic / masonry grid, color-mapped accents,
   one oversized stroked numeral as the page's second-read moment */
function StoriesGridSection() {
  const { lang } = useI18n();
  const tx = (en: string, zh: string) => (lang === "en" ? en : zh);

  return (
    <section className="relative bg-[var(--color-paper)]">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-16 md:py-20">
        {/* Section header with the SECOND-READ MOMENT: oversized stroked count */}
        <div className="flex flex-wrap items-end justify-between gap-6 mb-10">
          <div className="max-w-xl">
            <span className="tag-mono mb-3">{tx("Portfolio", "作品集")}</span>
            <h2 className="font-display text-3xl sm:text-4xl text-[var(--color-ink)] leading-tight">
              {tx("The proof, card by card", "一張一張，講成績")}
            </h2>
          </div>
          <div className="relative leading-none" aria-hidden="true">
            <span className="font-display text-7xl sm:text-8xl lg:text-9xl text-outline-ink select-none">
              {String(legacyStoryCards.length).padStart(2, "0")}
            </span>
          </div>
        </div>

        {/* Masonry-style mosaic via CSS columns so cards keep varied heights */}
        <div className="[column-gap:1.5rem] sm:columns-2 lg:columns-3">
          {legacyStoryCards.map((story, i) => {
            const clr = colorAccentMap[story.color] ?? colorAccentMap.pink;

            return (
              <article
                key={story.id}
                className={cn(
                  "mb-6 break-inside-avoid bg-white p-5 sm:p-6",
                  clr.card,
                  clr.topBorder,
                  "stagger-" + Math.min(i + 1, 8),
                  "animate-slide-up",
                )}
              >
                <div className="flex items-center gap-2.5 mb-4">
                  <span
                    className={cn(
                      "text-[10px] font-mono font-bold tracking-[0.12em] uppercase px-2.5 py-1 rounded-full border-2 border-[var(--color-ink)]",
                      clr.tagBg,
                      clr.tagText,
                    )}
                  >
                    {localized(story.industry, lang)}
                  </span>
                  <span className={cn("h-2.5 w-2.5 rounded-full", clr.dot)} aria-hidden="true" />
                  <span className="text-[10px] font-mono text-[var(--color-soft-ink)]">
                    {tx("Portfolio proof", "過往案例")}
                  </span>
                </div>

                <h3 className="font-display text-2xl sm:text-[1.75rem] text-[var(--color-ink)] leading-tight mb-3">
                  {story.client}
                </h3>
                <p className="text-sm text-[var(--color-soft-ink)] leading-relaxed mb-4">
                  {localized(story.activation, lang)}
                </p>

                <div className="grid gap-2 text-[11px] text-[var(--color-soft-ink)] font-mono mb-4">
                  <span className="inline-flex items-center gap-1.5">
                    <Globe className="h-3.5 w-3.5" aria-hidden="true" />
                    {story.year ? story.year : localized(story.product, lang)}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Award className="h-3.5 w-3.5" aria-hidden="true" />
                    {story.service ? localized(story.service, lang) : localized(story.proof, lang)}
                  </span>
                </div>

                <a
                  href={story.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm font-heading font-bold text-[var(--color-ink)] hover:gap-2.5 transition-all"
                >
                  {tx("Reference", "參考來源")}
                  <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                </a>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* §28 — DUAL CTA: color-blocked diptych (creators / brands) */
function DualCTASection() {
  const { lang } = useI18n();
  const tx = (en: string, zh: string) => (lang === "en" ? en : zh);

  return (
    <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-16 md:py-20">
      <div className="grid gap-0 overflow-hidden rounded-[var(--radius)] border-2 border-[var(--color-ink)] shadow-[6px_6px_0_0_var(--color-ink)] md:grid-cols-2">
        {/* Creators — acid field */}
        <div className="relative bg-[var(--color-acid)] p-8 sm:p-10 lg:p-12 md:border-r-2 md:border-[var(--color-ink)]">
          <span className="tag-mono mb-4">{tx("For creators", "創作者")}</span>
          <h2 className="font-display text-3xl sm:text-4xl text-[var(--color-ink)] leading-tight">
            {tx("Be the next story", "成為下一個案例")}
          </h2>
          <p className="mt-3 text-[var(--color-ink)]/80 text-sm sm:text-base leading-relaxed max-w-sm">
            {tx(
              "Join KOCmax, level up, and turn your content into verified, paid activations.",
              "加入 KOCmax，逐級升級，將你嘅內容變成有紀錄、有收入嘅激活。",
            )}
          </p>
          <Link to="/creators" className="btn-ink mt-7 inline-flex items-center gap-2">
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            {tx("Join as creator", "以創作者身份加入")}
          </Link>
        </div>

        {/* Brands — violet field */}
        <div className="relative bg-[var(--color-violet)] p-8 sm:p-10 lg:p-12">
          <span className="tag-mono mb-4">{tx("For brands", "品牌")}</span>
          <h2 className="font-display text-3xl sm:text-4xl text-white leading-tight">
            {tx("Want results like these?", "想要同樣嘅成績？")}
          </h2>
          <p className="mt-3 text-white/85 text-sm sm:text-base leading-relaxed max-w-sm">
            {tx(
              "Brief us your goal and we'll match the right creators to drive real activation.",
              "話我哋知你嘅目標，我哋為你配對啱嘅創作者，帶動真正激活。",
            )}
          </p>
          <Link to="/contact" className="btn-primary mt-7 inline-flex items-center gap-2">
            {tx("Start your story", "開始你嘅故事")}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  );
}
