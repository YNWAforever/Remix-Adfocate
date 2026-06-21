import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Lightbulb, Target, BarChart3, BookOpen } from "lucide-react";
import { legacyPlaybookTopics, localized } from "@/data/legacyAdfocateContent";
import { playbooks } from "@/data/mockData";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_site/playbooks")({
  component: PlaybooksPage,
});

const colorAccentMap: Record<
  string,
  { border: string; bg: string; pill: string; dot: string; text: string }
> = {
  pink: {
    border: "border-l-4 border-l-brand-pink",
    bg: "bg-brand-pink/5",
    pill: "bg-brand-pink/10 text-brand-pink border-brand-pink/20",
    dot: "bg-brand-pink",
    text: "text-brand-pink",
  },
  yellow: {
    border: "border-l-4 border-l-brand-yellow",
    bg: "bg-brand-yellow/5",
    pill: "bg-brand-yellow/10 text-yellow-700 border-brand-yellow/20",
    dot: "bg-brand-yellow",
    text: "text-brand-yellow",
  },
  mint: {
    border: "border-l-4 border-l-brand-mint",
    bg: "bg-brand-mint/5",
    pill: "bg-brand-mint/10 text-mint-700 border-brand-mint/20",
    dot: "bg-brand-mint",
    text: "text-brand-mint",
  },
  blue: {
    border: "border-l-4 border-l-brand-blue",
    bg: "bg-brand-blue/5",
    pill: "bg-brand-blue/10 text-brand-blue border-brand-blue/20",
    dot: "bg-brand-blue",
    text: "text-brand-blue",
  },
  lilac: {
    border: "border-l-4 border-l-brand-lilac",
    bg: "bg-brand-lilac/5",
    pill: "bg-brand-lilac/10 text-purple-600 border-brand-lilac/20",
    dot: "bg-brand-lilac",
    text: "text-brand-lilac",
  },
};

const levelPillMap: Record<string, string> = {
  "KOC Starter": "level-pill-l1",
  "Trusted KOC": "level-pill-l2",
  "Nano Creator": "level-pill-l3",
  "Micro-Influencer": "level-pill-l4",
  Influencer: "level-pill-l5",
};

function PlaybooksPage() {
  return (
    <div>
      <HeroSection />
      <PlaybooksGridSection />
      <LegacyPlaybookTopicsSection />
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
            background: "radial-gradient(circle, rgba(254,240,138,0.18) 0%, transparent 65%)",
          }}
        />
        <div
          className="absolute bottom-0 -left-32 w-[400px] h-[400px] rounded-full"
          style={{
            background: "radial-gradient(circle, rgba(167,243,208,0.12) 0%, transparent 65%)",
          }}
        />
      </div>

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl">
          <span className="inline-block font-mono text-[10px] uppercase tracking-[0.2em] text-brand-yellow border-2 border-brand-yellow/30 rounded-full px-3 py-1.5 bg-white mb-6">
            Playbooks
          </span>
          <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl text-foreground max-w-3xl leading-[1.05] mb-5">
            Industry Playbooks<span className="text-brand-yellow">.</span>
          </h1>
          <p className="text-soft-ink text-sm sm:text-base max-w-xl mb-6 leading-relaxed">
            Practical campaign formats and creator activation ideas, organized by industry. Pick the
            play that fits your sector — from Beauty to Finance.
          </p>
        </div>
      </div>
    </section>
  );
}

function PlaybooksGridSection() {
  const { lang } = useI18n();
  return (
    <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12 border-t border-gray-200">
      <div className="space-y-6">
        {playbooks.map((pb, i) => {
          const clr = colorAccentMap[pb.color] ?? colorAccentMap.pink;

          return (
            <article
              key={pb.industry.en}
              className={cn(
                "game-card border-2 border-gray-200 bg-white overflow-hidden",
                clr.border,
                "stagger-" + Math.min(i + 1, 6),
                "animate-slide-up",
              )}
            >
              <div className={cn("p-6 sm:p-8", clr.bg)}>
                <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
                  {/* Left column: industry header + levels */}
                  <div>
                    <div className="flex items-center gap-3 mb-3">
                      <span className="text-3xl">{pb.emoji}</span>
                      <div>
                        <h2 className="font-display text-2xl sm:text-3xl text-foreground leading-tight">
                          {localized(pb.industry, lang)}
                        </h2>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-1.5 mb-4">
                      {pb.levels.map((level) => (
                        <span
                          key={level.en}
                          className={cn(
                            "level-pill text-[10px]",
                            levelPillMap[level.en] ?? "level-pill-l1",
                          )}
                        >
                          {localized(level, lang)}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Right column: ideas, angle, measurement */}
                  <div className="space-y-4">
                    <div>
                      <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-soft-ink mb-2 block">
                        Campaign Ideas
                      </span>
                      <ul className="grid gap-1.5 sm:grid-cols-2">
                        {pb.ideas.map((idea) => (
                          <li key={idea} className="flex items-start gap-2 text-sm text-foreground">
                            <span className={cn("h-2 w-2 rounded-full mt-1.5 shrink-0", clr.dot)} />
                            <span>{idea}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2 pt-3 border-t border-gray-100">
                      <div className="rounded-xl bg-white border border-gray-200 p-3">
                        <div className="flex items-center gap-1.5 mb-1">
                          <Target className={cn("h-3.5 w-3.5", clr.text)} />
                          <span className="text-[10px] font-mono uppercase tracking-[0.1em] text-soft-ink">
                            Creator Angle
                          </span>
                        </div>
                        <p className="text-xs text-foreground leading-relaxed">{localized(pb.creatorAngle, lang)}</p>
                      </div>

                      <div className="rounded-xl bg-white border border-gray-200 p-3">
                        <div className="flex items-center gap-1.5 mb-1">
                          <BarChart3 className={cn("h-3.5 w-3.5", clr.text)} />
                          <span className="text-[10px] font-mono uppercase tracking-[0.1em] text-soft-ink">
                            Measurement Focus
                          </span>
                        </div>
                        <p className="text-xs text-foreground leading-relaxed">
                          {pb.measurementFocus}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function LegacyPlaybookTopicsSection() {
  const { lang } = useI18n();

  return (
    <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between mb-7">
        <div>
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-brand-yellow">
            {localized({ en: "From Adfocate insights", zh: "源自 Adfocate 洞察" }, lang)}
          </span>
          <h2 className="font-display text-3xl sm:text-4xl text-foreground mt-2 leading-tight">
            {localized(
              {
                en: "Agency insights, rebuilt as working playbooks.",
                zh: "把實戰洞察，整理成可執行 Playbook。",
              },
              lang,
            )}
          </h2>
        </div>
        <p className="text-sm text-soft-ink leading-relaxed max-w-md">
          {localized(
            {
              en: "These topics condense Adfocate articles into practical guidance for matching, briefing, content quality, affiliate conversion, and live commerce.",
              zh: "這些主題將 Adfocate 文章濃縮成實用指南，涵蓋配對、Briefing、內容質素、Affiliate 轉化及直播商務。",
            },
            lang,
          )}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {legacyPlaybookTopics.map((topic) => (
          <article key={topic.id} className="game-card border-2 border-gray-200 bg-white p-5">
            <div className="flex items-start justify-between gap-3 mb-3">
              <span className="text-[10px] font-mono font-bold tracking-[0.12em] uppercase px-2.5 py-1 rounded-full border bg-brand-yellow/10 text-yellow-700 border-brand-yellow/20">
                {localized(topic.industry, lang)}
              </span>
              <span className="text-[10px] font-mono uppercase tracking-[0.12em] text-soft-ink">
                {localized({ en: topic.format, zh: "Playbook" }, lang)}
              </span>
            </div>
            <h3 className="font-heading font-bold text-sm text-foreground leading-snug">
              {localized(topic.title, lang)}
            </h3>
            <p className="mt-2 text-xs text-soft-ink leading-relaxed">
              {localized(topic.summary, lang)}
            </p>
            <ul className="mt-4 space-y-2">
              {topic.takeaways.map((takeaway) => (
                <li key={takeaway.en} className="flex items-start gap-2 text-xs text-foreground">
                  <Lightbulb className="h-3.5 w-3.5 text-brand-yellow shrink-0 mt-0.5" />
                  <span>{localized(takeaway, lang)}</span>
                </li>
              ))}
            </ul>
            <a
              href={topic.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex items-center gap-1.5 text-sm font-heading font-bold text-yellow-700 hover:gap-2 transition-all"
            >
              {localized({ en: "Reference", zh: "參考來源" }, lang)}{" "}
              <ArrowRight className="h-4 w-4" />
            </a>
          </article>
        ))}
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
            background: "radial-gradient(circle, rgba(254,240,138,0.2) 0%, transparent 60%)",
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
              Want a custom playbook for your brand?
            </h2>
            <p className="text-gray-300 mt-2">
              Our team can design a tailored creator activation playbook for your industry, goals,
              and budget.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <Link
              to="/contact"
              className="inline-flex items-center justify-center gap-2 h-13 px-7 rounded-full bg-brand-yellow text-foreground font-bold text-sm hover:bg-butter/85 transition-colors"
            >
              <BookOpen className="h-4 w-4" /> Request Playbook
            </Link>
            <Link
              to="/packages"
              className="inline-flex items-center justify-center h-13 px-7 rounded-full bg-white text-foreground font-bold text-sm border-2 border-white hover:bg-gray-100 transition-colors"
            >
              View Packages
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
