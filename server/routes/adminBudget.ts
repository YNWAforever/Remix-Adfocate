// server/routes/adminBudget.ts
import { Hono } from "hono";
import { serviceClient } from "../lib/supabase.js";

/** Operator budget management (Slice 3). Mounted under the /admin staff-auth gate; uses
 *  serviceClient (bypasses RLS) and the SECURITY DEFINER funding RPCs. All relative imports
 *  carry the .js ESM extension. */
export const adminBudgetRoutes = new Hono();

adminBudgetRoutes.get("/budget", async (c) => {
  const ws = c.req.query("workspace");
  if (!ws) return c.json({ error: "workspace required", code: "no_workspace" }, 400);
  const svc = serviceClient();
  const { data: row } = await svc
    .from("workspace_budgets").select("balance, enforced").eq("workspace_id", ws).maybeSingle();
  const { data: txns, error } = await svc
    .from("workspace_budget_transactions")
    .select("id, type, delta, balance_after, source_ref, description, created_at")
    .eq("workspace_id", ws).order("created_at", { ascending: false }).limit(100);
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json({ budget: { balance: row?.balance ?? 0, enforced: row?.enforced ?? false }, transactions: txns ?? [] });
});

adminBudgetRoutes.post("/budget/topup", async (c) => {
  const body = await c.req.json<{ workspace_id?: string; amount?: number }>().catch(() => ({}) as { workspace_id?: string; amount?: number });
  const ws = body.workspace_id;
  const amount = Number(body.amount);
  if (!ws) return c.json({ error: "workspace_id required", code: "no_workspace" }, 400);
  if (!Number.isFinite(amount) || amount <= 0) return c.json({ error: "amount must be > 0", code: "bad_amount" }, 400);
  const { data, error } = await serviceClient().rpc("credit_workspace_budget", {
    p_workspace: ws, p_delta: amount, p_type: "topup", p_description: null,
  });
  if (error) return c.json({ error: error.message, code: "rpc_error" }, 400);
  return c.json({ balance: data });
});

adminBudgetRoutes.post("/budget/adjust", async (c) => {
  const body = await c.req.json<{ workspace_id?: string; delta?: number; description?: string }>().catch(() => ({}) as { workspace_id?: string; delta?: number; description?: string });
  const ws = body.workspace_id;
  const delta = Number(body.delta);
  if (!ws) return c.json({ error: "workspace_id required", code: "no_workspace" }, 400);
  if (!Number.isFinite(delta) || delta === 0) return c.json({ error: "delta must be non-zero", code: "bad_amount" }, 400);
  const { data, error } = await serviceClient().rpc("credit_workspace_budget", {
    p_workspace: ws, p_delta: delta, p_type: "adjust", p_description: body.description ?? null,
  });
  if (error) {
    if (error.message === "negative_balance") return c.json({ error: "balance cannot go negative", code: "negative_balance" }, 400);
    return c.json({ error: error.message, code: "rpc_error" }, 400);
  }
  return c.json({ balance: data });
});

adminBudgetRoutes.post("/budget/enforcement", async (c) => {
  const body = await c.req.json<{ workspace_id?: string; enforced?: boolean }>().catch(() => ({}) as { workspace_id?: string; enforced?: boolean });
  const ws = body.workspace_id;
  if (!ws) return c.json({ error: "workspace_id required", code: "no_workspace" }, 400);
  const { data, error } = await serviceClient().rpc("set_workspace_budget_enforcement", {
    p_workspace: ws, p_enforced: Boolean(body.enforced),
  });
  if (error) return c.json({ error: error.message, code: "rpc_error" }, 400);
  return c.json({ enforced: data });
});
