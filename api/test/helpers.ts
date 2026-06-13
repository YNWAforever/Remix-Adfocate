import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL!;
const service = createClient(url, process.env.SUPABASE_SERVICE_KEY!, {
  auth: { persistSession: false },
});

export const DEMO_WS = "00000000-0000-0000-0000-0000000000aa";

/** Create a confirmed user + creator (in DEMO_WS) + balance. Returns a signed-in JWT. */
export async function makeCreator(email: string, balance = 0) {
  const { data: created, error } = await service.auth.admin.createUser({
    email, password: "test-pw-123456", email_confirm: true,
  });
  if (error) throw error;
  const userId = created.user.id;

  await service.from("creators").insert({ id: userId, workspace_id: DEMO_WS, display_name: email });
  await service.from("point_balances").insert({ creator_id: userId, workspace_id: DEMO_WS, balance });

  const anon = createClient(url, process.env.SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const { data: session, error: signErr } = await anon.auth.signInWithPassword({
    email, password: "test-pw-123456",
  });
  if (signErr) throw signErr;
  return { userId, jwt: session.session!.access_token };
}

export async function cleanup() {
  const { data } = await service.from("creators").select("id").like("display_name", "%@test.local");
  for (const row of data ?? []) {
    await service.from("point_transactions").delete().eq("creator_id", row.id);
    await service.from("point_balances").delete().eq("creator_id", row.id);
    await service.from("creators").delete().eq("id", row.id);
    await service.auth.admin.deleteUser(row.id);
  }
}
