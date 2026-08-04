import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import type {
  CapabilityStatus,
  DeploymentReport,
  PilotCandidateReport,
  PilotEnableReport,
  PilotGateInput,
  PilotJoinContract,
  PilotAtomicEnableInput,
  PilotAtomicEnableResult,
} from "./contracts";

type Row = Record<string, unknown>;
type QueryResult = { data?: unknown; error?: unknown; count?: number | null; affectedRows?: number };

/** A deliberately small Supabase-like surface; the real client and test fakes both fit. */
export interface PilotClient {
  readonly from?: (table: string) => unknown;
  readonly enablePilotAtomically?: (input: PilotAtomicEnableInput) => Promise<PilotAtomicEnableResult>;
  readonly rpc?: (fn: string, args: Record<string, unknown>) => Promise<PilotAtomicEnableResult>;
  readonly [key: string]: unknown;
}

export interface PilotInspectionInput extends PilotGateInput {
  readonly workspaceId: string;
  readonly missionId: string;
  readonly now?: Date;
}

export interface PilotEnableInput extends Partial<Omit<PilotCandidateReport, "deployment">>, PilotGateInput {
  readonly workspaceId?: string;
  readonly missionId?: string;
  readonly evidenceDigest: string;
  readonly approval: string;
  readonly apply?: boolean;
}

interface QueryBuilder {
  select?: (...args: unknown[]) => QueryBuilder;
  eq?: (column: string, value: unknown) => QueryBuilder;
  in?: (column: string, values: readonly unknown[]) => QueryBuilder;
  limit?: (count: number) => QueryBuilder;
  maybeSingle?: () => Promise<QueryResult>;
  single?: () => Promise<QueryResult>;
  update?: (values: Row) => QueryBuilder;
  then?: (resolve: (result: QueryResult) => unknown, reject?: (reason: unknown) => unknown) => unknown;
}

function asRows(value: unknown): Row[] {
  if (value && typeof value === "object" && !Array.isArray(value)) return [value as Row];
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is Row => Boolean(row) && typeof row === "object" && !Array.isArray(row));
}

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nowFrom(input: { now?: Date }) {
  return input.now instanceof Date ? input.now : new Date();
}

async function runQuery(query: unknown): Promise<QueryResult> {
  if (!query || typeof query !== "object") return { data: null, error: "query unavailable" };
  const candidate = query as QueryBuilder;
  if (candidate.maybeSingle) return candidate.maybeSingle();
  if (candidate.single) return candidate.single();
  // Awaiting a Supabase builder uses its thenable implementation.  Some tiny
  // fakes expose a plain promise instead, which is covered by this branch too.
  return await query as QueryResult;
}

async function rowsFrom(client: PilotClient, table: string, filters: Record<string, unknown>) {
  const alias = table === "missions" ? "mission" : table === "mission_submissions" ? "submissions" : table === "mission_workflows" ? "workflows" : undefined;
  const direct = client[table] ?? (alias ? client[alias] : undefined);
  if (Array.isArray(direct)) {
    return asRows(direct).filter((row) => Object.entries(filters).every(([key, value]) => row[key] === value));
  }
  if (direct && typeof direct === "object" && "data" in direct) return asRows((direct as { data?: unknown }).data);
  if (typeof client.from !== "function") throw new Error(`pilot read failed: ${table} client unavailable`);
  try {
    let builder = client.from(table) as QueryBuilder;
    if (builder.select) builder = builder.select("*");
    for (const [key, value] of Object.entries(filters)) {
      if (builder.eq) builder = builder.eq(key, value);
    }
    const result = await runQuery(builder);
    if (result.error) throw new Error(`pilot read failed: ${table}`);
    return asRows(result.data);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("pilot read failed:")) throw error;
    throw new Error(`pilot read failed: ${table}`);
  }
}

async function oneFrom(client: PilotClient, table: string, filters: Record<string, unknown>) {
  const alias = table === "missions" ? "mission" : undefined;
  const direct = client[table] ?? (alias ? client[alias] : undefined);
  if (direct && typeof direct === "object" && !Array.isArray(direct)) {
    const row = direct as Row;
    if (Object.entries(filters).every(([key, value]) => row[key] === value)) return row;
  }
  const rows = await rowsFrom(client, table, filters);
  return rows[0] ?? null;
}

function hasGateInput(input: PilotInspectionInput) {
  if (input.structuralOnly === true) return false;
  return Boolean(
    input.approvedEvidenceDigest
    || input.evidenceDigest
    || input.expectedCapabilities
    || input.capabilities
    || input.postflight?.capabilities
    || input.schemaPostflight?.capabilities
    || input.deployment
    || input.deploymentReport
    || input.approvedCommit
    || input.compatibilityEvidence !== undefined
    || input.legacyCompatibilityEvidence !== undefined
    || input.evidenceCreatedAt
    || input.evidenceExpiresAt,
  );
}

function validDigest(value: unknown) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function gateReasons(input: PilotInspectionInput, now: Date) {
  if (!hasGateInput(input)) return { reasons: [] as string[], capabilities: [] as { name: string; status: CapabilityStatus }[] };
  const reasons: string[] = [];
  const expected = input.expectedCapabilities ?? [];
  const digest = input.approvedEvidenceDigest ?? input.evidenceDigest;
  if (!validDigest(digest)) reasons.push("approved evidence digest is missing or invalid");
  const capabilityEvidence = input.capabilities ?? input.postflight?.capabilities ?? input.schemaPostflight?.capabilities ?? [];
  for (const name of expected) {
    const capability = capabilityEvidence.find((item) => item.name === name);
    if (!capability || capability.status !== "present") reasons.push(`capability gate failed: ${name}`);
  }
  const deployment = input.deployment ?? input.deploymentReport;
  if (deployment === undefined) {
    reasons.push("READY deployment evidence is missing");
  } else {
    const expectedCommit = input.approvedCommit ?? deployment.expectedCommit;
    if (deployment.status !== "passed" || deployment.deploymentReadyState !== "READY") reasons.push("deployment is not READY");
    if (expectedCommit && deployment.commit !== expectedCommit) reasons.push("deployment commit mismatch");
    if (!expectedCommit) reasons.push("approved deployment commit is missing");
  }
  const compatibility = input.compatibilityEvidence ?? input.legacyCompatibilityEvidence;
  if (compatibility === undefined || (typeof compatibility === "boolean" ? !compatibility : !compatibility.passed)) {
    reasons.push("legacy compatibility evidence is missing or failed");
  }
  if (!input.evidenceCreatedAt) reasons.push("approved evidence creation timestamp is missing");
  if (!input.evidenceExpiresAt) reasons.push("approved evidence expiry timestamp is missing");
  const created = input.evidenceCreatedAt ? Date.parse(input.evidenceCreatedAt) : Number.NaN;
  const expiry = input.evidenceExpiresAt ? Date.parse(input.evidenceExpiresAt) : Number.NaN;
  if (!Number.isFinite(created) || !Number.isFinite(expiry)) reasons.push("approved evidence timestamp is invalid");
  if (Number.isFinite(created) && created > now.getTime()) reasons.push("approved evidence creation timestamp is in the future");
  if (Number.isFinite(expiry) && expiry <= now.getTime()) reasons.push("approved evidence has expired");
  return { reasons, capabilities: capabilityEvidence };
}

function activePilotRows(client: PilotClient, workspaceId: string, missionId: string) {
  const direct = numberOrNull(client.activePilotCount);
  if (direct !== null) return Promise.resolve(direct);
  return rowsFrom(client, "missions", { workspace_id: workspaceId, creator_workflow_mode: "active_workspace" })
    .then((rows) => rows.filter((row) => row.id !== missionId).length);
}

function structuralReason(reasons: string[], reason: string) {
  if (!reasons.includes(reason)) reasons.push(reason);
}

/**
 * Inspects one exact workspace/mission pair.  Read errors become ineligible
 * reasons instead of escaping as an accidental approval.
 */
export async function inspectPilotCandidate(
  client: PilotClient,
  input: PilotInspectionInput,
): Promise<PilotCandidateReport> {
  const now = nowFrom(input);
  const workspaceId = text(input.workspaceId).trim();
  const missionId = text(input.missionId).trim();
  const reasons: string[] = [];
  if (input.structuralOnly !== true) {
    // A production candidate is never approved from mission rows alone.  The
    // explicit structuralOnly escape hatch is read-only and intended only for
    // deterministic contract tests/tools.
    if (!input.approvedEvidenceDigest && !input.evidenceDigest) reasons.push("approved evidence digest is missing or invalid");
    if (!input.expectedCapabilities?.length) reasons.push("expected schema capabilities are missing");
    if (!(input.capabilities?.length || input.postflight?.capabilities?.length || input.schemaPostflight?.capabilities?.length)) reasons.push("schema capability evidence is missing");
    if (!input.deployment && !input.deploymentReport) reasons.push("READY deployment evidence is missing");
    if (input.compatibilityEvidence === undefined && input.legacyCompatibilityEvidence === undefined) reasons.push("legacy compatibility evidence is missing or failed");
    if (!input.evidenceCreatedAt) reasons.push("approved evidence creation timestamp is missing");
    if (!input.evidenceExpiresAt) reasons.push("approved evidence expiry timestamp is missing");
  }
  if (!workspaceId) reasons.push("workspace ID is required");
  if (!missionId) reasons.push("mission ID is required");

  let mission: Row | null = null;
  let submissions: Row[] = [];
  let workflows: Row[] = [];
  let activeCount = 0;
  try {
    mission = missionId ? await oneFrom(client, "missions", { id: missionId }) : null;
    submissions = missionId ? await rowsFrom(client, "mission_submissions", { mission_id: missionId }) : [];
    workflows = missionId ? await rowsFrom(client, "mission_workflows", { mission_id: missionId }) : [];
    activeCount = workspaceId ? await activePilotRows(client, workspaceId, missionId) : 0;
  } catch (error) {
    reasons.push(error instanceof Error ? error.message : "pilot read failed");
  }
  if (!mission) {
    reasons.push("mission was not found");
  } else {
    if (text(mission.workspace_id) !== workspaceId) structuralReason(reasons, "mission workspace mismatch");
    if (text(mission.status) !== "draft") structuralReason(reasons, "mission is not draft");
    if (text(mission.creator_workflow_mode) !== "legacy") structuralReason(reasons, "mission is not legacy mode");
  }

  const points = numberOrNull(mission?.points_reward ?? mission?.pointsReward);
  const cashValue = mission?.cash_reward ?? mission?.cashReward;
  const cash = cashValue === null || cashValue === undefined
    ? 0
    : numberOrNull(cashValue);
  if (points === null || points < 0) reasons.push("points reward must be non-negative");
  if (cash === null || cash < 0) reasons.push("cash reward must be non-negative");

  if (submissions.length > 0) reasons.push("mission already has submissions");
  if (workflows.length > 0) reasons.push("mission already has workflows");
  for (const row of [...submissions, ...workflows]) {
    if (row.workspace_id !== undefined && row.workspace_id !== workspaceId) reasons.push("existing record workspace mismatch");
  }

  if (activeCount > 0) reasons.push("another active workspace pilot exists");

  const gate = gateReasons(input, now);
  reasons.push(...gate.reasons);
  const joinContract: PilotJoinContract | null = points !== null && points >= 0 && cash !== null && cash >= 0
    ? { points_amount: points, cash_amount: cash, currency: "HKD", xp_amount: 0 }
    : null;
  return {
    eligible: reasons.length === 0,
    workspaceId,
    missionId,
    reasons: [...new Set(reasons)],
    joinContract,
    capabilities: gate.capabilities,
    ...((input.deployment ?? input.deploymentReport) ? { deployment: input.deployment ?? input.deploymentReport } : {}),
    inspectedAt: now.toISOString(),
    ...(hasGateInput(input) ? {
      gateInput: {
        approvedEvidenceDigest: input.approvedEvidenceDigest ?? input.evidenceDigest,
        evidenceDigest: input.evidenceDigest,
        structuralOnly: input.structuralOnly,
        expectedCapabilities: input.expectedCapabilities,
        capabilities: input.capabilities,
        postflight: input.postflight,
        schemaPostflight: input.schemaPostflight,
        deployment: input.deployment ?? input.deploymentReport,
        deploymentReport: input.deploymentReport,
        approvedCommit: input.approvedCommit,
        compatibilityEvidence: input.compatibilityEvidence ?? input.legacyCompatibilityEvidence,
        legacyCompatibilityEvidence: input.legacyCompatibilityEvidence,
        evidenceCreatedAt: input.evidenceCreatedAt,
        evidenceExpiresAt: input.evidenceExpiresAt,
      },
    } : {}),
  };
}

function updateCount(result: QueryResult) {
  if (typeof result.affectedRows === "number") return result.affectedRows;
  if (typeof result.count === "number") return result.count;
  if (Array.isArray(result.data)) return result.data.length;
  return result.data && typeof result.data === "object" ? 1 : 0;
}

async function conditionalUpdate(client: PilotClient, workspaceId: string, missionId: string): Promise<QueryResult> {
  const args: PilotAtomicEnableInput = {
    workspaceId,
    missionId,
    expectedWorkflowMode: "legacy",
    nextWorkflowMode: "active_workspace",
    expectedMissionStatus: "draft",
    rejectIfSubmissionExists: true,
  };
  if (typeof client.enablePilotAtomically === "function") {
    return client.enablePilotAtomically(args);
  }
  if (typeof client.rpc === "function") {
    return client.rpc("enable_pilot_if_empty", {
      p_workspace_id: workspaceId,
      p_mission_id: missionId,
      p_expected_workflow_mode: "legacy",
      p_next_workflow_mode: "active_workspace",
      p_expected_status: "draft",
      p_reject_if_submission_exists: true,
    });
  }
  return {
    data: [],
    error: "atomic pilot enablement hook is required; direct table updates are not safe",
  };
}

/**
 * Applies the pilot mode only with the exact operator phrase.  Inspection is
 * always repeated immediately before the conditional single-row update.
 */
export async function enablePilot(client: PilotClient, input: PilotEnableInput): Promise<PilotEnableReport> {
  const workspaceId = text(input.workspaceId).trim() || text((input as PilotCandidateReport).workspaceId).trim();
  const missionId = text(input.missionId).trim() || text((input as PilotCandidateReport).missionId).trim();
  const apply = input.apply === true;
  const now = nowFrom(input);
  if (!apply) {
    return {
      enabled: false,
      applied: false,
      workspaceId,
      missionId,
      affectedRows: 0,
      inspectedAt: now.toISOString(),
    };
  }
  if (!workspaceId || !missionId) throw new Error("pilot enablement requires exact workspace and mission IDs");
  if (!validDigest(input.evidenceDigest)) throw new Error("pilot enablement requires a valid evidence digest");
  const expected = `ENABLE PILOT ${workspaceId} ${missionId} ${input.evidenceDigest}`;
  if (input.approval !== expected) throw new Error("pilot enablement requires the exact approval phrase");

  const prior = (input as PilotCandidateReport).gateInput ?? {
    approvedEvidenceDigest: input.approvedEvidenceDigest ?? input.evidenceDigest,
    evidenceDigest: input.evidenceDigest,
    expectedCapabilities: input.expectedCapabilities,
    capabilities: input.capabilities,
    postflight: input.postflight,
    schemaPostflight: input.schemaPostflight,
    deployment: input.deployment ?? input.deploymentReport,
    deploymentReport: input.deploymentReport,
    approvedCommit: input.approvedCommit,
    compatibilityEvidence: input.compatibilityEvidence ?? input.legacyCompatibilityEvidence,
    legacyCompatibilityEvidence: input.legacyCompatibilityEvidence,
    evidenceCreatedAt: input.evidenceCreatedAt,
    evidenceExpiresAt: input.evidenceExpiresAt,
    structuralOnly: input.structuralOnly,
  } satisfies PilotGateInput;
  if (prior.approvedEvidenceDigest && prior.approvedEvidenceDigest !== input.evidenceDigest) {
    throw new Error("pilot enablement evidence digest mismatch");
  }
  const reinspectionInput: PilotInspectionInput = {
    workspaceId,
    missionId,
    now,
    ...(prior ? {
      ...prior,
      // The approved digest is checked again, never silently reused from a
      // stale report when the operator supplies a different one.
      approvedEvidenceDigest: input.evidenceDigest,
    } : {}),
  };
  const report = await inspectPilotCandidate(client, reinspectionInput);
  if (!report.eligible) throw new Error(`pilot candidate rejected before update: ${report.reasons.join("; ")}`);
  const result = await conditionalUpdate(client, workspaceId, missionId);
  if (result.error) throw new Error(`pilot enablement update failed: ${String(result.error)}`);
  const affectedRows = updateCount(result);
  if (affectedRows !== 1) throw new Error("pilot enablement rejected: submission race or conditional update affected zero rows");
  return {
    enabled: true,
    applied: true,
    workspaceId,
    missionId,
    affectedRows,
    inspectedAt: now.toISOString(),
  };
}

function envValue(env: NodeJS.ProcessEnv, key: string) {
  const value = env[key]?.trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function jsonEnv<T>(env: NodeJS.ProcessEnv, key: string): T {
  const value = envValue(env, key);
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(`${key} must contain valid JSON`);
  }
}

function serviceClient(env: NodeJS.ProcessEnv): PilotClient {
  const url = env.RELEASE_SUPABASE_URL ?? env.SUPABASE_URL;
  const key = env.RELEASE_SUPABASE_SERVICE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("explicit Supabase service client configuration is required");
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error("Supabase service URL is invalid"); }
  if (!/^https?:$/.test(parsed.protocol)) throw new Error("Supabase service URL is invalid");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } }) as unknown as PilotClient;
}

/** Injectable CLI adapter; production callers provide a service client. */
export async function runPilotCli(
  args: readonly string[],
  client: PilotClient,
  env: NodeJS.ProcessEnv = process.env,
) {
  const command = args[0] ?? "inspect";
  const workspaceId = env.RELEASE_PILOT_WORKSPACE_ID ?? env.PILOT_WORKSPACE_ID;
  const missionId = env.RELEASE_PILOT_MISSION_ID ?? env.PILOT_MISSION_ID;
  if (!workspaceId || !missionId) throw new Error("RELEASE_PILOT_WORKSPACE_ID and RELEASE_PILOT_MISSION_ID are required");
  const evidenceDigest = env.RELEASE_EVIDENCE_DIGEST;
  const base = {
    workspaceId,
    missionId,
    approvedEvidenceDigest: evidenceDigest,
    evidenceDigest,
    expectedCapabilities: jsonEnv<readonly string[]>(env, "RELEASE_EXPECTED_CAPABILITIES_JSON"),
    capabilities: jsonEnv<PilotInspectionInput["capabilities"]>(env, "RELEASE_CAPABILITIES_JSON"),
    deployment: jsonEnv<NonNullable<PilotInspectionInput["deployment"]>>(env, "RELEASE_DEPLOYMENT_JSON"),
    compatibilityEvidence: jsonEnv<PilotInspectionInput["compatibilityEvidence"]>(env, "RELEASE_COMPATIBILITY_JSON"),
    approvedCommit: envValue(env, "RELEASE_APPLICATION_COMMIT"),
    evidenceCreatedAt: envValue(env, "RELEASE_EVIDENCE_CREATED_AT"),
    evidenceExpiresAt: envValue(env, "RELEASE_EVIDENCE_EXPIRES_AT"),
    now: new Date(),
  } satisfies PilotInspectionInput;
  if (command === "inspect") return inspectPilotCandidate(client, base);
  if (command === "enable") {
    if (!evidenceDigest) throw new Error("RELEASE_EVIDENCE_DIGEST is required");
    const report = await inspectPilotCandidate(client, base);
    return enablePilot(client, {
      ...report,
      ...base,
      evidenceDigest,
      approval: env.RELEASE_PILOT_APPROVAL ?? "",
      apply: env.RELEASE_PILOT_APPLY === "1",
    });
  }
  throw new Error("usage: pilot.ts inspect|enable");
}

export async function executePilotCli(args: readonly string[], env: NodeJS.ProcessEnv = process.env) {
  return runPilotCli(args, serviceClient(env), env);
}

function sanitizedError(error: unknown) {
  const message = error instanceof Error ? error.message : "pilot command failed";
  return message.replace(/(?:postgres(?:ql)?:\/\/|eyJ)[^\s"']+/gi, "[REDACTED]");
}

if (!process.env.VITEST && process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await executePilotCli(process.argv.slice(2), process.env);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if ("eligible" in (result as object) && (result as { eligible: boolean }).eligible === false) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ status: "failed", error: sanitizedError(error) })}\n`);
    process.exitCode = 1;
  }
}

export function hashOpaque(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
