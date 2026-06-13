export function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="xp-bar h-2 w-full overflow-hidden rounded-full border-[1.5px] border-[var(--color-ink)] bg-white" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max} aria-label="進度">
      <div className="h-full bg-[var(--color-acid)]" style={{ width: `${pct}%` }} />
    </div>
  );
}
