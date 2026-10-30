import { publicDisplayName } from "./campaignLeaderboard.js";
import { buildPassport } from "./passport.js";
import type { PublicProfileHighlight } from "./profileMedia/types.js";
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
  profileMedia: {
    highlights: PublicProfileHighlight[];
    publishedAt: string | null;
  };
  badges: string[];
  socialTrustBadges: string[];
};

type PublicPassportCreatorRow = {
  id: string;
  display_name: string | null;
  level: string;
  xp: number;
};

type PublicProfileSnapshotRow = {
  avatar_url: string | null;
  highlights: unknown;
  published_at: string | null;
};

const PUBLIC_BADGE_ALLOWLIST = new Set([
  "level_l1",
  "first_approval",
  "reliable",
  "referrer",
  "perfect_rating",
  "content_pro",
  "spotless",
]);

function publicBadges(badges: string[]): string[] {
  return badges.filter((badge) => PUBLIC_BADGE_ALLOWLIST.has(badge));
}

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
    .select("id, display_name, level, xp")
    .eq("id", share.creator_id)
    .single();
  if (creatorErr) throw creatorErr;
  const creatorRow = creator as PublicPassportCreatorRow;

  const { data: snapshot, error: snapshotErr } = await svc
    .from("creator_public_profile_snapshots")
    .select("avatar_url, highlights, published_at")
    .eq("creator_id", share.creator_id)
    .maybeSingle();
  if (snapshotErr) throw snapshotErr;
  const snapshotRow = snapshot as PublicProfileSnapshotRow | null;

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
    selfReportedHandles: null,
  });
  const passport = buildPassport({
    level: creatorRow.level,
    xp: creatorRow.xp,
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
      // Bootstrap defaults display_name to the sign-up email/phone; never expose it publicly.
      displayName: publicDisplayName(creatorRow.display_name, creatorRow.id) || "KOC",
      avatarUrl: snapshotRow?.avatar_url ?? null,
      level: passport.level,
      xp: passport.xp,
    },
    scores: passport.scores,
    profileMedia: {
      highlights: Array.isArray(snapshotRow?.highlights)
        ? ((snapshotRow?.highlights ?? []) as PublicProfileHighlight[])
        : [],
      publishedAt: snapshotRow?.published_at ?? null,
    },
    badges: publicBadges(passport.badges),
    socialTrustBadges: publicSocialTrustBadges(syncedAccounts),
  };
}
