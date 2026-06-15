import { Hono } from "hono";
import type { Env } from "../app.js";
import { makeUserClient } from "../lib/supabase.js";
import { countTerminal, reliabilityFor, brandSafetyFor, contentFor } from "../lib/passport.js";
import { filterCandidates, scoreMissions, rankMissions, type MatchMission, type MatchCreator } from "../lib/missionMatch.js";
import { enhanceRationales } from "../lib/llm.js";

export const matchRoutes = new Hono<Env>();

/** GET /api/match — the "今日整乜好？" Mission Matcher. Deterministically ranks the workspace's
 *  open, joinable missions for the caller (category / reward / urgency / readiness / level-fit),
 *  then best-effort polishes each rationale via the AI Gateway (template fallback). RLS scopes
 *  every read to the caller. */
matchRoutes.get("/", async (c) => {
  const userId = c.get("userId");
  const workspaceId = c.get("workspaceId");
  const supabase = makeUserClient(c.get("jwt"));
  const now = new Date();

  // Independent reads — fire concurrently to trim request latency (the LLM polish below adds its own).
  const [{ data: creator, error: cErr }, { data: subs, error: sErr }, { data: missions, error: mErr }] =
    await Promise.all([
      supabase.from("creators").select("level, categories").eq("id", userId).single(),
      supabase
        .from("mission_submissions")
        .select("mission_id, status, quality_rating")
        .eq("creator_id", userId)
        .eq("workspace_id", workspaceId),
      supabase
        .from("missions")
        .select("id, slug, title, category, mission_type, required_level, points_reward, cash_reward, deadline, quota, filled")
        .eq("workspace_id", workspaceId)
        .eq("status", "active")
        .eq("access_type", "open"),
    ]);
  if (cErr) return c.json({ error: cErr.message, code: "db_error" }, 500);
  if (sErr) return c.json({ error: sErr.message, code: "db_error" }, 500);
  if (mErr) return c.json({ error: mErr.message, code: "db_error" }, 500);

  // Live readiness from the caller's own submissions (single source of truth — reuse passport fns).
  const statuses = (subs ?? []).map((s) => s.status as string);
  const counts = countTerminal(statuses);
  const ratings = (subs ?? [])
    .filter((s) => s.status === "approved" && s.quality_rating != null)
    .map((s) => s.quality_rating as number);
  const creatorInput: MatchCreator = {
    level: creator.level as string,
    categories: ((creator.categories as string[] | null) ?? []),
    reliability: reliabilityFor(counts),
    brandSafety: brandSafetyFor(counts),
    content: contentFor(ratings),
  };

  const engaged = new Set((subs ?? []).map((s) => s.mission_id as string));
  const today = now.toISOString().slice(0, 10);
  const candidates = filterCandidates((missions ?? []) as MatchMission[], engaged, today);
  const ranked = rankMissions(scoreMissions(creatorInput, candidates, now));

  // Best-effort LLM polish of the top rationales (cap at 8 to bound latency/cost; positions 9+
  // keep their template). Any failure → templates kept.
  const enhanced = await enhanceRationales(
    ranked.slice(0, 8).map((m) => ({ id: m.id, title: m.title, category: m.category, rationale: m.rationale, locked: m.locked })),
  );
  const matches = ranked.map((m) => ({ ...m, rationale: enhanced?.[m.id] ?? m.rationale }));

  return c.json({ matches });
});
