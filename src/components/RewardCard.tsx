import { Star } from "lucide-react";

export function RewardCard({
  name,
  pointsCost,
  stockRemaining,
  imageUrl,
  footer,
}: {
  name: string;
  pointsCost: number;
  stockRemaining: number;
  imageUrl?: string;
  footer?: React.ReactNode;
}) {
  const soldOut = stockRemaining <= 0;
  return (
    <article className="pastel-card relative flex flex-col overflow-hidden rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-0">
      <div className="relative h-32 w-full border-b-2 border-[var(--color-ink)] bg-[var(--color-muted,#E4E4E4)]">
        {imageUrl ? <img src={imageUrl} alt="" className="h-full w-full object-cover" /> : null}
        {soldOut && (
          <span className="absolute inset-0 grid place-items-center bg-black/55 font-heading font-bold text-white">已換罄</span>
        )}
      </div>
      <div className="p-3">
        <h3 className="line-clamp-2 font-heading font-semibold">{name}</h3>
        <p className="mt-1 flex items-center gap-1 font-bold text-[var(--color-ink)]">
          <Star size={14} className="text-[var(--color-magenta)]" aria-hidden /> {pointsCost} 積分
        </p>
        {footer}
      </div>
    </article>
  );
}
