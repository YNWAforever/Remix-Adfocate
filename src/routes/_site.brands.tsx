import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Sparkles, Check, ArrowRight, Users, BarChart3, Target } from "lucide-react";
import {
  problemSolutions,
  builderGoals,
  builderFormats,
  getBuilderOutput,
  brandCreatorTypes,
  brandDashboardMetrics,
} from "@/data/mockData";
import { legacyActivationServices, localized } from "@/data/legacyAdfocateContent";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_site/brands")({
  component: BrandsPage,
});

function BrandsPage() {
  return (
    <div>
      <BrandsHero />
      <ActivationMenu />
      <ProblemSolution />
      <BrandDashboard />
    </div>
  );
}

/* ─── 12. HERO — magenta split meeting paper ─── */
function BrandsHero() {
  const { t, lang } = useI18n();
  const tx = (en: string, zh: string) => (lang === "en" ? en : zh);

  return (
    <section className="border-b-2 border-foreground bg-paper">
      <div className="mx-auto max-w-7xl px-0 sm:px-6 lg:px-8">
        <div className="grid lg:grid-cols-[1.05fr_0.95fr] lg:items-stretch">
          {/* Left — magenta field, paper text */}
          <div className="relative overflow-hidden bg-[var(--color-magenta)] px-4 py-16 sm:px-10 sm:py-20 lg:py-24 lg:rounded-bl-[var(--radius)] border-b-2 lg:border-b-0 lg:border-r-2 border-foreground">
            <div
              className="absolute inset-0 pointer-events-none opacity-25"
              style={{
                backgroundImage: "radial-gradient(circle, #EFEFEF 1px, transparent 1px)",
                backgroundSize: "20px 20px",
              }}
            />
            <div className="relative">
              <span className="inline-block bg-acid text-foreground font-mono text-[11px] uppercase tracking-[0.16em] font-bold px-3 py-1 border-2 border-foreground -rotate-2">
                {tx("For Brands", "品牌專區")}
              </span>
              <h1 className="mt-6 font-display text-4xl sm:text-6xl text-paper max-w-2xl leading-[1.02] tracking-tight">
                {tx("Find the right creators, ", "搵啱嘅創作者，")}
                <span className="bg-acid text-foreground px-2 box-decoration-clone">
                  {tx("start with KOCmax", "由 KOCmax 開始")}
                </span>
              </h1>
              <p className="mt-5 text-paper/90 max-w-xl text-lg">
                {t("brands.hero.sub")}
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link to="/contact" className="btn-primary">
                  <Sparkles className="h-4 w-4" />
                  {t("brands.hero.cta")}
                </Link>
                <Link to="/packages" className="btn-ink">
                  {tx("See Packages", "查看方案")}
                </Link>
              </div>
              <p className="mt-6 font-mono text-[10px] uppercase tracking-[0.14em] text-paper/70">
                {tx(
                  "KOL · Micro · KOC · Affiliate · Live · Community — Hong Kong",
                  "KOL · 微網紅 · KOC · 聯盟 · 直播 · 社群 — 香港",
                )}
              </p>
            </div>
          </div>

          {/* Right — paper dot-grid with an artifact: matched-creator card */}
          <div className="relative px-4 py-12 sm:px-10 sm:py-16 lg:py-24 flex items-center">
            <div
              className="absolute inset-0 pointer-events-none opacity-40"
              style={{
                backgroundImage: "radial-gradient(circle, #0A0A0A 1px, transparent 1px)",
                backgroundSize: "22px 22px",
              }}
            />
            <div className="relative w-full max-w-sm mx-auto pastel-card p-5">
              <div className="flex items-center justify-between">
                <p className="tag-mono">{tx("Matched roster", "配對名單")}</p>
                <span className="metric-badge metric-up">↑ 92% {tx("fit", "契合")}</span>
              </div>
              <div className="mt-4 space-y-3">
                {[
                  { name: "@mei.makes", tag: "Beauty KOC", lvl: "L4" },
                  { name: "@kai.eats", tag: "F&B Micro", lvl: "L3" },
                  { name: "@nova.live", tag: "Live Host", lvl: "L5" },
                ].map((c) => (
                  <div
                    key={c.name}
                    className="flex items-center gap-3 rounded-xl border-2 border-foreground bg-white px-3 py-2.5"
                  >
                    <span className="h-9 w-9 rounded-full bg-[var(--color-violet)] border-2 border-foreground inline-flex items-center justify-center text-paper font-mono text-[10px] font-bold shrink-0">
                      {c.lvl}
                    </span>
                    <div className="min-w-0">
                      <p className="font-heading font-bold text-foreground text-sm leading-none truncate">
                        {c.name}
                      </p>
                      <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-soft-ink mt-1">
                        {c.tag}
                      </p>
                    </div>
                    <Check className="h-4 w-4 text-brand-mint ml-auto shrink-0" strokeWidth={3} />
                  </div>
                ))}
              </div>
              <div className="mt-4 rounded-xl bg-acid border-2 border-foreground px-3 py-2.5">
                <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-foreground/70">
                  {tx("Verified history · live tracking", "驗證歷史 · 即時追蹤")}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─── 13. ACTIVATION MENU — bento grid (+ folded creator roster strip) ─── */
function ActivationMenu() {
  const { lang } = useI18n();
  const tx = (en: string, zh: string) => (lang === "en" ? en : zh);

  return (
    <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-16 md:py-20">
      <div className="max-w-2xl">
        <p className="tag-mono mb-3">
          {localized({ en: "01 / Activation Menu", zh: "01 / 活動方案" }, lang)}
        </p>
        <h2 className="font-display text-3xl sm:text-4xl text-foreground tracking-tight leading-tight">
          {localized(
            {
              en: "What brands can activate with Adfocate.",
              zh: "品牌可透過 Adfocate 啟動的創作者方案。",
            },
            lang,
          )}
        </h2>
        <p className="mt-4 text-soft-ink leading-relaxed">
          {localized(
            {
              en: "Adfocate's agency services are now expressed as structured platform workflows: creator matching, mission setup, content validation, affiliate tracking, and campaign learning.",
              zh: "Adfocate 的 agency 服務現已轉化為結構化平台流程：創作者配對、任務設定、內容驗證、Affiliate 追蹤及活動學習。",
            },
            lang,
          )}
        </p>
        <Link to="/packages" className="btn-ink mt-6">
          {localized({ en: "View campaign packages", zh: "查看活動方案" }, lang)}
        </Link>
      </div>

      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {legacyActivationServices.map((service, i) => (
          <a
            key={service.id}
            href={service.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="pastel-card p-5 flex flex-col group"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="tag-mono">
                {localized({ en: "Service", zh: "服務" }, lang)} {String(i + 1).padStart(2, "0")}
              </span>
              <span className="h-8 w-8 rounded-md bg-acid border-2 border-foreground inline-flex items-center justify-center text-foreground font-mono text-xs font-bold shrink-0">
                {String(i + 1).padStart(2, "0")}
              </span>
            </div>
            <h3 className="mt-4 font-heading font-bold text-foreground text-base leading-snug">
              {localized(service.title, lang)}
            </h3>
            <p className="mt-2 text-sm text-soft-ink leading-relaxed">
              {localized(service.summary, lang)}
            </p>
            <div className="mt-4 grid gap-2">
              {service.outcomes.map((outcome) => (
                <div key={outcome.en} className="flex items-start gap-2 text-sm text-foreground">
                  <Check className="h-3.5 w-3.5 text-brand-mint shrink-0 mt-1" strokeWidth={3} />
                  <span>{localized(outcome, lang)}</span>
                </div>
              ))}
            </div>
            <p className="mt-4 pt-4 border-t-2 border-dashed border-foreground/15 font-mono text-[9px] uppercase tracking-[0.14em] text-soft-ink flex items-center gap-1.5">
              {localized(
                {
                  en: `Root: ${service.legacySource}`,
                  zh: `服務脈絡：${localized(service.title, "zh")}`,
                },
                lang,
              )}
              <ArrowRight className="h-3 w-3 shrink-0 transition-transform group-hover:translate-x-0.5" />
            </p>
          </a>
        ))}
      </div>

      {/* Folded: creator roster strip (was "Creator Types" section) */}
      <div className="mt-12 rounded-[var(--radius)] border-2 border-foreground bg-paper p-5 sm:p-7">
        <div className="flex items-center gap-2 mb-4">
          <Users className="h-4 w-4 text-foreground" strokeWidth={2.5} />
          <h3 className="font-heading font-bold text-foreground text-lg tracking-tight">
            {tx("Creator types on the roster", "名單上的創作者類型")}
          </h3>
        </div>
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
          {brandCreatorTypes.map((ct) => (
            <article key={ct.name} className="rounded-xl border-2 border-foreground bg-white p-3.5">
              <span className="text-2xl" aria-hidden="true">
                {ct.emoji}
              </span>
              <h4 className="mt-2 font-heading font-bold text-foreground text-sm leading-snug">
                {ct.name}
              </h4>
              <p className="mt-1 text-xs text-soft-ink leading-relaxed">{ct.desc}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── 14. PROBLEM → SOLUTION — alternating editorial + ink contrast band + folded builder ─── */
function ProblemSolution() {
  const { lang } = useI18n();
  const tx = (en: string, zh: string) => (lang === "en" ? en : zh);

  return (
    <>
      <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-16 md:py-20">
        <div className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
          {/* Left intro with the second-read moment: oversized stroked "vs" */}
          <div className="lg:sticky lg:top-24">
            <p className="tag-mono mb-3">{tx("02 / Old way vs Adfocate", "02 / 舊方法 vs Adfocate")}</p>
            <h2 className="font-display text-3xl sm:text-4xl text-foreground tracking-tight leading-tight">
              {tx("Common problems · what Adfocate solves", "常見痛點 · Adfocate 點樣解決")}
            </h2>
            <p
              className="text-outline-ink font-display font-bold leading-none mt-6 select-none"
              style={{ fontSize: "clamp(5rem, 14vw, 9rem)" }}
              aria-hidden="true"
            >
              vs
            </p>
            <p className="mt-4 text-soft-ink leading-relaxed">
              {tx(
                "Manual sourcing and follower-count guesswork on one side. Matched creators, a real earn loop, and a measurement dashboard on the other.",
                "一邊係人手搵人、靠 follower 數字估；另一邊係精準配對創作者、真正嘅 earn loop，加埋可量度嘅儀錶板。",
              )}
            </p>
          </div>

          {/* Right alternating compare blocks */}
          <div className="space-y-4">
            {problemSolutions.map((row, i) => (
              <div
                key={row.problem}
                className="grid gap-0 sm:grid-cols-2 rounded-[var(--radius)] overflow-hidden border-2 border-foreground shadow-[4px_4px_0_0_#0A0A0A]"
              >
                <div className="bg-paper p-5 border-b-2 sm:border-b-0 sm:border-r-2 border-foreground">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="h-6 w-6 rounded-md bg-foreground inline-flex items-center justify-center text-paper font-mono text-[10px] font-bold shrink-0">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-soft-ink">
                      {tx("Old way", "舊方法")}
                    </span>
                  </div>
                  <p className="text-sm text-soft-ink">{row.problem}</p>
                </div>
                <div className="bg-white p-5">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="h-6 w-6 rounded-md bg-acid border-2 border-foreground inline-flex items-center justify-center text-foreground shrink-0">
                      <Check className="h-3.5 w-3.5" strokeWidth={3} />
                    </span>
                    <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-foreground">
                      Adfocate
                    </span>
                  </div>
                  <p className="text-sm text-foreground font-bold">{row.solution}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* The page's ONE ink section — folded Campaign Builder */}
      <CampaignBuilder />
    </>
  );
}

/* ─── CAMPAIGN BUILDER (folded into Problem→Solution, on the ink section) ─── */
const creatorLevelOptions = brandCreatorTypes.slice(0, 6).map((ct, i) => ({
  label: ct.name,
  emoji: ct.emoji,
  level: [
    "KOC Starter",
    "Trusted KOC",
    "Nano Creator",
    "Micro-Influencer",
    "Influencer",
    "Expert Creator",
  ][i],
}));

function CampaignBuilder() {
  const { lang } = useI18n();
  const tx = (en: string, zh: string) => (lang === "en" ? en : zh);
  const [goal, setGoal] = useState<string | null>(null);
  const [creatorIdx, setCreatorIdx] = useState<number | null>(null);
  const [format, setFormat] = useState<string | null>(null);

  const selectedLevel = creatorIdx !== null ? creatorLevelOptions[creatorIdx].level : null;
  const output = useMemo(() => {
    if (!goal || !selectedLevel || !format) return null;
    return getBuilderOutput(goal, selectedLevel, format);
  }, [goal, selectedLevel, format]);

  return (
    <section className="bg-[var(--color-ink)] border-y-2 border-foreground py-16 md:py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-acid mb-3">
          {tx("03 / Campaign Builder", "03 / 活動建立器")}
        </p>
        <h2 className="font-display text-3xl sm:text-4xl text-paper mb-2 tracking-tight">
          {tx("Shape the fix in three taps", "三步砌出你嘅活動方案")}
        </h2>
        <p className="text-paper/70 mb-10">
          {tx(
            "Frontend prototype — pick your goal, creator level, and format.",
            "前端原型 — 揀目標、創作者等級同內容形式。",
          )}
        </p>

        <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
          {/* Steps */}
          <div className="space-y-7">
            {/* Step 1: Goal */}
            <div>
              <div className="flex items-center gap-3 mb-3">
                <span className="h-8 w-8 rounded-md bg-acid border-2 border-foreground text-foreground font-mono text-xs font-bold inline-flex items-center justify-center shadow-[2px_2px_0_0_#000]">
                  01
                </span>
                <h3 className="font-heading font-bold text-paper text-lg">{tx("Goal", "目標")}</h3>
              </div>
              <div className="flex flex-wrap gap-2">
                {builderGoals.map((g) => {
                  const active = goal === g;
                  return (
                    <button
                      key={g}
                      type="button"
                      onClick={() => setGoal(g)}
                      className={active ? "filter-pill filter-pill-active" : "filter-pill"}
                    >
                      {g}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Step 2: Creator Level */}
            <div>
              <div className="flex items-center gap-3 mb-3">
                <span className="h-8 w-8 rounded-md bg-[var(--color-violet)] border-2 border-foreground text-paper font-mono text-xs font-bold inline-flex items-center justify-center shadow-[2px_2px_0_0_#000]">
                  02
                </span>
                <h3 className="font-heading font-bold text-paper text-lg">
                  {tx("Creator Level", "創作者等級")}
                </h3>
              </div>
              <div className="flex flex-wrap gap-2">
                {creatorLevelOptions.map((opt, i) => {
                  const active = creatorIdx === i;
                  return (
                    <button
                      key={opt.label}
                      type="button"
                      onClick={() => setCreatorIdx(i)}
                      className={active ? "filter-pill filter-pill-active" : "filter-pill"}
                    >
                      <span aria-hidden="true">{opt.emoji}</span> {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Step 3: Format */}
            <div>
              <div className="flex items-center gap-3 mb-3">
                <span className="h-8 w-8 rounded-md bg-foreground border-2 border-paper text-acid font-mono text-xs font-bold inline-flex items-center justify-center shadow-[2px_2px_0_0_#000]">
                  03
                </span>
                <h3 className="font-heading font-bold text-paper text-lg">{tx("Format", "內容形式")}</h3>
              </div>
              <div className="flex flex-wrap gap-2">
                {builderFormats.map((f) => {
                  const active = format === f;
                  return (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setFormat(f)}
                      className={active ? "filter-pill filter-pill-active" : "filter-pill"}
                    >
                      {f}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Output Card */}
          <aside className="rounded-2xl bg-white border-2 border-foreground p-6 h-fit lg:sticky lg:top-24 shadow-[6px_6px_0_0_#D4FF00]">
            <p className="tag-mono mb-2">{tx("Suggested Package", "建議方案")}</p>
            {output ? (
              <>
                <h3 className="font-display text-2xl font-bold text-foreground leading-tight tracking-tight">
                  {output.packageName}
                </h3>
                <p className="text-sm text-soft-ink mt-1">
                  {tx("Creator mix", "創作者組合")}: {output.creatorMix}
                </p>
                <ul className="mt-5 space-y-2 text-sm">
                  {output.deliverables.map((d) => (
                    <li key={d} className="flex gap-2 text-foreground">
                      <Check className="h-4 w-4 text-foreground shrink-0 mt-0.5" strokeWidth={3} />
                      <span>{d}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-4 rounded-xl bg-acid border-2 border-foreground px-4 py-3">
                  <p className="text-[10px] font-mono uppercase tracking-[0.1em] text-foreground/70 mb-1">
                    {tx("Measurement", "量度指標")}
                  </p>
                  <p className="text-sm text-foreground font-bold">{output.measurement}</p>
                </div>
                <Link to="/contact" className="btn-primary w-full justify-center mt-5">
                  <Sparkles className="h-4 w-4" />
                  {tx("Launch this campaign", "啟動呢個活動")}
                </Link>
              </>
            ) : (
              <p className="mt-3 text-sm text-soft-ink">
                {tx(
                  "Make selections above to see a recommended campaign package.",
                  "喺上面揀選項，就會出現建議活動方案。",
                )}
              </p>
            )}
          </aside>
        </div>
      </div>
    </section>
  );
}

/* ─── 15. DASHBOARD PREVIEW — product UI panel stack ─── */
const metricAccents = ["#D4FF00", "#FF3D7F", "#7C5CFF", "#00E5FF"];

const dashboardRoster = [
  { name: "@mei.makes", platform: "IG", tag: "Beauty KOC", lvl: "L4", posts: 6, fit: "94%" },
  { name: "@kai.eats", platform: "TikTok", tag: "F&B Micro", lvl: "L3", posts: 4, fit: "88%" },
  { name: "@nova.live", platform: "IG", tag: "Live Host", lvl: "L5", posts: 9, fit: "91%" },
  { name: "@joy.fit", platform: "YT", tag: "Wellness", lvl: "L2", posts: 3, fit: "85%" },
];

function BrandDashboard() {
  const { lang } = useI18n();
  const tx = (en: string, zh: string) => (lang === "en" ? en : zh);

  return (
    <section className="py-16 md:py-20 border-t-2 border-foreground bg-paper">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <p className="tag-mono mb-3">{tx("04 / Dashboard", "04 / 儀錶板")}</p>
        <h2 className="font-display text-3xl sm:text-4xl text-foreground mb-2 tracking-tight">
          {tx("See every campaign as live product", "每個活動 = 一個即時產品畫面")}
        </h2>
        <p className="text-soft-ink mb-8 max-w-2xl">
          {tx(
            "A look at the operator view — matched creator roster, post progress, and campaign metrics in one place.",
            "操作員視圖一覽 — 配對創作者名單、發文進度同活動指標，全部喺同一版。",
          )}
        </p>

        {/* Mock operator dashboard chrome */}
        <div className="rounded-[var(--radius)] border-2 border-foreground bg-white shadow-[6px_6px_0_0_#0A0A0A] overflow-hidden">
          {/* window bar */}
          <div className="flex items-center gap-2 px-4 py-3 border-b-2 border-foreground bg-[var(--color-ink)]">
            <span className="h-3 w-3 rounded-full bg-[var(--color-magenta-pop)] border border-paper/40" />
            <span className="h-3 w-3 rounded-full bg-acid border border-paper/40" />
            <span className="h-3 w-3 rounded-full bg-[var(--color-cyan)] border border-paper/40" />
            <span className="ml-3 font-mono text-[10px] uppercase tracking-[0.14em] text-paper/80">
              {tx("Adfocate · Operator", "Adfocate · 操作員")}
            </span>
            <span className="ml-auto inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-acid">
              <BarChart3 className="h-3.5 w-3.5" strokeWidth={2.5} />
              {tx("Live", "即時")}
            </span>
          </div>

          {/* metric strip */}
          <div className="grid gap-px bg-foreground border-b-2 border-foreground grid-cols-2 sm:grid-cols-4">
            {brandDashboardMetrics.map((m, i) => (
              <div
                key={m.label}
                className="bg-white p-4"
                style={{ borderTop: `4px solid ${metricAccents[i % metricAccents.length]}` }}
              >
                <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-soft-ink mb-1">
                  {m.label}
                </p>
                <p className="font-display text-2xl text-foreground tracking-tight">{m.value}</p>
                <div className="mt-1.5">
                  <span className={`metric-badge ${m.up ? "metric-up" : "metric-down"}`}>
                    {m.up ? "↑" : "↓"} {m.change}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* roster rows */}
          <div className="p-4 sm:p-5">
            <div className="flex items-center gap-2 mb-3">
              <Target className="h-4 w-4 text-foreground" strokeWidth={2.5} />
              <h3 className="font-heading font-bold text-foreground text-sm tracking-tight">
                {tx("Matched creator roster", "配對創作者名單")}
              </h3>
            </div>
            {/* header */}
            <div className="hidden sm:grid grid-cols-[1.4fr_0.8fr_0.6fr_0.6fr] gap-3 px-3 pb-2 font-mono text-[9px] uppercase tracking-[0.14em] text-soft-ink">
              <span>{tx("Creator", "創作者")}</span>
              <span>{tx("Type", "類型")}</span>
              <span>{tx("Posts", "發文")}</span>
              <span>{tx("Fit", "契合")}</span>
            </div>
            <div className="space-y-2">
              {dashboardRoster.map((r) => (
                <div
                  key={r.name}
                  className="grid grid-cols-2 sm:grid-cols-[1.4fr_0.8fr_0.6fr_0.6fr] gap-3 items-center rounded-xl border-2 border-foreground bg-paper px-3 py-2.5"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="h-7 w-7 rounded-full bg-[var(--color-violet)] border-2 border-foreground inline-flex items-center justify-center text-paper font-mono text-[9px] font-bold shrink-0">
                      {r.lvl}
                    </span>
                    <span className="font-heading font-bold text-foreground text-sm truncate">
                      {r.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="platform-tag">{r.platform}</span>
                    <span className="hidden sm:inline text-xs text-soft-ink truncate">{r.tag}</span>
                  </div>
                  <div className="font-mono text-xs text-foreground">
                    <span className="sm:hidden font-normal text-soft-ink">
                      {tx("Posts", "發文")}:{" "}
                    </span>
                    {r.posts}
                  </div>
                  <div>
                    <span className="metric-badge metric-up">↑ {r.fit}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* closing CTA — folded from former dedicated CTA section */}
        <div className="mt-10 rounded-[var(--radius)] border-2 border-foreground bg-acid p-7 sm:p-10 flex flex-col sm:flex-row sm:items-center gap-5 shadow-[6px_6px_0_0_#0A0A0A]">
          <div className="flex-1">
            <h3 className="font-display text-2xl sm:text-3xl text-foreground tracking-tight leading-tight">
              {tx("Tell us your goal. We'll shape the workflow.", "話俾我哋知你嘅目標，我哋幫你砌好流程。")}
            </h3>
            <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.12em] text-foreground/70">
              {tx("Hong Kong · structured · measurable", "香港 · 結構化 · 可量度")}
            </p>
          </div>
          <Link to="/contact" className="btn-ink shrink-0">
            <Sparkles className="h-4 w-4" />
            {tx("Contact Adfocate", "聯絡 Adfocate")}
          </Link>
        </div>
      </div>
    </section>
  );
}
