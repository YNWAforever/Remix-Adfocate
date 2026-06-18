import { serviceClient } from "./supabase.js";
import { buildPassport } from "./passport.js";
import { listSocialAccounts } from "./social/repo.js";
import { effectiveSocialHandles } from "./social/passportSocial.js";

/** Recompute a creator's passport scores and snapshot them into creators.scores.
 *  Best-effort: logs and returns on any failure (never throws) so a snapshot error
 *  can't turn a successful approve/reject/profile-save into a 500. The read path
 *  (GET /me/passport) always live-computes, so creators.scores is a forward-looking
 *  cache (Mission Matcher) and transient staleness is non-fatal. Uses the service
 *  client throughout: the approve/reject caller is the operator (no creator JWT). */
export async function persistScores(creatorId: string): Promise<void> {
  try {
    const svc = serviceClient();

    const { data: creator, error: cErr } = await svc
      .from("creators")
      .select("level, xp, social_handles")
      .eq("id", creatorId)
      .single();
    if (cErr || !creator) {
      console.error("[persistScores] creator read failed", creatorId, cErr);
      return;
    }

    const { data: subs, error: sErr } = await svc
      .from("mission_submissions")
      .select("status, quality_rating")
      .eq("creator_id", creatorId);
    if (sErr) {
      console.error("[persistScores] submissions read failed", creatorId, sErr);
      return;
    }

    const { count, error: rErr } = await svc
      .from("creators")
      .select("id", { count: "exact", head: true })
      .eq("referred_by", creatorId);
    if (rErr) {
      console.error("[persistScores] referral count failed", creatorId, rErr);
      return;
    }

    const syncedAccounts = await listSocialAccounts(svc, creatorId);
    const socialHandles = effectiveSocialHandles({
      syncedAccounts,
      selfReportedHandles: creator.social_handles as { followers?: number | null }[] | null,
    });

    const { scores } = buildPassport({
      level: creator.level,
      xp: creator.xp,
      socialHandles,
      statuses: (subs ?? []).map((s) => s.status as string),
      ratings: (subs ?? [])
        .filter((s) => {
          const row = s as { status: string; quality_rating?: number | null };
          return row.status === "approved" && row.quality_rating != null;
        })
        .map((s) => (s as { quality_rating: number }).quality_rating),
      referredCount: count ?? 0,
    });

    const { error: uErr } = await svc.from("creators").update({ scores }).eq("id", creatorId);
    if (uErr) console.error("[persistScores] snapshot write failed", creatorId, uErr);
  } catch (err) {
    console.error("[persistScores] unexpected error", creatorId, err);
  }
}
