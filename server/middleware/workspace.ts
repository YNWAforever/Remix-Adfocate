import type { MiddlewareHandler } from "hono";
import type { Env } from "../app.js";
import { makeUserClient } from "../lib/supabase.js";

export const workspaceAuth: MiddlewareHandler<Env> = async (c, next) => {
  const auth = c.req.header("Authorization");
  const jwt = auth?.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!jwt) return c.json({ error: "Missing bearer token", code: "no_auth" }, 401);

  const slug = c.req.header("X-Workspace-Slug");
  if (!slug) return c.json({ error: "Missing workspace", code: "no_workspace" }, 400);

  const supabase = makeUserClient(jwt);
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) {
    return c.json({ error: "Invalid token", code: "bad_token" }, 401);
  }

  // Resolve workspace by slug and verify the creator belongs to it.
  const { data: creator } = await supabase
    .from("creators")
    .select("id, workspace_id, status, workspaces!creators_workspace_id_fkey!inner(slug)")
    .eq("workspaces.slug", slug)
    .single();

  if (!creator) {
    return c.json({ error: "Creator not in workspace", code: "forbidden" }, 403);
  }
  // A deleted (anonymised) account's still-unexpired access token must not keep working, except
  // to retry the deletion itself so a partly failed cleanup can complete.
  const finishingDeletion = c.req.method === "POST" && c.req.path.endsWith("/me/delete");
  if ((creator as { status?: string }).status === "deleted" && !finishingDeletion) {
    return c.json({ error: "Account deleted", code: "account_deleted" }, 401);
  }

  c.set("jwt", jwt);
  c.set("userId", userData.user.id);
  c.set("workspaceId", creator.workspace_id as string);
  await next();
};
