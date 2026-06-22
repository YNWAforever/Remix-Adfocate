import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  ArrowUpRight,
  Lightbulb,
  Target,
  BarChart3,
  BookOpen,
  FileText,
} from "lucide-react";
import { legacyPlaybookTopics, localized } from "@/data/legacyAdfocateContent";
import { playbooks } from "@/data/mockData";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_site/playbooks")({
  component: PlaybooksPage,
});

// Map each play's data color → an Acid Y2K card hover variant + accent token.
const playAccentMap: Record<
  string,
  { card: string; accentVar: string }
> = {
  pink: { card: "game-card-yellow", accentVar: "var(--color-magenta)" },
  yellow: { card: "game-card-yellow", accentVar: "var(--color-magenta)" },
  blue: { card: "game-card-blue", accentVar: "var(--color-cyan)" },
  mint: { card: "game-card-mint", accentVar: "var(--color-violet)" },
  lilac: { card: "game-card-blue", accentVar: "var(--color-violet)" },
};

const levelPillMap: Record<string, string> = {
  "KOC Starter": "level-pill-l1",
  "Trusted KOC": "level-pill-l2",
  "Nano Creator": "level-pill-l3",
  "Micro-KOL": "level-pill-l4",
  "Small KOL": "level-pill-l5",
};

function PlaybooksPage() {
  return (
    <div>
      <HeroSection />
      <IndustryPlaysSection />
      <TopicArchiveSection />
      <BottomCTASection />
    </div>
  );
}

/* ─────────────────────────── 1. HERO — dossier/archive index ─────────────────────────── */
function HeroSection() {
  const { lang } = useI18n();
  const tx = (en: string, zh: string) => (lang === "en" ? en : zh);

  return (
    <section className="relative overflow-hidden bg-[var(--color-paper)]">
      <div className="dot-pattern absolute inset-0 opacity-60" aria-hidden="true" />

      <div className="relative mx-auto max-w-6xl px-4 pt-12 pb-14 sm:pt-20 sm:pb-20">
        <div className="grid items-end gap-10 lg:grid-cols-[1.55fr_1fr]">
          {/* Off-grid editorial: title block bottom-left */}
          <div>
            <span className="sticker mb-6 inline-block">
              {tx("Creator Playbooks", "創作者 Playbooks")}
            </span>
            <h1 className="font-display max-w-3xl leading-[1.02]">
              {tx("Industry Playbooks", "創作者 Playbooks")}
              <span className="text-[var(--color-magenta)]">.</span>
            </h1>
            <p className="mt-5 max-w-xl text-sm leading-relaxed text-[var(--color-soft-ink)] sm:text-base">
              {tx(
                "An open archive of campaign formats and creator activation ideas, filed by industry. Pull the play that fits your sector — from Beauty to Finance.",
                "一個公開的 Playbook 檔案庫，按行業分類嘅活動格式同創作者啟動點子。揀返啱你行業嘅一份 — 由美妝到金融。",
              )}
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-2.5">
              <span className="tag-mono">{tx("Filed by industry", "按行業分類")}</span>
              <span className="tag-mono">{tx("Field-tested", "實戰驗證")}</span>
              <span className="tag-mono">{tx("Always open", "持續更新")}</span>
            </div>
          </div>

          {/* Artifact: an "archive index" card with the second-read numeral */}
          <aside
            className="pastel-card relative p-6 sm:p-7"
            aria-label={tx("Playbook archive index", "Playbook 檔案索引")}
          >
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-soft-ink)]">
                {tx("Archive index", "檔案索引")}
              </span>
              <FileText className="h-4 w-4 text-[var(--color-ink)]" aria-hidden="true" />
            </div>

            {/* SECOND-READ MOMENT: one oversized stroked numeral */}
            <div className="mt-3 flex items-end gap-3">
              <span className="text-outline-ink font-display text-7xl leading-none sm:text-8xl">
                {playbooks.length}
              </span>
              <span className="mb-2 max-w-[8rem] font-heading text-sm leading-snug text-[var(--color-ink)]">
                {tx("industry plays on file", "份行業 Playbook")}
              </span>
            </div>

            <div className="mt-5 space-y-2 border-t-2 border-dashed border-[var(--color-ink)]/15 pt-4">
              {playbooks.slice(0, 3).map((pb, i) => (
                <div
                  key={pb.industry.en}
                  className="flex items-center gap-2.5 text-sm text-[var(--color-ink)]"
                >
                  <span className="font-mono text-[11px] text-[var(--color-soft-ink)]">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span aria-hidden="true">{pb.emoji}</span>
                  <span className="font-heading">{localized(pb.industry, lang)}</span>
                </div>
              ))}
              <div className="flex items-center gap-2.5 pt-1 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--color-soft-ink)]">
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                {tx("and more below", "下方更多")}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────── 2. INDUSTRY PLAYS — gapless bento ─────────────────────────── */
function IndustryPlaysSection() {
  const { lang } = useI18n();
  const tx = (en: string, zh: string) => (lang === "en" ? en : zh);

  return (
    <section className="mx-auto max-w-6xl px-4 py-16 md:py-20">
      <div className="mb-9 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-soft-ink)]">
            {tx("01 · Industry plays", "01 · 行業 Playbook")}
          </span>
          <h2 className="mt-2 max-w-2xl leading-tight">
            {tx("Pick the play that fits your sector.", "揀返一份啱你行業嘅打法。")}
          </h2>
        </div>
        <p className="max-w-sm text-sm leading-relaxed text-[var(--color-soft-ink)]">
          {tx(
            "Each play maps creator levels, campaign ideas, the creator angle, and what to measure.",
            "每份 Playbook 都對應創作者等級、活動點子、創作者切入角度同要量度嘅指標。",
          )}
        </p>
      </div>

      {/* Gapless bento 2-col with hairline dividers between cards */}
      <div className="grid overflow-hidden rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-ink)] shadow-[6px_6px_0_var(--color-ink)] sm:grid-cols-2 [&>article]:border-[var(--color-ink)]">
        {playbooks.map((pb, i) => {
          const accent = playAccentMap[pb.color] ?? playAccentMap.pink;
          return (
            <article
              key={pb.industry.en}
              className={cn(
                "group flex flex-col gap-4 bg-[var(--color-card)] p-6 transition-colors sm:p-7",
                "border-b-2 last:border-b-0 sm:[&:nth-last-child(-n+2)]:border-b-0",
                "sm:[&:nth-child(odd)]:border-r-2",
                "animate-slide-up",
                "stagger-" + Math.min(i + 1, 6),
              )}
            >
              {/* Header row */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="text-3xl" aria-hidden="true">
                    {pb.emoji}
                  </span>
                  <h3 className="font-display text-xl leading-tight text-[var(--color-ink)] sm:text-2xl">
                    {localized(pb.industry, lang)}
                  </h3>
                </div>
                <span
                  className="mt-1 h-3 w-3 shrink-0 rounded-full border-2 border-[var(--color-ink)]"
                  style={{ background: accent.accentVar }}
                  aria-hidden="true"
                />
              </div>

              {/* Level chips */}
              <div className="flex flex-wrap gap-1.5">
                {pb.levels.map((level) => (
                  <span
                    key={level.en}
                    className={cn("level-pill text-[10px]", levelPillMap[level.en] ?? "level-pill-l1")}
                  >
                    {localized(level, lang)}
                  </span>
                ))}
              </div>

              {/* Campaign ideas */}
              <div>
                <span className="mb-2 block font-mono text-[10px] uppercase tracking-[0.15em] text-[var(--color-soft-ink)]">
                  {tx("Campaign ideas", "活動點子")}
                </span>
                <ul className="grid gap-1.5 sm:grid-cols-2">
                  {pb.ideas.map((idea) => (
                    <li
                      key={idea}
                      className="flex items-start gap-2 text-sm leading-snug text-[var(--color-ink)]"
                    >
                      <span
                        className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ background: accent.accentVar }}
                        aria-hidden="true"
                      />
                      <span>{idea}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Angle + Measurement */}
              <div className="mt-auto grid gap-3 border-t-2 border-dashed border-[var(--color-ink)]/12 pt-4 sm:grid-cols-2">
                <div>
                  <div className="mb-1 flex items-center gap-1.5">
                    <Target className="h-3.5 w-3.5 text-[var(--color-ink)]" aria-hidden="true" />
                    <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--color-soft-ink)]">
                      {tx("Creator angle", "創作者切入")}
                    </span>
                  </div>
                  <p className="text-xs leading-relaxed text-[var(--color-ink)]">
                    {localized(pb.creatorAngle, lang)}
                  </p>
                </div>
                <div>
                  <div className="mb-1 flex items-center gap-1.5">
                    <BarChart3 className="h-3.5 w-3.5 text-[var(--color-ink)]" aria-hidden="true" />
                    <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--color-soft-ink)]">
                      {tx("Measurement focus", "量度重點")}
                    </span>
                  </div>
                  <p className="text-xs leading-relaxed text-[var(--color-ink)]">
                    {pb.measurementFocus}
                  </p>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

/* ─────────────────────────── 3. TOPIC ARCHIVE — gallery cadence ─────────────────────────── */
function TopicArchiveSection() {
  const { lang } = useI18n();

  return (
    <section className="border-t-2 border-[var(--color-ink)]/10 bg-[var(--color-paper)]">
      <div className="mx-auto max-w-6xl px-4 py-16 md:py-20">
        <div className="mb-9 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-soft-ink)]">
              {localized({ en: "02 · From Adfocate insights", zh: "02 · 源自 Adfocate 洞察" }, lang)}
            </span>
            <h2 className="mt-2 max-w-2xl leading-tight">
              {localized(
                {
                  en: "Agency insights, rebuilt as working playbooks.",
                  zh: "把實戰洞察，整理成可執行 Playbook。",
                },
                lang,
              )}
            </h2>
          </div>
          <p className="max-w-md text-sm leading-relaxed text-[var(--color-soft-ink)]">
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
          {legacyPlaybookTopics.map((topic, i) => (
            <article
              key={topic.id}
              className={cn("pastel-card flex flex-col p-5", "animate-slide-up", "stagger-" + Math.min(i + 1, 6))}
            >
              <div className="mb-3 flex items-start justify-between gap-3">
                <span className="tag-mono">{localized(topic.industry, lang)}</span>
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-soft-ink)]">
                  {localized({ en: topic.format, zh: "Playbook" }, lang)}
                </span>
              </div>
              <h3 className="font-heading text-sm font-bold leading-snug text-[var(--color-ink)]">
                {localized(topic.title, lang)}
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-[var(--color-soft-ink)]">
                {localized(topic.summary, lang)}
              </p>
              <ul className="mt-4 space-y-2">
                {topic.takeaways.map((takeaway) => (
                  <li
                    key={takeaway.en}
                    className="flex items-start gap-2 text-xs leading-relaxed text-[var(--color-ink)]"
                  >
                    <Lightbulb
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-magenta)]"
                      aria-hidden="true"
                    />
                    <span>{localized(takeaway, lang)}</span>
                  </li>
                ))}
              </ul>
              <a
                href={topic.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-flex items-center gap-1.5 pt-2 font-heading text-sm font-bold text-[var(--color-ink)] transition-all hover:gap-2.5"
              >
                {localized({ en: "Reference", zh: "參考來源" }, lang)}
                <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
              </a>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────── 4. CTA — the one ink section ─────────────────────────── */
function BottomCTASection() {
  const { lang } = useI18n();
  const tx = (en: string, zh: string) => (lang === "en" ? en : zh);

  return (
    <section className="mx-auto max-w-6xl px-4 pb-20 pt-4">
      <div className="relative overflow-hidden rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-ink)] p-8 shadow-[6px_6px_0_var(--color-ink)] sm:p-12 lg:p-14">
        <div className="dot-pattern absolute inset-0 opacity-20" aria-hidden="true" />
        <div className="relative grid items-center gap-7 lg:grid-cols-[1fr_auto]">
          <div>
            <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-acid)]">
              {tx("03 · Custom playbook", "03 · 客製 Playbook")}
            </span>
            <h2 className="mt-3 max-w-2xl leading-tight text-[var(--color-paper)]">
              {tx("Want a custom playbook for your brand?", "想要為品牌度身訂造嘅 Playbook？")}
            </h2>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-[var(--color-paper)]/75">
              {tx(
                "Our team can design a tailored creator activation playbook for your industry, goals, and budget.",
                "我哋團隊可以按你嘅行業、目標同預算，設計一份專屬嘅創作者啟動 Playbook。",
              )}
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row lg:flex-col">
            <Link to="/contact" className="btn-primary">
              <BookOpen className="h-4 w-4" aria-hidden="true" />
              {tx("Request playbook", "索取 Playbook")}
            </Link>
            <Link to="/packages" className="btn-ink border-[var(--color-paper)] bg-[var(--color-card)] text-[var(--color-ink)]">
              {tx("View packages", "查看方案")}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
