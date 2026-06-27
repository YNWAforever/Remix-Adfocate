// server/routes/brandBudget.ts
import { Hono } from "hono";
import { makeUserClient } from "../lib/supabase.js";
import type { BrandEnv } from "../lib/brandAuth.js";

/** Brand-facing READ-ONLY wallet. Mounted under requireBrand; reads through makeUserClient so
 *  the RLS policy (migration 0024) scopes rows to the caller's workspace. The brand can never
 *  top-up or toggle enforcement — that's operator-only. All relative imports carry .js. */
export const brandBudgetRoutes = new Hono<BrandEnv>();

function bearer(c: { req: { header: (k: string) => string | undefined } }): string {
  const a = c.req.header("Authorization") ?? "";
  return a.startsWith("Bearer ") ? a.slice(7) : "";
}

brandBudgetRoutes.get("/budget", async (c) => {
  const ws = c.var.brand.workspaceId;
  const uc = makeUserClient(bearer(c));
  const { data: row, error: rErr } = await uc
    .from("workspace_budgets").select("balance, enforced").eq("workspace_id", ws).maybeSingle();
  if (rErr) return c.json({ error: rErr.message, code: "db_error" }, 500);
  const { data: txns, error: tErr } = await uc
    .from("workspace_budget_transactions")
    .select("id, type, delta, balance_after, source_ref, description, created_at")
    .eq("workspace_id", ws).order("created_at", { ascending: false }).limit(50);
  if (tErr) return c.json({ error: tErr.message, code: "db_error" }, 500);
  return c.json({ budget: { balance: row?.balance ?? 0, enforced: row?.enforced ?? false }, transactions: txns ?? [] });
});
