/** Pure Mission Matcher scoring — no DB, no I/O. The route in routes/match.ts feeds it raw
 *  rows; this module owns the fit-score formula and rationale rules (unit-testable in isolation),
 *  mirroring lib/passport.ts. */
import { levelOrdinal } from "./passport.js";
import { canonicalMissionCategory } from "../../src/lib/missionCategories.js";
import { missionEligibility } from "../../src/lib/missionMeta.js";

export type MatchCreator = {
  level: string;              // "L0".."L6"
  isTrusted?: boolean;
  categories: string[];       // creator niches; may be empty
  reliability: number | null; // 0..100 (passport)
  brandSafety: number | null; // 0..100
  content: number | null;     // 0..100
};

export type MatchMission = {
  id: string; slug: string; title: string;
  category: string | null; mission_type: string;
  required_level: string;     // "L0".."L6"
  points_reward: number; cash_reward: number | null;
  deadline: string | null;    // "yyyy-mm-dd"
  quota: number; filled: number;
  access_type?: string; platforms?: string[]; deliverables?: string[]; effort?: string | null;
  workspaces?: { name?: string } | null;
};

export type ScoredMission = MatchMission & {
  fit_score: number;          // 0..100
  reasons: string[];
  rationale: string;
  locked: boolean;
};

const W = { category: 35, reward: 25, urgency: 15, readiness: 15, levelFit: 10 };
const DAY_MS = 86_400_000;

/** 1 on a niche match, 0 on a miss; 0.5 neutral when the creator has set no niches yet. */
export function categoryTerm(creator: MatchCreator, mission: MatchMission): number {
  if (creator.categories.length === 0) return 0.5;
  return mission.category != null && creator.categories.some((value) => canonicalMissionCategory(value) === canonicalMissionCategory(mission.category!)) ? 1 : 0;
}

/** Proportional to the strongest reward in the candidate set; unit-agnostic across points/cash. */
export function rewardTerm(mission: MatchMission, maxPoints: number, maxCash: number): number {
  const normPoints = maxPoints > 0 ? mission.points_reward / maxPoints : 0;
  const normCash = maxCash > 0 ? (mission.cash_reward ?? 0) / maxCash : 0;
  return Math.max(normPoints, normCash);
}

/** Bucketed days-to-deadline; no deadline → 0.4 neutral; past → 0 (defensive, filtered upstream). */
export function urgencyTerm(mission: MatchMission, now: Date): number {
  if (!mission.deadline) return 0.4;
  // A bare "yyyy-mm-dd" deadline parses as UTC midnight, so compare it to a UTC-normalised
  // "today" — keeps the bucket timezone-stable (server may run in HK/UTC+8, tests anywhere).
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const days = Math.ceil((new Date(mission.deadline).getTime() - todayUtc) / DAY_MS);
  if (days < 0) return 0;
  if (days <= 3) return 1;
  if (days <= 7) return 0.7;
  if (days <= 14) return 0.4;
  return 0.2;
}

/** Average of the creator's non-null passport scores, scaled to 0..1; 0.5 neutral when all null. */
export function readinessTerm(creator: MatchCreator): number {
  const vals = [creator.reliability, creator.brandSafety, creator.content].filter(
    (v): v is number => v != null,
  );
  if (vals.length === 0) return 0.5;
  return vals.reduce((s, v) => s + v, 0) / vals.length / 100;
}

/** 1 when the creator's level meets the mission's required level, else 0 (locked). */
export function levelFitTerm(creator: MatchCreator, mission: MatchMission): number {
  return levelOrdinal(creator.level) >= levelOrdinal(mission.required_level) ? 1 : 0;
}

/** Build the ordered reason tags + the short rationale string (top 1-2 reasons). */
export function rationaleFor(
  mission: MatchMission,
  terms: { category: number; reward: number; urgency: number },
  locked: boolean,
  lockedLabel?: string,
): { reasons: string[]; rationale: string } {
  const reasons: string[] = [];
  if (locked) reasons.push(lockedLabel ?? `🔒 升級至 ${mission.required_level} 解鎖`);
  if (terms.category === 1 && mission.category) reasons.push(`啱你嘅${mission.category}範疇`);
  if (terms.reward >= 0.8) reasons.push((mission.cash_reward ?? 0) > 0 ? "高回報・有現金獎" : "高積分回報");
  if (terms.urgency >= 0.7) reasons.push("即將截止");
  if (reasons.length === 0) reasons.push("為你推薦");
  return { reasons, rationale: reasons.slice(0, 2).join(" · ") };
}

/** Score every mission (0..100) with reasons + locked flag. `now` is injected for testability. */
export function scoreMissions(creator: MatchCreator, missions: MatchMission[], now: Date): ScoredMission[] {
  const maxPoints = Math.max(0, ...missions.map((m) => m.points_reward));
  const maxCash = Math.max(0, ...missions.map((m) => m.cash_reward ?? 0));
  const readiness = readinessTerm(creator); // constant per creator

  return missions.map((m) => {
    const category = categoryTerm(creator, m);
    const reward = rewardTerm(m, maxPoints, maxCash);
    const urgency = urgencyTerm(m, now);
    const levelFit = levelFitTerm(creator, m);
    const decision = missionEligibility(m.required_level, creator.level, creator.isTrusted);
    const locked = !decision.qualified;
    const raw =
      W.category * category + W.reward * reward + W.urgency * urgency +
      W.readiness * readiness + W.levelFit * levelFit;
    const fit_score = Math.max(0, Math.min(100, Math.round(raw)));
    const lockedLabel = decision.labelKey === "app.eligibility.verifyToUnlock"
      ? `🔒 驗證社交帳號以解鎖 ${m.required_level} 任務`
      : decision.labelKey === "app.eligibility.unknown" ? "🔒 參加資格資料未齊" : undefined;
    const { reasons, rationale } = rationaleFor(m, { category, reward, urgency }, locked, lockedLabel);
    return { ...m, fit_score, reasons, rationale, locked };
  });
}

/** True iff SOME mission in the set is both unlocked for the creator AND a niche match.
 *  No-niche creators never match (categoryTerm is 0.5, never 1). */
export function creatorQualifiesForCampaign(creator: MatchCreator, missions: MatchMission[]): boolean {
  return missions.some((m) => levelFitTerm(creator, m) === 1 && categoryTerm(creator, m) === 1);
}

/** Eligible-first, then fit_score desc, then deadline asc (nulls last), then points desc. */
export function rankMissions(scored: ScoredMission[]): ScoredMission[] {
  return [...scored].sort((a, b) => {
    if (a.locked !== b.locked) return a.locked ? 1 : -1;
    if (b.fit_score !== a.fit_score) return b.fit_score - a.fit_score;
    const ad = a.deadline ?? "9999-12-31";
    const bd = b.deadline ?? "9999-12-31";
    if (ad !== bd) return ad < bd ? -1 : 1;
    return b.points_reward - a.points_reward;
  });
}

/** Drop full / past-deadline / already-engaged missions. Status + access_type are filtered at
 *  the DB query; level-locked missions are KEPT (ranked last via rankMissions). */
export function filterCandidates(
  missions: MatchMission[],
  engagedMissionIds: Set<string>,
  today: string,
): MatchMission[] {
  return missions.filter(
    (m) => m.filled < m.quota && !engagedMissionIds.has(m.id) && (m.deadline == null || m.deadline >= today),
  );
}
