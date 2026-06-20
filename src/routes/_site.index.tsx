import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  Sparkles,
  Target,
  ShoppingBag,
  Trophy,
  Coins,
  Gift,
  Percent,
  Monitor,
  Camera,
  Megaphone,
  Rocket,
  ArrowRight,
  TrendingUp,
  Gem,
  Shield,
  Zap,
  Crown,
  MessageCircle,
} from "lucide-react";
import { creatorLevels, mockCreatorPassport } from "@/data/mockData";
import { legacyActivationServices, localized } from "@/data/legacyAdfocateContent";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";

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

export const Route = createFileRoute("/_site/")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session) throw redirect({ to: "/home" });
  },
  component: Home,
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

const serviceRouteMap = {
  Brands: "/brands",
  Creators: "/creators",
  Earn: "/earn",
  Playbooks: "/playbooks",
} as const;

const monetizationItems = [
  {
    icon: Coins,
    label: "Campaign Fees",
    desc: "Earn per sponsored post, review, or content job",
    color: "text-brand-pink",
  },
  {
    icon: Percent,
    label: "Affiliate Commissions",
    desc: "Earn from sales through your links and codes",
    color: "text-brand-blue",
  },
  {
    icon: Gift,
    label: "Coupon Rewards",
    desc: "Redeem points and rewards from missions",
    color: "text-brand-yellow",
  },
  {
    icon: Monitor,
    label: "Live Commerce",
    desc: "Host live shopping sessions, earn fees + bonuses",
    color: "text-brand-mint",
  },
  {
    icon: Camera,
    label: "UGC Licensing",
    desc: "License your content to brands for ads and usage",
    color: "text-brand-lilac",
  },
  {
    icon: Megaphone,
    label: "Ambassador Retainers",
    desc: "Monthly brand ambassador contracts and retainers",
    color: "text-brand-pink",
  },
  {
    icon: Rocket,
    label: "Product Drops",
    desc: "Launch and sell your own creator product line",
    color: "text-brand-yellow",
  },
  {
    icon: TrendingUp,
    label: "Creator Capital Readiness",
    desc: "Build verified history to unlock future capital options",
    color: "text-brand-mint",
  },
];

function AnimatedBlobs() {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
      <div
        className="absolute top-0 -left-32 w-[500px] h-[500px] rounded-full"
        style={{
          background: "radial-gradient(circle, rgba(255,181,194,0.15) 0%, transparent 70%)",
        }}
      />
      <div
        className="absolute top-1/4 -right-32 w-[450px] h-[450px] rounded-full"
        style={{
          background: "radial-gradient(circle, rgba(167,243,208,0.18) 0%, transparent 70%)",
        }}
      />
      <div
        className="absolute top-1/2 left-1/4 w-[400px] h-[400px] rounded-full"
        style={{
          background: "radial-gradient(circle, rgba(254,240,138,0.15) 0%, transparent 70%)",
        }}
      />
      <div
        className="absolute bottom-0 right-1/3 w-[500px] h-[500px] rounded-full"
        style={{
          background: "radial-gradient(circle, rgba(186,230,253,0.12) 0%, transparent 70%)",
        }}
      />
      <div
        className="absolute top-1/3 left-1/2 w-[350px] h-[350px] rounded-full animate-float-slow"
        style={{
          background: "radial-gradient(circle, rgba(196,181,253,0.12) 0%, transparent 70%)",
        }}
      />
    </div>
  );
}

function ScoreRing({
  score,
  size = 56,
  strokeWidth = 5,
  color = "#FFB5C2",
}: {
  score: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div className="score-ring" style={{ width: size, height: size }}>
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
      <span className="relative font-mono text-sm font-bold text-foreground">{score}</span>
    </div>
  );
}

function HeroSection() {
  return (
    <section className="relative overflow-hidden pt-10 pb-16 sm:pt-20 sm:pb-24">
      <AnimatedBlobs />

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto text-center">
          <span className="sticker mb-7 inline-flex items-center gap-2">
            <Sparkles className="h-3 w-3" /> Adfocate · Creator Growth Platform
          </span>

          <h1 className="font-display text-foreground mb-6 leading-[0.95] tracking-tight">
            From your first review,
            <br />
            <span className="text-secondary">to your first creator business.</span>
          </h1>

          <p className="text-soft-ink text-base sm:text-lg max-w-2xl mx-auto mb-9 leading-relaxed">
            Grow your audience, monetize across eight income streams, and turn verified creator
            performance into future capital — all in one calmly-gamified platform.
          </p>

          <div className="flex flex-wrap justify-center gap-3 mb-10">
            <Link to="/creators" className="btn-primary">
              <Sparkles className="h-4 w-4" /> Join as Creator
            </Link>
            <Link to="/brands" className="btn-ink">
              <Rocket className="h-4 w-4" /> Launch a Campaign
            </Link>
            <Link
              to="/earn"
              className="inline-flex items-center gap-2 px-[22px] py-3 rounded-full bg-white text-foreground font-bold text-sm border-2 border-foreground hover:bg-primary transition-colors"
            >
              <ShoppingBag className="h-4 w-4" /> Explore Adfoplace
            </Link>
          </div>

          <div className="flex flex-wrap justify-center gap-2.5">
            <span className="platform-tag">
              <InstagramIcon className="h-3.5 w-3.5" /> Instagram
            </span>
            <span className="platform-tag">
              <YoutubeIcon className="h-3.5 w-3.5" /> TikTok
            </span>
            <span className="platform-tag">
              <MessageCircle className="h-3.5 w-3.5" /> Xiaohongshu
            </span>
            <span className="platform-tag">
              <Monitor className="h-3.5 w-3.5" /> Facebook
            </span>
          </div>
        </div>

        <DashboardMockVisual />
      </div>
    </section>
  );
}

function PillarsSection() {
  const pillars = [
    {
      to: "/login" as const,
      icon: Target,
      tag: "01 · Grow",
      title: "The Growth Engine",
      desc: "Daily missions, playbooks and a Creator Passport that levels up with every post.",
      accent: "pink",
      ring: "from-brand-pink/20 to-transparent",
    },
    {
      to: "/earn" as const,
      icon: ShoppingBag,
      tag: "02 · Earn",
      title: "Monetization Stack",
      desc: "Eight income streams: campaigns, affiliate, UGC, live, packages, drops & more.",
      accent: "lilac",
      ring: "from-brand-lilac/20 to-transparent",
    },
    {
      to: "/login" as const,
      icon: Gem,
      tag: "03 · Capital",
      title: "Creator Capital",
      desc: "Verified history compounds into readiness for advances and creator finance.",
      accent: "mint",
      ring: "from-brand-mint/20 to-transparent",
    },
    {
      to: "/login" as const,
      icon: Zap,
      tag: "04 · Copilot",
      title: "AI Copilot",
      desc: "Your always-on co-creator: ideas, scripts, briefs, performance feedback.",
      accent: "blue",
      ring: "from-brand-blue/20 to-transparent",
    },
  ];

  return (
    <section className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-20 sm:py-24">
      <div className="text-center mb-12">
        <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-soft-ink">
          The four pillars
        </span>
        <h2 className="font-display text-foreground mt-3 mb-4">One loop. Four pillars.</h2>
        <p className="text-soft-ink max-w-xl mx-auto">
          Each pillar plugs into the next — growth feeds earnings, earnings feed capital, copilot
          speeds it all up.
        </p>
      </div>

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {pillars.map((p, i) => (
          <Link
            key={p.to}
            to={p.to}
            className={cn(
              "group relative overflow-hidden rounded-3xl border border-border bg-white p-6 flex flex-col gap-5 transition-all duration-300",
              "hover:-translate-y-1 hover:shadow-[0_20px_50px_-20px_rgba(255,143,163,0.25)]",
              "stagger-" + (i + 1),
              "animate-slide-up",
            )}
          >
            <div
              className={cn(
                "absolute -top-12 -right-12 h-40 w-40 rounded-full bg-gradient-to-br opacity-70 group-hover:opacity-100 transition-opacity",
                p.ring,
              )}
              aria-hidden="true"
            />
            <div className="relative flex items-center justify-between">
              <span
                className={cn(
                  "inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-" +
                    p.accent +
                    "/10",
                )}
              >
                <p.icon className={cn("h-5 w-5 text-brand-" + p.accent)} />
              </span>
              <span
                className={cn(
                  "font-mono text-[10px] tracking-[0.2em] uppercase text-brand-" + p.accent,
                )}
              >
                {p.tag}
              </span>
            </div>
            <div className="relative flex flex-col gap-2 flex-1">
              <h3 className="font-display text-2xl text-foreground leading-tight">{p.title}</h3>
              <p className="text-sm text-soft-ink leading-relaxed">{p.desc}</p>
            </div>
            <span
              className={cn(
                "relative inline-flex items-center gap-1 text-sm font-semibold group-hover:gap-2 transition-[gap] text-brand-" +
                  p.accent,
              )}
            >
              Explore <ArrowRight className="h-4 w-4" />
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function LegacyProofSection() {
  const { lang } = useI18n();
  const servicePreview = legacyActivationServices.slice(0, 6);

  return (
    <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-14">
      <div className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr] items-start">
        <div className="lg:sticky lg:top-24">
          <span className="inline-block font-mono text-[10px] uppercase tracking-[0.2em] text-brand-blue border-2 border-brand-blue/30 rounded-full px-3 py-1.5 bg-white mb-4">
            {localized({ en: "Built from agency practice", zh: "源自 Adfocate 實戰經驗" }, lang)}
          </span>
          <h2 className="font-display text-3xl sm:text-4xl text-foreground leading-tight">
            {localized(
              {
                en: "Agency expertise, rebuilt as a platform growth loop.",
                zh: "把實戰經驗，重組為平台化增長循環。",
              },
              lang,
            )}
          </h2>
          <p className="text-sm text-soft-ink leading-relaxed mt-4 max-w-md">
            {localized(
              {
                en: "Adfocate keeps the most useful parts of the original Hong Kong agency model: influencer strategy, KOC trials, affiliate programs, social content, and live commerce.",
                zh: "Adfocate 保留香港團隊的實戰經驗，涵蓋 Influencer 策略、KOC 試用、Affiliate 計劃、社交內容及直播商務。",
              },
              lang,
            )}
          </p>
          <Link
            to="/brands"
            className="inline-flex items-center gap-2 mt-6 h-11 px-5 rounded-full bg-white border-2 border-gray-200 text-foreground font-heading font-bold text-sm hover:border-brand-blue/40 transition-colors"
          >
            {localized({ en: "Explore brand activations", zh: "查看品牌活動方案" }, lang)}{" "}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {servicePreview.map((service) => (
            <Link
              key={service.id}
              to={serviceRouteMap[service.modernHome]}
              className="group rounded-2xl border border-gray-200 bg-white p-4 transition-all hover:-translate-y-0.5 hover:border-brand-pink/30 hover:shadow-[0_12px_35px_-22px_rgba(255,143,163,0.35)]"
            >
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-heading font-bold text-sm text-foreground leading-snug">
                  {localized(service.title, lang)}
                </h3>
                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-soft-ink">
                  {service.modernHome}
                </span>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-soft-ink">
                {localized(service.summary, lang)}
              </p>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

function DashboardMockVisual() {
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          obs.disconnect();
        }
      },
      { threshold: 0.2 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const xpPct = Math.round((mockCreatorPassport.xp / mockCreatorPassport.xpNext) * 100);

  return (
    <div ref={ref} className="mt-10 max-w-4xl mx-auto">
      <div className="rounded-2xl bg-white border-2 border-gray-200 p-4 sm:p-6 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between mb-5 pb-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-brand-pink" />
            <span className="h-3 w-3 rounded-full bg-brand-yellow" />
            <span className="h-3 w-3 rounded-full bg-brand-mint" />
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono text-soft-ink uppercase tracking-wider">
              Creator Workspace
            </span>
            <span className="status-live px-2.5 py-1 rounded-full text-[10px] font-mono font-bold uppercase tracking-wider">
              Live Demo
            </span>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="game-card">
            <div className="flex items-center justify-between mb-2">
              <span className="level-pill level-pill-l3">L3 Nano Creator</span>
              <span className="font-mono text-[10px] text-soft-ink">78% to Micro-Influencer</span>
            </div>
            <div className="xp-bar mb-1.5">
              <div className="xp-bar-fill" style={{ width: visible ? `${xpPct}%` : "0%" }} />
            </div>
            <p className="text-[11px] text-soft-ink font-mono">
              {mockCreatorPassport.xp.toLocaleString()} /{" "}
              {mockCreatorPassport.xpNext.toLocaleString()} XP ·{" "}
              {mockCreatorPassport.completedMissions} missions done
            </p>
          </div>

          <div className="game-card flex items-center gap-4">
            <div>
              <p className="text-[10px] font-mono uppercase tracking-wider text-soft-ink mb-0.5">
                Creator Value Index
              </p>
              <p className="font-display text-3xl text-foreground leading-none">
                {Math.round(
                  Object.values(mockCreatorPassport.scores).reduce((a, b) => a + b, 0) / 7,
                )}
              </p>
            </div>
            <div className="ml-auto flex items-center gap-3">
              <ScoreRing
                score={mockCreatorPassport.scores.reliability}
                size={44}
                strokeWidth={4}
                color="#A7F3D0"
              />
              <ScoreRing
                score={mockCreatorPassport.scores.content}
                size={44}
                strokeWidth={4}
                color="#BAE6FD"
              />
              <ScoreRing
                score={mockCreatorPassport.scores.influence}
                size={44}
                strokeWidth={4}
                color="#FFB5C2"
              />
            </div>
          </div>

          <div className="game-card game-card-yellow">
            <div className="flex items-center justify-between mb-1">
              <p className="text-[10px] font-mono uppercase tracking-wider text-soft-ink">
                Pending Earnings
              </p>
              <Coins className="h-4 w-4 text-brand-yellow" />
            </div>
            <p className="font-display text-2xl text-foreground leading-tight">HK$8,450</p>
            <p className="text-[11px] text-brand-mint font-semibold mt-1">
              2 payouts pending approval
            </p>
          </div>

          <div className="game-card game-card-mint">
            <div className="flex items-center justify-between mb-1">
              <p className="text-[10px] font-mono uppercase tracking-wider text-soft-ink">
                Active Mission
              </p>
              <span className="status-live px-2 py-0.5 rounded-full text-[10px] font-mono font-bold">
                Live
              </span>
            </div>
            <p className="font-heading font-bold text-sm text-foreground">Skincare Glow Trial</p>
            <p className="text-xs text-soft-ink mt-0.5">42/100 spots · Draft due May 30</p>
            <div className="xp-bar mt-2">
              <div className="xp-bar-fill" style={{ width: "42%" }} />
            </div>
          </div>

          <div className="game-card game-card-blue">
            <div className="flex items-center justify-between mb-1">
              <p className="text-[10px] font-mono uppercase tracking-wider text-soft-ink">
                Adfoplace Offer
              </p>
              <Percent className="h-4 w-4 text-brand-blue" />
            </div>
            <p className="font-heading font-bold text-sm text-foreground">
              Beauty Bundle Affiliate
            </p>
            <p className="text-base font-bold text-brand-blue mt-1">12% affiliate commission</p>
            <p className="text-[11px] text-soft-ink mt-0.5">Instagram · TikTok · Ends Jun 30</p>
          </div>

          <div className="game-card lg:col-span-2 bg-brand-pink/5 border-brand-pink/20">
            <div className="flex items-start gap-3">
              <div className="h-8 w-8 rounded-full bg-brand-pink/15 flex items-center justify-center shrink-0 mt-0.5">
                <Sparkles className="h-4 w-4 text-brand-pink" />
              </div>
              <div>
                <p className="text-[10px] font-mono uppercase tracking-wider text-brand-pink mb-0.5">
                  Copilot Suggestion
                </p>
                <p className="text-sm text-foreground font-medium leading-relaxed">
                  Post more short-form demos; your beauty reviews convert best. Try a 3-part Reel
                  series for the GlowLab campaign.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8 flex flex-wrap justify-center gap-x-8 gap-y-2 text-xs text-soft-ink">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-brand-pink" /> 5,200+ creators
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-brand-yellow" /> 120+ active campaigns
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-brand-mint" /> 45 offers on Adfoplace
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-brand-lilac" /> Structured workflow
          </span>
        </div>
      </div>
    </div>
  );
}

function GrowthLadderSection() {
  const { t } = useI18n();

  return (
    <section className="relative py-24 overflow-hidden">
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-cream via-background to-cream" />
      <div className="absolute top-1/3 left-0 -z-10 h-72 w-72 rounded-full bg-brand-pink/10 blur-3xl" />
      <div className="absolute bottom-1/4 right-0 -z-10 h-72 w-72 rounded-full bg-brand-lilac/10 blur-3xl" />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-14 max-w-2xl mx-auto">
          <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-brand-pink rounded-full px-3 py-1 bg-brand-pink/10 mb-5">
            <Sparkles className="h-3 w-3" /> Growth Ladder
          </span>
          <h2 className="font-display text-4xl sm:text-5xl tracking-tight text-foreground mb-4 leading-[1.05]">
            {t("home.ladder.heading")}
          </h2>
          <p className="text-soft-ink text-base sm:text-lg leading-relaxed">
            Seven levels, one journey. Start with a simple product mission, earn verified proof, and
            unlock paid jobs, affiliate offers, live commerce, and creator capital.
          </p>
        </div>

        {/* Connector line on desktop */}
        <div className="relative">
          <div className="hidden lg:block absolute top-[88px] left-8 right-8 h-px bg-gradient-to-r from-transparent via-brand-lilac/40 to-transparent" />

          <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 relative">
            {creatorLevels.map((level, i) => (
              <div
                key={level.level}
                className={cn(
                  "group relative flex flex-col items-center text-center gap-3 rounded-3xl bg-white/70 backdrop-blur-sm border border-white p-5 shadow-[0_4px_20px_-8px_rgba(196,181,253,0.25)] hover:shadow-[0_12px_30px_-10px_rgba(255,181,194,0.4)] hover:-translate-y-1 transition-all duration-300",
                  `stagger-${Math.min(i + 1, 8)} animate-slide-up`,
                )}
              >
                <div className="relative">
                  <div className="absolute inset-0 rounded-full bg-gradient-to-br from-brand-pink/20 to-brand-lilac/20 blur-md group-hover:blur-lg transition-all" />
                  <div className="relative flex h-14 w-14 items-center justify-center rounded-full bg-cream text-3xl border border-white shadow-sm">
                    {level.emoji}
                  </div>
                </div>
                <span className="font-mono text-[10px] tracking-[0.18em] text-soft-ink/60">
                  LEVEL {level.level.slice(1)}
                </span>
                <span
                  className={cn(
                    "level-pill text-[10px]",
                    levelPillClass[level.level] ?? "level-pill-l1",
                  )}
                >
                  {level.label}
                </span>
                <p className="text-[11px] text-soft-ink leading-snug font-body">{level.goal}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-12 flex flex-wrap items-center justify-center gap-3">
          <Link
            to="/login"
            className="inline-flex items-center gap-2 rounded-full bg-foreground text-background px-5 py-2.5 text-sm font-semibold hover:bg-foreground/90 transition-colors"
          >
            See the full path <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            to="/creators"
            className="inline-flex items-center gap-2 rounded-full bg-white border border-brand-lilac/30 text-foreground px-5 py-2.5 text-sm font-semibold hover:border-brand-lilac transition-colors"
          >
            Start at L0
          </Link>
        </div>
      </div>
    </section>
  );
}

function CreatorPassportPreview() {
  const { t } = useI18n();
  const passport = mockCreatorPassport;
  const nextLevel = creatorLevels.find(
    (l) => parseInt(l.level.slice(1)) === parseInt(passport.level.slice(1)) + 1,
  );
  const xpPct = Math.round((passport.xp / passport.xpNext) * 100);

  return (
    <section className="py-20 border-y border-gray-200">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
          <div>
            <span className="inline-block font-mono text-[10px] uppercase tracking-[0.2em] text-brand-lilac border-2 border-brand-lilac/30 rounded-full px-3 py-1 bg-white mb-3">
              Identity
            </span>
            <h2 className="font-display text-3xl sm:text-4xl text-foreground">
              {t("home.passport.heading")}
            </h2>
            <p className="text-soft-ink mt-2 max-w-lg">{t("home.passport.sub")}</p>
          </div>
          <Link
            to="/creators"
            className="inline-flex items-center gap-1.5 text-sm font-bold text-brand-pink hover:text-brand-pink/80 transition-colors"
          >
            Build Your Passport <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="game-card p-6 sm:p-8 border-2 border-brand-lilac/30 bg-white">
          <div className="grid gap-6 lg:grid-cols-[1fr_auto]">
            <div className="space-y-5">
              <div className="flex items-center gap-4">
                <div className="h-14 w-14 rounded-full bg-gradient-to-br from-primary to-secondary text-foreground font-display text-xl font-bold">
                  {passport.avatar}
                </div>
                <div>
                  <h3 className="font-heading text-lg font-bold text-foreground">
                    {passport.name}
                  </h3>
                  <span
                    className={cn("level-pill", levelPillClass[passport.level] ?? "level-pill-l3")}
                  >
                    {passport.level} {passport.levelLabel}
                  </span>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-heading font-semibold text-soft-ink">
                    XP Progress
                  </span>
                  <span className="text-[11px] font-mono text-brand-pink font-bold">
                    {passport.xp.toLocaleString()} / {passport.xpNext.toLocaleString()} XP
                  </span>
                </div>
                <div className="xp-bar">
                  <div className="xp-bar-fill" style={{ width: `${xpPct}%` }} />
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {passport.categories.map((cat) => (
                  <span
                    key={cat}
                    className="text-[11px] font-heading font-semibold px-2.5 py-1 rounded-full bg-brand-pink/10 text-brand-pink border border-brand-pink/20"
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

              <div className="grid grid-cols-4 gap-2">
                {(
                  [
                    { key: "content", color: "#BAE6FD" },
                    { key: "reliability", color: "#A7F3D0" },
                    { key: "influence", color: "#FFB5C2" },
                    { key: "brandSafety", color: "#C4B5FD" },
                  ] as const
                ).map(({ key, color }) => (
                  <div key={key} className="flex flex-col items-center gap-1">
                    <ScoreRing
                      score={passport.scores[key as keyof typeof passport.scores]}
                      size={48}
                      strokeWidth={4}
                      color={color}
                    />
                    <span className="text-[9px] font-mono uppercase tracking-wider text-soft-ink">
                      {key.slice(0, 6)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="border-t lg:border-t-0 lg:border-l border-gray-200 pt-4 lg:pt-0 lg:pl-6 flex flex-col gap-4">
              <div className="bg-brand-mint/5 rounded-xl p-4 border border-brand-mint/20">
                <p className="text-[10px] font-mono uppercase tracking-wider text-brand-mint mb-1">
                  Next Unlock
                </p>
                <p className="font-heading font-bold text-sm text-foreground">
                  {nextLevel?.label ?? "Higher Level"}
                </p>
                <p className="text-xs text-soft-ink mt-0.5">
                  {(passport.xpNext - passport.xp).toLocaleString()} XP to go
                </p>
              </div>
              <div className="rounded-xl p-4 bg-white border border-gray-200">
                <p className="text-[10px] font-mono uppercase tracking-wider text-soft-ink mb-2">
                  Top Strengths
                </p>
                <ul className="space-y-1">
                  {passport.strengths.map((s) => (
                    <li key={s} className="text-xs text-foreground flex items-center gap-1.5">
                      <Trophy className="h-3 w-3 text-brand-yellow shrink-0" /> {s}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="mt-auto text-center">
                <p className="text-[10px] font-mono uppercase tracking-wider text-soft-ink mb-1">
                  Brand Feedback
                </p>
                <p className="font-display text-2xl text-foreground">{passport.brandFeedback}%</p>
                <p className="text-[11px] text-brand-mint font-semibold">Positive</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function MonetizationStackSection() {
  const { t } = useI18n();

  return (
    <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-20">
      <div className="text-center mb-10">
        <span className="inline-block font-mono text-[10px] uppercase tracking-[0.2em] text-brand-yellow border-2 border-brand-yellow/30 rounded-full px-3 py-1 bg-white mb-4">
          Earn
        </span>
        <h2 className="font-display text-3xl sm:text-4xl text-foreground mb-4">
          {t("home.monetization.heading")}
        </h2>
        <p className="text-soft-ink max-w-xl mx-auto">
          Every creator income stream unlocked through verified growth on Adfocate.
        </p>
      </div>

      <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
        {monetizationItems.map((item, i) => (
          <div
            key={item.label}
            className={cn(
              "game-card flex flex-col items-center text-center gap-3",
              "stagger-" + Math.min(i + 1, 8),
              "animate-slide-up",
            )}
          >
            <span
              className={cn(
                "inline-flex h-11 w-11 items-center justify-center rounded-xl bg-white border-2 border-gray-100",
                item.color,
              )}
            >
              <item.icon className="h-5 w-5" />
            </span>
            <div>
              <p className="font-heading font-bold text-sm text-foreground">
                {t(`home.monetization.${i + 1}` as keyof ReturnType<typeof useI18n>["t"])}
              </p>
              <p className="text-[11px] text-soft-ink mt-0.5 leading-snug">{item.label}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function BrandValueSection() {
  const { t } = useI18n();

  return (
    <section className="py-20 border-y border-gray-200">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="font-display text-3xl sm:text-4xl text-foreground mb-5">
            {t("home.brands.heading")}
          </h2>
          <p className="text-soft-ink leading-relaxed mb-8">
            Brands work with creators whose reliability, content quality, audience fit, conversion
            history, and brand safety are visible through verified platform data — not just follower
            counts.
          </p>

          <div className="flex flex-wrap justify-center gap-3">
            {[
              {
                label: "92% Audience Fit",
                color: "bg-brand-mint/10 text-brand-mint border-brand-mint/20",
              },
              {
                label: "98% Brand Safety",
                color: "bg-brand-lilac/10 text-brand-lilac border-brand-lilac/20",
              },
              {
                label: "8.4/10 Content Quality",
                color: "bg-brand-blue/10 text-brand-blue border-brand-blue/20",
              },
              {
                label: "4.8% Avg Engagement",
                color: "bg-brand-pink/10 text-brand-pink border-brand-pink/20",
              },
              {
                label: "3.2% Conversion",
                color: "bg-brand-yellow/10 text-yellow-700 border-brand-yellow/20",
              },
            ].map((m) => (
              <span
                key={m.label}
                className={cn(
                  "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-heading font-bold border",
                  m.color,
                )}
              >
                <Zap className="h-3 w-3" /> {m.label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function FinalCTASection() {
  const { t } = useI18n();

  return (
    <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-20">
      <div
        className="relative rounded-[2rem] overflow-hidden p-8 sm:p-12 lg:p-16 shadow-[0_30px_80px_-30px_rgba(42,31,34,0.5)]"
        style={{ background: "linear-gradient(135deg, #2A1F22 0%, #3D2C2C 50%, #2A1F22 100%)" }}
      >
        <div
          aria-hidden="true"
          className="absolute top-0 right-0 w-[400px] h-[400px] rounded-full pointer-events-none"
          style={{
            background: "radial-gradient(circle, rgba(255,181,194,0.28) 0%, transparent 60%)",
          }}
        />
        <div
          aria-hidden="true"
          className="absolute bottom-0 left-0 w-[400px] h-[400px] rounded-full pointer-events-none"
          style={{
            background: "radial-gradient(circle, rgba(167,243,208,0.22) 0%, transparent 60%)",
          }}
        />
        <div
          className="absolute inset-0 opacity-[0.04] pointer-events-none"
          style={{
            backgroundImage: "radial-gradient(circle, #FFFFFF 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        />

        <div className="relative grid gap-8 lg:grid-cols-[1fr_auto] items-center">
          <div>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-brand-yellow uppercase tracking-[0.22em] mb-4 bg-white/10 backdrop-blur rounded-full px-3 py-1.5 border border-white/10">
              <Sparkles className="h-3.5 w-3.5" /> Adfocate
            </span>
            <h2 className="font-display text-3xl sm:text-4xl lg:text-5xl text-white leading-[1.05] tracking-tight">
              {t("home.final.heading")}
            </h2>
            <p className="text-white/70 mt-4 max-w-md text-base leading-relaxed">
              Join thousands of creators growing from KOC missions to real creator businesses — or
              work with verified creators on brand campaigns.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row lg:flex-col gap-3">
            <Link
              to="/creators"
              className="inline-flex items-center justify-center gap-2 h-12 px-7 rounded-full bg-white text-foreground font-semibold text-sm hover:bg-cream transition-colors shadow-lg"
            >
              <Crown className="h-4 w-4 text-brand-pink" /> {t("home.final.start")}
            </Link>
            <Link
              to="/contact"
              className="inline-flex items-center justify-center h-12 px-7 rounded-full bg-transparent text-white font-semibold text-sm border border-white/30 hover:border-white hover:bg-white/5 transition-colors"
            >
              {t("home.final.talk")}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function SocialProofStrip() {
  const stats = [
    { value: "5,200+", label: "Creators" },
    { value: "120+", label: "Brand campaigns" },
    { value: "8", label: "Income streams" },
    { value: "98%", label: "Brand-safe rating" },
  ];
  return (
    <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12">
      <div className="rounded-3xl bg-white border-2 border-foreground shadow-[6px_6px_0_0_#0A0A0A] px-6 py-8 sm:px-10">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 sm:gap-4">
          {stats.map((s) => (
            <div key={s.label} className="text-center">
              <div className="font-display text-3xl sm:text-4xl tracking-tight text-foreground font-bold">
                {s.value}
              </div>
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-soft-ink mt-1.5 font-bold">
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Home() {
  return (
    <div>
      <HeroSection />
      <SocialProofStrip />
      <PillarsSection />
      <LegacyProofSection />
      <GrowthLadderSection />
      <CreatorPassportPreview />
      <MonetizationStackSection />
      <BrandValueSection />
      <FinalCTASection />
    </div>
  );
}
