import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Sparkles, Check } from "lucide-react";
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
      <ProblemSolutionTable />
      <CreatorTypes />
      <CampaignBuilder />
      <BrandDashboard />
      <BrandsCTA />
    </div>
  );
}

/* ─── ACTIVATION MENU ─── */
function ActivationMenu() {
  const { lang } = useI18n();

  return (
    <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-20">
      <div className="grid gap-8 lg:grid-cols-[360px_1fr]">
        <div>
          <p className="tag-mono mb-3">
            {localized({ en: "01 / Activation Playbook", zh: "01 / 活動方案" }, lang)}
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
          <p className="mt-4 text-sm text-soft-ink leading-relaxed">
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

        <div className="grid gap-4 sm:grid-cols-2">
          {legacyActivationServices.map((service, i) => (
            <article
              key={service.id}
              className="rounded-2xl border-2 border-foreground bg-white p-5 shadow-[4px_4px_0_0_#0A0A0A]"
            >
              <div className="flex items-start gap-3">
                <span className="h-8 w-8 rounded-md bg-acid border-2 border-foreground inline-flex items-center justify-center text-foreground font-mono text-xs font-bold shrink-0">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div>
                  <h3 className="font-heading font-bold text-foreground text-sm leading-snug">
                    {localized(service.title, lang)}
                  </h3>
                  <p className="mt-1.5 text-xs text-soft-ink leading-relaxed">
                    {localized(service.summary, lang)}
                  </p>
                </div>
              </div>
              <div className="mt-4 grid gap-2">
                {service.outcomes.map((outcome) => (
                  <div key={outcome.en} className="flex items-start gap-2 text-xs text-foreground">
                    <Check
                      className="h-3.5 w-3.5 text-brand-mint shrink-0 mt-0.5"
                      strokeWidth={3}
                    />
                    <span>{localized(outcome, lang)}</span>
                  </div>
                ))}
              </div>
              <p className="mt-4 font-mono text-[9px] uppercase tracking-[0.14em] text-soft-ink">
                {localized(
                  {
                    en: `Service root: ${service.legacySource}`,
                    zh: `服務脈絡：${localized(service.title, "zh")}`,
                  },
                  lang,
                )}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── HERO ─── */
function BrandsHero() {
  const { t } = useI18n();
  return (
    <section className="relative overflow-hidden pt-12 pb-16 sm:pt-20 sm:pb-24 border-b-2 border-foreground bg-paper">
      <div
        className="absolute inset-0 pointer-events-none opacity-40"
        style={{
          backgroundImage: "radial-gradient(circle, #0A0A0A 1px, transparent 1px)",
          backgroundSize: "22px 22px",
        }}
      />
      <div className="absolute -top-10 -right-10 w-72 h-72 rounded-full bg-acid pointer-events-none" />
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <span className="sticker mb-6">For Brands</span>
        <h1 className="font-display text-4xl sm:text-6xl text-foreground max-w-3xl leading-[1.02] tracking-tight">
          {t("brands.hero.title")}{" "}
          <span className="bg-acid px-2 box-decoration-clone">measurable</span>
        </h1>
        <p className="mt-5 text-soft-ink max-w-2xl text-lg">
          Access KOLs, micro-influencers, KOCs, affiliates, live hosts, and community advocates with
          structured workflow, verified history, and measurable results.
        </p>
        <div className="mt-7 flex flex-wrap gap-3">
          <Link to="/contact" className="btn-primary">
            <Sparkles className="h-4 w-4" />
            Launch a Campaign
          </Link>
          <Link to="/packages" className="btn-ink">
            See Packages
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ─── PROBLEM / SOLUTION TABLE ─── */
function ProblemSolutionTable() {
  return (
    <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-20">
      <p className="tag-mono mb-3">02 / Pain → Fix</p>
      <h2 className="font-display text-3xl sm:text-4xl text-foreground mb-8 tracking-tight">
        Common problems · what Adfocate solves
      </h2>
      <div className="space-y-3">
        {problemSolutions.map((row, i) => (
          <div
            key={row.problem}
            className="grid gap-4 md:grid-cols-2 rounded-2xl bg-white border-2 border-foreground p-5 shadow-[4px_4px_0_0_#0A0A0A] hover:shadow-[6px_6px_0_0_#D4FF00] hover:-translate-x-0.5 hover:-translate-y-0.5 transition-all"
          >
            <div className="flex gap-3 items-start">
              <span className="h-7 w-7 rounded-md bg-foreground inline-flex items-center justify-center text-paper font-mono text-xs font-bold shrink-0">
                {String(i + 1).padStart(2, "0")}
              </span>
              <p className="text-sm text-soft-ink pt-1">{row.problem}</p>
            </div>
            <div className="flex gap-3 items-start">
              <span className="h-7 w-7 rounded-md bg-acid border-2 border-foreground inline-flex items-center justify-center text-foreground shrink-0">
                <Check className="h-4 w-4" strokeWidth={3} />
              </span>
              <p className="text-sm text-foreground font-bold pt-1">{row.solution}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ─── CREATOR TYPES ─── */
function CreatorTypes() {
  return (
    <section className="py-20 border-y-2 border-foreground bg-paper">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <p className="tag-mono mb-3">03 / Roster</p>
        <h2 className="font-display text-3xl sm:text-4xl text-foreground mb-8 tracking-tight">
          Creator Types
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {brandCreatorTypes.map((t) => (
            <article key={t.name} className="game-card flex flex-col gap-2 p-5">
              <span className="text-3xl">{t.emoji}</span>
              <h3 className="font-heading font-bold text-foreground text-sm leading-snug">
                {t.name}
              </h3>
              <p className="text-xs text-soft-ink leading-relaxed">{t.desc}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── CAMPAIGN BUILDER WIZARD ─── */
const creatorLevelOptions = brandCreatorTypes.slice(0, 6).map((t, i) => ({
  label: t.name,
  emoji: t.emoji,
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
  const [goal, setGoal] = useState<string | null>(null);
  const [creatorIdx, setCreatorIdx] = useState<number | null>(null);
  const [format, setFormat] = useState<string | null>(null);

  const selectedLevel = creatorIdx !== null ? creatorLevelOptions[creatorIdx].level : null;
  const output = useMemo(() => {
    if (!goal || !selectedLevel || !format) return null;
    return getBuilderOutput(goal, selectedLevel, format);
  }, [goal, selectedLevel, format]);

  return (
    <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-20">
      <p className="tag-mono mb-3">04 / Builder</p>
      <h2 className="font-display text-3xl sm:text-4xl text-foreground mb-2 tracking-tight">
        Campaign Builder
      </h2>
      <p className="text-soft-ink mb-10">
        Frontend prototype — pick your goal, creator level, and format.
      </p>

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        {/* Steps */}
        <div className="space-y-7">
          {/* Step 1: Goal */}
          <div>
            <div className="flex items-center gap-3 mb-3">
              <span className="h-8 w-8 rounded-md bg-acid border-2 border-foreground text-foreground font-mono text-xs font-bold inline-flex items-center justify-center shadow-[2px_2px_0_0_#0A0A0A]">
                01
              </span>
              <h3 className="font-heading font-bold text-foreground text-lg">Goal</h3>
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
              <span className="h-8 w-8 rounded-md bg-paper border-2 border-foreground text-foreground font-mono text-xs font-bold inline-flex items-center justify-center shadow-[2px_2px_0_0_#0A0A0A]">
                02
              </span>
              <h3 className="font-heading font-bold text-foreground text-lg">Creator Level</h3>
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
                    {opt.emoji} {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Step 3: Format */}
          <div>
            <div className="flex items-center gap-3 mb-3">
              <span className="h-8 w-8 rounded-md bg-foreground border-2 border-foreground text-acid font-mono text-xs font-bold inline-flex items-center justify-center shadow-[2px_2px_0_0_#0A0A0A]">
                03
              </span>
              <h3 className="font-heading font-bold text-foreground text-lg">Format</h3>
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
          <p className="tag-mono mb-2">Suggested Package</p>
          {output ? (
            <>
              <h3 className="font-display text-2xl font-bold text-foreground leading-tight tracking-tight">
                {output.packageName}
              </h3>
              <p className="text-sm text-soft-ink mt-1">Creator mix: {output.creatorMix}</p>
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
                  Measurement
                </p>
                <p className="text-sm text-foreground font-bold">{output.measurement}</p>
              </div>
              <Link to="/contact" className="btn-primary w-full justify-center mt-5">
                <Sparkles className="h-4 w-4" />
                Launch this campaign
              </Link>
            </>
          ) : (
            <p className="mt-3 text-sm text-soft-ink">
              Make selections above to see a recommended campaign package.
            </p>
          )}
        </aside>
      </div>
    </section>
  );
}

/* ─── BRAND DASHBOARD PREVIEW ─── */
const metricAccents = ["#D4FF00", "#FF3D7F", "#7C5CFF", "#00E5FF"];

function BrandDashboard() {
  return (
    <section className="py-20 border-y-2 border-foreground bg-paper">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <p className="tag-mono mb-3">05 / Dashboard</p>
        <h2 className="font-display text-3xl sm:text-4xl text-foreground mb-8 tracking-tight">
          Brand Dashboard Preview
        </h2>
        <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
          {brandDashboardMetrics.map((m, i) => (
            <div
              key={m.label}
              className="rounded-2xl bg-white border-2 border-foreground p-5 shadow-[4px_4px_0_0_#0A0A0A] hover:-translate-y-0.5 hover:-translate-x-0.5 hover:shadow-[6px_6px_0_0_#0A0A0A] transition-all"
              style={{
                borderLeftWidth: 8,
                borderLeftColor: metricAccents[i % metricAccents.length],
              }}
            >
              <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-soft-ink mb-1">
                {m.label}
              </p>
              <p className="font-display text-3xl text-foreground tracking-tight">{m.value}</p>
              <div className="mt-2">
                <span className={`metric-badge ${m.up ? "metric-up" : "metric-down"}`}>
                  {m.up ? "↑" : "↓"} {m.change}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── CTA ─── */
function BrandsCTA() {
  return (
    <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-24 text-center">
      <div className="inline-block bg-foreground text-paper px-8 py-12 sm:px-14 sm:py-16 rounded-3xl border-2 border-foreground shadow-[8px_8px_0_0_#D4FF00] max-w-3xl">
        <h2 className="font-display text-3xl sm:text-5xl max-w-2xl mx-auto leading-[1.05] tracking-tight">
          Tell us your goal.{" "}
          <span className="bg-acid text-foreground px-2 box-decoration-clone">
            We&apos;ll shape the workflow.
          </span>
        </h2>
        <Link to="/contact" className="btn-primary mt-8">
          <Sparkles className="h-4 w-4" />
          Contact Adfocate
        </Link>
      </div>
    </section>
  );
}
