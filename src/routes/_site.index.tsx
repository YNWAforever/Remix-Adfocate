import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import {
  Sparkles,
  Target,
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
  MessageCircle,
  Compass,
  Wallet,
  Check,
} from "lucide-react";
import { mockCreatorPassport } from "@/data/mockData";
import { LEVELS, progressToNext } from "@/lib/levels";
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

// Eight income streams (full set preserved from the legacy monetization grid).
const monetizationItems = [
  { icon: Coins, label: "Earn per sponsored post, review, or content job" },
  { icon: Percent, label: "Earn from sales through your links and codes" },
  { icon: Gift, label: "Redeem points and rewards from missions" },
  { icon: Monitor, label: "Host live shopping sessions, earn fees + bonuses" },
  { icon: Camera, label: "License your content to brands for ads and usage" },
  { icon: Megaphone, label: "Monthly brand ambassador contracts and retainers" },
  { icon: Rocket, label: "Launch and sell your own creator product line" },
  { icon: TrendingUp, label: "Build verified history to unlock future capital" },
];

function ScoreRing({
  score,
  size = 56,
  strokeWidth = 5,
  color = "#FF3D7F",
  track = "#2A2A2A",
  textClass = "text-foreground",
}: {
  score: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  track?: string;
  textClass?: string;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div className="score-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="absolute inset-0">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={track} strokeWidth={strokeWidth} />
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
      <span className={cn("relative font-mono text-sm font-bold", textClass)}>{score}</span>
    </div>
  );
}

/* ───────────────────────── 1. HERO — off-grid editorial ───────────────────────── */
function HeroSection() {
  const { t, lang } = useI18n();
  const tx = (en: string, zh: string) => (lang === "en" ? en : zh);
  const passport = mockCreatorPassport;
  const progress = progressToNext(passport.xp);
  const xpPct = progress.pct;

  return (
    <section className="relative overflow-hidden bg-[var(--color-paper)]">
      <div className="dot-pattern absolute inset-0 opacity-60" aria-hidden="true" />
      <div className="relative mx-auto max-w-6xl px-4 pt-14 pb-16 sm:pt-20 sm:pb-24">
        <div className="grid items-center gap-10 lg:grid-cols-[1.15fr_0.85fr]">
          {/* Editorial column — anchored left, off-grid */}
          <div className="max-w-2xl">
            <span className="sticker mb-6 inline-flex items-center gap-2">
              <Sparkles className="h-3 w-3" /> KOCMAX × ADFOCATE
            </span>
            <h1 className="font-display text-[var(--color-ink)] mb-5 leading-[0.95] tracking-tight">
              {tx("From first review to creator business.", "由第一篇開箱，做到創作者事業。")}
            </h1>
            <p className="text-[var(--color-soft-ink)] text-base sm:text-lg max-w-xl mb-8 leading-relaxed">
              {tx(
                "Explore the mission workflow: join, deliver, revise and submit proof. Reviewed completion creates a pending reward; payment is separate and unavailable in this pilot.",
                "了解任務流程：加入、交付、修稿及提交證明。完成審核後會有待處理獎勵；付款是另一流程，尚未開通。",
              )}
            </p>
            <div className="flex flex-wrap gap-3">
              <Link to="/creators" className="btn-primary">
                <Sparkles className="h-4 w-4" /> {tx("Join as Creator", "成為創作者")}
              </Link>
              <Link to="/brands" className="btn-ink">
                <Rocket className="h-4 w-4" /> {tx("For Brands", "品牌方案")}
              </Link>
            </div>

            <div className="mt-7 flex flex-wrap gap-2.5">
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

          {/* Artifact — passport/level card mock, the concept anchor */}
          <div className="relative lg:justify-self-end">
            <span
              className="absolute -top-4 -left-3 z-10 tag-mono rotate-[-4deg] bg-[var(--color-acid)]"
            >
              {tx("Illustrative profile · fictional data", "示範履歷 · 虛構資料")}
            </span>
            <div className="pastel-card animate-float w-full max-w-sm p-6">
              <div className="flex items-center gap-3">
                <div className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] font-display text-lg font-bold text-[var(--color-ink)]">
                  {passport.avatar}
                </div>
                <div>
                  <p className="font-heading text-base font-bold text-[var(--color-ink)]">{passport.name}</p>
                  <span className={cn("level-pill", levelPillClass[passport.level] ?? "level-pill-l3")}>
                    {progress.current.id} {t(progress.current.labelKey)}
                  </span>
                </div>
              </div>

              <div className="mt-5">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-soft-ink)]">
                    {tx("XP Progress", "經驗進度")}
                  </span>
                  <span className="font-mono text-[11px] font-bold text-[var(--color-magenta)]">
                    {passport.xp.toLocaleString()} / {passport.xpNext.toLocaleString()}
                  </span>
                </div>
                <div className="xp-bar">
                  <div className="xp-bar-fill" style={{ width: `${xpPct}%` }} />
                </div>
              </div>

              <div className="mt-5 flex items-center justify-between">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-soft-ink)]">
                    {tx("Illustrative pending reward · not payment", "示範待處理獎勵 · 並非付款")}
                  </p>
                  <p className="font-display text-xl text-[var(--color-ink)]">HK$8,450</p>
                </div>
                <span className="metric-badge metric-up">+18%</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ───────────────────── Social proof strip (folded-in legacy content) ───────────────────── */
function SocialProofStrip() {
  const { lang } = useI18n();
  const tx = (en: string, zh: string) => (lang === "en" ? en : zh);
  const stats = [
    { value: tx("Preview", "預覽"), label: tx("Illustrative profiles", "示範履歷") },
    { value: tx("Pending", "待處理"), label: tx("Reward handoff", "獎勵交接") },
    { value: tx("Separate", "獨立核實"), label: tx("Account ownership", "帳號擁有權") },
    { value: tx("Unavailable", "未開通"), label: tx("Payments and withdrawals", "付款及提現") },
  ];
  return (
    <section className="mx-auto max-w-6xl px-4 -mt-6 mb-4">
      <div className="rounded-3xl border-2 border-[var(--color-ink)] bg-[var(--color-card)] px-6 py-8 shadow-[6px_6px_0_0_var(--color-ink)] sm:px-10">
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-4 sm:gap-4">
          {stats.map((s) => (
            <div key={s.label} className="text-center">
              <div className="font-display text-3xl font-bold tracking-tight text-[var(--color-ink)] sm:text-4xl">
                {s.value}
              </div>
              <div className="mt-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-soft-ink)]">
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────── 2. FOUR PILLARS — gapless bento 2×2 ───────────────────────── */
function PillarsSection() {
  const { lang } = useI18n();
  const tx = (en: string, zh: string) => (lang === "en" ? en : zh);

  // Phase-1 stopgap: Grow / Capital / Copilot pillars have no dedicated public
  // pages yet, so their CTAs point at /login (the join/enter funnel) and /earn.
  const pillars = [
    {
      to: "/login" as const,
      icon: Target,
      tag: "01 · Earn Loop",
      title: tx("The Earn Loop", "賺取循環"),
      desc: tx("Approved mission completion can create a pending reward, not a payment.", "任務完成審核後可建立待處理獎勵，並不等於付款。"),
      variant: "game-card-mint",
    },
    {
      to: "/login" as const,
      icon: TrendingUp,
      tag: "02 · Leveling",
      title: tx("Leveling Engine", "升級引擎"),
      desc: tx("XP follows the applicable mission approval rules.", "XP 按各任務適用的審核規則計算。"),
      variant: "game-card-yellow",
    },
    {
      to: "/creators" as const,
      icon: Gem,
      tag: "03 · Passport",
      title: tx("Creator Passport", "創作者履歷"),
      desc: tx("Scores use mission and account data; ownership status is shown separately.", "評分採用任務及帳號資料，擁有權狀態會獨立顯示。"),
      variant: "game-card-blue",
    },
    {
      to: "/earn" as const,
      icon: Compass,
      tag: "04 · Matcher",
      title: tx("Mission Matcher", "任務配對"),
      desc: tx("Get matched to the right missions, ranked by fit.", "按合適度配對最啱你嘅任務。"),
      variant: "magenta",
    },
  ];

  return (
    <section className="mx-auto max-w-6xl px-4 py-16 md:py-20">
      <div className="mb-10 max-w-xl">
        <span className="tag-mono">{tx("The Platform", "平台基石")}</span>
        <h2 className="mt-4 font-display text-[var(--color-ink)]">{tx("One loop. Four pillars.", "一個循環，四大基石。")}</h2>
        <p className="mt-3 text-[var(--color-soft-ink)]">
          {tx(
            "Each pillar plugs into the next — earn feeds leveling, leveling builds your passport, the matcher keeps work flowing.",
            "每個基石互相扣連 —— 賺取推動升級，升級建立履歷，配對令工作源源不絕。",
          )}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {pillars.map((p, i) => (
          <Link
            key={p.tag}
            to={p.to}
            className={cn(
              "game-card group flex flex-col gap-4 p-6",
              p.variant !== "magenta" && p.variant,
              p.variant === "magenta" && "hover:shadow-[6px_6px_0_0_var(--color-magenta-pop)]",
              `stagger-${i + 1} animate-slide-up`,
            )}
          >
            <div className="flex items-center justify-between">
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl border-2 border-[var(--color-ink)] bg-[var(--color-card)]">
                <p.icon className="h-5 w-5 text-[var(--color-ink)]" />
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-soft-ink)]">
                {p.tag}
              </span>
            </div>
            <div className="flex flex-1 flex-col gap-2">
              <h3 className="font-display text-2xl leading-tight text-[var(--color-ink)]">{p.title}</h3>
              <p className="text-sm leading-relaxed text-[var(--color-soft-ink)]">{p.desc}</p>
            </div>
            <span className="inline-flex items-center gap-1 text-sm font-bold text-[var(--color-ink)] transition-[gap] group-hover:gap-2">
              {tx("Explore", "了解更多")} <ArrowRight className="h-4 w-4" />
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

/* ───────────────────────── 3. GROWTH LADDER — journey spine ───────────────────────── */
function GrowthLadderSection() {
  const { t, lang } = useI18n();
  const tx = (en: string, zh: string) => (lang === "en" ? en : zh);

  return (
    <section className="bg-[var(--color-card)] py-16 md:py-20">
      <div className="mx-auto max-w-6xl px-4">
        <div className="mb-12 max-w-2xl">
          <span className="sticker">{tx("Level up to unlock", "升級解鎖更多")}</span>
          <h2 className="mt-4 font-display text-[var(--color-ink)]">{t("home.ladder.heading")}</h2>
          <p className="mt-3 text-[var(--color-soft-ink)]">{t("home.ladder.sub")}</p>
        </div>

        {/* Connecting segmented rule */}
        <div className="mb-8 hidden md:block">
          <div className="segmented-bar">
            {LEVELS.map((l, i) => (
              <span key={l.id} className={i <= 3 ? "active" : "inactive"} />
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {LEVELS.map((level, i) => (
            <div
              key={level.id}
              className={cn(
                "pastel-card flex flex-col items-center gap-2.5 p-4 text-center",
                `stagger-${Math.min(i + 1, 8)} animate-slide-up`,
              )}
            >
              <span className="text-2xl" aria-hidden="true">
                {level.emoji}
              </span>
              <span className="font-mono text-[9px] tracking-[0.18em] text-[var(--color-soft-ink)]">
                LEVEL {level.id.slice(1)}
              </span>
              <span className={cn("level-pill text-[10px]", levelPillClass[level.id] ?? "level-pill-l1")}>
                {t(level.labelKey)}
              </span>
              <p className="font-body text-[11px] leading-snug text-[var(--color-soft-ink)]">{level.goal}</p>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-wrap gap-3">
          <Link to="/login" className="btn-ink">
            {tx("See the full path", "睇完整路徑")} <ArrowRight className="h-4 w-4" />
          </Link>
          <Link to="/creators" className="btn-primary">
            {tx("Start at L0", "由 L0 開始")}
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ───────── 4. CREATOR PASSPORT — the ONE ink section + second-read moment ───────── */
function CreatorPassportSection() {
  const { t, lang } = useI18n();
  const tx = (en: string, zh: string) => (lang === "en" ? en : zh);
  const passport = mockCreatorPassport;
  const nextLevel = LEVELS.find(
    (l) => parseInt(l.id.slice(1)) === parseInt(passport.level.slice(1)) + 1,
  );
  const progress = progressToNext(passport.xp);
  const xpPct = progress.pct;

  const rings = [
    { key: "reliability", color: "#D4FF00", label: tx("Reliability", "可靠度") },
    { key: "influence", color: "#FF3D7F", label: tx("Influence", "影響力") },
    { key: "content", color: "#00E5FF", label: tx("Content", "內容") },
    { key: "brandSafety", color: "#7C5CFF", label: tx("Brand Safety", "品牌安全") },
  ] as const;

  return (
    <section className="relative overflow-hidden bg-[var(--color-ink)] py-16 text-[var(--color-paper)] md:py-24">
      {/* Second-read moment: one oversized stroked numeral */}
      <span
        className="text-outline-mint pointer-events-none absolute -right-6 top-2 select-none font-display text-[180px] leading-none opacity-40 sm:text-[260px] md:text-[320px]"
        aria-hidden="true"
      >
        {passport.level}
      </span>

      <div className="relative mx-auto max-w-6xl px-4">
        <div className="grid items-center gap-10 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="max-w-md">
            <span className="tag-mono bg-[var(--color-acid)]">{tx("Your Identity", "你嘅身份")}</span>
            <h2 className="mt-4 font-display text-[var(--color-paper)]">{t("home.passport.heading")}</h2>
            <p className="mt-3 text-[var(--color-paper)]/70">{t("home.passport.sub")}</p>

            <div className="mt-6 flex flex-wrap gap-1.5">
              {passport.badges.slice(0, 3).map((b) => (
                <span
                  key={b}
                  className="inline-flex items-center gap-1 rounded-full border border-[var(--color-acid)]/40 bg-[var(--color-acid)]/10 px-2.5 py-1 font-mono text-[10px] font-semibold text-[var(--color-acid)]"
                >
                  <Shield className="h-3 w-3" /> {b}
                </span>
              ))}
            </div>

            <Link
              to="/creators"
              className="mt-7 inline-flex items-center gap-2 rounded-full border-2 border-[var(--color-acid)] bg-transparent px-5 py-2.5 text-sm font-bold text-[var(--color-acid)] transition-colors hover:bg-[var(--color-acid)] hover:text-[var(--color-ink)]"
            >
              {tx("Build Your Passport", "建立你嘅履歷")} <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          {/* Passport artifact card on dark */}
          <div className="rounded-[1.5rem] border-2 border-[var(--color-acid)]/30 bg-[var(--color-ink)]/60 p-6 backdrop-blur-sm sm:p-8">
            <p className="mb-3 text-sm text-[var(--color-acid)]">{tx("Illustrative profile · fictional data", "示範履歷 · 虛構資料")}</p>
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-[var(--color-acid)] bg-[var(--color-acid)] font-display text-xl font-bold text-[var(--color-ink)]">
                {passport.avatar}
              </div>
              <div>
                <h3 className="font-heading text-lg font-bold text-[var(--color-paper)]">{passport.name}</h3>
                <span className={cn("level-pill", levelPillClass[passport.level] ?? "level-pill-l3")}>
                  {progress.current.id} {t(progress.current.labelKey)}
                </span>
              </div>
            </div>

            <div className="mt-5">
              <div className="mb-1 flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-paper)]/60">
                  {tx("XP Progress", "經驗進度")}
                </span>
                <span className="font-mono text-[11px] font-bold text-[var(--color-acid)]">
                  {passport.xp.toLocaleString()} / {passport.xpNext.toLocaleString()}
                </span>
              </div>
              <div className="xp-bar">
                <div className="xp-bar-fill" style={{ width: `${xpPct}%` }} />
              </div>
            </div>

            <div className="mt-6 grid grid-cols-4 gap-2">
              {rings.map(({ key, color, label }) => (
                <div key={key} className="flex flex-col items-center gap-1.5">
                  <ScoreRing
                    score={passport.scores[key]}
                    size={52}
                    strokeWidth={4}
                    color={color}
                    track="#2A2A2A"
                    textClass="text-[var(--color-paper)]"
                  />
                  <span className="text-center font-mono text-[8px] uppercase tracking-wider text-[var(--color-paper)]/55">
                    {label}
                  </span>
                </div>
              ))}
            </div>

            <div className="mt-6 flex items-center justify-between rounded-xl border border-[var(--color-acid)]/20 bg-[var(--color-acid)]/5 p-4">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-acid)]">
                  {tx("Next Unlock", "下一個解鎖")}
                </p>
                <p className="font-heading text-sm font-bold text-[var(--color-paper)]">
                  {nextLevel ? t(nextLevel.labelKey) : tx("Higher Level", "更高等級")}
                </p>
              </div>
              <p className="font-mono text-xs text-[var(--color-paper)]/70">
                {(passport.xpNext - passport.xp).toLocaleString()} XP {tx("to go", "差距")}
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ───────────────────── 5. MONETIZATION STACK — stacked storytelling ───────────────────── */
function MonetizationStackSection() {
  const { t, lang } = useI18n();
  const tx = (en: string, zh: string) => (lang === "en" ? en : zh);

  return (
    <section className="mx-auto max-w-6xl px-4 py-16 md:py-20">
      <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="lg:sticky lg:top-24 lg:self-start">
          <span className="tag-mono">{tx("Earn", "賺取收入")}</span>
          <h2 className="mt-4 font-display text-[var(--color-ink)]">{t("home.monetization.heading")}</h2>
          <p className="mt-3 text-[var(--color-soft-ink)]">
            {tx(
              "Illustrative reward concepts. The pilot records pending rewards after review; pending reward is not payment. Payments, withdrawals and automatic affiliate commissions are unavailable.",
              "獎勵概念示範。試行版在審核後記錄待處理獎勵，並不等於付款；付款、提現及自動佣金尚未開通。",
            )}
          </p>
        </div>

        {/* Stacked tiers — cash wallet is the hero of the stack */}
        <div className="flex flex-col gap-4">
          <div className="pastel-card flex items-start gap-4 p-5">
            <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border-2 border-[var(--color-ink)] bg-[var(--color-card)]">
              <Gift className="h-5 w-5 text-[var(--color-ink)]" />
            </span>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-soft-ink)]">
                {tx("Layer 01", "第一層")}
              </p>
              <h3 className="font-heading text-lg font-bold text-[var(--color-ink)]">
                {tx("Points Store", "積分商店")}
              </h3>
              <p className="mt-1 text-sm text-[var(--color-soft-ink)]">
                {tx("Redeem mission points for rewards, coupons and product drops.", "用任務積分換取獎勵、優惠券同產品。")}
              </p>
            </div>
          </div>

          <div className="pastel-card flex items-start gap-4 p-5">
            <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border-2 border-[var(--color-ink)] bg-[var(--color-card)]">
              <Percent className="h-5 w-5 text-[var(--color-ink)]" />
            </span>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-soft-ink)]">
                {tx("Layer 02", "第二層")}
              </p>
              <h3 className="font-heading text-lg font-bold text-[var(--color-ink)]">
                {tx("Affiliate Commission", "聯盟佣金")}
              </h3>
              <p className="mt-1 text-sm text-[var(--color-soft-ink)]">
                {tx("Earn a cut of every sale made through your links and codes.", "每筆透過你連結同優惠碼成交嘅銷售都有分成。")}
              </p>
            </div>
          </div>

          {/* Cash wallet — the hero tier */}
          <div className="wallet-card p-6">
            <div className="relative flex items-start justify-between">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-acid)]">
                  {tx("Layer 03 · Cash Wallet", "第三層 · 現金錢包")}
                </p>
                <h3 className="mt-1 font-display text-3xl text-[var(--color-paper)]">HK$28,450</h3>
                <p className="mt-1 font-mono text-xs text-[var(--color-paper)]/60">
                  {tx("Illustrative amount · no withdrawals", "示範金額 · 不可提現")}
                </p>
              </div>
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl border-2 border-[var(--color-acid)] bg-[var(--color-acid)]/15">
                <Wallet className="h-5 w-5 text-[var(--color-acid)]" />
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Folded-in legacy content: the full eight income streams */}
      <div className="mt-12">
        <p className="mb-4 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-soft-ink)]">
          {tx("Eight ways creators earn", "創作者嘅八種收入")}
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {monetizationItems.map((item, i) => (
            <div
              key={item.label}
              className={cn(
                "pastel-card flex flex-col items-center gap-3 p-4 text-center",
                `stagger-${Math.min(i + 1, 8)} animate-slide-up`,
              )}
            >
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl border-2 border-[var(--color-ink)] bg-[var(--color-card)]">
                <item.icon className="h-5 w-5 text-[var(--color-ink)]" />
              </span>
              <div>
                <p className="font-heading text-sm font-bold text-[var(--color-ink)]">
                  {t(`home.monetization.${i + 1}`)}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────────── 6. TWO-SIDED DIPTYCH — color-blocked split ─────────────── */
function TwoSidedDiptychSection() {
  const { t, lang } = useI18n();
  const tx = (en: string, zh: string) => (lang === "en" ? en : zh);
  const servicePreview = legacyActivationServices.slice(0, 4);

  return (
    <section className="mx-auto max-w-6xl px-4 py-16 md:py-20">
      <div className="overflow-hidden rounded-[1.5rem] border-2 border-[var(--color-ink)] shadow-[6px_6px_0_0_var(--color-ink)]">
        <div className="grid md:grid-cols-2">
          {/* Creators — acid field */}
          <div className="flex flex-col gap-5 bg-[var(--color-acid)] p-8 sm:p-10">
            <span className="tag-mono w-fit">{tx("For Creators", "創作者")}</span>
            <h2 className="font-display text-[var(--color-ink)]">{tx("創作者", "創作者")}</h2>
            <p className="max-w-sm text-[var(--color-ink)]/80">
              {tx(
                "Start with simple product missions, build verified proof, and grow into paid campaigns, affiliate offers and live commerce.",
                "由簡單嘅產品任務開始，累積驗證證明，成長至付費活動、聯盟優惠同直播帶貨。",
              )}
            </p>
            <Link
              to="/creators"
              className="mt-2 inline-flex w-fit items-center gap-2 rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-ink)] px-5 py-2.5 text-sm font-bold text-[var(--color-acid)] transition-transform hover:-translate-y-0.5"
            >
              {tx("Join as Creator", "成為創作者")} <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          {/* Brands — violet field */}
          <div className="flex flex-col gap-5 bg-[var(--color-violet)] p-8 text-[var(--color-paper)] sm:p-10">
            <span className="tag-mono w-fit">{tx("For Brands", "品牌方")}</span>
            <h2 className="font-display text-[var(--color-paper)]">{tx("品牌", "品牌")}</h2>
            <p className="max-w-sm text-[var(--color-paper)]/85">{t("home.brands.sub")}</p>
            <div className="flex flex-wrap gap-1.5">
              {servicePreview.map((service) => (
                <Link
                  key={service.id}
                  to={serviceRouteMap[service.modernHome]}
                  className="rounded-full border border-[var(--color-paper)]/30 bg-[var(--color-paper)]/10 px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-[var(--color-paper)] transition-colors hover:bg-[var(--color-paper)]/20"
                >
                  {localized(service.title, lang)}
                </Link>
              ))}
            </div>
            <Link
              to="/brands"
              className="mt-2 inline-flex w-fit items-center gap-2 rounded-full border-2 border-[var(--color-paper)] bg-[var(--color-paper)] px-5 py-2.5 text-sm font-bold text-[var(--color-ink)] transition-transform hover:-translate-y-0.5"
            >
              {tx("Explore brand activations", "查看品牌活動方案")} <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </div>

      <p className="mt-8 text-center text-sm">{tx("Illustrative metrics · not platform results", "示範數據 · 並非平台實績")}</p>
      {/* Illustrative metrics; no production performance evidence. */}
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        {[
          { label: tx("92% Audience Fit", "92% 受眾匹配") },
          { label: tx("98% Brand Safety", "98% 品牌安全") },
          { label: tx("8.4/10 Content Quality", "8.4/10 內容品質") },
          { label: tx("4.8% Avg Engagement", "4.8% 平均互動") },
          { label: tx("3.2% Conversion", "3.2% 轉化率") },
        ].map((m) => (
          <span key={m.label} className="metric-badge metric-up">
            <Zap className="h-3 w-3" /> {m.label}
          </span>
        ))}
      </div>
    </section>
  );
}

/* ───────────────────────── 7. FINAL CTA — banner-style acid block ───────────────────────── */
function FinalCTASection() {
  const { t, lang } = useI18n();
  const tx = (en: string, zh: string) => (lang === "en" ? en : zh);

  return (
    <section className="mx-auto max-w-6xl px-4 py-16 md:py-20">
      <div className="relative overflow-hidden rounded-[1.5rem] border-2 border-[var(--color-ink)] bg-[var(--color-acid)] p-8 text-center shadow-[6px_6px_0_0_var(--color-ink)] sm:p-12 lg:p-16">
        <div className="dot-pattern absolute inset-0 opacity-30" aria-hidden="true" />
        <div className="relative mx-auto max-w-2xl">
          <span className="tag-mono">{tx("Get Started", "立即開始")}</span>
          <h2 className="mt-5 font-display text-[var(--color-ink)]">{t("home.final.heading")}</h2>
          <p className="mx-auto mt-4 max-w-md text-[var(--color-ink)]/80">
            {tx(
              "Explore the creator workflow preview, from joining a mission to a reviewed pending reward.",
              "加入數以千計嘅香港創作者，把 KOC 任務變成真正嘅創作者事業 —— 或者同經驗證嘅創作者合作你下一個活動。",
            )}
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link to="/creators" className="btn-ink">
              <Sparkles className="h-4 w-4" /> {t("home.final.start")}
            </Link>
            <Link
              to="/contact"
              className="inline-flex items-center gap-2 rounded-full border-2 border-[var(--color-ink)] bg-transparent px-[22px] py-3 text-sm font-bold text-[var(--color-ink)] transition-colors hover:bg-[var(--color-ink)] hover:text-[var(--color-acid)]"
            >
              {t("home.final.talk")}
            </Link>
          </div>
          <p className="mt-6 inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-ink)]/70">
            <Check className="h-3.5 w-3.5" /> {tx("Free to join · No contract · Hong Kong", "免費加入 · 無合約 · 香港")}
          </p>
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
      <GrowthLadderSection />
      <CreatorPassportSection />
      <MonetizationStackSection />
      <TwoSidedDiptychSection />
      <FinalCTASection />
    </div>
  );
}
