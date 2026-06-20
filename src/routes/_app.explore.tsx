import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_app/explore")({ component: Explore });

function Explore() {
  const { t } = useI18n();
  const [open, setOpen] = useState<number | null>(null);

  const BENEFITS = useMemo(
    () => [
      { t: t("app.explore.benefit1Title"), d: t("app.explore.benefit1Desc") },
      { t: t("app.explore.benefit2Title"), d: t("app.explore.benefit2Desc") },
      { t: t("app.explore.benefit3Title"), d: t("app.explore.benefit3Desc") },
      { t: t("app.explore.benefit4Title"), d: t("app.explore.benefit4Desc") },
    ],
    [t],
  );

  const STEPS = useMemo(
    () => [
      { n: "01", t: t("app.explore.step1Title"), d: t("app.explore.step1Desc") },
      { n: "02", t: t("app.explore.step2Title"), d: t("app.explore.step2Desc") },
      { n: "03", t: t("app.explore.step3Title"), d: t("app.explore.step3Desc") },
      { n: "04", t: t("app.explore.step4Title"), d: t("app.explore.step4Desc") },
    ],
    [t],
  );

  const FAQ = useMemo(
    () => [
      { q: t("app.explore.faq1Q"), a: t("app.explore.faq1A") },
      { q: t("app.explore.faq2Q"), a: t("app.explore.faq2A") },
      { q: t("app.explore.faq3Q"), a: t("app.explore.faq3A") },
      { q: t("app.explore.faq4Q"), a: t("app.explore.faq4A") },
    ],
    [t],
  );

  return (
    <div className="mx-auto w-full max-w-lg space-y-6 p-4 lg:max-w-5xl">
      <h1 className="font-display text-2xl font-bold">{t("app.explore.pageTitle")}</h1>
      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <h2 className="mb-2 font-heading font-bold">{t("app.explore.benefitsHeading")}</h2>
          <div className="grid gap-3">
            {BENEFITS.map((b) => (
              <div key={b.t} className="pastel-card rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4">
                <p className="font-heading font-semibold">{b.t}</p>
                <p className="text-sm text-[var(--color-soft-ink)]">{b.d}</p>
              </div>
            ))}
          </div>
        </section>
        <div className="space-y-6">
          <section>
            <h2 className="mb-2 font-heading font-bold">{t("app.explore.stepsHeading")}</h2>
            <div className="pastel-card space-y-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4">
              {STEPS.map((s) => (
                <div key={s.n} className="flex gap-3">
                  <span className="font-display text-lg font-bold text-[var(--color-magenta)]">{s.n}</span>
                  <div>
                    <p className="font-heading font-semibold">{s.t}</p>
                    <p className="text-sm text-[var(--color-soft-ink)]">{s.d}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
          <section>
            <h2 className="mb-2 font-heading font-bold">{t("app.explore.faqHeading")}</h2>
            <div className="space-y-2">
              {FAQ.map((f, i) => (
                <div key={f.q} className="pastel-card overflow-hidden rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white">
                  <button
                    type="button"
                    aria-expanded={open === i}
                    aria-controls={`faq-panel-${i}`}
                    onClick={() => setOpen(open === i ? null : i)}
                    className="flex w-full items-center justify-between p-4 text-left font-heading font-semibold"
                  >
                    {f.q}{" "}
                    <ChevronDown size={18} className={open === i ? "rotate-180 transition" : "transition"} aria-hidden />
                  </button>
                  {open === i && (
                    <p id={`faq-panel-${i}`} role="region" aria-label={f.q} className="px-4 pb-4 text-sm text-[var(--color-soft-ink)]">
                      {f.a}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
