// src/components/admin/TrendChart.tsx
import { useId } from "react";
import { useI18n } from "@/lib/i18n";

export type TrendPoint = { bucket: string; joined: number; submitted: number; approved: number };

const SERIES = [
  { key: "joined", stroke: "var(--color-ink)" },
  { key: "submitted", stroke: "var(--color-cyan)" },
  { key: "approved", stroke: "var(--color-acid)" },
] as const;

const W = 640;
const H = 200;
const PAD = 24;

export function TrendChart({ data }: { data: TrendPoint[] }) {
  const { t } = useI18n();
  const titleId = useId();
  const allZero = data.every((d) => d.joined === 0 && d.submitted === 0 && d.approved === 0);

  if (data.length === 0 || allZero) {
    return (
      <div className="flex h-[200px] items-center justify-center rounded-[var(--radius)] border-2 border-dashed border-[var(--color-soft-ink)] text-sm text-[var(--color-soft-ink)]">
        {t("app.insights.trendEmpty")}
      </div>
    );
  }

  const max = Math.max(1, ...data.flatMap((d) => [d.joined, d.submitted, d.approved]));
  const x = (i: number) =>
    PAD + (data.length === 1 ? (W - 2 * PAD) / 2 : (i * (W - 2 * PAD)) / (data.length - 1));
  const y = (v: number) => H - PAD - (v / max) * (H - 2 * PAD);
  const path = (key: "joined" | "submitted" | "approved") =>
    data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-labelledby={titleId}>
      <title id={titleId}>{t("app.insights.trendTitle")}</title>
      <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="var(--color-ink)" strokeWidth="1.5" />
      {SERIES.map((s) => (
        <path
          key={s.key}
          d={path(s.key)}
          fill="none"
          stroke={s.stroke}
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}
