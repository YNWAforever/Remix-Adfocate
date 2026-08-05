// Pure shaper for the campaign leaderboard. rank_campaign (SECURITY DEFINER) does the ranking;
// this only decorates rows with public creator profile fields and coerces PostgREST numerics.

export type RankRow = { creator_id: string; rank: number; approved: number; avg_quality: number };
export type CreatorProfile = { id: string; display_name: string | null; avatar_url?: string | null; level?: number | null };
export type LeaderboardEntry = {
  creator_id: string; rank: number; approved: number; avg_quality: number;
  display_name: string; avatar_url: string | null; level: number;
  movement: number | null;
};

export function num(v: unknown): number {
  if (typeof v === "number") return Number.isNaN(v) ? 0 : v;
  if (typeof v === "string") { const n = Number(v); return Number.isNaN(n) ? 0 : n; }
  return 0;
}

// Bootstrap defaults display_name to the account identifier (server/routes/me.ts), so a creator
// who never set a name carries their email or E.164 phone there. Rows here are read across the
// whole workspace, so a contact-shaped name is replaced by a label derived from creator_id —
// stable per creator, and carrying nothing of the address.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_SHAPE = /^\+?\d{7,15}$/;

export function publicDisplayName(name: string | null | undefined, creatorId: string): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return "";
  const digits = trimmed.replace(/[\s()-]/g, "");
  if (!EMAIL_SHAPE.test(trimmed) && !PHONE_SHAPE.test(digits)) return trimmed;
  const suffix = creatorId.replace(/-/g, "").slice(0, 4).toUpperCase();
  return suffix ? `KOC ${suffix}` : "KOC";
}

export function shapeLeaderboard(
  rows: RankRow[], profiles: CreatorProfile[], prevRanks?: Map<string, number>,
  // Operator surfaces that already have contact access can opt out; creator-facing callers must not.
  opts?: { revealContactNames?: boolean },
): LeaderboardEntry[] {
  const byId = new Map(profiles.map((p) => [p.id, p]));
  return rows.map((r) => {
    const p = byId.get(r.creator_id);
    const prev = prevRanks?.get(r.creator_id);
    return {
      creator_id: r.creator_id,
      rank: num(r.rank),
      approved: num(r.approved),
      avg_quality: num(r.avg_quality),
      display_name: opts?.revealContactNames
        ? p?.display_name ?? ""
        : publicDisplayName(p?.display_name, r.creator_id),
      avatar_url: p?.avatar_url ?? null,
      level: num(p?.level),
      movement: prev == null ? null : prev - num(r.rank),
    };
  });
}

export function myStanding(rows: RankRow[], creatorId: string): RankRow | null {
  return rows.find((r) => r.creator_id === creatorId) ?? null;
}

// "差 N 名入獎": 0 if rank is within the prize cutoff, otherwise how many spots away.
export function spotsToPrize(rank: number, prizeCutoffRank: number): number {
  return rank <= prizeCutoffRank ? 0 : rank - prizeCutoffRank;
}
