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
import { LEVELS } from "@/lib/levels";
import { legacyActivationServices, localized } from "@/data/legacyAdfocateContent";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { type Audience } from "@/components/marketing/AudienceToggle";
import { useHomeAudience } from "@/components/marketing/homeAudience";
import { BrandView, BrandHeroCard } from "@/components/marketing/BrandView";

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

/* ───────── Creator hero artifact — passport/level card mock ───────── */
function CreatorHeroCard() {
  const { lang } = useI18n();
  const tx = (en: string, zh: string) => (lang === "en" ? en : zh);
  const passport = mockCreatorPassport;
  const xpPct = Math.round((passport.xp / passport.xpNext) * 100);

  return (
    <div className="relative lg:justify-self-end">
      <span
        className="absolute -top-4 -left-3 z-10 tag-mono rotate-[-4deg] bg-[var(--color-acid)]"
        aria-hidden="true"
      >
        Live Passport
      </span>
      <div className="pastel-card animate-float w-full max-w-sm p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] font-display text-lg font-bold text-[var(--color-ink)]">
            {passport.avatar}
          </div>
          <div>
            <p className="font-heading text-base font-bold text-[var(--color-ink)]">{passport.name}</p>
            <span className={cn("level-pill", levelPillClass[passport.level] ?? "level-pill-l3")}>
              {passport.level} {passport.levelLabel}
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
              {tx("Pending earnings", "待結算收入")}
            </p>
            <p className="font-display text-xl text-[var(--color-ink)]">HK$8,450</p>
          </div>
          <span className="metric-badge metric-up">+18%</span>
        </div>
      </div>
      <p className="mt-3 text-right font-mono text-[10px] uppercase tracking-wider text-[var(--color-soft-ink)]">
        {tx("Demo · not a guarantee", "示範畫面・非保證收入")}
      </p>
    </div>
  );
}

/* ───────────────────────── 1. HERO — identity decision ───────────────────────── */
function HeroSection({
  audience,
  onChange,
}: {
  audience: Audience;
  onChange: (next: Audience) => void;
}) {
  const { lang } = useI18n();
  const tx = (en: string, zh: string) => (lang === "en" ? en : zh);
  const isBrand = audience === "brand";

  const cardBase =
    "group flex flex-col justify-between gap-6 rounded-[1.25rem] border-2 border-[var(--color-ink)] p-6 text-left transition-transform hover:-translate-y-0.5 min-h-[168px]";

  return (
    <section className="relative overflow-hidden bg-[var(--color-paper)]">
      <div className="dot-pattern absolute inset-0 opacity-60" aria-hidden="true" />
      <div className="relative mx-auto max-w-6xl px-4 pt-12 pb-16 sm:pt-16 sm:pb-24">
        <div className="grid items-center gap-10 lg:grid-cols-[1.15fr_0.85fr]">
          {/* Editorial column */}
          <div className="max-w-2xl">
            <span className="sticker mb-6 inline-flex items-center gap-2">
              <Sparkles className="h-3 w-3" /> KOCMAX × ADFOCATE
            </span>
            <h1 className="font-display text-[var(--color-ink)] mb-5 leading-[0.98] tracking-tight text-[clamp(2.25rem,5.5vw,3.75rem)]">
              {isBrand ? (
                tx("Quickly find the right creators.", "快速搵到啱嘅創作者。")
              ) : lang === "zh" ? (
                // Force a clean two-line break at the comma; the clamped size keeps
                // the longer line ("做到創作者事業。") on one row at every width.
                <>
                  <span className="block">由第一篇開箱，</span>
                  <span className="block">做到創作者事業。</span>
                </>
              ) : (
                "From first review to creator business."
              )}
            </h1>
            <p className="text-[var(--color-soft-ink)] text-base sm:text-lg max-w-xl mb-8 leading-relaxed">
              {isBrand
                ? tx(
                    "Pick a ready-made campaign plan; Adfocate matches the right creators to your budget and goals, then helps run and settle it — no hunting around.",
                    "揀一個現成活動方案，Adfocate 依你嘅預算同目標配對啱嘅創作者，仲會全程幫你執行同結算 —— 唔使自己四圍搵人。",
                  )
                : tx(
                    "Grow, get matched to missions, and turn verified performance into real income — on one calmly-gamified platform built for Hong Kong creators and brands.",
                    "成長、配對任務、把經過驗證嘅表現變成真實收入 —— 一個為香港創作者同品牌而設、輕度遊戲化嘅平台。",
                  )}
            </p>
            <div className="flex flex-wrap gap-3">
              {isBrand ? (
                <>
                  <Link to="/contact" className="btn-primary">
                    <MessageCircle className="h-4 w-4" /> {tx("Contact Us", "聯絡我們")}
                  </Link>
                  <a href="#services" className="btn-ink">
                    <Rocket className="h-4 w-4" /> {tx("Browse plans", "瀏覽方案")}
                  </a>
                </>
              ) : (
                <>
                  <Link to="/creators" className="btn-primary">
                    <Sparkles className="h-4 w-4" /> {tx("Join as Creator", "成為創作者")}
                  </Link>
                  <Link to="/brands" className="btn-ink">
                    <Rocket className="h-4 w-4" /> {tx("For Brands", "品牌方案")}
                  </Link>
                </>
              )}
            </div>

            {!isBrand && (
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
            )}
          </div>

          {/* Audience-specific artifact card */}
          {isBrand ? <BrandHeroCard /> : <CreatorHeroCard />}
        </div>

        {/* Identity selector cards — also switch the whole page */}
        <div className="mt-12 grid gap-4 sm:mt-14 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => onChange("creator")}
            className={cn(
              cardBase,
              !isBrand
                ? "bg-[var(--color-acid)] text-[var(--color-ink)] shadow-[8px_8px_0_0_var(--color-ink)]"
                : "bg-[var(--color-paper)] text-[var(--color-ink)]",
            )}
          >
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] opacity-70">
                For Creators
              </span>
              <ArrowRight className="h-5 w-5 -rotate-45" />
            </div>
            <div>
              <p className="font-display text-2xl font-bold sm:text-3xl">{tx("I'm a Creator", "我是創作者")}</p>
              <p className="mt-2 text-sm leading-relaxed opacity-85">
                {tx(
                  "Take brand missions, build your portfolio, and turn creating into steady income.",
                  "接品牌任務、累積作品履歷，把創作變成穩定收入。",
                )}
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => onChange("brand")}
            className={cn(
              cardBase,
              isBrand
                ? "bg-[var(--color-violet)] text-[var(--color-paper)] shadow-[8px_8px_0_0_var(--color-ink)]"
                : "bg-[var(--color-paper)] text-[var(--color-ink)]",
            )}
          >
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] opacity-70">
                For Brands
              </span>
              <ArrowRight className="h-5 w-5 -rotate-45" />
            </div>
            <div>
              <p className="font-display text-2xl font-bold sm:text-3xl">{tx("I'm a Brand", "我是品牌")}</p>
              <p className="mt-2 text-sm leading-relaxed opacity-85">
                {tx(
                  "Use ready-made campaign plans to quickly match the right creators.",
                  "用現成的活動方案，快速媒合對的創作者做行銷。",
                )}
              </p>
            </div>
          </button>
        </div>
      </div>
    </section>
  );
}

/* ───────── 1b. HOW IT WORKS (creator) — three-step flow ─────────
 * Anchor target for the "運作方式" sub-nav item. */
function HowItWorksSection() {
  const { lang } = useI18n();
  const tx = (en: string, zh: string) => (lang === "en" ? en : zh);
  const steps = [
    {
      n: "01",
      t: tx("Match a mission", "配對任務"),
      d: tx(
        "Auto-matched to brand missions that fit your style and audience.",
        "依你的風格與粉絲輪廓，自動媒合適合的品牌任務。",
      ),
    },
    {
      n: "02",
      t: tx("Create & deliver", "完成創作"),
      d: tx(
        "Produce to the brief and deliver online — no back-and-forth chasing.",
        "照任務簡報產出內容，線上交付與溝通，不用來回追人。",
      ),
    },
    {
      n: "03",
      t: tx("Get paid", "領取收入"),
      d: tx("Auto-settled once approved, paid straight to your account.", "任務通過後自動結算，收入直接進入你的帳戶。"),
    },
  ];

  return (
    <section id="how" className="mx-auto max-w-6xl scroll-mt-32 px-4 py-16 md:py-20">
      <div className="mb-10 max-w-xl">
        <span className="tag-mono">{tx("How it works", "運作方式")}</span>
        <h2 className="mt-4 font-display text-[var(--color-ink)]">{tx("Three steps to start earning.", "三步，就開始賺。")}</h2>
        <p className="mt-3 text-[var(--color-soft-ink)]">
          {tx("No jargon — the flow really is this simple.", "不用術語，實際流程就是這樣簡單。")}
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {steps.map((st, i) => (
          <div key={st.n} className={cn("pastel-card p-6", `stagger-${i + 1} animate-slide-up`)}>
            <div className="text-outline-mint font-display text-5xl leading-none text-[var(--color-acid)]">
              {st.n}
            </div>
            <h3 className="mt-5 font-heading text-xl font-bold text-[var(--color-ink)]">{st.t}</h3>
            <p className="mt-2.5 text-sm leading-relaxed text-[var(--color-soft-ink)]">{st.d}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ───────────────────── Social proof strip (folded-in legacy content) ───────────────────── */
function SocialProofStrip() {
  const { lang } = useI18n();
  const tx = (en: string, zh: string) => (lang === "en" ? en : zh);
  const stats = [
    { value: "5,200+", label: tx("Creators", "創作者") },
    { value: "120+", label: tx("Brand partners", "合作品牌") },
    { value: "8", label: tx("Mission types", "任務類型") },
    { value: "98%", label: tx("Satisfaction", "合作滿意度") },
  ];
  return (
    <section className="mx-auto max-w-6xl px-4 pt-2 pb-4 sm:pt-4">
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
      desc: tx("Daily missions turn into points, rewards and real payouts.", "每日任務變成積分、獎勵同真實收入。"),
      variant: "game-card-mint",
    },
    {
      to: "/login" as const,
      icon: TrendingUp,
      tag: "02 · Leveling",
      title: tx("Leveling Engine", "升級引擎"),
      desc: tx("Every post earns XP that levels up your creator profile.", "每篇貼文賺取 XP，升級你嘅創作者檔案。"),
      variant: "game-card-yellow",
    },
    {
      to: "/creators" as const,
      icon: Gem,
      tag: "03 · Passport",
      title: tx("Creator Passport", "創作者履歷"),
      desc: tx("Verified scores brands can trust — beyond follower counts.", "品牌可信嘅驗證評分 —— 唔止係粉絲數。"),
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
    <section id="value" className="mx-auto max-w-6xl scroll-mt-32 px-4 py-16 md:py-20">
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
    <section id="levels" className="scroll-mt-32 bg-[var(--color-card)] py-16 md:py-20">
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
  const xpPct = Math.round((passport.xp / passport.xpNext) * 100);

  const rings = [
    { key: "reliability", color: "#D4FF00", label: tx("Reliability", "可靠度") },
    { key: "influence", color: "#FF3D7F", label: tx("Influence", "影響力") },
    { key: "content", color: "#00E5FF", label: tx("Content", "內容") },
    { key: "brandSafety", color: "#7C5CFF", label: tx("Brand Safety", "品牌安全") },
  ] as const;

  return (
    <section id="passport" className="relative scroll-mt-32 overflow-hidden bg-[var(--color-ink)] py-16 text-[var(--color-paper)] md:py-24">
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
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-[var(--color-acid)] bg-[var(--color-acid)] font-display text-xl font-bold text-[var(--color-ink)]">
                {passport.avatar}
              </div>
              <div>
                <h3 className="font-heading text-lg font-bold text-[var(--color-paper)]">{passport.name}</h3>
                <span className={cn("level-pill", levelPillClass[passport.level] ?? "level-pill-l3")}>
                  {passport.level} {passport.levelLabel}
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
              "Three layers of income, stacked. Spend points in the store, earn affiliate commission on your links, then withdraw real HK$ from your cash wallet.",
              "三層收入疊加。喺商店使用積分，靠你嘅連結賺取聯盟佣金，再從現金錢包提取真實港幣。",
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
                  {tx("Lifetime withdrawable earnings", "可提取累計收入")}
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

/* ─────────────── 6. BRAND CLOSER — single violet CTA card ───────────────
 * Merges the old brand card and the "想跑一檔看看?" final CTA into one
 * brand-styled (violet) closing block for the brand view. */
function BrandCloserSection() {
  const { lang } = useI18n();
  const tx = (en: string, zh: string) => (lang === "en" ? en : zh);
  const servicePreview = legacyActivationServices.slice(0, 4);

  return (
    <section className="mx-auto max-w-6xl px-4 py-16 md:py-20">
      <div className="relative overflow-hidden rounded-[1.5rem] border-2 border-[var(--color-ink)] bg-[var(--color-violet)] p-8 text-[var(--color-paper)] shadow-[6px_6px_0_0_var(--color-ink)] sm:p-12 md:p-16">
        <div className="dot-pattern absolute inset-0 opacity-20" aria-hidden="true" />
        <div className="relative">
          <span className="tag-mono">{tx("Run a campaign", "開始活動")}</span>
          <h2 className="mt-5 font-display text-[var(--color-paper)]">
            {tx("Want to run one?", "想跑一檔看看？")}
          </h2>
          <p className="mt-4 max-w-xl text-[var(--color-paper)]/85">
            {tx(
              "Tell us your product and goals; we'll send back an actionable plan and quote.",
              "告訴我們你的產品與目標，我們給你一份可執行的方案與報價。",
            )}
          </p>

          <div className="mt-6 flex flex-wrap gap-1.5">
            {servicePreview.map((service) => (
              <span
                key={service.id}
                className="rounded-full border border-[var(--color-paper)]/30 bg-[var(--color-paper)]/10 px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-[var(--color-paper)]"
              >
                {localized(service.title, lang)}
              </span>
            ))}
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              to="/contact"
              className="inline-flex items-center gap-2 rounded-full border-2 border-[var(--color-paper)] bg-[var(--color-paper)] px-6 py-3 text-sm font-bold text-[var(--color-ink)] transition-transform hover:-translate-y-0.5"
            >
              <MessageCircle className="h-4 w-4" /> {tx("Contact Us", "聯絡我們")}
            </Link>
            <a
              href="#services"
              className="inline-flex items-center gap-2 rounded-full border-2 border-[var(--color-paper)] bg-transparent px-6 py-3 text-sm font-bold text-[var(--color-paper)] transition-colors hover:bg-[var(--color-paper)] hover:text-[var(--color-ink)]"
            >
              {tx("Browse plans", "瀏覽方案")} <ArrowRight className="h-4 w-4" />
            </a>
          </div>

          <p className="mt-6 inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-paper)]/70">
            <Check className="h-3.5 w-3.5" /> {tx("Free intro call · Hong Kong", "免費初步傾 · 香港")}
          </p>
        </div>
      </div>

      {/* Verified metrics brands see */}
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
function FinalCTASection({ audience }: { audience: Audience }) {
  const { t, lang } = useI18n();
  const tx = (en: string, zh: string) => (lang === "en" ? en : zh);
  const isBrand = audience === "brand";

  return (
    <section className="mx-auto max-w-6xl px-4 py-16 md:py-20">
      <div className="relative overflow-hidden rounded-[1.5rem] border-2 border-[var(--color-ink)] bg-[var(--color-acid)] p-8 text-center shadow-[6px_6px_0_0_var(--color-ink)] sm:p-12 lg:p-16">
        <div className="dot-pattern absolute inset-0 opacity-30" aria-hidden="true" />
        <div className="relative mx-auto max-w-2xl">
          <span className="tag-mono">{isBrand ? tx("Run a campaign", "開始活動") : tx("Get Started", "立即開始")}</span>
          <h2 className="mt-5 font-display text-[var(--color-ink)]">
            {isBrand ? tx("Want to run one?", "想跑一檔看看？") : t("home.final.heading")}
          </h2>
          <p className="mx-auto mt-4 max-w-md text-[var(--color-ink)]/80">
            {isBrand
              ? tx(
                  "Tell us your product and goals; we'll send back an actionable plan and quote.",
                  "告訴我們你的產品與目標，我們給你一份可執行的方案與報價。",
                )
              : tx(
                  "Join thousands of Hong Kong creators turning KOC missions into real creator businesses — or work with verified creators on your next campaign.",
                  "加入數以千計嘅香港創作者，把 KOC 任務變成真正嘅創作者事業 —— 或者同經驗證嘅創作者合作你下一個活動。",
                )}
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            {isBrand ? (
              <Link to="/contact" className="btn-ink">
                <MessageCircle className="h-4 w-4" /> {tx("Contact Us", "聯絡我們")}
              </Link>
            ) : (
              <Link to="/creators" className="btn-ink">
                <Sparkles className="h-4 w-4" /> {t("home.final.start")}
              </Link>
            )}
            {isBrand ? (
              <a
                href="#services"
                className="inline-flex items-center gap-2 rounded-full border-2 border-[var(--color-ink)] bg-transparent px-[22px] py-3 text-sm font-bold text-[var(--color-ink)] transition-colors hover:bg-[var(--color-ink)] hover:text-[var(--color-acid)]"
              >
                {tx("Browse plans", "瀏覽方案")}
              </a>
            ) : (
              <Link
                to="/contact"
                className="inline-flex items-center gap-2 rounded-full border-2 border-[var(--color-ink)] bg-transparent px-[22px] py-3 text-sm font-bold text-[var(--color-ink)] transition-colors hover:bg-[var(--color-ink)] hover:text-[var(--color-acid)]"
              >
                {t("home.final.talk")}
              </Link>
            )}
          </div>
          <p className="mt-6 inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-ink)]/70">
            <Check className="h-3.5 w-3.5" />{" "}
            {isBrand
              ? tx("Free intro call · Hong Kong", "免費初步傾 · 香港")
              : tx("Free to join · No contract · Hong Kong", "免費加入 · 無合約 · 香港")}
          </p>
        </div>
      </div>
    </section>
  );
}

function Home() {
  const { audience, setAudience } = useHomeAudience();

  return (
    <div>
      <HeroSection audience={audience} onChange={setAudience} />
      <SocialProofStrip />
      {audience === "creator" ? (
        <>
          <PillarsSection />
          <HowItWorksSection />
          <CreatorPassportSection />
          <GrowthLadderSection />
          <MonetizationStackSection />
          <FinalCTASection audience="creator" />
        </>
      ) : (
        <>
          <BrandView />
          {/* One brand-styled closer: the brand card + the "想跑一檔看看?" CTA are
              merged into a single violet block (no separate acid CTA banner). */}
          <BrandCloserSection />
        </>
      )}
    </div>
  );
}
