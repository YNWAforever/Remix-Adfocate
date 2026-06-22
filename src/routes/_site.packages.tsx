import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, ArrowRight, ArrowUpRight } from "lucide-react";
import {
  legacyActivationServices,
  localized,
} from "@/data/legacyAdfocateContent";
import { packages, type PackageCard } from "@/data/mockData";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_site/packages")({
  component: PackagesPage,
});

// Acid Y2K accent per legacy color key — used as the card top-edge + dot.
const ACCENT: Record<string, string> = {
  pink: "var(--color-magenta)",
  yellow: "var(--color-acid)",
  mint: "var(--color-cyan)",
  blue: "var(--color-violet)",
  lilac: "var(--color-violet)",
};

// The recommended tier — surfaced with an acid border + sticker.
const RECOMMENDED_ID = "p4";

function PackagesPage() {
  return (
    <div>
      <HeroSection />
      <PackagesGridSection />
      <ServiceMapSection />
      <CustomCTASection />
    </div>
  );
}

// ─── 20. HERO — stacked center, minimalist ───
function HeroSection() {
  const { lang } = useI18n();
  const tx = (en: string, zh: string) => (lang === "en" ? en : zh);

  return (
    <section className="relative overflow-hidden bg-[var(--color-paper)]">
      <div className="dot-pattern absolute inset-0 opacity-40" aria-hidden="true" />
      <div className="relative mx-auto max-w-3xl px-4 py-20 text-center sm:py-28">
        <span className="sticker mx-auto mb-7 inline-block">
          {tx("Packages · 方案", "方案 · PACKAGES")}
        </span>
        <h1 className="font-display text-[var(--color-ink)]">
          {tx("Pick the plan that fits", "揀啱你嘅方案")}
          <span className="text-[var(--color-magenta)]">.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-[var(--color-soft-ink)] sm:text-lg">
          {tx(
            "Productized creator campaign formats. Start from a ready package, or mix and match with the Adfocate team for your specific brand goals.",
            "產品化嘅創作者活動格式。揀一個現成方案，或者同 Adfocate 團隊度身組合，配合你品牌嘅目標。",
          )}
        </p>
        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link to="/contact" className="btn-primary">
            {tx("Plan a campaign", "規劃活動")}
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link to="/playbooks" className="btn-ink">
            {tx("Browse playbooks", "瀏覽 Playbooks")}
          </Link>
        </div>
        <p className="mt-7 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-soft-ink)]">
          {tx(
            "12 formats · HK market · Mix & match",
            "12 種格式 · 香港市場 · 自由組合",
          )}
        </p>
      </div>
    </section>
  );
}

// ─── 21. PACKAGE GRID — pricing bento, recommended tier highlighted ───
function PackagesGridSection() {
  const { lang } = useI18n();
  const tx = (en: string, zh: string) => (lang === "en" ? en : zh);

  return (
    <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 md:py-20 lg:px-8">
      <header className="mb-10 max-w-2xl">
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-magenta)]">
          {tx("The menu", "活動菜單")}
        </span>
        <h2 className="mt-3 font-display text-[var(--color-ink)]">
          {tx("Every format, ready to launch", "每個格式，準備即開即用")}
        </h2>
        <p className="mt-4 text-[var(--color-soft-ink)]">
          {tx(
            "Each package is a tested creator workflow with a clear brief, deliverables, and a report. The Affiliate program is where most brands start.",
            "每個方案都係一條實測過嘅創作者流程，有清晰 Brief、交付物同報告。大部分品牌都係由 Affiliate 計劃開始。",
          )}
        </p>
      </header>

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {packages.map((pkg, i) => (
          <PackageTier
            key={pkg.id}
            pkg={pkg}
            index={i}
            recommended={pkg.id === RECOMMENDED_ID}
            tx={tx}
          />
        ))}
      </div>
    </section>
  );
}

function PackageTier({
  pkg,
  index,
  recommended,
  tx,
}: {
  pkg: PackageCard;
  index: number;
  recommended: boolean;
  tx: (en: string, zh: string) => string;
}) {
  const accent = ACCENT[pkg.color] ?? ACCENT.pink;

  return (
    <article
      className={cn(
        "pastel-card relative flex flex-col gap-4 animate-slide-up",
        "stagger-" + Math.min(index + 1, 8),
        recommended &&
          "lg:scale-[1.02] lg:shadow-[6px_6px_0_0_var(--color-acid)]",
      )}
      style={
        recommended
          ? { borderColor: "var(--color-acid)", borderWidth: "3px" }
          : undefined
      }
    >
      {recommended && (
        <span className="sticker absolute -right-2 -top-3 z-10">
          {tx("Recommended", "推薦")}
        </span>
      )}

      <div className="flex items-center justify-between">
        <span className="tag-mono">{tx("Package", "方案")}</span>
        <span
          className="h-3 w-3 rounded-full border-2 border-[var(--color-ink)]"
          style={{ background: accent }}
          aria-hidden="true"
        />
      </div>

      <h3 className="font-heading text-lg leading-snug text-[var(--color-ink)]">
        {pkg.title}
      </h3>

      <div className="rounded-xl border-2 border-[var(--color-ink)] bg-[var(--color-paper)] px-3 py-2.5">
        <span className="block font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-soft-ink)]">
          {tx("Best for", "最適合")}
        </span>
        <p className="mt-0.5 font-heading text-sm font-semibold text-[var(--color-ink)]">
          {pkg.bestFor}
        </p>
      </div>

      <div>
        <span className="mb-2 block font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-soft-ink)]">
          {tx("Deliverables", "交付物")}
        </span>
        <ul className="space-y-1.5">
          {pkg.deliverables.map((d) => (
            <li
              key={d}
              className="flex items-start gap-2 text-sm text-[var(--color-ink)]"
            >
              <Check
                className="mt-0.5 h-4 w-4 shrink-0"
                style={{ color: accent }}
                aria-hidden="true"
              />
              <span>{d}</span>
            </li>
          ))}
        </ul>
      </div>

      <Link
        to="/contact"
        className={cn("mt-auto", recommended ? "btn-primary" : "btn-ink")}
      >
        {tx("Talk to us", "聯絡我們")}
        <ArrowRight className="h-4 w-4" />
      </Link>
    </article>
  );
}

// ─── Service map — folded-in supporting band (preserves all 12 services) ───
function ServiceMapSection() {
  const { lang } = useI18n();
  const tx = (en: string, zh: string) => (lang === "en" ? en : zh);

  return (
    <section className="bg-[var(--color-paper)]">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-20 lg:px-8">
        <div className="grid items-start gap-8 lg:grid-cols-[320px_1fr]">
          <div className="lg:sticky lg:top-24">
            <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-magenta)]">
              {tx("Service map", "服務對照")}
            </span>
            <h2 className="mt-3 font-display text-[var(--color-ink)]">
              {localized(
                {
                  en: "Agency-grade services, packaged into creator workflows.",
                  zh: "實戰級服務，整理成可重複嘅創作者流程。",
                },
                lang,
              )}
            </h2>
            <p className="mt-4 text-[var(--color-soft-ink)]">
              {tx(
                "Every package above traces back to a service we have run for HK brands. Tap any to start a conversation.",
                "上面每個方案，都源自我哋為香港品牌實際執行過嘅服務。撳任何一個即可開始傾。",
              )}
            </p>
          </div>

          <ul className="grid gap-3 sm:grid-cols-2">
            {legacyActivationServices.map((service) => (
              <li key={service.id}>
                <Link
                  to="/contact"
                  className="game-card game-card-blue flex h-full flex-col gap-2"
                >
                  <span className="tag-mono w-fit">{service.modernHome}</span>
                  <p className="font-heading text-sm font-bold leading-snug text-[var(--color-ink)]">
                    {localized(service.title, lang)}
                  </p>
                  <span className="mt-auto inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-soft-ink)]">
                    {tx("Start", "開始")}
                    <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

// ─── 22. CUSTOM CTA — banner ───
function CustomCTASection() {
  const { lang } = useI18n();
  const tx = (en: string, zh: string) => (lang === "en" ? en : zh);

  return (
    <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-20 lg:px-8">
      <div className="relative overflow-hidden rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-acid)] p-8 shadow-[8px_8px_0_0_var(--color-ink)] sm:p-12 lg:p-14">
        <span
          className="pointer-events-none absolute -right-6 -top-10 select-none font-display text-[12rem] leading-none text-outline-ink opacity-20"
          aria-hidden="true"
        >
          +
        </span>
        <div className="relative grid items-center gap-7 lg:grid-cols-[1fr_auto]">
          <div className="max-w-xl">
            <h2 className="font-display text-[var(--color-ink)]">
              {tx("Need a custom package?", "需要客製方案？")}
            </h2>
            <p className="mt-3 text-[var(--color-ink)]/80">
              {tx(
                "Tell us your goal, budget, and timeline. We will design a tailored creator package for your brand, category, and audience.",
                "話俾我哋知你嘅目標、預算同時間表，我哋會為你嘅品牌、品類同受眾，設計度身嘅創作者方案。",
              )}
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row lg:flex-col">
            <Link to="/contact" className="btn-ink">
              {tx("Request custom package", "申請客製方案")}
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              to="/playbooks"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-card)] px-7 font-heading text-sm font-bold text-[var(--color-ink)] transition-colors hover:bg-[var(--color-paper)]"
            >
              {tx("Browse playbooks", "瀏覽 Playbooks")}
            </Link>
          </div>
        </div>
        <p className="relative mt-7 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-ink)]/70">
          {tx(
            "No retainer to start · HK market · Reply in 1 business day",
            "免綁約起步 · 香港市場 · 一個工作天內回覆",
          )}
        </p>
      </div>
    </section>
  );
}
