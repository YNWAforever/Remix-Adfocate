import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { BrandReviewSubmissions } from "@/components/brand/BrandReviewSubmissions";
import { BrandReviewApplications } from "@/components/brand/BrandReviewApplications";
import { BrandReviewEngaged } from "@/components/brand/BrandReviewEngaged";

export const Route = createFileRoute("/brand/review")({ component: BrandReview });

type Tab = "submissions" | "applications" | "engaged";

function BrandReview() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("submissions");
  const tabs: { key: Tab; label: string }[] = [
    { key: "submissions", label: t("app.brand.review.tabSubmissions") },
    { key: "applications", label: t("app.brand.review.tabApplications") },
    { key: "engaged", label: t("app.brand.review.tabEngaged") },
  ];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {tabs.map((tb) => (
          <button
            key={tb.key}
            type="button"
            aria-pressed={tab === tb.key}
            onClick={() => setTab(tb.key)}
            className={
              tab === tb.key
                ? "rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-3 py-1 font-heading text-sm font-bold"
                : "rounded-full border-2 border-[var(--color-ink)] bg-white px-3 py-1 font-heading text-sm font-semibold text-[var(--color-soft-ink)]"
            }
          >
            {tb.label}
          </button>
        ))}
      </div>
      {tab === "submissions" && <BrandReviewSubmissions />}
      {tab === "applications" && <BrandReviewApplications />}
      {tab === "engaged" && <BrandReviewEngaged />}
    </div>
  );
}
