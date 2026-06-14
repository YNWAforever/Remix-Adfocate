/** An SVG circular gauge for a single passport score. `value` is 0..100, or `null` for a
 *  locked score (Content / Brand Safety, or a computed score with no source data yet),
 *  which renders a greyed ring with "敬請期待". A real 0 renders the value, not the lock. */
export function ScoreRing({
  value,
  label,
  accent,
}: {
  value: number | null;
  label: string;
  accent: string;
}) {
  const r = 32;
  const circ = 2 * Math.PI * r;
  const locked = value === null;
  const pct = locked ? 0 : Math.max(0, Math.min(100, value));
  const dash = (pct / 100) * circ;

  return (
    <div className="flex flex-col items-center gap-1">
      <svg viewBox="0 0 80 80" className="h-20 w-20 -rotate-90" aria-hidden>
        <circle cx="40" cy="40" r={r} fill="none" stroke="var(--color-ink)" strokeWidth="6" opacity="0.12" />
        {!locked && (
          <circle
            cx="40"
            cy="40"
            r={r}
            fill="none"
            stroke={accent}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circ}`}
          />
        )}
      </svg>
      <span className="font-heading text-sm font-bold">{label}</span>
      <span className="text-xs text-[var(--color-soft-ink)]">{locked ? "敬請期待" : value}</span>
    </div>
  );
}
