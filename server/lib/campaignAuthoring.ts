// Pure campaign authoring rules — no DB, no I/O, no `new Date()` ("today" injected by the route).
// Mirrors missionAuthoring.ts. Also home to the shared payout source_ref builders.

export type PrizeTier = { rank_from: number; rank_to: number; cash: number; points: number; xp: number };

export type CampaignInput = {
  workspace_id: string;
  slug: string;
  title: string;
  description?: string | null;
  starts_at: string;
  ends_at: string;
  goal_target: number;
  completion_bonus_points: number;
  completion_bonus_xp: number;
  prize_tiers: PrizeTier[];
};

export type CampaignRecord = CampaignInput & {
  id: string;
  status: "draft" | "active" | "closed" | "settled";
  published_at: string | null;
  closed_at: string | null;
  settled_at: string | null;
};

export type ValidationResult = { ok: boolean; errors: Record<string, string> };

// Columns the operator route copies from the request body on create/edit.
export const CAMPAIGN_EDITABLE_COLS: (keyof CampaignInput)[] = [
  "slug", "title", "description", "starts_at", "ends_at",
  "goal_target", "completion_bonus_points", "completion_bonus_xp", "prize_tiers",
];

const BONUS_PREFIX = "campaign_bonus:";
const PRIZE_PREFIX = "campaign_prize:";
// Invariant: both prefixes are exactly 15 chars to match the left(source_ref,15) index predicate.
if (BONUS_PREFIX.length !== 15 || PRIZE_PREFIX.length !== 15) {
  throw new Error("campaign source_ref prefix must be 15 chars (matches the partial-index predicate)");
}
export function campaignBonusRef(campaignId: string, creatorId: string): string {
  return `${BONUS_PREFIX}${campaignId}:${creatorId}`;
}
export function campaignPrizeRef(campaignId: string, creatorId: string): string {
  return `${PRIZE_PREFIX}${campaignId}:${creatorId}`;
}

function nonEmpty(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}
function num(v: unknown): number {
  return typeof v === "number" && !Number.isNaN(v) ? v : 0;
}

export function validatePrizeTiers(tiers: PrizeTier[]): { ok: boolean; error?: string } {
  if (!Array.isArray(tiers)) return { ok: false, error: "prize_tiers must be an array" };
  let prevTo = 0;
  for (const t of tiers) {
    if (!Number.isInteger(t.rank_from) || !Number.isInteger(t.rank_to)) {
      return { ok: false, error: "rank_from/rank_to must be integers" };
    }
    if (t.rank_from < 1) return { ok: false, error: "rank_from must be >= 1" };
    if (t.rank_to < t.rank_from) return { ok: false, error: "rank_to must be >= rank_from" };
    if (t.rank_from <= prevTo) return { ok: false, error: "tiers must be ascending and non-overlapping" };
    if (num(t.cash) < 0 || num(t.points) < 0 || num(t.xp) < 0) {
      return { ok: false, error: "cash/points/xp must be >= 0" };
    }
    prevTo = t.rank_to;
  }
  return { ok: true };
}

export function validateCampaign(
  input: CampaignInput,
  mode: "draft" | "publish",
  _today?: string,
): ValidationResult {
  const errors: Record<string, string> = {};
  if (!nonEmpty(input.workspace_id)) errors.workspace_id = "必填";
  if (!nonEmpty(input.slug)) errors.slug = "必填";
  if (!nonEmpty(input.title)) errors.title = "必填";

  if (mode === "publish") {
    if (!nonEmpty(input.starts_at)) errors.starts_at = "必填";
    if (!nonEmpty(input.ends_at)) errors.ends_at = "必填";
    if (nonEmpty(input.starts_at) && nonEmpty(input.ends_at) && !(input.ends_at > input.starts_at)) {
      errors.ends_at = "結束時間必須晚於開始時間";
    }
    if (!(Number.isInteger(input.goal_target) && input.goal_target >= 1)) {
      errors.goal_target = "目標必須 >= 1";
    }
    const hasReward = num(input.completion_bonus_points) > 0 || num(input.completion_bonus_xp) > 0 || (input.prize_tiers?.length ?? 0) > 0;
    if (!hasReward) errors.reward = "至少需要完成獎勵或名次獎品";
    const tiers = validatePrizeTiers(input.prize_tiers ?? []);
    if (!tiers.ok) errors.prize_tiers = tiers.error ?? "獎品階級無效";
  }
  return { ok: Object.keys(errors).length === 0, errors };
}

export function validateEdit(
  existing: CampaignRecord,
  patch: CampaignInput,
  hasEngagement: boolean,
): ValidationResult {
  const errors: Record<string, string> = {};
  const published = existing.status !== "draft";
  const locked = published || hasEngagement; // config frozen once live or once anyone has joined

  if (published && patch.slug !== existing.slug) errors.slug = "發佈後不可更改 slug";
  if (locked) {
    if (patch.goal_target !== existing.goal_target) errors.goal_target = "已開始，不可更改目標";
    if (patch.completion_bonus_points !== existing.completion_bonus_points) errors.completion_bonus_points = "已開始，不可更改獎勵";
    if (patch.completion_bonus_xp !== existing.completion_bonus_xp) errors.completion_bonus_xp = "已開始，不可更改獎勵";
    if (JSON.stringify(patch.prize_tiers ?? []) !== JSON.stringify(existing.prize_tiers ?? [])) errors.prize_tiers = "已開始，不可更改獎品";
    if (patch.starts_at !== existing.starts_at) errors.starts_at = "已開始，不可更改開始時間";
    // ends_at may only extend.
    if (patch.ends_at < existing.ends_at) errors.ends_at = "只可延長，不可縮短";
  }
  return { ok: Object.keys(errors).length === 0, errors };
}

// Overlap guard backing the DB's one-active-campaign-per-mission index.
export function canAttachMission(activeMissionIds: Set<string>, missionId: string): { ok: boolean; error?: string } {
  if (activeMissionIds.has(missionId)) return { ok: false, error: "此任務已連結到另一個進行中的挑戰" };
  return { ok: true };
}
