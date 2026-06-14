import { Hono } from "hono";
import type { Env } from "../app.js";
import { makeUserClient } from "../lib/supabase.js";

export const walletRoutes = new Hono<Env>();

walletRoutes.get("/points", async (c) => {
  const supabase = makeUserClient(c.get("jwt"));
  const { data, error } = await supabase
    .from("point_balances")
    .select("balance, available_to")
    .eq("creator_id", c.get("userId"))
    .maybeSingle();
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json({ balance: data?.balance ?? 0, available_to: data?.available_to ?? null });
});

walletRoutes.get("/points/history", async (c) => {
  const supabase = makeUserClient(c.get("jwt"));
  const { data, error } = await supabase
    .from("point_transactions")
    .select("id, type, delta, balance_after, description, created_at")
    .eq("creator_id", c.get("userId"))
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json({ transactions: data });
});

walletRoutes.get("/earnings", async (c) => {
  const supabase = makeUserClient(c.get("jwt"));
  const userId = c.get("userId");

  const { data: bal, error: balErr } = await supabase
    .from("earnings_balances")
    .select("available")
    .eq("creator_id", userId)
    .maybeSingle();
  if (balErr) return c.json({ error: balErr.message, code: "db_error" }, 500);

  // pending = Σ cash_reward over the caller's submitted / under_review submissions.
  const { data: pend, error: pErr } = await supabase
    .from("mission_submissions")
    .select("missions!inner(cash_reward)")
    .eq("creator_id", userId)
    .in("status", ["submitted", "under_review"]);
  if (pErr) return c.json({ error: pErr.message, code: "db_error" }, 500);
  const pending = (pend ?? []).reduce(
    (sum, r) => sum + Number((r as { missions?: { cash_reward?: number | null } }).missions?.cash_reward ?? 0),
    0,
  );

  return c.json({ available: Number(bal?.available ?? 0), pending });
});

walletRoutes.get("/earnings/history", async (c) => {
  const supabase = makeUserClient(c.get("jwt"));
  const { data, error } = await supabase
    .from("earnings_transactions")
    .select("id, type, amount, balance_after, description, created_at")
    .eq("creator_id", c.get("userId"))
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  const transactions = (data ?? []).map((t) => ({
    ...t,
    amount: Number(t.amount),
    balance_after: Number(t.balance_after),
  }));
  return c.json({ transactions });
});
