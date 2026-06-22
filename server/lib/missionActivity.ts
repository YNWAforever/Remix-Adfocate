// server/lib/missionActivity.ts
// Pure shaper: bucket one mission's (already-enriched) submission rows for the Manage drill-in.

export type MissionActivityRow = {
  id: string;
  mission_id: string;
  creator_id: string;
  status: string;
  content_urls: string[] | null;
  submitted_at: string | null;
  created_at: string;
  creators: { display_name: string };
  missions: { slug: string; title: string; points_reward: number };
  creator_review: { status: string; risk_level: string };
  mission_shortlist: { status: string } | null;
};

export type MissionActivity = {
  applicants: MissionActivityRow[];
  submissions: MissionActivityRow[];
  engaged: MissionActivityRow[];
  fill: { filled: number; quota: number };
};

export function shapeMissionActivity(
  mission: { filled: number | null; quota: number | null },
  rows: MissionActivityRow[],
): MissionActivity {
  return {
    applicants: rows.filter((r) => r.status === "applied"),
    submissions: rows.filter((r) => r.status === "submitted" || r.status === "under_review"),
    engaged: rows.filter((r) => r.status === "joined" || r.status === "approved"),
    fill: { filled: mission.filled ?? 0, quota: mission.quota ?? 0 },
  };
}
