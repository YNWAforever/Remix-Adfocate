import { buildPassport } from "./passport.js";
import { effectiveSocialHandles, publicSocialTrustBadges } from "./social/passportSocial.js";
import { listSocialAccounts } from "./social/repo.js";
import { serviceClient } from "./supabase.js";
import { hashPublicToken } from "./tokens.js";

export type PublicPassportPayload = {
  creator: {
    displayName: string;
    avatarUrl: string | null;
    level: string;
    xp: number;
  };
  scores: {
    influence: number | null;
    reliability: number | null;
    content: number | null;
    brandSafety: number | null;
  };
  badges: string[];
  socialTrustBadges: string[];
};

export async function getPublicPassportByToken(token: string): Promise<PublicPassportPayload | null> {
  const svc = serviceClient();
  const tokenHash = hashPublicToken(token);

  const { data: share, error: shareErr } = await svc
    .from("creator_public_passports")
    .select("creator_id, enabled")
    .eq("public_token_hash", tokenHash)
    .eq("enabled", true)
    .maybeSingle();
  if (shareErr) throw shareErr;
  if (!share) return null;

  const { data: creator, error: creatorErr } = await svc
    .from("creators")
    .select("id, display_name, avatar_url, level, xp, social_handles")
    .eq("id", share.creator_id)
    .single();
  if (creatorErr) throw creatorErr;

  const { data: subs, error: subsErr } = await svc
    .from("mission_submissions")
    .select("status, quality_rating")
    .eq("creator_id", share.creator_id);
  if (subsErr) throw subsErr;

  const { count: referredCount, error: refErr } = await svc
    .from("creators")
    .select("id", { count: "exact", head: true })
    .eq("referred_by", share.creator_id);
  if (refErr) throw refErr;

  const syncedAccounts = await listSocialAccounts(svc, share.creator_id as string);
  const socialHandles = effectiveSocialHandles({
    syncedAccounts,
    selfReportedHandles: creator.social_handles as { followers?: number | null }[] | null,
  });
  const passport = buildPassport({
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
    referredCount: referredCount ?? 0,
  });

  const { error: updateErr } = await svc
    .from("creator_public_passports")
    .update({ last_viewed_at: new Date().toISOString() })
    .eq("public_token_hash", tokenHash);
  if (updateErr) throw updateErr;

  return {
    creator: {
      displayName: creator.display_name ?? "KOC",
      avatarUrl: creator.avatar_url ?? null,
      level: passport.level,
      xp: passport.xp,
    },
    scores: passport.scores,
    badges: passport.badges,
    socialTrustBadges: publicSocialTrustBadges(syncedAccounts),
  };
}
