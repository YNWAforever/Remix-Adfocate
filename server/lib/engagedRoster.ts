// Shapes raw mission_submissions rows (joined to creators + missions) into the
// operator "engaged users" roster: one entry per creator with >=1 active
// participation (joined/submitted/under_review), each expandable to their active
// missions. Approved rows contribute only to the completed/points rollups. Pure —
// no DB, fully unit-tested.

const ACTIVE: ReadonlySet<string> = new Set(["joined", "submitted", "under_review"]);

export type EngagedSubmissionRow = {
  id: string;
  mission_id: string;
  creator_id: string;
  status: string;
  points_awarded: number | null;
  created_at: string;
  submitted_at: string | null;
  reviewed_at: string | null;
  review_deadline: string | null;
  creators: { id: string; display_name: string | null; avatar_url: string | null; level: string; xp: number };
  missions: { slug: string; title: string };
};

export type EngagedActiveMission = {
  submissionId: string;
  missionId: string;
  missionSlug: string;
  missionTitle: string;
  status: string;
  joinedAt: string;
  submittedAt: string | null;
  reviewDeadline: string | null;
};

export type EngagedCreator = {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
  level: string;
  xp: number;
  activeCount: number;
  completedCount: number;
  pointsEarned: number;
  lastActivityAt: string | null;
  activeMissions: EngagedActiveMission[];
};

// ISO 8601 strings sort lexicographically, so string compare == time compare.
function maxIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a >= b ? a : b;
}

export function shapeEngagedRoster(rows: EngagedSubmissionRow[]): EngagedCreator[] {
  const byCreator = new Map<string, EngagedCreator>();
  for (const r of rows) {
    let c = byCreator.get(r.creator_id);
    if (!c) {
      c = {
        id: r.creator_id,
        displayName: r.creators.display_name,
        avatarUrl: r.creators.avatar_url,
        level: r.creators.level,
        xp: r.creators.xp,
        activeCount: 0,
        completedCount: 0,
        pointsEarned: 0,
        lastActivityAt: null,
        activeMissions: [],
      };
      byCreator.set(r.creator_id, c);
    }
    c.pointsEarned += r.points_awarded ?? 0;
    c.lastActivityAt = maxIso(c.lastActivityAt, maxIso(maxIso(r.created_at, r.submitted_at), r.reviewed_at));
    if (r.status === "approved") {
      c.completedCount += 1;
    } else if (ACTIVE.has(r.status)) {
      c.activeCount += 1;
      c.activeMissions.push({
        submissionId: r.id,
        missionId: r.mission_id,
        missionSlug: r.missions.slug,
        missionTitle: r.missions.title,
        status: r.status,
        joinedAt: r.created_at,
        submittedAt: r.submitted_at,
        reviewDeadline: r.review_deadline,
      });
    }
  }
  return [...byCreator.values()]
    .filter((c) => c.activeCount > 0)
    .sort((a, b) => (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? ""));
}
