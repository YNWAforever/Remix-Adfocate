import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ShoppingBag,
  Package,
  Sparkles,
  ArrowRight,
  ArrowDown,
  Coins,
  Percent,
  Gift,
  Monitor,
  Camera,
  Megaphone,
  Rocket,
  TrendingUp,
  Wallet,
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

// Map the three Adfoplace sub-products to the three colored game-card hover variants
// so the gapless 3-col reads as a single product family. Data (to/desc/etc.) untouched.
const subSectionStyles = [
  { hover: "game-card-yellow", chip: "level-pill-l2", outline: "text-outline-yellow" },
  { hover: "game-card-mint", chip: "level-pill-l3", outline: "text-outline-mint" },
  { hover: "game-card-blue", chip: "level-pill-l4", outline: "text-outline-ink" },
] as const;

function EarnPage() {
  const { lang } = useI18n();
  const tx = (en: string, zh: string) => (lang === "en" ? en : zh);

  return (
    <div className="relative">
      {/* ── 1 · ADFOPLACE HERO — centered statement on paper dot-grid ───────── */}
      <section className="relative overflow-hidden border-b-2 border-[var(--color-ink)]">
        <div
          className="dot-pattern absolute inset-0 opacity-[0.35] pointer-events-none"
          aria-hidden="true"
        />
        <div
          className="absolute -top-24 right-[8%] h-72 w-72 rounded-full bg-[var(--color-acid)] opacity-40 blur-3xl pointer-events-none"
          aria-hidden="true"
        />
        <div className="relative mx-auto max-w-4xl px-4 py-20 text-center sm:py-28">
          <span className="sticker animate-pop">{tx("ADFOPLACE · EARN", "ADFOPLACE · 收入")}</span>

          <h1 className="font-display text-[var(--color-ink)] mt-7 animate-slide-up stagger-1">
            {tx("Your creativity,", "你嘅創作，")}
            <br />
            <span className="relative inline-block">
              {tx("turned into income.", "變收入。")}
              <span
                className="absolute -bottom-1 left-0 h-3 w-full bg-[var(--color-acid)] -z-10"
                aria-hidden="true"
              />
            </span>
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-[var(--color-soft-ink)] animate-slide-up stagger-2 sm:text-xl">
            {tx(
              "Eight income streams in one place. Pick the ones that fit your audience, set your rate, and let the platform match you with brands.",
              "八條收入線，集中喺一個平台。揀啱你受眾嘅玩法、定好你嘅價錢，等平台幫你配對品牌。",
            )}
          </p>

          <div className="mt-9 flex flex-wrap justify-center gap-3 animate-slide-up stagger-3">
            <Link to="/login" className="btn-primary inline-flex items-center gap-2">
              {tx("Browse Adfoplace", "瀏覽 Adfoplace")} <ArrowRight className="h-4 w-4" />
            </Link>
            <Link to="/packages" className="btn-ink inline-flex items-center gap-2">
              {tx("Build a Package", "建立 Package")}
            </Link>
          </div>

          {/* Income artifact — earnings chip built from existing primitives */}
          <div className="mx-auto mt-12 max-w-sm animate-slide-up stagger-4">
            <div className="wallet-card px-6 py-5 text-left">
              <div className="relative flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-paper)]/70">
                  {tx("Cash wallet · HK$", "現金錢包 · HK$")}
                </span>
                <span className="metric-badge metric-up">
                  <TrendingUp className="h-3 w-3" /> +18%
                </span>
              </div>
              <p className="relative mt-2 font-display text-4xl leading-none text-[var(--color-acid)]">
                HK$ 4,280
              </p>
              <div className="relative mt-4 flex items-center gap-2">
                <span className="level-pill level-pill-l6">LV.4</span>
                <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-paper)]/60">
                  {tx("This month", "本月")}
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 2 · THREE SUB-PRODUCTS — gapless 3-col, colored game-cards ───────── */}
      <section className="mx-auto max-w-6xl px-4 py-16 md:py-20">
        <div className="mb-10 max-w-2xl">
          <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-[var(--color-magenta)]">
            {tx("Three ways in", "三條入場路")}
          </span>
          <h2 className="font-display text-[var(--color-ink)] mt-3">
            {tx("One marketplace, three sub-products.", "一個市集，三個子產品。")}
          </h2>
        </div>

        <div className="grid gap-0 overflow-hidden rounded-[var(--radius)] border-2 border-[var(--color-ink)] md:grid-cols-3">
          {subSections.map(({ to, icon: Icon, label, title, desc }, i) => {
            const style = subSectionStyles[i];
            return (
              <Link
                key={to}
                to={to}
                className={`game-card ${style.hover} group flex flex-col gap-4 rounded-none border-0 p-7 shadow-none [&:not(:last-child)]:border-r-2 [&:not(:last-child)]:border-[var(--color-ink)] max-md:[&:not(:last-child)]:border-r-0 max-md:[&:not(:last-child)]:border-b-2`}
              >
                <div className="flex items-center justify-between">
                  <span className={`level-pill ${style.chip}`}>
                    <Icon className="h-3.5 w-3.5" aria-hidden="true" /> {label}
                  </span>
                  <span className={`font-display text-3xl ${style.outline}`} aria-hidden="true">
                    {`0${i + 1}`}
                  </span>
                </div>
                <h3 className="font-display text-2xl leading-snug text-[var(--color-ink)]">
                  {title}
                </h3>
                <p className="flex-1 text-sm leading-relaxed text-[var(--color-soft-ink)]">{desc}</p>
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--color-magenta)] transition-all group-hover:gap-2.5">
                  {tx("Open", "開啟")} <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      {/* ── 3 · AFFILIATE PATHWAY — journey waypoints (the ONE ink section) ──── */}
      <section className="bg-[var(--color-ink)] text-[var(--color-paper)]">
        <div className="mx-auto max-w-6xl px-4 py-16 md:py-20">
          <div className="mb-10 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="max-w-xl">
              <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-[var(--color-acid)]">
                {localized({ en: "Affiliate programme model", zh: "Affiliate 計劃流程" }, lang)}
              </span>
              <h2 className="mt-3 font-display text-[var(--color-paper)]">
                {localized(
                  {
                    en: "Apply, get approved, create, earn.",
                    zh: "申請、通過、創作、收錢。",
                  },
                  lang,
                )}
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-[var(--color-paper)]/70">
                {localized(
                  {
                    en: "Make content shoppable, trackable, and repeatable.",
                    zh: "讓內容可購物、可追蹤、可重複優化。",
                  },
                  lang,
                )}
              </p>
            </div>
            <Link
              to="/login"
              className="inline-flex items-center gap-2 self-start text-sm font-semibold text-[var(--color-acid)]"
            >
              {localized({ en: "Browse offers", zh: "瀏覽 Offer" }, lang)}{" "}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>

          {/* Stepper connecting rule */}
          <div className="mb-6 hidden md:block">
            <div className="segmented-bar">
              {legacyAffiliateSteps.map((step) => (
                <span key={step.id} className="active" />
              ))}
            </div>
          </div>

          <ol className="grid gap-4 md:grid-cols-4">
            {legacyAffiliateSteps.map((step, i) => (
              <li
                key={step.id}
                className={`relative rounded-[var(--radius)] border-2 border-[var(--color-acid)]/40 bg-[var(--color-ink)] p-5 animate-slide-up stagger-${i + 1}`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-acid)]">
                    {localized(step.step, lang)}
                  </span>
                  <span
                    className="font-display text-2xl leading-none text-[var(--color-acid)]"
                    aria-hidden="true"
                  >
                    {`0${i + 1}`}
                  </span>
                </div>
                <h3 className="mt-3 font-heading text-base font-bold text-[var(--color-paper)]">
                  {localized(step.title, lang)}
                </h3>
                <p className="mt-2 text-xs leading-relaxed text-[var(--color-paper)]/70">
                  {localized(step.description, lang)}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── 4 · INCOME STACK — stacked layers; wallet-card is the cash hero ──── */}
      <section className="relative overflow-hidden">
        <div
          className="dot-pattern absolute inset-0 opacity-[0.3] pointer-events-none"
          aria-hidden="true"
        />
        <div className="relative mx-auto max-w-6xl px-4 py-16 md:py-24">
          <div className="grid items-start gap-10 lg:grid-cols-[0.85fr_1fr]">
            {/* Left: framing + second-read oversized numeral */}
            <div className="lg:sticky lg:top-24">
              <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-[var(--color-magenta)]">
                {tx("Income stack", "收入疊層")}
              </span>
              <h2 className="mt-3 font-display text-[var(--color-ink)]">
                {tx("Eight ways to earn.", "八種賺錢方式。")}
              </h2>
              <p className="mt-4 max-w-md text-base leading-relaxed text-[var(--color-soft-ink)]">
                {tx(
                  "Points and rewards build the base. Affiliate commissions stack on top. Cash lands in your HK$ wallet.",
                  "積分同獎勵打底，Affiliate 佣金疊上去，最後現金落入你嘅 HK$ 錢包。",
                )}
              </p>
              {/* SECOND-READ MOMENT — oversized stroked numeral */}
              <p
                className="text-outline-pink mt-8 select-none font-display text-[7rem] leading-none sm:text-[9rem]"
                aria-hidden="true"
              >
                08
              </p>
              <p className="-mt-2 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-soft-ink)]">
                {tx("Income streams, one platform", "八條收入線 · 一個平台")}
              </p>
            </div>

            {/* Right: stacked tiers */}
            <div className="flex flex-col gap-5">
              {/* Tier 1 — Points & rewards base */}
              <article className="pastel-card p-6">
                <div className="flex items-center justify-between">
                  <span className="tag-mono">
                    <Coins className="h-3.5 w-3.5" aria-hidden="true" /> {tx("Layer 01", "第 1 層")}
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-soft-ink)]">
                    {tx("Points store", "積分商店")}
                  </span>
                </div>
                <h3 className="mt-4 font-display text-xl text-[var(--color-ink)]">
                  {tx("Points & coupon rewards", "積分同優惠獎勵")}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--color-soft-ink)]">
                  {tx(
                    "Complete missions to bank points and coupon rewards — redeem them in the points store.",
                    "完成任務累積積分同優惠獎勵，喺積分商店即時兌換。",
                  )}
                </p>
              </article>

              <div
                className="flex justify-center text-[var(--color-soft-ink)]"
                aria-hidden="true"
              >
                <ArrowDown className="h-5 w-5" />
              </div>

              {/* Tier 2 — Affiliate commission */}
              <article className="pastel-card border-[var(--color-violet)] p-6">
                <div className="flex items-center justify-between">
                  <span className="tag-mono">
                    <Percent className="h-3.5 w-3.5" aria-hidden="true" /> {tx("Layer 02", "第 2 層")}
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-soft-ink)]">
                    {tx("Affiliate", "Affiliate")}
                  </span>
                </div>
                <h3 className="mt-4 font-display text-xl text-[var(--color-ink)]">
                  {tx("Affiliate commissions", "Affiliate 佣金")}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--color-soft-ink)]">
                  {tx(
                    "Shoppable links and codes turn clicks and purchases into trackable commission on every post.",
                    "可購物連結同優惠碼，將每篇內容嘅點擊同購買變成可追蹤佣金。",
                  )}
                </p>
              </article>

              <div
                className="flex justify-center text-[var(--color-soft-ink)]"
                aria-hidden="true"
              >
                <ArrowDown className="h-5 w-5" />
              </div>

              {/* Tier 3 — Cash wallet (the hero of the stack) */}
              <article className="wallet-card p-6">
                <div className="relative flex items-center justify-between">
                  <span className="metric-badge metric-up">
                    <Wallet className="h-3 w-3" aria-hidden="true" /> {tx("Layer 03", "第 3 層")}
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-acid)]">
                    {tx("Cash wallet · HK$", "現金錢包 · HK$")}
                  </span>
                </div>
                <h3 className="relative mt-4 font-display text-2xl text-[var(--color-paper)]">
                  {tx("Cash lands in your HK$ wallet", "現金落入你嘅 HK$ 錢包")}
                </h3>
                <p className="relative mt-2 text-sm leading-relaxed text-[var(--color-paper)]/75">
                  {tx(
                    "Validated campaigns, retainers, and product drops earn cash credits, paid out by Fimmick finance.",
                    "經驗證嘅活動、Retainer 同 Product Drop 會累積現金獎賞，由 Fimmick 財務部發放。",
                  )}
                </p>
              </article>
            </div>
          </div>

          {/* Eight income streams — full source list, preserved */}
          <div className="mt-14">
            <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-[var(--color-soft-ink)]">
              {tx("Every income source", "所有收入來源")}
            </span>
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {monetization.map(({ icon: Icon, label }, i) => (
                <div
                  key={label}
                  className={`pastel-card flex flex-col items-start gap-3 p-5 animate-slide-up stagger-${(i % 8) + 1}`}
                >
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border-2 border-[var(--color-ink)] bg-[var(--color-acid)]">
                    <Icon className="h-5 w-5 text-[var(--color-ink)]" aria-hidden="true" />
                  </span>
                  <span className="font-display text-base leading-tight text-[var(--color-ink)]">
                    {label}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Earn CTA */}
          <div className="mt-12 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-acid)] p-8 text-center shadow-[6px_6px_0_0_var(--color-ink)]">
            <h2 className="font-display text-[var(--color-ink)]">
              {tx("Start earning on Adfoplace.", "喺 Adfoplace 開始賺錢。")}
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-[var(--color-ink)]/80">
              {tx(
                "Browse open offers and match with brands — your first stream is one click away.",
                "瀏覽公開 Offer、配對品牌 — 你嘅第一條收入線，撳一下就開始。",
              )}
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link to="/login" className="btn-ink inline-flex items-center gap-2">
                {tx("Browse Adfoplace", "瀏覽 Adfoplace")}{" "}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link to="/packages" className="btn-ink inline-flex items-center gap-2">
                {tx("Build a Package", "建立 Package")}
              </Link>
            </div>
            <p className="mt-5 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-ink)]/70">
              {tx("Free to join · No contract · Hong Kong", "免費加入 · 無合約 · 香港")}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
