import { Star, Clock } from "lucide-react";
import { BadgePill } from "./BadgePill";
import { useI18n } from "@/lib/i18n";

export function MissionCard({ title, category, points, deadline, imageUrl }: { title: string; category?: string; points: number; deadline?: string; imageUrl?: string }) {
  const { t } = useI18n();
  return (
    <article className="pastel-card flex gap-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-3">
      <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl border-2 border-[var(--color-ink)] bg-[var(--color-muted,#E4E4E4)]">
        {imageUrl ? <img src={imageUrl} alt="" className="h-full w-full object-cover" /> : null}
      </div>
      <div className="min-w-0 flex-1">
        {category && <BadgePill>{category}</BadgePill>}
        <h3 className="mt-1 line-clamp-2 font-heading font-semibold">{title}</h3>
        <div className="mt-1 flex items-center gap-3 text-sm text-[var(--color-soft-ink)]">
          <span className="flex items-center gap-1"><Star size={14} aria-hidden /> {t("app.mission.cardPoints", { n: points })}</span>
          {deadline && <span className="flex items-center gap-1"><Clock size={14} aria-hidden /> {deadline.slice(0, 10)}</span>}
        </div>
      </div>
    </article>
  );
}
