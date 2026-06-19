import { Link } from "@tanstack/react-router";
import { progressToNext } from "@/lib/levels";

/** Compact level pill for the Profile page that links to the full Passport. */
export function LevelChip({ xp }: { xp: number }) {
  const { current } = progressToNext(xp);
  return (
    <Link
      to="/passport"
      className="inline-flex max-w-full items-center gap-1 rounded-full border-2 border-[var(--color-ink)] bg-white px-3 py-1 text-sm font-bold"
    >
      <span aria-hidden className="shrink-0">{current.emoji}</span>
      {/* Truncate only the label (English level names run long, e.g. "Micro-Influencer");
          the emoji and the "看護照" call-to-action stay visible so the chip never overflows
          a cramped mobile header. */}
      <span className="min-w-0 truncate">{current.label}</span>
      <span className="shrink-0">· 看護照 →</span>
    </Link>
  );
}
