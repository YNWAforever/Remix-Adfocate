import { randomUUID } from "node:crypto";
import type { ActiveMissionWorkspace, MissionPublicationView, MissionWorkItemView } from "../../src/lib/activeMission";
import { ProviderRehearsalFailure, requireProviderFact, type ProviderActor, type ProviderRehearsalRuntime } from "./delta-provider-contracts";
import { PsqlTransportError, type PsqlTransportFailureCode } from "./delta-psql-session";

export const PROVIDER_FIXTURE_SQL_STAGES = Object.freeze(["query", "mission-legacy", "mission-active", "issued-history", "neutrality", "issued-anchor", "legacy-events", "null-mode-schema", "quota-actors", "quota-counts", "draft-versions", "pending-counts"] as const);
export type ProviderFixtureSqlStage = typeof PROVIDER_FIXTURE_SQL_STAGES[number];
const PSQL_FAILURE_CODES = ["invalid-options", "invalid-query", "spawn-failed", "process-error", "unexpected-exit", "protocol-error", "query-timeout", "output-limit", "stdin-error", "stderr-output", "busy", "closed", "aborted", "close-timeout", "json-result"] satisfies readonly PsqlTransportFailureCode[];
const HTTP_STATUSES = [200, 201, 400, 401, 403, 404, 409, 413, 415, 422, 429];
const SQLSTATE = /^[0-9A-Z]{5}$/;
const SHARED_FAILURE_CODES = ["journey-fixture-identity", "journey-fixture-options", "journey-fixture-readback", "journey-required-item", "journey-fixture-stage", "journey-fixture-drafting", "journey-fixture-draft", "journey-fixture-approved", "journey-fixture-create", "journey-fixture-prepare", "journey-fixture-mode", "journey-request-status", "journey-request-path", "journey-http-failed", ...HTTP_STATUSES.map(status => `journey-http-${status}`)];
/** A bounded public diagnostic token only; never reads messages, SQL, rows, arguments or causes. */
function journeyDiagnosticCode(code: unknown): string | undefined {
  if (typeof code !== "string") return undefined;
  for (const stage of PROVIDER_FIXTURE_SQL_STAGES) {
    const prefix = `journey-fixture-${stage}-`; if (!code.startsWith(prefix)) continue;
    const suffix = code.slice(prefix.length);
    if (["row", "json", "failed"].includes(suffix) || PSQL_FAILURE_CODES.some(failure => suffix === `psql-${failure}` || suffix.startsWith(`psql-${failure}-`) && SQLSTATE.test(suffix.slice(`psql-${failure}-`.length)))) return `${stage}-${suffix}`;
  }
  return SHARED_FAILURE_CODES.includes(code) ? code.slice("journey-".length) : undefined;
}
export function providerFixtureDiagnosticCode(value: unknown): value is string { return journeyDiagnosticCode(value) !== undefined; }
export function providerJourneyDiagnostic(error: unknown): string | undefined {
  return error instanceof ProviderRehearsalFailure ? journeyDiagnosticCode(error.code) : undefined;
}

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export function providerFixtureUuid(value: string): string {
  requireProviderFact(typeof value === "string" && UUID.test(value), "journey-fixture-identity"); return value;
}
export async function providerJourneyRequest<T>(runtime: ProviderRehearsalRuntime, actor: ProviderActor, path: string,
  method = "GET", body?: unknown, key?: string, expected = 200): Promise<T> {
  try {
    requireProviderFact(HTTP_STATUSES.includes(expected), "journey-request-status");
    requireProviderFact(path.startsWith("/api/") && !path.includes("..") && !path.includes("\\") && !path.includes("#"), "journey-request-path");
    if (key) providerFixtureUuid(key);
    const response = await runtime.request(actor, path, { method, redirect: "error", headers: { "X-Workspace-Slug": runtime.workspaceSlug,
      "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    requireProviderFact(response.status === expected, `journey-http-${expected}`);
    return await response.json() as T;
  } catch (error) { if (error instanceof ProviderRehearsalFailure) throw error; throw new ProviderRehearsalFailure("journey-http-failed"); }
}
export async function providerFixtureJson<T>(runtime: ProviderRehearsalRuntime, sql: string, stage: ProviderFixtureSqlStage = "query"): Promise<T> {
  requireProviderFact(PROVIDER_FIXTURE_SQL_STAGES.includes(stage), "journey-fixture-stage");
  let rows: readonly string[];
  try { await runtime.assertOwned(); rows = await runtime.sql(sql); }
  catch (error) {
    if (error instanceof ProviderRehearsalFailure) throw error;
    if (error instanceof PsqlTransportError && PSQL_FAILURE_CODES.includes(error.code)) {
      const state = typeof error.sqlState === "string" && SQLSTATE.test(error.sqlState) ? `-${error.sqlState}` : "";
      throw new ProviderRehearsalFailure(`journey-fixture-${stage}-psql-${error.code}${state}`);
    }
    throw new ProviderRehearsalFailure(`journey-fixture-${stage}-failed`);
  }
  requireProviderFact(rows.length === 1, `journey-fixture-${stage}-row`);
  try { return JSON.parse(rows[0]!) as T; }
  catch { throw new ProviderRehearsalFailure(`journey-fixture-${stage}-json`); }
}
/** Repository-authored SQL only; all interpolated identities are validated UUIDs and all other values are closed constants. */
export async function createProviderMission(runtime: ProviderRehearsalRuntime, mode: "legacy" | "active_workspace",
  options: { quota?: number; fulfillment?: boolean } = {}): Promise<{ id: string; slug: string }> {
  try {
    const workspace = providerFixtureUuid(runtime.workspaceId), run = providerFixtureUuid(runtime.runId), id = randomUUID();
    const quota = options.quota ?? 1;
    requireProviderFact(["legacy", "active_workspace"].includes(mode) && Number.isInteger(quota) && quota >= 1 && quota <= 3, "journey-fixture-options");
    const slug = `provider-journey-${run}-${id}`, templateIds = [randomUUID(), randomUUID()];
    const templates = mode === "active_workspace" ? `
      insert into public.mission_deliverable_templates(id,workspace_id,mission_id,title,platform,required,position,publication_instructions,publication_window_hours,required_disclosures,proof_evidence_policy)
        values ('${templateIds[0]}','${workspace}','${id}','Synthetic required post','instagram',true,0,'Synthetic local rehearsal; never publish',72,'[]'::jsonb,'{}'::jsonb),
        ('${templateIds[1]}','${workspace}','${id}','Synthetic optional post','instagram',false,1,'Synthetic local rehearsal; never publish',72,'[]'::jsonb,'{}'::jsonb);
      insert into public.mission_deliverable_requirements(workspace_id,mission_deliverable_template_id,category,requirement_text,required,position)
        values ('${workspace}','${templateIds[0]}','format','Show synthetic product',true,0),('${workspace}','${templateIds[1]}','format','Show synthetic product',true,0);` : "";
    const result = await providerFixtureJson<{ id: string; slug: string }>(runtime, `-- provider-journey owned fixture
      begin;
      insert into public.missions(id,workspace_id,slug,title,mission_type,access_type,points_reward,cash_reward,quota,status,required_level,creator_workflow_mode,fulfillment_required,revision_limit,review_sla_hours,revision_response_hours,platforms,deliverables,requirements)
        values ('${id}','${workspace}','${slug}','Synthetic provider rehearsal','ugc','open',500,125,${quota},'active','L0','${mode}',${options.fulfillment === true},2,48,48,array['instagram'],array['Synthetic post'],array['Show synthetic product']);
      ${templates}
      commit;
      select jsonb_build_object('id',id,'slug',slug) from public.missions where id='${id}' and workspace_id='${workspace}';`, mode === "legacy" ? "mission-legacy" : "mission-active");
    requireProviderFact(result.id === id && result.slug === slug, "journey-fixture-readback"); return result;
  } catch (error) { if (error instanceof ProviderRehearsalFailure) throw error; throw new ProviderRehearsalFailure("journey-fixture-create"); }
}
export function requiredProviderItem(workspace: ActiveMissionWorkspace): MissionWorkItemView {
  const item = workspace.workItems.find(candidate => candidate.required);
  requireProviderFact(item && UUID.test(item.id), "journey-required-item"); return item;
}
export async function providerWorkspace(runtime: ProviderRehearsalRuntime, creator: ProviderActor, submissionId: string): Promise<ActiveMissionWorkspace> {
  providerFixtureUuid(submissionId);
  return providerJourneyRequest(runtime, creator, `/api/my-missions/${submissionId}/workspace`);
}
export interface ProviderJourneyFixture {
  readonly missionId: string; readonly missionSlug: string; readonly submissionId: string; readonly workflowId: string;
  readonly workItemId: string; readonly instructionRevision: number; readonly creatorId: string;
  readonly creator: ProviderActor; readonly workspace: ActiveMissionWorkspace;
}
export async function prepareProviderActiveFixture(runtime: ProviderRehearsalRuntime,
  stage: "drafting" | "approved_to_publish" = "drafting"): Promise<ProviderJourneyFixture> {
  try {
    requireProviderFact(["drafting", "approved_to_publish"].includes(stage), "journey-fixture-stage");
    const creator = runtime.actors.creator; providerFixtureUuid(creator.id);
    const mission = await createProviderMission(runtime, "active_workspace");
    const joined = await providerJourneyRequest<{ submission: { id: string }; workflow: { id: string } }>(runtime, creator, `/api/missions/${mission.slug}/join`, "POST");
    const submissionId = providerFixtureUuid(joined.submission.id), workflowId = providerFixtureUuid(joined.workflow.id);
    let workspace = await providerWorkspace(runtime, creator, submissionId), item = requiredProviderItem(workspace);
    requireProviderFact(workspace.workflow.id === workflowId && workspace.workflow.state === "drafting" && item.state === "drafting", "journey-fixture-drafting");
    let instructionRevision = 0;
    if (stage === "approved_to_publish") {
      requireProviderFact(item.draft && item.requirements.length > 0, "journey-fixture-draft");
      const path = `/api/my-missions/${submissionId}/work-items/${item.id}`, review = `/api/admin/active-missions/${workflowId}/work-items/${item.id}`;
      const checklist = Object.fromEntries(item.requirements.map(requirement => [requirement.id, true]));
      await providerJourneyRequest(runtime, creator, `${path}/draft`, "PATCH", { revision: item.draft.revision, caption: "Synthetic provider draft", checklist });
      workspace = await providerWorkspace(runtime, creator, submissionId); item = requiredProviderItem(workspace);
      await providerJourneyRequest(runtime, creator, `${path}/submit`, "POST", { expectedRevision: item.draft!.revision }, randomUUID());
      workspace = await providerWorkspace(runtime, creator, submissionId); item = requiredProviderItem(workspace);
      await providerJourneyRequest(runtime, runtime.actors.reviewer, `${review}/start-review`, "POST", { expectedState: item.state });
      await providerJourneyRequest(runtime, runtime.actors.reviewer, `${review}/approve-to-publish`, "POST", { expectedState: "under_review", versionId: item.currentSubmittedVersionId });
      workspace = await providerWorkspace(runtime, creator, submissionId); item = requiredProviderItem(workspace);
      const publication = await providerJourneyRequest<{ publication: MissionPublicationView }>(runtime, creator, `/api/my-missions/${submissionId}/publication/${item.id}`);
      instructionRevision = publication.publication.revision;
      requireProviderFact(item.state === stage && publication.publication.state === stage && instructionRevision === 0 && publication.publication.approvedVersionId, "journey-fixture-approved");
    }
    return { missionId: mission.id, missionSlug: mission.slug, submissionId, workflowId, workItemId: item.id, instructionRevision, creatorId: creator.id, creator, workspace };
  } catch (error) { if (error instanceof ProviderRehearsalFailure) throw error; throw new ProviderRehearsalFailure("journey-fixture-prepare"); }
}
export interface ProviderNeutralitySnapshot { readonly xp: Readonly<Record<string, number>>; readonly financial: Readonly<Record<string, unknown>> }
export async function providerNeutrality(runtime: ProviderRehearsalRuntime): Promise<ProviderNeutralitySnapshot> {
  const workspace = providerFixtureUuid(runtime.workspaceId), ids = [runtime.actors.creator.id, runtime.actors.otherCreator.id].map(providerFixtureUuid);
  const tables = ["point_balances", "earnings_balances", "workspace_budgets", "point_transactions", "earnings_transactions", "workspace_budget_transactions", "redemptions", "redemption_gifts", "redemption_codes"];
  const fields = tables.map(table => `'${table}',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.${table} t where t.workspace_id='${workspace}')`).join(",");
  return providerFixtureJson(runtime, `begin read only; select jsonb_build_object('xp',(select jsonb_object_agg(id,xp) from public.creators where workspace_id='${workspace}' and id in ('${ids[0]}','${ids[1]}')),'financial',jsonb_build_object(${fields})); commit;`, "neutrality");
}
/** Synthetic pre-existing issued history only: fixture tuples, never an approval/settlement or historical production claim. */
export async function seedProviderIssuedHistory(runtime: ProviderRehearsalRuntime): Promise<{ submissionId: string }> {
  const mission = await createProviderMission(runtime, "legacy"), workspace = providerFixtureUuid(runtime.workspaceId), creator = providerFixtureUuid(runtime.actors.creator.id);
  const submission = randomUUID(), gift = randomUUID();
  const result = await providerFixtureJson<{ submissionId: string; pointLedger: number; cashLedger: number; budgetLedger: number }>(runtime, `-- provider-journey synthetic prior-issued fixture; not an exercised settlement
    begin;
    insert into public.mission_submissions(id,workspace_id,mission_id,creator_id,status,content_urls,submitted_at,reviewed_at,points_awarded,xp_awarded)
      values ('${submission}','${workspace}','${mission.id}','${creator}','approved',array['https://example.test/synthetic-prior-proof'],now()-interval '2 days',now()-interval '1 day',500,135);
    update public.missions set filled=1 where id='${mission.id}' and workspace_id='${workspace}';
    update public.creators set xp=xp+135 where id='${creator}' and workspace_id='${workspace}';
    update public.point_balances set balance=balance+500 where creator_id='${creator}' and workspace_id='${workspace}';
    insert into public.point_transactions(creator_id,workspace_id,type,delta,balance_after,source_ref,description)
      select '${creator}','${workspace}','earn',500,balance,'mission_submission:${submission}','Synthetic prior issued fixture' from public.point_balances where creator_id='${creator}' and workspace_id='${workspace}';
    update public.earnings_balances set available=available+125 where creator_id='${creator}' and workspace_id='${workspace}';
    insert into public.earnings_transactions(creator_id,workspace_id,type,amount,balance_after,source_ref,description)
      select '${creator}','${workspace}','earn',125,available,'mission_submission:${submission}','Synthetic prior issued fixture' from public.earnings_balances where creator_id='${creator}' and workspace_id='${workspace}';
    insert into public.workspace_budgets(workspace_id,balance,enforced) values ('${workspace}',10000,true) on conflict(workspace_id) do nothing;
    update public.workspace_budgets set balance=balance-125 where workspace_id='${workspace}';
    insert into public.workspace_budget_transactions(workspace_id,type,delta,balance_after,source_ref,description)
      select '${workspace}','debit',-125,balance,'mission_submission:${submission}','Synthetic prior issued fixture' from public.workspace_budgets where workspace_id='${workspace}';
    insert into public.redemption_gifts(id,workspace_id,name,points_cost,stock_qty,stock_remaining,gift_type) values ('${gift}','${workspace}','Synthetic untouched inventory',100,2,2,'digital');
    insert into public.redemption_codes(gift_id,workspace_id,code) values ('${gift}','${workspace}','synthetic-${gift}');
    commit;
    select jsonb_build_object('submissionId',id,'pointLedger',(select count(*) from public.point_transactions where source_ref='mission_submission:${submission}' and workspace_id='${workspace}'),
      'cashLedger',(select count(*) from public.earnings_transactions where source_ref='mission_submission:${submission}' and workspace_id='${workspace}'),
      'budgetLedger',(select count(*) from public.workspace_budget_transactions where source_ref='mission_submission:${submission}' and workspace_id='${workspace}'))
      from public.mission_submissions where id='${submission}' and workspace_id='${workspace}' and status='approved';`, "issued-history");
  requireProviderFact(result.submissionId === submission && result.pointLedger === 1 && result.cashLedger === 1 && result.budgetLedger === 1, "journey-history-fixture"); return { submissionId: result.submissionId };
}
export function createProviderJourneyFixture(runtime: ProviderRehearsalRuntime,
  options: { mode: "active_workspace"; state: "drafting" | "approved_to_publish" }): Promise<ProviderJourneyFixture> {
  requireProviderFact(options.mode === "active_workspace", "journey-fixture-mode"); return prepareProviderActiveFixture(runtime, options.state);
}
