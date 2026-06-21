import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useEffect, useState } from "react";
import {
  Sparkles,
  ArrowRight,
  Target,
  Trophy,
  ShoppingBag,
  TrendingUp,
  Banknote,
  Star,
  Shield,
  User,
  MessageCircle,
  Check,
} from "lucide-react";
import {
  mockCreatorPassport,
  copilotTools,
  academyTracks,
  resources,
} from "@/data/mockData";
import { LEVELS } from "@/lib/levels";
import { legacyAffiliateSteps, localized } from "@/data/legacyAdfocateContent";
import { useI18n } from "@/lib/i18n";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { cn } from "@/lib/utils";

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

export const Route = createFileRoute("/_site/creators")({
  component: CreatorsPage,
});

const levelPillClass: Record<string, string> = {
  L0: "level-pill-l0",
  L1: "level-pill-l1",
  L2: "level-pill-l2",
  L3: "level-pill-l3",
  L4: "level-pill-l4",
  L5: "level-pill-l5",
  L6: "level-pill-l6",
};

const faqItems = [
  {
    q: "Do I need many followers?",
    a: "No. Adfocate values content quality, reliability, and category fit more than just follower count. KOC missions are designed for everyday creators — your honest voice matters more than your numbers.",
  },
  {
    q: "How do I level up?",
    a: "Complete missions, get approved content, earn XP, unlock badges, and build your Creator Passport. Each level unlocks better missions, higher pay, and new tools. Level-ups are based on verified platform activity — not just follower count.",
  },
  {
    q: "How do I earn money?",
    a: "Through campaign fees, affiliate commissions, coupon rewards, UGC content jobs, live commerce hosting, and brand ambassador roles on Adfoplace. As you level up, your earning potential grows significantly.",
  },
  {
    q: "What is Creator Passport?",
    a: "Your Creator Passport is a live profile that grows with every mission you complete. It shows your scores (Influence, Content, Reliability, Brand Safety), badges, category expertise, brand feedback, and verified earnings history — proving your value to brands.",
  },
  {
    q: "What is finance readiness?",
    a: "Finance Readiness is a preview score based on your verified creator activity and earnings history. It assesses factors like earnings consistency, mission completion, brand safety, and affiliate performance to help you understand your potential for future capital options.",
  },
  {
    q: "Is creator capital guaranteed?",
    a: "No. Finance readiness is only a preview to help you understand your trajectory. Any capital or payout advance product would be subject to eligibility, approval, and applicable partner or licensing arrangements. Adfocate does not provide financing in this prototype.",
  },
];

function ScoreRing({
  score,
  size = 56,
  strokeWidth = 5,
  color = "#FFB5C2",
  label,
}: {
  score: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  label?: string;
}) {
  const [animatedScore, setAnimatedScore] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          const start = Date.now();
          const duration = 1200;
          const tick = () => {
            const elapsed = Date.now() - start;
            const progress = Math.min(elapsed / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            setAnimatedScore(Math.round(eased * score));
            if (progress < 1) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
          obs.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [score]);

  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (animatedScore / 100) * circumference;

  return (
    <div ref={ref} className="score-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="absolute inset-0">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#F0E7DA"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="relative flex flex-col items-center">
        <span className="font-mono text-sm font-bold text-foreground">{animatedScore}</span>
        {label && (
          <span className="text-[9px] font-mono uppercase tracking-wider text-soft-ink">
            {label}
          </span>
        )}
      </div>
    </div>
  );
}

function HowItWorksSection() {
  const { t } = useI18n();

  const steps = [
    {
      icon: User,
      label: t("creators.how.s1"),
      desc: "Sign up, set your categories, and connect your social profiles to start receiving missions.",
      color: "text-brand-pink",
    },
    {
      icon: Target,
      label: t("creators.how.s2"),
      desc: "Pick missions that match your niche, follow the brief, submit content, and get approved.",
      color: "text-brand-yellow",
    },
    {
      icon: Check,
      label: t("creators.how.s3"),
      desc: "Every approved mission builds your Creator Passport with scores, badges, and verified history.",
      color: "text-brand-mint",
    },
    {
      icon: Sparkles,
      label: t("creators.how.s4"),
      desc: "As your reliability and quality scores rise, unlock paid UGC jobs, campaign fees, and better brand briefs.",
      color: "text-brand-blue",
    },
    {
      icon: TrendingUp,
      label: t("creators.how.s5"),
      desc: "Access Adfoplace for affiliate commissions, live commerce, coupons, and product drop opportunities.",
      color: "text-brand-lilac",
    },
    {
      icon: Banknote,
      label: t("creators.how.s6"),
      desc: "Build verified earnings history and improve your Finance Readiness Score for future capital access.",
      color: "text-brand-pink",
    },
  ];

  return (
    <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-20">
      <div className="text-center mb-10">
        <span className="inline-block font-mono text-[10px] uppercase tracking-[0.2em] text-brand-pink border-2 border-brand-pink/30 rounded-full px-3 py-1 bg-white mb-4">
          Flow
        </span>
        <h2 className="font-display text-3xl sm:text-4xl text-foreground">
          {t("creators.how.heading")}
        </h2>
        <p className="text-soft-ink mt-3 max-w-xl mx-auto">
          Your creator journey in six structured steps, from first mission to finance-ready.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {steps.map((step, i) => (
          <div
            key={step.label}
            className={cn(
              "game-card flex flex-col gap-3",
              "stagger-" + Math.min(i + 1, 6),
              "animate-slide-up",
            )}
          >
            <div className="flex items-center gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-charcoal text-white font-mono text-sm font-bold shrink-0">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span
                className={cn(
                  "inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white border-2 border-gray-100",
                  step.color,
                )}
              >
                <step.icon className="h-4.5 w-4.5" />
              </span>
            </div>
            <h3 className="font-heading font-bold text-sm text-foreground leading-snug">
              {step.label}
            </h3>
            <p className="text-xs text-soft-ink leading-relaxed">{step.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function AffiliatePathwaySection() {
  const { lang } = useI18n();

  return (
    <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 pb-20">
      <div className="rounded-3xl border-2 border-gray-200 bg-white p-6 sm:p-8">
        <div className="grid gap-7 lg:grid-cols-[320px_1fr] items-start">
          <div>
            <span className="inline-block font-mono text-[10px] uppercase tracking-[0.2em] text-brand-mint border-2 border-brand-mint/30 rounded-full px-3 py-1 bg-white mb-4">
              {localized({ en: "Affiliate creator pathway", zh: "Affiliate 創作者流程" }, lang)}
            </span>
            <h2 className="font-display text-2xl sm:text-3xl text-foreground leading-tight">
              {localized(
                {
                  en: "Apply, get approved, create, and earn.",
                  zh: "申請、通過審批、創作，然後賺取收益。",
                },
                lang,
              )}
            </h2>
            <p className="text-sm text-soft-ink leading-relaxed mt-3">
              {localized(
                {
                  en: "The original Adfocate affiliate flow now connects to creator levels, mission validation, Adfoplace offers, and verified earning history.",
                  zh: "Adfocate 原有 Affiliate 流程現已連接創作者等級、任務驗證、Adfoplace Offer 及已驗證收益紀錄。",
                },
                lang,
              )}
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {legacyAffiliateSteps.map((item) => (
              <article key={item.id} className="rounded-2xl bg-cream/50 border border-gray-200 p-4">
                <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-brand-mint mb-2">
                  {localized(item.step, lang)}
                </p>
                <h3 className="font-heading font-bold text-sm text-foreground">
                  {localized(item.title, lang)}
                </h3>
                <p className="mt-2 text-xs text-soft-ink leading-relaxed">
                  {localized(item.description, lang)}
                </p>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function CreatorLevelsSection() {
  const { t } = useI18n();

  return (
    <section className="py-20 border-y border-gray-200">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-10">
          <span className="inline-block font-mono text-[10px] uppercase tracking-[0.2em] text-brand-yellow border-2 border-brand-yellow/30 rounded-full px-3 py-1 bg-white mb-4">
            Progression
          </span>
          <h2 className="font-display text-3xl sm:text-4xl text-foreground">
            {t("creators.levels.heading")}
          </h2>
          <p className="text-soft-ink mt-3 max-w-xl mx-auto">
            From product sampler to creator entrepreneur — each level unlocks new earning
            opportunities.
          </p>
        </div>

        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {LEVELS.map((level, i) => {
            const isDemoLevel = level.id === mockCreatorPassport.level;
            return (
              <article
                key={level.id}
                className={cn(
                  "game-card flex flex-col gap-3",
                  isDemoLevel && "border-brand-pink/40 bg-brand-pink/5",
                  "stagger-" + Math.min(i + 1, 7),
                  "animate-slide-up",
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="text-3xl">{level.emoji}</span>
                  <span
                    className={cn("level-pill", levelPillClass[level.id] ?? "level-pill-l1")}
                  >
                    {level.id} {t(level.labelKey)}
                  </span>
                </div>

                <div>
                  <p className="font-heading font-bold text-sm text-foreground">{level.goal}</p>
                  <p className="text-[11px] text-soft-ink mt-1">
                    <span className="font-mono font-semibold text-brand-pink">
                      {level.xpRequired.toLocaleString()} XP
                    </span>{" "}
                    required
                  </p>
                </div>

                <div className="flex flex-wrap gap-1">
                  {level.unlocks.map((u) => (
                    <span
                      key={u}
                      className="text-[10px] font-heading font-semibold px-2 py-0.5 rounded-full bg-brand-mint/10 text-brand-mint border border-brand-mint/20"
                    >
                      {u}
                    </span>
                  ))}
                </div>

                <div className="mt-auto pt-2 border-t border-gray-100">
                  <p className="text-[10px] font-mono uppercase tracking-wider text-soft-ink mb-0.5">
                    Income Example
                  </p>
                  <p className="text-xs font-bold text-foreground">{level.incomeExample}</p>
                </div>

                {isDemoLevel && (
                  <div className="absolute top-2 right-2 hidden sm:block">
                    <span className="inline-flex items-center gap-1 text-[10px] font-mono font-bold text-primary-foreground bg-primary rounded-full px-2 py-0.5">
                      <Star className="h-3 w-3" /> YOU
                    </span>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function CreatorPassportFullSection() {
  const { t } = useI18n();
  const passport = mockCreatorPassport;
  const xpPct = Math.round((passport.xp / passport.xpNext) * 100);

  const scoreRings = [
    { key: "influence", label: "Influence", color: "#FFB5C2" },
    { key: "content", label: "Content", color: "#BAE6FD" },
    { key: "reliability", label: "Reliability", color: "#A7F3D0" },
    { key: "brandSafety", label: "Brand Safety", color: "#C4B5FD" },
  ] as const;

  return (
    <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-20">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
        <div>
          <span className="inline-block font-mono text-[10px] uppercase tracking-[0.2em] text-brand-lilac border-2 border-brand-lilac/30 rounded-full px-3 py-1 bg-white mb-3">
            Passport
          </span>
          <h2 className="font-display text-3xl sm:text-4xl text-foreground">
            {t("creators.passport.heading")}
          </h2>
          <p className="text-soft-ink mt-2 max-w-lg">
            Your profile grows with every mission. Prove your value to brands with verified data.
          </p>
        </div>
      </div>

      <div className="game-card p-6 sm:p-8 border-2 border-brand-lilac/30 bg-white">
        <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
          <div className="space-y-6">
            <div className="flex items-start gap-5">
              <div className="h-16 w-16 rounded-full bg-gradient-to-br from-primary via-secondary to-sky text-foreground font-display text-2xl font-bold shrink-0">
                {passport.avatar}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-heading text-xl font-bold text-foreground">{passport.name}</h3>
                <div className="flex items-center gap-2 mt-1">
                  <span
                    className={cn("level-pill", levelPillClass[passport.level] ?? "level-pill-l3")}
                  >
                    {passport.level} {passport.levelLabel}
                  </span>
                  <span className="text-[11px] font-mono text-soft-ink">
                    {passport.completedMissions} missions completed
                  </span>
                </div>
                <p className="text-xs text-soft-ink mt-2 leading-relaxed">{passport.bio}</p>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-heading font-semibold text-soft-ink">
                  XP Progress to Next Level
                </span>
                <span className="text-[11px] font-mono text-brand-pink font-bold">
                  {passport.xp.toLocaleString()} / {passport.xpNext.toLocaleString()} XP
                </span>
              </div>
              <div className="xp-bar h-3">
                <div className="xp-bar-fill h-3" style={{ width: `${xpPct}%` }} />
              </div>
              <p className="text-[10px] font-mono text-soft-ink mt-1.5">
                {xpPct}% to L4 Micro-Influencer · Complete{" "}
                {(passport.xpNext - passport.xp).toLocaleString()} more XP
              </p>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {passport.categories.map((cat) => (
                <span
                  key={cat}
                  className="text-[11px] font-heading font-semibold px-3 py-1 rounded-full bg-brand-pink/10 text-brand-pink border border-brand-pink/20"
                >
                  {cat}
                </span>
              ))}
            </div>

            <div className="flex flex-wrap gap-1.5">
              {passport.badges.map((b) => (
                <span
                  key={b}
                  className="inline-flex items-center gap-1 text-[10px] font-mono font-semibold px-2.5 py-1 rounded-full bg-brand-yellow/10 text-yellow-700 border border-brand-yellow/20"
                >
                  <Shield className="h-3 w-3" /> {b}
                </span>
              ))}
            </div>

            <div>
              <span className="text-xs font-heading font-semibold text-soft-ink mb-2 block">
                Social Handles
              </span>
              <div className="flex flex-wrap gap-2">
                {passport.socialHandles.map((h) => (
                  <span
                    key={h.platform}
                    className="inline-flex items-center gap-1.5 text-[11px] font-mono font-semibold px-3 py-1 rounded-full bg-white border border-gray-200 text-foreground"
                  >
                    {h.platform === "Instagram" && (
                      <InstagramIcon className="h-3 w-3 text-brand-pink" />
                    )}
                    {h.platform === "Xiaohongshu" && (
                      <MessageCircle className="h-3 w-3 text-red-500" />
                    )}
                    {h.platform === "TikTok" && <YoutubeIcon className="h-3 w-3 text-gray-700" />}
                    {h.handle}
                  </span>
                ))}
              </div>
            </div>

            <div>
              <span className="text-xs font-heading font-semibold text-soft-ink mb-2 block">
                Strengths
              </span>
              <ul className="space-y-1">
                {passport.strengths.map((s) => (
                  <li key={s} className="text-xs text-foreground flex items-center gap-1.5">
                    <Trophy className="h-3 w-3 text-brand-yellow shrink-0" /> {s}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="border-t lg:border-t-0 lg:border-l border-gray-200 pt-6 lg:pt-0 lg:pl-6 space-y-5">
            <div>
              <span className="text-xs font-heading font-semibold text-soft-ink mb-3 block">
                Creator Value Scores
              </span>
              <div className="grid grid-cols-2 gap-3">
                {scoreRings.map(({ key, label, color }) => (
                  <div
                    key={key}
                    className="flex flex-col items-center gap-1.5 bg-white rounded-xl border border-gray-200 p-3"
                  >
                    <ScoreRing
                      score={passport.scores[key]}
                      size={56}
                      strokeWidth={5}
                      color={color}
                      label={label}
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl bg-brand-mint/5 border border-brand-mint/20 p-4">
              <p className="text-[10px] font-mono uppercase tracking-wider text-brand-mint mb-1">
                Lifetime Earnings
              </p>
              <p className="font-display text-2xl text-foreground">
                {passport.incomeHistory.split(" ")[0]}
              </p>
              <p className="text-xs text-soft-ink mt-0.5">{passport.incomeHistory}</p>
            </div>

            <div className="rounded-xl bg-brand-lilac/5 border border-brand-lilac/20 p-4">
              <p className="text-[10px] font-mono uppercase tracking-wider text-brand-lilac mb-1">
                Brand Feedback
              </p>
              <p className="font-display text-2xl text-foreground">{passport.brandFeedback}%</p>
              <p className="text-xs text-soft-ink mt-0.5">Positive satisfaction score</p>
            </div>

            <div className="rounded-xl border border-gray-200 p-4 bg-white">
              <p className="text-[10px] font-mono uppercase tracking-wider text-soft-ink mb-2">
                Next Actions
              </p>
              <ul className="space-y-1.5">
                {passport.nextActions.map((a) => (
                  <li key={a} className="text-xs text-foreground flex items-start gap-1.5">
                    <ArrowRight className="h-3 w-3 text-brand-pink mt-0.5 shrink-0" /> {a}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function GrowResourcesSection() {
  const { t, lang } = useI18n();

  const resourceGroups = [
    {
      title: "Academy Courses",
      emoji: "📚",
      desc: "Structured learning tracks from KOC Starter to live commerce and creator finance.",
      items: academyTracks.slice(0, 4),
      color: "text-brand-pink",
      bg: "bg-brand-pink/5",
      to: "/mission",
    },
    {
      title: "Templates & Playbooks",
      emoji: "📝",
      desc: "Ready-to-use caption templates, script formulas, shot lists, and media kits.",
      items: resources.slice(0, 4),
      color: "text-brand-mint",
      bg: "bg-brand-mint/5",
      to: "/playbooks",
    },
    {
      title: "Creator Copilot Tools",
      emoji: "🤖",
      desc: "AI-powered tools for hooks, captions, pricing, mission matching, and compliance.",
      items: copilotTools.slice(0, 4),
      color: "text-brand-blue",
      bg: "bg-brand-blue/5",
      to: "/mission",
    },
    {
      title: "Mentor Sessions & Studio",
      emoji: "🎙️",
      desc: "Book sessions with experienced creators, join workshops, and use studio resources.",
      color: "text-brand-lilac",
      bg: "bg-brand-lilac/5",
      items: [
        { id: "m1", title: "1-on-1 Creator Coaching", level: "L3+", emoji: "👤" },
        { id: "m2", title: "Live Shopping Dress Rehearsal", level: "L4+", emoji: "🎬" },
        { id: "m3", title: "Content Shoot Studio Access", level: "L2+", emoji: "📸" },
        { id: "m4", title: "Finance Readiness Workshop", level: "L3+", emoji: "🏦" },
      ],
      to: "/contact",
    },
  ];

  return (
    <section className="py-20 border-y border-gray-200">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-10">
          <span className="inline-block font-mono text-[10px] uppercase tracking-[0.2em] text-brand-mint border-2 border-brand-mint/30 rounded-full px-3 py-1 bg-white mb-4">
            Growth
          </span>
          <h2 className="font-display text-3xl sm:text-4xl text-foreground">
            {t("creators.resources.heading")}
          </h2>
          <p className="text-soft-ink mt-3 max-w-xl mx-auto">
            Access Academy, Copilot, templates, and studio resources to accelerate your creator
            journey.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {resourceGroups.map((group, i) => (
            <div
              key={group.title}
              className={cn(
                "game-card flex flex-col gap-4",
                "stagger-" + Math.min(i + 1, 4),
                "animate-slide-up",
              )}
            >
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    "inline-flex h-12 w-12 items-center justify-center rounded-xl text-2xl",
                    group.bg,
                  )}
                >
                  {group.emoji}
                </span>
                <div>
                  <h3 className="font-heading font-bold text-foreground">{group.title}</h3>
                  <p className="text-[11px] text-soft-ink">{group.desc}</p>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {group.items.map((item) => {
                  const icon =
                    "emoji" in item
                      ? item.emoji
                      : "icon" in item
                        ? (item as { icon: string }).icon
                        : "📌";
                  return (
                    <span
                      key={item.id}
                      className="text-[10px] font-mono font-semibold px-2.5 py-1 rounded-full bg-white border border-gray-200 text-soft-ink inline-flex items-center gap-1"
                    >
                      {icon} {typeof item.title === "string" ? item.title : localized(item.title, lang)}
                    </span>
                  );
                })}
              </div>

              <Link
                to={group.to}
                className={cn(
                  "mt-auto inline-flex items-center gap-1 text-sm font-bold hover:gap-2 transition-[gap]",
                  group.color,
                )}
              >
                Browse all →
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CreatorFAQSection() {
  const { t } = useI18n();

  return (
    <section className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-20">
      <div className="text-center mb-10">
        <span className="inline-block font-mono text-[10px] uppercase tracking-[0.2em] text-brand-pink border-2 border-brand-pink/30 rounded-full px-3 py-1 bg-white mb-4">
          FAQ
        </span>
        <h2 className="font-display text-3xl sm:text-4xl text-foreground">
          {t("creators.faq.heading")}
        </h2>
      </div>

      <Accordion type="single" collapsible className="w-full space-y-2">
        {faqItems.map((item, i) => (
          <AccordionItem
            key={item.q}
            value={`faq-${i}`}
            className="border border-gray-200 rounded-xl bg-white overflow-hidden data-[state=open]:border-brand-pink/30 data-[state=open]:shadow-sm"
          >
            <AccordionTrigger className="text-left font-heading font-bold text-foreground hover:text-brand-pink transition-colors px-5 py-4 text-sm data-[state=open]:text-brand-pink">
              <span className="flex items-center gap-3">
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border-2 border-brand-pink/20 text-brand-pink text-[11px] font-mono font-bold shrink-0">
                  {i + 1}
                </span>
                {item.q}
              </span>
            </AccordionTrigger>
            <AccordionContent className="text-soft-ink text-sm leading-relaxed px-5 pb-4 pt-0">
              {item.a}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  );
}

function CreatorsPage() {
  const { t } = useI18n();

  return (
    <div>
      <section className="relative overflow-hidden pt-8 pb-12 sm:pt-20 sm:pb-24">
        <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
          <div
            className="absolute top-0 right-0 w-[500px] h-[500px] rounded-full"
            style={{
              background: "radial-gradient(circle, rgba(167,243,208,0.18) 0%, transparent 65%)",
            }}
          />
          <div
            className="absolute bottom-0 -left-32 w-[400px] h-[400px] rounded-full"
            style={{
              background: "radial-gradient(circle, rgba(255,181,194,0.12) 0%, transparent 65%)",
            }}
          />
          <div
            className="absolute top-1/2 left-1/3 w-[350px] h-[350px] rounded-full"
            style={{
              background: "radial-gradient(circle, rgba(196,181,253,0.1) 0%, transparent 60%)",
            }}
          />
        </div>

        <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl">
            <span className="inline-block font-mono text-[10px] uppercase tracking-[0.2em] text-brand-mint border-2 border-brand-mint/30 rounded-full px-3 py-1.5 bg-white mb-6">
              For Creators
            </span>
            <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl text-foreground max-w-3xl leading-[1.05] mb-5">
              {t("creators.hero.title")}
            </h1>
            <p className="text-soft-ink text-sm sm:text-base max-w-xl mb-8 leading-relaxed">
              {t("creators.hero.sub")}
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                to="/mission"
                className="inline-flex items-center gap-2 h-13 px-8 rounded-full bg-primary text-primary-foreground font-bold text-sm hover:bg-rose-hover transition-colors"
              >
                <Sparkles className="h-4 w-4" /> {t("creators.hero.cta2")}
              </Link>
              <Link
                to="/login"
                className="inline-flex items-center gap-2 h-13 px-8 rounded-full bg-charcoal text-white font-bold text-sm border-2 border-charcoal hover:bg-ink transition-colors"
              >
                <ShoppingBag className="h-4 w-4" /> Explore Adfoplace
              </Link>
            </div>
          </div>
        </div>
      </section>

      <AffiliatePathwaySection />
      <HowItWorksSection />
      <CreatorLevelsSection />
      <CreatorPassportFullSection />
      <GrowResourcesSection />
      <CreatorFAQSection />

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
                Ready to start your creator journey?
              </h2>
              <p className="text-gray-300 mt-2">
                Join Adfocate. Create your profile, pick your first mission, and start building
                your Creator Passport.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <Link
                to="/mission"
                className="inline-flex items-center justify-center gap-2 h-13 px-7 rounded-full bg-primary text-primary-foreground font-bold text-sm hover:bg-rose-hover transition-colors"
              >
                <Target className="h-4 w-4" /> Browse Missions
              </Link>
              <Link
                to="/contact"
                className="inline-flex items-center justify-center h-13 px-7 rounded-full bg-white text-foreground font-bold text-sm border-2 border-white hover:bg-gray-100 transition-colors"
              >
                Talk to Adfocate
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
