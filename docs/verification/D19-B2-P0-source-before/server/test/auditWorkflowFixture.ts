import { randomUUID } from "node:crypto";
import { appendFileSync, writeFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function createAuditFixture() {
  // @ts-expect-error Native ESM identity verifier has no declaration file.
  const { verifiedTarget } = await import("../../scripts/audit/local-targets.mjs");
  const target = verifiedTarget("empty"); // Must precede SDK import and all clients/setup.
  Object.assign(process.env, target.env, { OPENAI_API_KEY: "", OPENROUTER_API_KEY: "", ANTHROPIC_API_KEY: "" });
  const { createClient } = await import("@supabase/supabase-js");
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  const service = createClient(target.env.SUPABASE_URL, target.env.SUPABASE_SERVICE_KEY, options);
  const runId = randomUUID();
  const workspaceId = randomUUID(), otherWorkspaceId = randomUUID();
  const slug = `audit-${runId}`;
  const authIds: string[] = [];
  const missionIds: string[] = [];
  const must = <T extends { data: unknown; error: { message: string } | null }>(result: T): T["data"] => {
    if (result.error) throw new Error(result.error.message);
    return result.data;
  };
  must(await service.from("workspaces").insert([
    { id: workspaceId, slug, name: "Synthetic audit workspace A" },
    { id: otherWorkspaceId, slug: `${slug}-b`, name: "Synthetic audit workspace B" },
  ]));
  async function account(role: "creator" | "operator" | "no-membership", index: number) {
    const email = `${role}-${index}-${runId}@example.test`, password = `Audit-${randomUUID()}!`;
    const created = must(await service.auth.admin.createUser({ email, password, email_confirm: true }));
    const id = created.user!.id; authIds.push(id);
    if (role === "creator") {
      must(await service.from("creators").insert({ id, workspace_id: workspaceId, display_name: `Audit creator ${index}`, xp: 0, onboarding_completed: true }));
      must(await service.from("point_balances").insert({ creator_id: id, workspace_id: workspaceId, balance: 50 }));
      must(await service.from("earnings_balances").insert({ creator_id: id, workspace_id: workspaceId, available: 0 }));
    } else {
      must(await service.from("staff_users").insert({ user_id: id, email, active: true }));
      if (role === "operator") must(await service.from("brand_users").insert({ user_id: id, email, workspace_id: workspaceId, active: true, role: "member" }));
    }
    const client = createClient(target.env.SUPABASE_URL, target.env.SUPABASE_ANON_KEY, options);
    const signedIn = must(await client.auth.signInWithPassword({ email, password }));
    return { id, email, password, jwt: signedIn.session!.access_token, session: signedIn.session!, client };
  }
  const creators = [await account("creator", 1), await account("creator", 2)];
  const operator = await account("operator", 1), noMembership = await account("no-membership", 1);
  async function mission(mode: "legacy" | "active_workspace", fulfillment = false, quota = 1) {
    const id = randomUUID(), missionSlug = `audit-mission-${id}`; missionIds.push(id);
    must(await service.from("missions").insert({ id, workspace_id: workspaceId, slug: missionSlug, title: `Synthetic ${mode} mission`,
      mission_type: "ugc", access_type: "open", points_reward: 500, cash_reward: 125, quota, status: "active", required_level: "L0",
      creator_workflow_mode: mode, fulfillment_required: fulfillment, revision_limit: 2, review_sla_hours: 48, revision_response_hours: 48,
      platforms: ["instagram"], deliverables: ["One synthetic post"], requirements: ["Show the synthetic product"] }));
    if (mode === "active_workspace") {
      const templates = must(await service.from("mission_deliverable_templates").insert([true, false].map((required, position) => ({
        workspace_id: workspaceId, mission_id: id, title: required ? "Required synthetic post" : "Optional synthetic post", platform: "instagram",
        required, position, publication_instructions: "Synthetic acceptance only; never publish", publication_window_hours: 72,
        required_disclosures: [], proof_evidence_policy: {},
      }))).select("id,position"));
      for (const template of templates ?? []) must(await service.from("mission_deliverable_requirements").insert({
        workspace_id: workspaceId, mission_deliverable_template_id: template.id, category: "format", requirement_text: "Show the product", required: true, position: 0,
      }));
    }
    return { id, slug: missionSlug };
  }
  async function neutrality(creatorId: string) {
    const row = async (table: string, fields: string, key: string, value: string) => must(await service.from(table).select(fields).eq(key,value).maybeSingle()) as unknown as Record<string,number> | null;
    const count = async (table: string, key: string, value: string) => {
      const result = await service.from(table).select("*",{head:true,count:"exact"}).eq(key,value); must(result); return result.count ?? 0;
    };
    const creator = await row("creators","xp","id",creatorId);
    const points = await row("point_balances","balance","creator_id",creatorId);
    const earnings = await row("earnings_balances","available","creator_id",creatorId);
    const budget = await row("workspace_budgets","balance","workspace_id",workspaceId);
    const inventory = must(await service.from("redemption_gifts").select("id,stock_qty,stock_remaining").eq("workspace_id",workspaceId));
    return { xp: creator!.xp, points: points!.balance, withdrawable: earnings!.available, budget: budget?.balance ?? null,
      pointLedger: await count("point_transactions","creator_id",creatorId), cashLedger: await count("earnings_transactions","creator_id",creatorId),
      redemptions: await count("redemptions","creator_id",creatorId), budgetLedger: await count("workspace_budget_transactions","workspace_id",workspaceId),
      rewardInventory: inventory ?? [] };
  }
  const publicIds = () => ({ runId, workspaceIds: [workspaceId,otherWorkspaceId], authIds, missionIds });
  function queueCreators(count: number) {
    if (!Number.isInteger(count) || count < 1 || count > 51) throw new Error("bounded synthetic queue fixture required");
    const ids = Array.from({length:count},()=>randomUUID());
    const prefix = `queue-${runId}`;
    target.sql(`begin;
      insert into auth.users(id,email) values ${ids.map((id)=>`('${id}','${id}@example.test')`).join(",")};
      insert into public.creators(id,workspace_id,display_name,onboarding_completed) values ${ids.map((id,index)=>`('${id}','${workspaceId}','${prefix}-${index}',true)`).join(",")};
      commit;`);
    authIds.push(...ids);
    return {ids,prefix};
  }
  function recordEvidence(value: Record<string, unknown>) {
    // Cancellation responses contain authored notes. Keep the transition result only.
    const safe = { ...value };
    if ("cancellation" in safe) { delete safe.cancellation; safe.cancelled = true; }
    appendFileSync("docs/verification/workflow-runtime.jsonl", JSON.stringify({ ...publicIds(), ...safe }) + "\n");
  }
  // Private local credentials stay ignored. Evidence records only opaque IDs and values.
  writeFileSync(`.codex-tmp/fixture-${runId}.private.json`, JSON.stringify({ ...publicIds(), slug, env: target.env, creators, operator, noMembership },
    (key, value) => key === "client" ? undefined : value));
  recordEvidence({ stage: "fixture-created", target: target.identity, cleanup: "not-run; retained for inspection; only these exact IDs may be removed" });
  return { runId, target, service: service as SupabaseClient, workspaceId, otherWorkspaceId, slug, creators, operator, noMembership,
    mission, neutrality, queueCreators, recordEvidence, must };
}
