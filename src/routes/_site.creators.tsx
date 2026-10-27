import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useEffect, useState } from "react";
import {
  Sparkles,
  ArrowRight,
  Target,
  Trophy,
  TrendingUp,
  Banknote,
  Star,
  Shield,
  User,
  MessageCircle,
  Check,
  GraduationCap,
  BookOpen,
} from "lucide-react";
import {
  mockCreatorPassport,
  copilotTools,
  academyTracks,
  resources,
} from "@/data/mockData";
import { LEVELS, progressToNext } from "@/lib/levels";
import { legacyAffiliateSteps, localized } from "@/data/legacyAdfocateContent";
import { useI18n } from "@/lib/i18n";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { cn } from "@/lib/utils";
import {
  getDeviceCategory,
  trackActivationEvent,
} from "@/lib/activationAnalytics";

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

/** Card-accent border colour per level id (used as the ladder card accent). */
const levelAccent: Record<string, string> = {
  L0: "#0A0A0A",
  L1: "#CE1A5C",
  L2: "#D4FF00",
  L3: "#00E5FF",
  L4: "#7C5CFF",
  L5: "#FF3D7F",
  L6: "#0A0A0A",
};

const faqItems = [
  { qKey: "creators.faq.1.q", aKey: "creators.faq.1.a" },
  { qKey: "creators.faq.2.q", aKey: "creators.faq.2.a" },
  { qKey: "creators.faq.3.q", aKey: "creators.faq.3.a" },
  { qKey: "creators.faq.4.q", aKey: "creators.faq.4.a" },
  { qKey: "creators.faq.5.q", aKey: "creators.faq.5.a" },
  { qKey: "creators.faq.6.q", aKey: "creators.faq.6.a" },
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
          stroke="rgba(255,255,255,0.14)"
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
        <span className="font-mono text-sm font-bold text-[var(--color-paper)]">{animatedScore}</span>
        {label && (
          <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--color-paper)]/55">
            {label}
          </span>
        )}
      </div>
    </div>
  );
}

/* ───────────────────────── SECTION 1 · HERO ─────────────────────────
   Anchor: bottom-left text over a paper / dot-grid canvas. The level
   ladder rides above the headline as a visible "what you can become". */
function HeroSection() {
  const { t, lang } = useI18n();
  const tx = (en: string, zh: string) => (lang === "en" ? en : zh);

  return (
    <section className="relative overflow-hidden border-b-2 border-[var(--color-ink)] bg-[var(--color-paper)]">
      <div className="dot-pattern absolute inset-0 opacity-[0.5]" aria-hidden="true" />
      <div
        className="absolute -top-24 -right-24 h-[420px] w-[420px] rounded-full bg-[var(--color-acid)] opacity-25 blur-3xl"
        aria-hidden="true"
      />
      <div
        className="absolute top-1/3 -left-20 h-[320px] w-[320px] rounded-full bg-[var(--color-violet)] opacity-15 blur-3xl"
        aria-hidden="true"
      />

      {/* tall canvas; content anchored to the lower 40% */}
      <div className="relative mx-auto flex min-h-[620px] max-w-6xl flex-col justify-end px-4 pb-12 pt-28 sm:min-h-[680px] sm:px-6 sm:pb-16 sm:pt-36 lg:px-8">
        {/* ladder of levels floating above the headline */}
        <div className="mb-8 flex flex-wrap items-center gap-1.5">
          {LEVELS.map((level) => (
            <span
              key={level.id}
              className={cn("level-pill text-[10px]", levelPillClass[level.id] ?? "level-pill-l1")}
            >
              {level.id}
            </span>
          ))}
          <span className="ml-1 inline-flex items-center gap-1 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-soft-ink)]">
            <ArrowRight className="h-3 w-3" /> {tx("Your ladder", "你的階梯")}
          </span>
        </div>

        <div className="max-w-3xl">
          <span className="sticker mb-5">{tx("For Creators · 創作者", "創作者 · For Creators")}</span>
          <h1 className="font-display text-4xl leading-[1.03] text-[var(--color-ink)] sm:text-5xl lg:text-6xl">
            {t("creators.hero.title")}
          </h1>
          <p className="mt-5 max-w-xl text-sm leading-relaxed text-[var(--color-soft-ink)] sm:text-base">
            {t("creators.hero.sub")}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              to="/login"
              onClick={() =>
                trackActivationEvent("signup_started", {
                  locale: lang,
                  deviceCategory: getDeviceCategory(),
                  source: "creators_hero",
                })
              }
              className="btn-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--color-cyan)]/45 motion-reduce:transition-none"
            >
              <User className="h-4 w-4" /> {t("creators.hero.cta1")}
            </Link>
            <Link
              to="/mission"
              className="btn-ink focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--color-cyan)]/45 motion-reduce:transition-none"
            >
              <Target className="h-4 w-4" /> {t("creators.hero.cta2")}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ──────────────── SECTION 2 · HOW IT WORKS (numbered) ────────────────
   Anchor: oversized stroked numerals 01–04 — the page's SECOND-READ
   MOMENT. Folds the 6-step journey AND the legacy affiliate pathway. */
function HowItWorksSection() {
  const { t, lang } = useI18n();
  const tx = (en: string, zh: string) => (lang === "en" ? en : zh);

  const steps = [
    {
      icon: User,
      label: t("creators.how.s1"),
      desc: tx(
        "Sign up, set your categories, and connect your social profiles to start receiving missions.",
        "註冊、設定內容類別，連接社交帳號，即可開始收到任務。",
      ),
    },
    {
      icon: Target,
      label: t("creators.how.s2"),
      desc: tx(
        "Pick missions that match your niche, follow the brief, submit content, and get approved.",
        "揀啱你風格的任務，跟住 Brief 交稿，等審批通過。",
      ),
    },
    {
      icon: Check,
      label: t("creators.how.s3"),
      desc: tx(
        "Every approved mission builds your Creator Passport with scores, badges, and verified history.",
        "每個通過的任務，都會為你的創作者履歷加上分數、徽章同已驗證紀錄。",
      ),
    },
    {
      icon: Sparkles,
      label: t("creators.how.s4"),
      desc: tx(
        "As your reliability and quality scores rise, unlock paid UGC jobs, campaign fees, and better brand briefs.",
        "可靠度同質素分數上升後，解鎖付費 UGC 工作、活動費用同更好的品牌 Brief。",
      ),
    },
    {
      icon: TrendingUp,
      label: t("creators.how.s5"),
      desc: tx(
        "Access Adfoplace for affiliate commissions, live commerce, coupons, and product drop opportunities.",
        "進入 Adfoplace 賺取 Affiliate 佣金、直播帶貨、優惠券同產品搶先試用機會。",
      ),
    },
    {
      icon: Banknote,
      label: t("creators.how.s6"),
      desc: tx(
        "Build verified earnings history and improve your Finance Readiness Score for future capital access.",
        "累積已驗證收益紀錄，提升你的財務準備度分數，為未來資金渠道做準備。",
      ),
    },
  ];

  return (
    <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-20 lg:px-8">
      <div className="mb-12 max-w-2xl">
        <span className="tag-mono mb-4">{tx("The Flow · 流程", "流程 · The Flow")}</span>
        <h2 className="font-display text-3xl text-[var(--color-ink)] sm:text-4xl">
          {t("creators.how.heading")}
        </h2>
        <p className="mt-3 text-[var(--color-soft-ink)]">
          {tx(
            "Your creator journey in six structured steps, from first mission to finance-ready.",
            "你的創作者旅程，由第一個任務到財務準備就緒，分成六個清晰步驟。",
          )}
        </p>
      </div>

      {/* numbered grid with oversized stroked numerals (second-read) */}
      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {steps.map((step, i) => {
          const variant =
            i % 3 === 0 ? "game-card-mint" : i % 3 === 1 ? "game-card-yellow" : "game-card-blue";
          return (
            <article
              key={step.label}
              className={cn(
                "game-card relative flex flex-col gap-3 overflow-hidden",
                variant,
                "stagger-" + Math.min(i + 1, 6),
                "animate-slide-up",
              )}
            >
              <span
                className="text-outline-ink pointer-events-none absolute -right-2 -top-4 font-display text-[5.5rem] leading-none opacity-70 select-none"
                aria-hidden="true"
              >
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="relative inline-flex h-10 w-10 items-center justify-center rounded-xl border-2 border-[var(--color-ink)] bg-[var(--color-acid)] text-[var(--color-ink)]">
                <step.icon className="h-5 w-5" />
              </span>
              <h3 className="relative font-heading text-base font-bold leading-snug text-[var(--color-ink)]">
                {step.label}
              </h3>
              <p className="relative text-xs leading-relaxed text-[var(--color-soft-ink)]">
                {step.desc}
              </p>
            </article>
          );
        })}
      </div>

      {/* legacy affiliate pathway folded in as the journey detail */}
      <div className="mt-12 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-card)] p-6 shadow-[4px_4px_0_var(--color-ink)] sm:p-8">
        <div className="grid items-start gap-7 lg:grid-cols-[320px_1fr]">
          <div>
            <span className="tag-mono mb-4">
              {localized({ en: "Affiliate pathway", zh: "Affiliate 流程" }, lang)}
            </span>
            <h3 className="font-display text-2xl leading-tight text-[var(--color-ink)] sm:text-3xl">
              {localized(
                {
                  en: "Apply, get approved, create, and earn.",
                  zh: "申請、通過審批、創作，然後賺取收益。",
                },
                lang,
              )}
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-[var(--color-soft-ink)]">
              {localized(
                {
                  en: "An illustrative affiliate journey. Automatic commissions and payouts are not available in this pilot.",
                  zh: "聯盟行銷流程示範；此試行版尚未提供自動佣金及付款。",
                },
                lang,
              )}
            </p>
          </div>
          <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {legacyAffiliateSteps.map((item, i) => (
              <li
                key={item.id}
                className="rounded-2xl border-2 border-[var(--color-ink)] bg-[var(--color-paper)] p-4"
              >
                <span className="font-mono text-[26px] font-bold leading-none text-[var(--color-magenta)]">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.15em] text-[var(--color-soft-ink)]">
                  {localized(item.step, lang)}
                </p>
                <h4 className="mt-1 font-heading text-sm font-bold text-[var(--color-ink)]">
                  {localized(item.title, lang)}
                </h4>
                <p className="mt-2 text-xs leading-relaxed text-[var(--color-soft-ink)]">
                  {localized(item.description, lang)}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

/* ──────────────── SECTION 3 · CREATOR LEVELS (ladder) ────────────────
   Anchor: ladder / journey. Each card carries its level's accent colour
   on a top rule. Demo level highlighted as "YOU". */
function CreatorLevelsSection() {
  const { t, lang } = useI18n();
  const tx = (en: string, zh: string) => (lang === "en" ? en : zh);

  return (
    <section className="border-y-2 border-[var(--color-ink)] bg-[var(--color-paper)] py-16 md:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="mb-10 flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-2xl">
            <span className="tag-mono mb-4">{tx("Progression · 升級", "升級 · Progression")}</span>
            <h2 className="font-display text-3xl text-[var(--color-ink)] sm:text-4xl">
              {t("creators.levels.heading")}
            </h2>
            <p className="mt-3 text-[var(--color-soft-ink)]">
              {tx(
                "XP thresholds follow the current level rules. Opportunity and income examples below are illustrative; availability and rewards depend on each mission.",
                "XP 門檻依照現行等級規則。以下機會及收入僅供示範，實際資格及獎勵以各任務為準。",
              )}
            </p>
          </div>
          {/* mini segmented ladder, airy */}
          <div className="w-full max-w-xs">
            <div className="segmented-bar mb-2">
              {LEVELS.map((l) => (
                <span key={l.id} className="active" />
              ))}
            </div>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-soft-ink)]">
              L0 → L6 · {tx("Level up to unlock", "升級解鎖更多")}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {LEVELS.map((level, i) => {
            const isDemoLevel = level.id === mockCreatorPassport.level;
            return (
              <article
                key={level.id}
                className={cn(
                  "game-card relative flex flex-col gap-3",
                  "stagger-" + Math.min(i + 1, 7),
                  "animate-slide-up",
                )}
                style={{ borderTopWidth: 6, borderTopColor: levelAccent[level.id] }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-3xl">{level.emoji}</span>
                  <span className={cn("level-pill", levelPillClass[level.id] ?? "level-pill-l1")}>
                    {level.id} {t(level.labelKey)}
                  </span>
                </div>

                <div>
                  <p className="font-heading text-sm font-bold text-[var(--color-ink)]">
                    {level.goal}
                  </p>
                  <p className="mt-1 text-[11px] text-[var(--color-soft-ink)]">
                    <span className="font-mono font-semibold text-[var(--color-magenta)]">
                      {level.xpRequired.toLocaleString()} XP
                    </span>{" "}
                    {tx("required", "解鎖門檻")}
                  </p>
                </div>

                <div className="flex flex-wrap gap-1">
                  {level.unlocks.map((u) => (
                    <span
                      key={u}
                      className="rounded-full border border-[var(--color-ink)] bg-[var(--color-paper)] px-2 py-0.5 font-heading text-[10px] font-semibold text-[var(--color-ink)]"
                    >
                      {u}
                    </span>
                  ))}
                </div>

                <div className="mt-auto border-t-2 border-dashed border-[var(--color-ink)]/15 pt-2">
                  <p className="mb-0.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-soft-ink)]">
                    {tx("Income Example", "收入示例")}
                  </p>
                  <p className="text-xs font-bold text-[var(--color-ink)]">{level.incomeExample}</p>
                </div>

                {isDemoLevel && (
                  <div className="absolute -top-3 right-3 hidden sm:block">
                    <span className="inline-flex items-center gap-1 rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-2 py-0.5 font-mono text-[10px] font-bold text-[var(--color-ink)]">
                      <Star className="h-3 w-3" /> {tx("YOU", "你")}
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

/* ─────────────── SECTION 3b · CREATOR PASSPORT (ink) ─────────────────
   The page's ONE full-ink section — passport artifact with score rings,
   XP, badges and verified data. Acid accents on dark. */
function CreatorPassportFullSection() {
  const { t, lang } = useI18n();
  const tx = (en: string, zh: string) => (lang === "en" ? en : zh);
  const passport = mockCreatorPassport;
  const progress = progressToNext(passport.xp);
  const xpPct = progress.pct;

  const scoreRings = [
    { key: "influence", label: "Influence", color: "#FF3D7F" },
    { key: "content", label: "Content", color: "#00E5FF" },
    { key: "reliability", label: "Reliability", color: "#D4FF00" },
    { key: "brandSafety", label: "Brand Safety", color: "#7C5CFF" },
  ] as const;

  return (
    <section className="bg-[var(--color-ink)] py-16 md:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="mb-8 max-w-2xl">
          <span className="inline-block rounded-full border-2 border-[var(--color-acid)] bg-transparent px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--color-acid)]">
            {tx("Passport · 履歷", "履歷 · Passport")}
          </span>
          <h2 className="mt-3 font-display text-3xl !text-[var(--color-paper)] sm:text-4xl">
            {t("creators.passport.heading")}
          </h2>
          <p className="mt-2 max-w-lg text-[var(--color-paper)]/70">
            {tx(
              "Your profile brings together mission history and account data. Ownership verification is shown separately for each social account.",
              "履歷整合任務歷史及帳號資料，各社交帳號會分別顯示擁有權驗證狀態。",
            )}
          </p>
        </div>

        <p className="mb-3 text-sm text-[var(--color-acid)]">{tx("Illustrative profile · fictional data", "示範履歷 · 虛構資料")}</p>
        <div className="rounded-[var(--radius)] border-2 border-[var(--color-acid)] bg-[var(--color-ink)] p-6 shadow-[6px_6px_0_var(--color-acid)] sm:p-8">
          <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
            <div className="space-y-6">
              <div className="flex items-start gap-5">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] font-display text-2xl font-bold text-[var(--color-ink)]">
                  {passport.avatar}
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="font-heading text-xl font-bold text-[var(--color-paper)]">
                    {passport.name}
                  </h3>
                  <div className="mt-1 flex items-center gap-2">
                    <span
                      className={cn("level-pill", levelPillClass[passport.level] ?? "level-pill-l3")}
                    >
                      {progress.current.id} {t(progress.current.labelKey)}
                    </span>
                    <span className="font-mono text-[11px] text-[var(--color-paper)]/60">
                      {passport.completedMissions}{" "}
                      {tx("missions completed", "個任務已完成")}
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-[var(--color-paper)]/70">
                    {passport.bio}
                  </p>
                </div>
              </div>

              {/* SECOND-READ accent: oversized stroked XP percent */}
              <div className="relative">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="font-heading text-xs font-semibold text-[var(--color-paper)]/80">
                    {tx("XP Progress to Next Level", "距離下一級的 XP 進度")}
                  </span>
                  <span className="font-mono text-[11px] font-bold text-[var(--color-acid)]">
                    {passport.xp.toLocaleString()} / {passport.xpNext.toLocaleString()} XP
                  </span>
                </div>
                <div className="xp-bar h-3">
                  <div className="xp-bar-fill h-3" style={{ width: `${xpPct}%` }} />
                </div>
                <p className="mt-1.5 font-mono text-[10px] text-[var(--color-paper)]/55">
                  {xpPct}% · {progress.next?.id} {progress.next && t(progress.next.labelKey)} ·{" "}
                  {tx("Complete", "尚餘")}{" "}
                  {(passport.xpNext - passport.xp).toLocaleString()}{" "}
                  {tx("more XP", "XP")}
                </p>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {passport.categories.map((cat) => (
                  <span
                    key={cat}
                    className="rounded-full border border-[var(--color-magenta-pop)] px-3 py-1 font-heading text-[11px] font-semibold text-[var(--color-magenta-pop)]"
                  >
                    {cat}
                  </span>
                ))}
              </div>

              <div className="flex flex-wrap gap-1.5">
                {passport.badges.map((b) => (
                  <span
                    key={b}
                    className="inline-flex items-center gap-1 rounded-full border border-[var(--color-acid)] px-2.5 py-1 font-mono text-[10px] font-semibold text-[var(--color-acid)]"
                  >
                    <Shield className="h-3 w-3" /> {b}
                  </span>
                ))}
              </div>

              <div>
                <span className="mb-2 block font-heading text-xs font-semibold text-[var(--color-paper)]/80">
                  {tx("Social Handles", "社交帳號")}
                </span>
                <div className="flex flex-wrap gap-2">
                  {passport.socialHandles.map((h) => (
                    <span
                      key={h.platform}
                      className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-paper)]/25 px-3 py-1 font-mono text-[11px] font-semibold text-[var(--color-paper)]"
                    >
                      {h.platform === "Instagram" && (
                        <InstagramIcon className="h-3 w-3 text-[var(--color-magenta-pop)]" />
                      )}
                      {h.platform === "Xiaohongshu" && (
                        <MessageCircle className="h-3 w-3 text-[var(--color-magenta-pop)]" />
                      )}
                      {h.platform === "TikTok" && (
                        <YoutubeIcon className="h-3 w-3 text-[var(--color-cyan)]" />
                      )}
                      {h.handle}
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <span className="mb-2 block font-heading text-xs font-semibold text-[var(--color-paper)]/80">
                  {tx("Strengths", "強項")}
                </span>
                <ul className="space-y-1">
                  {passport.strengths.map((s) => (
                    <li
                      key={s}
                      className="flex items-center gap-1.5 text-xs text-[var(--color-paper)]"
                    >
                      <Trophy className="h-3 w-3 shrink-0 text-[var(--color-acid)]" /> {s}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="space-y-5 border-t border-[var(--color-paper)]/15 pt-6 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
              <div>
                <span className="mb-3 block font-heading text-xs font-semibold text-[var(--color-paper)]/80">
                  {tx("Creator Value Scores", "創作者價值分數")}
                </span>
                <div className="grid grid-cols-2 gap-3">
                  {scoreRings.map(({ key, label, color }) => (
                    <div
                      key={key}
                      className="flex flex-col items-center gap-1.5 rounded-xl border border-[var(--color-paper)]/15 p-3"
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

              <div className="rounded-xl border border-[var(--color-acid)]/40 bg-[var(--color-acid)]/5 p-4">
                <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-[var(--color-acid)]">
                  {tx("Lifetime Earnings", "累計收益")}
                </p>
                <p className="font-display text-2xl text-[var(--color-paper)]">
                  {passport.incomeHistory.split(" ")[0]}
                </p>
                <p className="mt-0.5 text-xs text-[var(--color-paper)]/60">{passport.incomeHistory}</p>
              </div>

              <div className="rounded-xl border border-[var(--color-violet)]/40 bg-[var(--color-violet)]/10 p-4">
                <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-[var(--color-violet)]">
                  {tx("Brand Feedback", "品牌回饋")}
                </p>
                <p className="font-display text-2xl text-[var(--color-paper)]">
                  {passport.brandFeedback}%
                </p>
                <p className="mt-0.5 text-xs text-[var(--color-paper)]/60">
                  {tx("Positive satisfaction score", "正面滿意度分數")}
                </p>
              </div>

              <div className="rounded-xl border border-[var(--color-paper)]/15 p-4">
                <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-[var(--color-paper)]/60">
                  {tx("Next Actions", "下一步行動")}
                </p>
                <ul className="space-y-1.5">
                  {passport.nextActions.map((a) => (
                    <li
                      key={a}
                      className="flex items-start gap-1.5 text-xs text-[var(--color-paper)]"
                    >
                      <ArrowRight className="mt-0.5 h-3 w-3 shrink-0 text-[var(--color-acid)]" /> {a}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ────────────── SECTION 4 · GROW WITH RESOURCES (gallery) ────────────
   Anchor: gallery / editorial cadence. Teases Academy + Playbooks with
   explicit links to /guide and /playbooks, then folds the FAQ and the
   final CTA banner so no prior content is lost. */
function GrowResourcesSection() {
  const { t, lang } = useI18n();
  const tx = (en: string, zh: string) => (lang === "en" ? en : zh);

  const resourceGroups = [
    {
      title: tx("Academy Courses", "創作者學院課程"),
      icon: GraduationCap,
      desc: tx(
        "Course topics preview · content in preparation",
        "課程主題預覽 · 內容準備中",
      ),
      items: academyTracks.slice(0, 4),
      variant: "game-card-mint",
      to: "/guide",
    },
    {
      title: tx("Templates & Playbooks", "範本與 Playbooks"),
      icon: BookOpen,
      desc: tx(
        "Ready-to-use caption templates, script formulas, shot lists, and media kits.",
        "即用文案範本、腳本公式、分鏡清單同媒體包。",
      ),
      items: resources.slice(0, 4),
      variant: "game-card-yellow",
      to: "/playbooks",
    },
    {
      title: tx("Creator Copilot Tools", "創作者 Copilot 工具"),
      icon: Sparkles,
      desc: tx(
        "AI-powered tools for hooks, captions, pricing, mission matching, and compliance.",
        "AI 工具助你生成 Hook、文案、定價、任務配對同合規檢查。",
      ),
      items: copilotTools.slice(0, 4),
      variant: "game-card-blue",
      to: "/mission",
    },
    {
      title: tx("Mentor Sessions & Studio", "導師時段與工作室"),
      icon: Trophy,
      desc: tx(
        "Book sessions with experienced creators, join workshops, and use studio resources.",
        "預約資深創作者一對一指導、參加工作坊，並使用工作室資源。",
      ),
      variant: "game-card-mint",
      items: [
        { id: "m1", title: tx("1-on-1 Creator Coaching", "一對一創作者指導"), level: "L3+", emoji: "👤" },
        { id: "m2", title: tx("Live Shopping Dress Rehearsal", "直播帶貨綵排"), level: "L4+", emoji: "🎬" },
        { id: "m3", title: tx("Content Shoot Studio Access", "內容拍攝工作室"), level: "L2+", emoji: "📸" },
        { id: "m4", title: tx("Finance Readiness Workshop", "財務準備工作坊"), level: "L3+", emoji: "🏦" },
      ],
      to: "/contact",
    },
  ];

  return (
    <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-20 lg:px-8">
      <div className="mb-10 max-w-2xl">
        <span className="tag-mono mb-4">{tx("Growth · 成長", "成長 · Growth")}</span>
        <h2 className="font-display text-3xl text-[var(--color-ink)] sm:text-4xl">
          {t("creators.resources.heading")}
        </h2>
        <p className="mt-3 text-[var(--color-soft-ink)]">
          {tx(
            "Resource concepts preview. Course units, AI services, mentoring and studio booking are not enabled by this page.",
            "資源概念預覽。本頁不提供課堂單元、AI 服務、導師預約或工作室預約。",
          )}
        </p>
      </div>

      {/* gallery: editorial bento — first card spans two columns on lg */}
      <div className="grid gap-5 md:grid-cols-2">
        {resourceGroups.map((group, i) => (
          <div
            key={group.title}
            className={cn(
              "game-card flex flex-col gap-4",
              group.variant,
              i === 0 && "md:col-span-2",
              "stagger-" + Math.min(i + 1, 4),
              "animate-slide-up",
            )}
          >
            <div className="flex items-center gap-3">
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl border-2 border-[var(--color-ink)] bg-[var(--color-paper)] text-[var(--color-ink)]">
                <group.icon className="h-5 w-5" />
              </span>
              <div>
                <h3 className="font-heading font-bold text-[var(--color-ink)]">{group.title}</h3>
                <p className="text-[11px] text-[var(--color-soft-ink)]">{group.desc}</p>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {group.items.map((item) => {
                const icon =
                  "emoji" in item
                    ? item.emoji
                    : "icon" in item
                      ? (item as { icon: string }).icon
                      : "•";
                return (
                  <span
                    key={item.id}
                    className="inline-flex items-center gap-1 rounded-full border border-[var(--color-ink)] bg-[var(--color-card)] px-2.5 py-1 font-mono text-[10px] font-semibold text-[var(--color-soft-ink)]"
                  >
                    {icon}{" "}
                    {typeof item.title === "string" ? item.title : localized(item.title, lang)}
                  </span>
                );
              })}
            </div>

            <Link
              to={group.to}
              className="mt-auto inline-flex items-center gap-1 text-sm font-bold text-[var(--color-magenta)] transition-[gap] hover:gap-2"
            >
              {tx("Browse all", "查看全部")} <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        ))}
      </div>

      {/* FAQ folded into the resources section */}
      <div className="mx-auto mt-16 max-w-3xl">
        <div className="mb-8 text-center">
          <span className="tag-mono mb-4">{tx("FAQ · 常見問題", "常見問題 · FAQ")}</span>
          <h3 className="font-display text-2xl text-[var(--color-ink)] sm:text-3xl">
            {t("creators.faq.heading")}
          </h3>
        </div>

        <Accordion type="single" collapsible className="w-full space-y-2">
          {faqItems.map((item, i) => (
            <AccordionItem
              key={item.qKey}
              value={`faq-${i}`}
              className="overflow-hidden rounded-xl border-2 border-[var(--color-ink)] bg-[var(--color-card)] data-[state=open]:shadow-[4px_4px_0_var(--color-ink)]"
            >
              <AccordionTrigger className="px-5 py-4 text-left font-heading text-sm font-bold text-[var(--color-ink)] transition-colors hover:text-[var(--color-magenta)] data-[state=open]:text-[var(--color-magenta)]">
                <span className="flex items-center gap-3">
                  <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-[var(--color-ink)] font-mono text-[11px] font-bold text-[var(--color-magenta)]">
                    {i + 1}
                  </span>
                  {t(item.qKey)}
                </span>
              </AccordionTrigger>
              <AccordionContent className="px-5 pb-4 pt-0 text-sm leading-relaxed text-[var(--color-soft-ink)]">
                {t(item.aKey)}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}

/* ───────────── FINAL CTA · banner (acid block, ink border) ───────────── */
function FinalCtaSection() {
  const { t, lang } = useI18n();
  const tx = (en: string, zh: string) => (lang === "en" ? en : zh);

  return (
    <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6 lg:px-8">
      <div className="rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-acid)] p-8 shadow-[6px_6px_0_var(--color-ink)] sm:p-12 lg:p-14">
        <div className="grid items-center gap-6 lg:grid-cols-[1fr_auto]">
          <div>
            <h2 className="font-display text-2xl leading-tight text-[var(--color-ink)] sm:text-3xl lg:text-4xl">
              {tx("Ready to start your creator journey?", "準備好開始你的創作者旅程？")}
            </h2>
            <p className="mt-2 text-[var(--color-ink)]/75">
              {tx(
                "Join Adfocate. Create your profile, pick your first mission, and start building your Creator Passport.",
                "加入 Adfocate，建立檔案、揀第一個任務，開始建立你的創作者履歷。",
              )}
            </p>
            <p className="mt-3 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--color-ink)]/70">
              {tx("Free to join · No contract · Hong Kong", "免費加入 · 無合約 · 香港")}
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link
              to="/login"
              onClick={() =>
                trackActivationEvent("signup_started", {
                  locale: lang,
                  deviceCategory: getDeviceCategory(),
                  source: "creators_footer",
                })
              }
              className="btn-ink focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--color-cyan)]/45 motion-reduce:transition-none"
            >
              <User className="h-4 w-4" /> {t("creators.final.cta")}
            </Link>
            <Link
              to="/contact"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-card)] px-7 text-sm font-bold text-[var(--color-ink)] transition-colors hover:bg-[var(--color-paper)]"
            >
              {tx("Talk to Adfocate", "聯絡 Adfocate")}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function CreatorsPage() {
  const { lang, localeReady } = useI18n();
  const trackedPageView = useRef(false);

  useEffect(() => {
    if (!localeReady || trackedPageView.current) return;
    trackedPageView.current = true;
    trackActivationEvent("landing_page_viewed", {
      locale: lang,
      deviceCategory: getDeviceCategory(),
    });
  }, [lang, localeReady]);

  return (
    <div>
      <HeroSection />
      <HowItWorksSection />
      <CreatorLevelsSection />
      <CreatorPassportFullSection />
      <GrowResourcesSection />
      <FinalCtaSection />
    </div>
  );
}
