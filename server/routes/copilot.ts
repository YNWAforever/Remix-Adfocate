import { Hono } from "hono";
import type { Env } from "../app.js";
import { makeUserClient } from "../lib/supabase.js";
import { buildHooks } from "../lib/hookGen.js";
import { enhanceHooks, type HookPlatform } from "../lib/llm.js";

export const copilotRoutes = new Hono<Env>();

const PLATFORMS: HookPlatform[] = ["instagram", "xiaohongshu", "tiktok", "youtube"];

/** POST /api/copilot/hook-generator — 5 angle-tagged zh-HK content hooks for a mission.
 *  Deterministic template baseline + best-effort AI Gateway rewrite (template fallback).
 *  RLS-scopes every read to the caller. */
copilotRoutes.post("/hook-generator", async (c) => {
  const userId = c.get("userId");
  const workspaceId = c.get("workspaceId");
  const supabase = makeUserClient(c.get("jwt"));

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const missionSlug = typeof body.mission_slug === "string" ? body.mission_slug : "";
  if (!missionSlug) return c.json({ error: "mission_slug required", code: "bad_request" }, 400);
  const platform: HookPlatform = PLATFORMS.includes(body.platform as HookPlatform)
    ? (body.platform as HookPlatform)
    : "instagram";

  const [{ data: mission, error: mErr }, { data: creator, error: cErr }] = await Promise.all([
    supabase.from("missions").select("title, description, category").eq("workspace_id", workspaceId).eq("slug", missionSlug).eq("status", "active").single(),
    supabase.from("creators").select("categories").eq("id", userId).single(),
  ]);
  if (mErr) {
    if (mErr.code === "PGRST116") return c.json({ error: "mission not found", code: "not_found" }, 404);
    return c.json({ error: mErr.message, code: "db_error" }, 500);
  }
  if (cErr) return c.json({ error: cErr.message, code: "db_error" }, 500);

  const creatorNiche = (((creator?.categories as string[] | null) ?? [])[0]) ?? null;
  const title = mission.title as string;
  const description = (mission.description as string | null) ?? null;
  const category = (mission.category as string | null) ?? null;

  const hooks = buildHooks({ title, description, category, creatorNiche });
  const enhanced = await enhanceHooks({ hooks, platform, title, category, description });
  return c.json({ hooks: enhanced ?? hooks, source: enhanced ? "ai" : "template" });
});
