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

// --- Implementation stub (will fail tests until Task 2 implements it) ---------

export function shapeRadar(_input: ShapeRadarInput): Radar {
  throw new Error("not implemented");
}
