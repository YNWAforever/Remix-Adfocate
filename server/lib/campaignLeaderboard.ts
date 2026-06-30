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

export function shapeLeaderboard(
  rows: RankRow[], profiles: CreatorProfile[], prevRanks?: Map<string, number>,
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
      display_name: p?.display_name ?? "",
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
