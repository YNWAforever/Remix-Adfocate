import { Hono } from "hono";
import type { Env } from "../app";
import { makeUserClient } from "../lib/supabase";

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
