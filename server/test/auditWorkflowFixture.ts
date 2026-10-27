import { randomUUID } from "node:crypto";
import { appendFileSync, writeFileSync, mkdirSync, openSync, closeSync } from "node:fs";
import { dirname } from "node:path";
// @ts-expect-error Native audit helper; never part of the product engine.
import { FixtureJournal, durableJson } from "../../scripts/audit/fixture-journal.mjs";
// @ts-expect-error Native local read-only inventory helper.
import { preflightB2FixtureShape } from "../../scripts/audit/b2-fixture-inventory.mjs";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function createAuditFixture() {
  // @ts-expect-error Native ESM identity verifier has no declaration file.
  const { verifiedTarget } = await import("../../scripts/audit/local-targets.mjs");
  const target = verifiedTarget(); // Explicit B2 manifest or legacy default; before all clients/setup.
  const context = target.context;
  preflightB2FixtureShape(target);
  const journal = context ? new FixtureJournal(context.privatePath("owned-journal.jsonl"), context.lineage, context.manifest.fixture.rowCaps[context.phase]) : null;
  if (context) {
    journal.assertReady();
    const claim = context.privatePath("fixture-claim.json"); mkdirSync(dirname(claim), { recursive: true });
    // No entire-phase retry, even after a crash. Resume is read-only or uses exact complete receipts.
    try { closeSync(openSync(claim, "wx", 0o600)); } catch { throw new Error("B2 fixture phase already claimed; no automatic reseed"); }
    durableJson(claim, { lineage: context.lineage, state: "claimed" });
    mkdirSync(dirname(context.publicPath("workflow-runtime.jsonl")), { recursive: true });
  }
  Object.assign(process.env, target.env, { OPENAI_API_KEY: "", OPENROUTER_API_KEY: "", ANTHROPIC_API_KEY: "" });
  const { createClient } = await import("@supabase/supabase-js");
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  const service = createClient(target.env.SUPABASE_URL, target.env.SUPABASE_SERVICE_KEY, options);
  const runId = context?.plan.plannedNamespace ?? randomUUID();
  const workspaceId = context?.plan.plannedPrimaryWorkspaceId ?? randomUUID(), otherWorkspaceId = context?.plan.plannedDenialWorkspaceId ?? randomUUID();
  const slug = `audit-${runId}`;
  const authIds: string[] = [];
  const missionIds: string[] = [];
  const must = <T extends { data: unknown; error: { message: string } | null }>(result: T): T["data"] => {
    if (result.error) throw new Error(result.error.message);
    return result.data;
  };
  const correlation: Record<string, unknown>[] = [];
  const saveCorrelation = () => { if (context) durableJson(context.privatePath("correlation.private.json"), { lineage: context.lineage, correlation }); };
  async function insert(table: string, value: Record<string, unknown> | Record<string, unknown>[], fields = "*") {
    const rows = Array.isArray(value) ? value : [value];
    const key = ["id", "user_id"].find(k => rows.every(r => typeof r[k] === "string"));
    const perform = async (): Promise<Record<string, unknown>[]> => must(await service.from(table).insert(value).select(fields)) as unknown as Record<string, unknown>[];
    if (!journal) return perform();
    let result: Record<string, unknown>[] = [];
    await journal.perform(`insert:${table}`, { [table]: rows.length }, async () => {
      result = (await perform()) ?? [];
      const resultKey = key ?? "id";
      const ids = result.map(r => String(r.id ?? r[resultKey] ?? r.creator_id ?? ""));
      return { [table]: ids };
    }, key ? { [table]: rows.map(r => String(r[key])) } : {});
    return result;
  }
  const historical = context?.manifest.bootstrap.historicalLegacy;
  const adopted = historical && context.phase === historical.phase ? historical : null;
  if (adopted) {
    const row = JSON.parse(target.sql(`begin read only;select jsonb_build_object('workspaceId',w.id,'missionId',m.id,'submissionId',s.id,'creatorId',s.creator_id,'status',s.status,'contentUrls',s.content_urls) from public.workspaces w join public.missions m on m.workspace_id=w.id join public.mission_submissions s on s.mission_id=m.id where w.id='${workspaceId}' and m.id='${adopted.missionId}' and s.id='${adopted.submissionId}' and s.creator_id='${adopted.creatorId}';commit;`));
    if (!row || row.status !== "submitted" || JSON.stringify(row.contentUrls) !== JSON.stringify(adopted.contentUrls)) throw new Error("B2 historical checkpoint readback mismatch");
    journal.observe({ workspaces: [workspaceId], missions: [adopted.missionId], mission_submissions: [adopted.submissionId], auth_users: [adopted.creatorId], creators: [adopted.creatorId] });
    authIds.push(adopted.creatorId);
  }
  await insert("workspaces", [
    { id: workspaceId, slug, name: "Synthetic audit workspace A" },
    { id: otherWorkspaceId, slug: `${slug}-b`, name: "Synthetic audit workspace B" },
  ].filter(row => !adopted || row.id !== workspaceId));
  async function account(role: "creator" | "operator" | "no-membership", index: number) {
    const email = `${role}-${index}-${runId}@example.test`, password = `Audit-${randomUUID()}!`;
    correlation.push({ role, index, email, password, state: "intent" }); saveCorrelation();
    let id = "";
    const create = async () => { const created = must(await service.auth.admin.createUser({ email, password, email_confirm: true })); id = created.user!.id; return { auth_users: [id] }; };
    if (journal) await journal.perform(`auth:${role}:${index}`, { auth_users: 1 }, create); else await create();
    authIds.push(id); correlation.push({ email, id, state: "success" }); saveCorrelation();
    if (role === "creator") {
      await insert("creators", { id, workspace_id: workspaceId, display_name: `Audit creator ${index}`, xp: 0, onboarding_completed: true });
      await insert("point_balances", { creator_id: id, workspace_id: workspaceId, balance: 50 });
      await insert("earnings_balances", { creator_id: id, workspace_id: workspaceId, available: 0 });
    } else {
      await insert("staff_users", { user_id: id, email, active: true });
      if (role === "operator") await insert("brand_users", { user_id: id, email, workspace_id: workspaceId, active: true, role: "member" });
    }
    const client = createClient(target.env.SUPABASE_URL, target.env.SUPABASE_ANON_KEY, options);
    const signedIn = must(await client.auth.signInWithPassword({ email, password }));
    return { id, email, password, jwt: signedIn.session!.access_token, session: signedIn.session!, client };
  }
  const creators = [await account("creator", 1), await account("creator", 2)];
  const operator = await account("operator", 1), noMembership = await account("no-membership", 1);
  async function mission(mode: "legacy" | "active_workspace", fulfillment = false, quota = 1) {
    const planned = context?.plan.plannedMissions.find((m: { id: string; kind: string }) => !missionIds.includes(m.id) && (mode === "legacy" ? m.kind === "legacy" : ["active", "unknown-contract"].includes(m.kind)));
    if (context && !planned) throw new Error("B2 mission cap/plan exhausted");
    const id = planned?.id ?? randomUUID(), missionSlug = `audit-mission-${id}`; missionIds.push(id);
    if (adopted?.missionId === id) return { id, slug: missionSlug };
    await insert("missions", { id, workspace_id: workspaceId, slug: missionSlug, title: `Synthetic ${mode} mission`,
      mission_type: "ugc", access_type: "open", points_reward: 500, cash_reward: 125, quota, status: "active", required_level: "L0",
      creator_workflow_mode: mode, fulfillment_required: fulfillment, revision_limit: 2, review_sla_hours: 48, revision_response_hours: 48,
      platforms: ["instagram"], deliverables: ["One synthetic post"], requirements: ["Show the synthetic product"] });
    if (mode === "active_workspace") {
      const templates = await insert("mission_deliverable_templates", [true, false].map((required, position) => ({
        workspace_id: workspaceId, mission_id: id, title: required ? "Required synthetic post" : "Optional synthetic post", platform: "instagram",
        required, position, publication_instructions: "Synthetic acceptance only; never publish", publication_window_hours: 72,
        required_disclosures: [], proof_evidence_policy: {},
      })), "id,position");
      for (const template of templates ?? []) await insert("mission_deliverable_requirements", {
        workspace_id: workspaceId, mission_deliverable_template_id: template.id, category: "format", requirement_text: "Show the product", required: true, position: 0,
      });
    }
    return { id, slug: missionSlug };
  }
  async function legacyNeutrality(creatorId: string) {
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
  async function neutrality(creatorId: string) {
    if (!context) return legacyNeutrality(creatorId);
    // Same read-only snapshot helper as the browser gate; all pending/cancel/reapproval
    // assertions now include unchanged row fingerprints, not just balance/count totals.
    // @ts-expect-error Native existing acceptance snapshot helper.
    const {neutralitySnapshot} = await import("../../scripts/audit/neutrality-snapshot.mjs");
    return neutralitySnapshot(target,creatorId,workspaceId,{complete:true}) as Awaited<ReturnType<typeof legacyNeutrality>> & {financialRows:Record<string,unknown[]>};
  }
  const publicIds = () => ({ runId, workspaceIds: [workspaceId,otherWorkspaceId], authIds, missionIds });
  function queueCreators(count: number) {
    if (!Number.isInteger(count) || count < 1 || count > 51) throw new Error("bounded synthetic queue fixture required");
    const ids: string[] = context?.plan.plannedQueueCreatorIds ?? Array.from({length:count},()=>randomUUID());
    if (ids.length !== count) throw new Error("B2 queue exact plan mismatch");
    const prefix = `queue-${runId}`;
    const added = ids.filter(id => id !== adopted?.creatorId);
    const perform = () => { target.sql(`begin;
      insert into auth.users(id,email) values ${added.map((id)=>`('${id}','${id}@example.test')`).join(",")};
      insert into public.creators(id,workspace_id,display_name,onboarding_completed) values ${added.map(id=>`('${id}','${workspaceId}','${prefix}-${ids.indexOf(id)}',true)`).join(",")};
      commit;`); return { auth_users: added, creators: added }; };
    if (journal) journal.performSync("queue-creators", { auth_users: added.length, creators: added.length }, perform, { auth_users: added, creators: added }); else perform();
    authIds.push(...added);
    return {ids,prefix};
  }
  function recordEvidence(value: Record<string, unknown>) {
    // Cancellation responses contain authored notes. Keep the transition result only.
    const safe = { ...value };
    if ("cancellation" in safe) { delete safe.cancellation; safe.cancelled = true; }
    appendFileSync(context?.publicPath("workflow-runtime.jsonl") ?? "docs/verification/workflow-runtime.jsonl", JSON.stringify({ ...(context ? { lineage: context.lineage } : {}), ...publicIds(), ...safe }) + "\n");
  }
  // Private local credentials stay ignored. Evidence records only opaque IDs and values.
  const privateValue = { ...(context ? { lineage: context.lineage } : {}), ...publicIds(), slug, env: target.env, creators, operator, noMembership };
  if (context) durableJson(context.privatePath("fixture.private.json"), privateValue);
  else writeFileSync(`.codex-tmp/fixture-${runId}.private.json`, JSON.stringify(privateValue, (key, value) => key === "client" ? undefined : value));
  recordEvidence({ stage: "fixture-created", target: target.identity, cleanup: "not-run; retained for inspection; only these exact IDs may be removed" });
  return { runId, target, service: service as SupabaseClient, workspaceId, otherWorkspaceId, slug, creators, operator, noMembership,
    mission, neutrality, queueCreators, recordEvidence, must, journal, insert, historical: adopted, saveCorrelation, correlation };
}
