/** Pure passport computation — no DB, no I/O. The handler in routes/me.ts feeds it raw
 *  rows; these functions own the score/badge rules so they're unit-testable in isolation. */

export type PassportSocialHandle = { followers?: number | null };

export type PassportScores = {
  influence: number | null; // computed; null = no social handles yet
  reliability: number | null; // computed; null = no concluded submissions yet
  content: number | null; // 6C: round(20 * avg rating); null = nothing rated
  brandSafety: number | null; // 6C: non-rejection rate; null = nothing reviewed
};

export type Passport = {
  level: string;
  xp: number;
  scores: PassportScores;
  badges: string[];
};

export type SubmissionCounts = { approved: number; rejected: number; expired: number };

const LEVEL_IDS = ["L0", "L1", "L2", "L3", "L4", "L5", "L6"];

/** 0..6 for L0..L6; unknown/empty → -1 (so the L1 badge check fails closed). */
export function levelOrdinal(level: string | null | undefined): number {
  return level ? LEVEL_IDS.indexOf(level) : -1;
}

/** Step function over total followers. `null` when the creator has no handles at all
 *  (distinct from a real 0 — a creator with handles totalling 0 followers). */
export function influenceFor(handles: PassportSocialHandle[] | null | undefined): number | null {
  if (!handles || handles.length === 0) return null;
  const total = handles.reduce((sum, h) => sum + (h.followers ?? 0), 0);
  if (total >= 1_000_000) return 100;
  if (total >= 100_000) return 80;
  if (total >= 10_000) return 50;
  if (total >= 1_000) return 20;
  return 0;
}

/** Tally terminal statuses; in-flight (joined/submitted/under_review) are excluded. */
export function countTerminal(statuses: string[]): SubmissionCounts {
  let approved = 0;
  let rejected = 0;
  let expired = 0;
  for (const s of statuses) {
    if (s === "approved") approved++;
    else if (s === "rejected") rejected++;
    else if (s === "expired") expired++;
  }
  return { approved, rejected, expired };
}

/** Approval rate over concluded submissions; `null` when none are concluded. */
export function reliabilityFor(counts: SubmissionCounts): number | null {
  const concluded = counts.approved + counts.rejected + counts.expired;
  if (concluded === 0) return null;
  return Math.round((100 * counts.approved) / concluded);
}

/** Average of the 1-5 quality ratings, scaled to 0-100. null when nothing is rated. */
export function contentFor(ratings: number[]): number | null {
  if (ratings.length === 0) return null;
  const avg = ratings.reduce((sum, r) => sum + r, 0) / ratings.length;
  return Math.round(20 * avg);
}

/** Non-rejection rate over REVIEWED submissions (approved + rejected; expired excluded).
 *  null when nothing has been reviewed. A proxy for compliance pass-rate. */
export function brandSafetyFor(counts: SubmissionCounts): number | null {
  const reviewed = counts.approved + counts.rejected;
  if (reviewed === 0) return null;
  return Math.round((100 * counts.approved) / reviewed);
}

export function buildPassport(input: {
  level: string;
  xp: number;
  socialHandles: PassportSocialHandle[] | null | undefined;
  statuses: string[];
  ratings: number[];
  referredCount: number;
}): Passport {
  const counts = countTerminal(input.statuses);
  const concluded = counts.approved + counts.rejected + counts.expired;
  const reviewed = counts.approved + counts.rejected;
  const reliability = reliabilityFor(counts);
  const influence = influenceFor(input.socialHandles);
  const content = contentFor(input.ratings);
  const brandSafety = brandSafetyFor(counts);
  const handleCount = input.socialHandles?.length ?? 0;

  const badges: string[] = [];
  if (levelOrdinal(input.level) >= 1) badges.push("level_l1");
  if (counts.approved >= 1) badges.push("first_approval");
  if (concluded >= 3 && (reliability ?? 0) >= 80) badges.push("reliable");
  if (handleCount >= 1) badges.push("social_linked");
  if (input.referredCount >= 1) badges.push("referrer");
  if (input.ratings.some((r) => r === 5)) badges.push("perfect_rating");
  if (input.ratings.length >= 3 && (content ?? 0) >= 80) badges.push("content_pro");
  if (reviewed >= 3 && brandSafety === 100) badges.push("spotless");

  return {
    level: input.level,
    xp: input.xp,
    scores: { influence, reliability, content, brandSafety },
    badges,
  };
}
