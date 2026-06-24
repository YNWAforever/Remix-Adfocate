// server/lib/radar.ts
// Pure shaper for the operator At-risk & Opportunity Radar.
// Takes pre-fetched rows from the Hono route and returns four ranked queues.
// No DB / no async — fully unit-testable. Mirrors shapeInsights / shapeEngagedRoster.

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const TOP_N = 20;

const ACTIVE_STATUSES = new Set(["joined", "submitted", "under_review"]);

// --- Raw DB row types (PostgREST joined shape) --------------------------------

export type AtRiskRawRow = {
  creator_id: string;
  status: string;
  created_at: string;
  submitted_at: string | null;
  reviewed_at: string | null;
  creators: { display_name: string | null; phone: string | null };
};

export type OverdueRawRow = {
  id: string;
  creator_id: string;
  status: string;
  review_deadline: string;
  creators: { display_name: string | null };
  missions: { title: string };
};

export type RecentApprovalRawRow = {
  creator_id: string;
  quality_rating: number | null;
  creators: { display_name: string | null; level: string };
};

export type NewCreatorRawRow = {
  id: string;
  display_name: string | null;
  phone: string | null;
  created_at: string;
};

// --- Shaped output types ------------------------------------------------------

export type RadarAtRiskRow = {
  creator_id: string;
  display_name: string | null;
  phone: string | null;
  last_active: string;   // ISO
  days_idle: number;
};

export type RadarOverdueRow = {
  submission_id: string;
  creator_id: string;
  display_name: string | null;
  mission_title: string;
  status: "submitted" | "under_review";
  review_deadline: string;   // ISO
  urgency: "overdue" | "due_soon";
  hours_overdue: number;     // positive = overdue, negative = future (due_soon)
};

export type RadarRisingRow = {
  creator_id: string;
  display_name: string | null;
  level: string;
  recent_approvals: number;
  avg_quality: number | null;  // null = no rated submissions; score uses 3 as default
  score: number;               // recent_approvals × (avg_quality ?? 3)
};

export type RadarNewCreatorRow = {
  creator_id: string;
  display_name: string | null;
  phone: string | null;
  created_at: string;   // ISO
  days_since_join: number;
};

export type RadarQueue<T> = {
  items: T[];    // capped at TOP_N (20)
  total: number; // full count before cap — for "+N more" UI indicator
};

export type Radar = {
  window: { days: number; from: string };  // ISO cutoff
  atRisk: RadarQueue<RadarAtRiskRow>;
  slaBreaching: RadarQueue<RadarOverdueRow>;
  rising: RadarQueue<RadarRisingRow>;
  newUnactivated: RadarQueue<RadarNewCreatorRow>;
};

export type ShapeRadarInput = {
  now: string;                          // ISO instant — injected by route, not Date.now()
  days: number;
  allSubmissions: AtRiskRawRow[];       // all historical mission_submissions (for Queue A)
  overdueSubmissions: OverdueRawRow[];  // status ∈ submitted|under_review + deadline ≤ now+2d (Queue B)
  recentApprovals: RecentApprovalRawRow[]; // approved rows in last `days` days (Queue C)
  newCreators: NewCreatorRawRow[];      // creators created in last `days` days (Queue D)
  allParticipantIds: string[];          // distinct creator_ids from all mission_submissions (anti-join for Queue D)
};

// --- Private helpers ----------------------------------------------------------

function cap<T>(items: T[]): RadarQueue<T> {
  return { items: items.slice(0, TOP_N), total: items.length };
}

function buildAtRisk(rows: AtRiskRawRow[], nowMs: number, cutoffMs: number): RadarAtRiskRow[] {
  // Group rows by creator_id: track their most-recent activity timestamp and whether
  // any row is currently active. Fetching all submissions per creator lets us determine
  // both "they've participated before" and "they have nothing active right now."
  const map = new Map<
    string,
    { display_name: string | null; phone: string | null; lastActiveMs: number; hasActive: boolean }
  >();

  for (const r of rows) {
    const ts = [r.created_at, r.submitted_at, r.reviewed_at]
      .filter((t): t is string => t !== null && t !== undefined)
      .map((t) => Date.parse(t))
      .filter(Number.isFinite);
    const rowLastMs = ts.length ? Math.max(...ts) : 0;
    const isActive = ACTIVE_STATUSES.has(r.status);

    const cur = map.get(r.creator_id);
    if (cur) {
      cur.lastActiveMs = Math.max(cur.lastActiveMs, rowLastMs);
      cur.hasActive = cur.hasActive || isActive;
    } else {
      map.set(r.creator_id, {
        display_name: r.creators.display_name,
        phone: r.creators.phone,
        lastActiveMs: rowLastMs,
        hasActive: isActive,
      });
    }
  }

  return [...map.entries()]
    .filter(([, v]) => !v.hasActive && v.lastActiveMs > 0 && v.lastActiveMs < cutoffMs)
    .sort(([, a], [, b]) => a.lastActiveMs - b.lastActiveMs) // most stale first
    .map(([creator_id, v]) => ({
      creator_id,
      display_name: v.display_name,
      phone: v.phone,
      last_active: new Date(v.lastActiveMs).toISOString(),
      days_idle: Math.floor((nowMs - v.lastActiveMs) / DAY_MS),
    }));
}

function buildSlaBreaching(rows: OverdueRawRow[], nowMs: number): RadarOverdueRow[] {
  // DB query already filters to status ∈ (submitted, under_review) and deadline ≤ now+2d;
  // DB orders by review_deadline ASC (most-overdue first).
  return rows.map((r) => {
    const deadlineMs = Date.parse(r.review_deadline);
    return {
      submission_id: r.id,
      creator_id: r.creator_id,
      display_name: r.creators.display_name,
      mission_title: r.missions.title,
      status: r.status as "submitted" | "under_review",
      review_deadline: r.review_deadline,
      urgency: deadlineMs < nowMs ? "overdue" : "due_soon",
      hours_overdue: Math.round((nowMs - deadlineMs) / HOUR_MS),
    };
  });
}

function buildRising(rows: RecentApprovalRawRow[]): RadarRisingRow[] {
  const map = new Map<
    string,
    { display_name: string | null; level: string; count: number; ratingSum: number; ratedCount: number }
  >();

  for (const r of rows) {
    const cur = map.get(r.creator_id);
    if (cur) {
      cur.count += 1;
      if (r.quality_rating !== null) {
        cur.ratingSum += r.quality_rating;
        cur.ratedCount += 1;
      }
    } else {
      map.set(r.creator_id, {
        display_name: r.creators.display_name,
        level: r.creators.level,
        count: 1,
        ratingSum: r.quality_rating ?? 0,
        ratedCount: r.quality_rating !== null ? 1 : 0,
      });
    }
  }

  return [...map.entries()]
    .map(([creator_id, v]) => {
      const avg_quality =
        v.ratedCount > 0 ? Math.round((v.ratingSum / v.ratedCount) * 10) / 10 : null;
      const score = v.count * (avg_quality ?? 3);
      return {
        creator_id,
        display_name: v.display_name,
        level: v.level,
        recent_approvals: v.count,
        avg_quality,
        score,
      };
    })
    .sort((a, b) => b.score - a.score); // highest score first
}

function buildNewUnactivated(
  rows: NewCreatorRawRow[],
  participantIds: Set<string>,
  nowMs: number,
): RadarNewCreatorRow[] {
  // Creators table has no workspace_id column — creators are global, not workspace-scoped.
  // The anti-join is done here in JS against the participant set built by the route.
  // DB already returns newest-first (ORDER BY created_at DESC).
  return rows
    .filter((r) => !participantIds.has(r.id))
    .map((r) => ({
      creator_id: r.id,
      display_name: r.display_name,
      phone: r.phone,
      created_at: r.created_at,
      days_since_join: Math.floor((nowMs - Date.parse(r.created_at)) / DAY_MS),
    }));
}

// --- Public API ---------------------------------------------------------------

export function shapeRadar(input: ShapeRadarInput): Radar {
  const { now, days } = input;
  const nowMs = Date.parse(now);
  const cutoffMs = nowMs - days * DAY_MS;
  const fromIso = new Date(cutoffMs).toISOString();
  const participantIds = new Set(input.allParticipantIds);

  return {
    window: { days, from: fromIso },
    atRisk: cap(buildAtRisk(input.allSubmissions, nowMs, cutoffMs)),
    slaBreaching: cap(buildSlaBreaching(input.overdueSubmissions, nowMs)),
    rising: cap(buildRising(input.recentApprovals)),
    newUnactivated: cap(buildNewUnactivated(input.newCreators, participantIds, nowMs)),
  };
}
