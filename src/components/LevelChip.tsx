import { Link } from "@tanstack/react-router";
import { progressToNext } from "@/lib/levels";

/** Compact level pill for the Profile page that links to the full Passport. */
export function LevelChip({ xp }: { xp: number }) {
  const { current } = progressToNext(xp);
  return (
    <Link
      to="/passport"
      className="inline-flex items-center gap-1 rounded-full border-2 border-[var(--color-ink)] bg-white px-3 py-1 text-sm font-bold"
    >
      <span aria-hidden>{current.emoji}</span>
      <span>{current.label}</span>
      <span>· 看護照 →</span>
    </Link>
  );
}
