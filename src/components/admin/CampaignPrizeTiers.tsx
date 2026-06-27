// src/components/admin/CampaignPrizeTiers.tsx
// Repeatable prize-tier editor + a friendly client-side pre-check. The server
// (server/lib/campaignAuthoring.ts → validatePrizeTiers) re-validates authoritatively;
// these rules deliberately mirror it (ascending, non-overlapping, rank_from>=1,
// rank_to>=rank_from, non-negative) for an early, friendly error.
import type { CampaignPrizeTier } from "@/lib/admin";

// Inputs hold strings while editing; coerced to numbers on submit.
export type DraftTier = { rank_from: number | string; rank_to: number | string; cash: number | string; points: number | string; xp: number | string };

export function emptyTier(): DraftTier {
  return { rank_from: 1, rank_to: 1, cash: 0, points: 0, xp: 0 };
}

export function toPrizeTiers(tiers: DraftTier[]): CampaignPrizeTier[] {
  return tiers.map((t) => ({
    rank_from: Number(t.rank_from), rank_to: Number(t.rank_to),
    cash: Number(t.cash), points: Number(t.points), xp: Number(t.xp),
  }));
}

export function fromPrizeTiers(tiers: CampaignPrizeTier[]): DraftTier[] {
  return (tiers ?? []).map((t) => ({ ...t }));
}

export function validateTiersClient(tiers: DraftTier[]): { ok: boolean; error?: string } {
  let prevTo = 0;
  for (const raw of tiers) {
    const rank_from = Number(raw.rank_from);
    const rank_to = Number(raw.rank_to);
    const cash = Number(raw.cash);
    const points = Number(raw.points);
    const xp = Number(raw.xp);
    if (!Number.isInteger(rank_from) || !Number.isInteger(rank_to)) return { ok: false, error: "名次必須是整數" };
    if (rank_from < 1) return { ok: false, error: "起始名次必須 >= 1" };
    if (rank_to < rank_from) return { ok: false, error: "結束名次必須 >= 起始名次" };
    if (rank_from <= prevTo) return { ok: false, error: "名次階級必須遞增且不重疊" };
    if (cash < 0 || points < 0 || xp < 0) return { ok: false, error: "獎金/分數/XP 不可為負" };
    prevTo = rank_to;
  }
  return { ok: true };
}

const cell = "h-8 w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white px-1 text-sm disabled:opacity-50";

export function PrizeTierEditor({
  tiers, onChange, disabled = false,
}: {
  tiers: DraftTier[];
  onChange: (next: DraftTier[]) => void;
  disabled?: boolean;
}) {
  const set = (i: number, key: keyof DraftTier, value: string) => {
    onChange(tiers.map((t, idx) => (idx === i ? { ...t, [key]: value } : t)));
  };
  const remove = (i: number) => onChange(tiers.filter((_, idx) => idx !== i));
  const add = () => onChange([...tiers, emptyTier()]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-[var(--color-soft-ink)]">名次獎品階級</p>
        {!disabled ? (
          <button type="button" onClick={add} className="rounded-full border-2 border-[var(--color-ink)] bg-white px-2 py-0.5 text-xs font-bold">+ 加入階級</button>
        ) : null}
      </div>
      {tiers.length === 0 ? <p className="text-xs text-[var(--color-soft-ink)]">尚無名次獎品。</p> : null}
      <div className="space-y-2">
        {tiers.map((t, i) => (
          <div key={i} className="grid grid-cols-6 items-end gap-1 rounded-[var(--radius)] border border-[var(--color-soft-ink)] p-2">
            <label className="space-y-0.5">
              <span className="block text-[10px] text-[var(--color-soft-ink)]">起始名次</span>
              <input aria-label={`tier-${i}-rank-from`} type="number" min={1} value={t.rank_from} disabled={disabled} onChange={(e) => set(i, "rank_from", e.target.value)} className={cell} />
            </label>
            <label className="space-y-0.5">
              <span className="block text-[10px] text-[var(--color-soft-ink)]">結束名次</span>
              <input aria-label={`tier-${i}-rank-to`} type="number" min={1} value={t.rank_to} disabled={disabled} onChange={(e) => set(i, "rank_to", e.target.value)} className={cell} />
            </label>
            <label className="space-y-0.5">
              <span className="block text-[10px] text-[var(--color-soft-ink)]">現金</span>
              <input aria-label={`tier-${i}-cash`} type="number" min={0} value={t.cash} disabled={disabled} onChange={(e) => set(i, "cash", e.target.value)} className={cell} />
            </label>
            <label className="space-y-0.5">
              <span className="block text-[10px] text-[var(--color-soft-ink)]">分數</span>
              <input aria-label={`tier-${i}-points`} type="number" min={0} value={t.points} disabled={disabled} onChange={(e) => set(i, "points", e.target.value)} className={cell} />
            </label>
            <label className="space-y-0.5">
              <span className="block text-[10px] text-[var(--color-soft-ink)]">XP</span>
              <input aria-label={`tier-${i}-xp`} type="number" min={0} value={t.xp} disabled={disabled} onChange={(e) => set(i, "xp", e.target.value)} className={cell} />
            </label>
            <div>
              {!disabled ? (
                <button type="button" onClick={() => remove(i)} aria-label={`移除第 ${i + 1} 個獎品階級`} className="h-8 rounded-full border-2 border-[var(--color-ink)] bg-white px-2 text-xs font-bold">移除</button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
