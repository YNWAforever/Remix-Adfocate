import { Hono } from "hono";
import type { Env } from "../app.js";
import { addOrUpdateSocialAccount, listSocialAccounts } from "../lib/social/repo.js";
import { scanSocialAccount } from "../lib/social/service.js";
import { makeUserClient } from "../lib/supabase.js";
import type { SocialPlatform } from "../lib/social/types.js";

export const socialRoutes = new Hono<Env>();

function isPlatform(value: unknown): value is SocialPlatform {
  return value === "instagram" || value === "threads";
}

function trustLabels(account: { api_synced_at: string | null; owner_verified: boolean }) {
  if (!account.api_synced_at) return [];
  return ["API-synced", account.owner_verified ? "Ownership verified" : "Ownership not verified"];
}

socialRoutes.get("/accounts", async (c) => {
  const supabase = makeUserClient(c.get("jwt"));

  try {
    const accounts = await listSocialAccounts(supabase, c.get("userId"));
    return c.json({ accounts });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to list social accounts";
    return c.json({ error: message, code: "db_error" }, 500);
  }
});

socialRoutes.post("/accounts", async (c) => {
  const body: { platform?: unknown; handle?: unknown } = await c.req
    .json<{ platform?: unknown; handle?: unknown }>()
    .catch(() => ({}));
  if (!isPlatform(body.platform)) {
    return c.json({ error: "Unsupported platform", code: "bad_platform" }, 400);
  }
  if (typeof body.handle !== "string" || !body.handle.trim()) {
    return c.json({ error: "Missing handle", code: "bad_handle" }, 400);
  }

  const supabase = makeUserClient(c.get("jwt"));

  try {
    const account = await addOrUpdateSocialAccount(supabase, {
      creatorId: c.get("userId"),
      workspaceId: c.get("workspaceId"),
      platform: body.platform,
      handle: body.handle,
    });
    return c.json(account);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save social account";
    return c.json({ error: message, code: "db_error" }, 500);
  }
});

socialRoutes.post("/accounts/:id/scan", async (c) => {
  try {
    const account = await scanSocialAccount({
      creatorId: c.get("userId"),
      accountId: c.req.param("id"),
    });

    if (account.sync_status === "failed") {
      return c.json({ account, labels: trustLabels(account) }, 422);
    }
    if (account.sync_status === "rate_limited") {
      return c.json({ account, labels: trustLabels(account) }, 429);
    }

    return c.json({ account, labels: trustLabels(account) });
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? error.code : null;
    const message = error instanceof Error ? error.message : "Social scan failed";

    if (code === "provider_not_configured") {
      return c.json({ error: message, code }, 503);
    }
    if (code === "not_found") {
      return c.json({ error: message, code }, 404);
    }

    return c.json({ error: message, code: "db_error" }, 500);
  }
});
