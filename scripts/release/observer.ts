import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { hashOpaque, type PilotClient } from "./pilot";
import type {
  PilotExitDecision,
  PilotObservation,
  PilotObservationFinancialMovement,
  PilotObservationThresholds,
  PilotObserveInput,
} from "./contracts";

type Row = Record<string, unknown>;
type QueryResult = { data?: unknown; error?: unknown };

export interface ObserverClient extends PilotClient {}
export interface ObserverInput extends PilotObserveInput {
  readonly snapshot?: Partial<PilotObservation> & Record<string, unknown>;
}

export interface ContainmentResult {
  readonly passed: boolean;
  readonly drillPassed?: boolean;
  readonly thresholds?: PilotObservationThresholds;
  readonly approvedEvidence?: { readonly thresholds?: PilotObservationThresholds };
}

export type PilotExitObservation = Pick<PilotObservation, "observedAt"> & Partial<PilotObservation> & Record<string, unknown>;

interface QueryBuilder {
  select?: (...args: unknown[]) => QueryBuilder;
  eq?: (column: string, value: unknown) => QueryBuilder;
  then?: (resolve: (result: QueryResult) => unknown, reject?: (reason: unknown) => unknown) => unknown;
}

function asRows(value: unknown): Row[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is Row => Boolean(row) && typeof row === "object" && !Array.isArray(row));
}

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

function count(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function amount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function scoped(rows: readonly Row[], workspaceId: string) {
  const invalid = rows.find((row) => {
    const rowWorkspace = row.workspace_id ?? row.workspaceId;
    return rowWorkspace !== workspaceId;
  });
  if (invalid) throw new Error("pilot observation row scope mismatch or missing scope");
  return [...rows];
}

async function queryRows(client: ObserverClient, table: string, workspaceId: string) {
  const aliases: Record<string, string> = {
    missions: "mission",
    mission_submissions: "submissions",
    mission_workflows: "workflows",
  };
  const direct = client[table] ?? client[aliases[table] ?? ""];
  if (Array.isArray(direct)) return scoped(asRows(direct), workspaceId);
  if (direct && typeof direct === "object" && "data" in direct) return scoped(asRows((direct as { data?: unknown }).data), workspaceId);
  if (typeof client.from !== "function") throw new Error(`pilot observation read failed: ${table} client unavailable`);
  try {
    let builder = client.from(table) as QueryBuilder;
    if (builder.select) builder = builder.select("*");
    const eq = builder.eq;
    if (eq) {
      builder = eq.call(builder, "workspace_id", workspaceId);
    }
    const result = await Promise.resolve(builder as unknown as PromiseLike<QueryResult>);
    if (result.error) throw new Error(`pilot observation read failed: ${table}`);
    return scoped(asRows(result.data), workspaceId);
  } catch (error) {
    if (error instanceof Error && (error.message.startsWith("pilot observation read failed:") || error.message.startsWith("pilot observation row scope mismatch"))) throw error;
    throw new Error(`pilot observation read failed: ${table}`);
  }
}

function relatedRows(rows: readonly Row[], key: string, ids: ReadonlySet<string>) {
  return rows.filter((row) => ids.has(text(row[key])));
}

function scopedNotification(row: Row, ids: ReadonlySet<string>) {
  const entityId = text(row.entity_id ?? row.entityId);
  if (entityId && ids.has(entityId)) return true;
  const data = row.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return ["mission_id", "mission_submission_id", "mission_workflow_id", "mission_work_item_id", "entity_id"]
      .some((key) => ids.has(text((data as Row)[key])));
  }
  return false;
}

function directSnapshot(client: ObserverClient) {
  const value = client.observation ?? client.snapshot ?? client.pilotObservation;
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function identityHash(workflows: readonly Row[], submissions: readonly Row[], salt: string) {
  const creator = [...workflows, ...submissions]
    .map((row) => text(row.creator_id ?? row.creatorId))
    .find(Boolean);
  return creator ? hashOpaque(`${salt}:${creator}`) : undefined;
}

function numericRecord(value: unknown): Record<string, number> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const output: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value)) if (typeof raw === "number" && Number.isFinite(raw)) output[key] = raw;
  return Object.keys(output).length ? output : undefined;
}

function movement(value: unknown): PilotObservationFinancialMovement {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
  return {
    points: amount(raw.points ?? raw.points_amount ?? raw.pointsMovement),
    cash: amount(raw.cash ?? raw.cash_amount ?? raw.cashMovement),
    xp: amount(raw.xp ?? raw.xp_amount ?? raw.xpMovement),
    ledgerRows: amount(raw.ledgerRows ?? raw.ledger_rows),
  };
}

function movementDelta(before: Record<string, number> | undefined, after: Record<string, number> | undefined) {
  if (!before || !after) return movement(undefined);
  return {
    points: amount((after.points ?? after.points_amount ?? 0) - (before.points ?? before.points_amount ?? 0)),
    cash: amount((after.cash ?? after.cash_amount ?? 0) - (before.cash ?? before.cash_amount ?? 0)),
    xp: amount((after.xp ?? after.xp_amount ?? 0) - (before.xp ?? before.xp_amount ?? 0)),
    ledgerRows: amount((after.ledgerRows ?? after.ledger_rows ?? 0) - (before.ledgerRows ?? before.ledger_rows ?? 0)),
  };
}

function valueOrSnapshot(snapshot: Record<string, unknown>, key: string, fallback: number) {
  return snapshot[key] === undefined ? fallback : count(snapshot[key]);
}

const OPERATIONAL_COUNTER_KEYS = [
  "integrityIncidents",
  "tenantIsolationIncidents",
  "illegalTransitions",
  "duplicateDecisions",
  "missingRewardContracts",
  "notificationRetries",
  "notificationDeadLetters",
  "maxQueueAgeSeconds",
  "reviewLatencySeconds",
  "overdueItems",
  "unexpected5xx",
  "requestErrorClusters",
  "databaseErrorClusters",
] as const;

const REQUIRED_OPERATIONAL_BOOLEAN_KEYS = [
  "queueHealthy",
  "notificationQueueHealthy",
  "retryQueueHealthy",
] as const;

const OPTIONAL_OPERATIONAL_BOOLEAN_KEYS = [
  "queueOverdue",
] as const;

function hasOperationalTelemetry(snapshot: Record<string, unknown>) {
  const countersValid = OPERATIONAL_COUNTER_KEYS.every((key) => {
    const value = snapshot[key];
    return typeof value === "number" && Number.isFinite(value) && value >= 0;
  });
  if (!countersValid) return false;
  if (!REQUIRED_OPERATIONAL_BOOLEAN_KEYS.every((key) => typeof snapshot[key] === "boolean")) return false;
  return OPTIONAL_OPERATIONAL_BOOLEAN_KEYS.every((key) => snapshot[key] === undefined || typeof snapshot[key] === "boolean");
}

/**
 * Collects structural pilot telemetry.  Raw creator/workflow identifiers are
 * reduced to one salted hash and opaque workflow hashes before returning.
 */
export async function observePilot(client: ObserverClient, input: ObserverInput): Promise<PilotObservation> {
  const workspaceId = text(input.workspaceId).trim();
  const missionId = text(input.missionId).trim();
  if (!workspaceId || !missionId) throw new Error("pilot observation requires exact workspace and mission IDs");
  const observedAt = input.observedAt instanceof Date
    ? input.observedAt.toISOString()
    : typeof input.observedAt === "string" && !Number.isNaN(Date.parse(input.observedAt))
      ? new Date(input.observedAt).toISOString()
      : new Date().toISOString();
  const snapshot = { ...directSnapshot(client), ...(input.snapshot ?? {}) };

  const allSubmissions = await queryRows(client, "mission_submissions", workspaceId);
  // Select the mission before deriving any counts, identities, or relations;
  // another mission in the same workspace must never influence this pilot.
  const submissions = allSubmissions.filter((row) => text(row.mission_id ?? row.missionId) === missionId);
  const submissionIds = new Set(submissions.map((row) => text(row.id)).filter(Boolean));
  const allWorkflows = await queryRows(client, "mission_workflows", workspaceId);
  const workflows = allWorkflows.filter((row) =>
    submissionIds.has(text(row.mission_submission_id))
    // Compatibility for deterministic fakes; shipped rows always use the
    // mission_submission_id relation above.
    || (!row.mission_submission_id && text(row.mission_id ?? row.missionId) === missionId),
  );
  const workflowIds = new Set(workflows.map((row) => text(row.id)).filter(Boolean));
  const workItems = await queryRows(client, "mission_work_items", workspaceId);
  const workItemIds = new Set(relatedRows(workItems, "mission_workflow_id", workflowIds).map((row) => text(row.id)).filter(Boolean));
  const [allProofAttempts, completionRows, pendingRewards, notificationRows, eventRows] = await Promise.all([
    queryRows(client, "mission_publication_proof_attempts", workspaceId),
    queryRows(client, "mission_completion_decisions", workspaceId),
    queryRows(client, "mission_pending_rewards", workspaceId),
    queryRows(client, "notifications", workspaceId),
    queryRows(client, "mission_workflow_events", workspaceId),
  ]);
  const proofAttempts = relatedRows(allProofAttempts, "mission_work_item_id", workItemIds);
  const completionDecisions = relatedRows(completionRows, "mission_workflow_id", workflowIds);
  const handoffs = pendingRewards.filter((row) => text(row.mission_id ?? row.missionId) === missionId && (text(row.status) === "pending" || text(row.status) === "cancelled" || row.status === undefined));
  const events = eventRows.filter((row) => workflowIds.has(text(row.mission_workflow_id)) || workItemIds.has(text(row.mission_work_item_id)));
  const scopedIds = new Set([
    missionId,
    ...submissionIds,
    ...workflowIds,
    ...workItemIds,
    ...events.map((row) => text(row.entity_id)).filter(Boolean),
  ]);
  const notifications = notificationRows.filter((row) => scopedNotification(row, scopedIds));
  const pending = Math.max(
    workflows.filter((row) => row.state === "reward_pending").length,
    handoffs.filter((row) => row.status === "pending" || row.state === "reward_pending").length,
  );
  const completed = Math.max(
    workflows.filter((row) => ["completed", "reward_pending", "proof_verified"].includes(text(row.state))).length,
    completionDecisions.filter((row) => ["completed", "approved", "accepted"].includes(text(row.state ?? row.status))).length,
  );
  const creatorIds = new Set([...workflows, ...submissions].map((row) => text(row.creator_id ?? row.creatorId)).filter(Boolean));
  const workflowHashes = workflows
    .map((row) => text(row.id ?? row.workflow_id ?? row.workflowId))
    .filter(Boolean)
    .map((id) => hashOpaque(id));
  const deadLetters = notifications.filter((row) => ["dead_letter", "dead-letter", "failed"].includes(text(row.status))).length;
  const retries = notifications.reduce((sum, row) => sum + count(row.retry_count ?? row.retries), 0);
  // Runtime/request/database error tables are not part of the shipped schema;
  // callers may supply these redacted counters via the snapshot instead.
  const error5xx = 0;
  const requestClusters = 0;
  const dbClusters = 0;
  const telemetryAvailable = hasOperationalTelemetry(snapshot);
  const snapshotBefore = numericRecord(snapshot.rewardSnapshotBefore ?? input.financialSnapshotBefore ?? client.rewardSnapshotBefore);
  const snapshotAfter = numericRecord(snapshot.rewardSnapshotAfter ?? input.financialSnapshotAfter ?? client.rewardSnapshotAfter);
  const observedMovement = snapshot.financialMovement !== undefined || client.financialMovement !== undefined
    ? movement(snapshot.financialMovement ?? client.financialMovement)
    : movementDelta(snapshotBefore, snapshotAfter);
  const queueHealthy = telemetryAvailable && snapshot.queueHealthy !== false
    && snapshot.notificationQueueHealthy !== false
    && snapshot.retryQueueHealthy !== false;

  return {
    observedAt,
    workspaceId,
    missionId,
    workflowCount: valueOrSnapshot(snapshot, "workflowCount", workflows.length),
    submissionCount: valueOrSnapshot(snapshot, "submissionCount", submissions.length),
    proofAttemptCount: valueOrSnapshot(snapshot, "proofAttemptCount", proofAttempts.length),
    completionDecisionCount: valueOrSnapshot(snapshot, "completionDecisionCount", completionDecisions.length),
    pendingRewards: valueOrSnapshot(snapshot, "pendingRewards", pending),
    completedWorkflows: valueOrSnapshot(snapshot, "completedWorkflows", completed),
    completedCreatorCount: valueOrSnapshot(snapshot, "completedCreatorCount", creatorIds.size && completed ? creatorIds.size : 0),
    ...(identityHash(workflows, submissions, input.creatorIdentitySalt ?? "adfocate-pilot") ? { creatorIdentityHash: identityHash(workflows, submissions, input.creatorIdentitySalt ?? "adfocate-pilot") } : {}),
    workflowIds: workflowHashes,
    integrityIncidents: valueOrSnapshot(snapshot, "integrityIncidents", count(snapshot.illegalTransitions)),
    tenantIsolationIncidents: valueOrSnapshot(snapshot, "tenantIsolationIncidents", count(snapshot.isolationIncidents)),
    illegalTransitions: valueOrSnapshot(snapshot, "illegalTransitions", 0),
    duplicateDecisions: valueOrSnapshot(snapshot, "duplicateDecisions", 0),
    missingRewardContracts: valueOrSnapshot(snapshot, "missingRewardContracts", 0),
    notificationRetries: valueOrSnapshot(snapshot, "notificationRetries", retries),
    notificationDeadLetters: valueOrSnapshot(snapshot, "notificationDeadLetters", deadLetters),
    maxQueueAgeSeconds: valueOrSnapshot(snapshot, "maxQueueAgeSeconds", 0),
    reviewLatencySeconds: valueOrSnapshot(snapshot, "reviewLatencySeconds", 0),
    overdueItems: valueOrSnapshot(snapshot, "overdueItems", 0),
    unexpected5xx: valueOrSnapshot(snapshot, "unexpected5xx", error5xx),
    requestErrorClusters: valueOrSnapshot(snapshot, "requestErrorClusters", requestClusters),
    databaseErrorClusters: valueOrSnapshot(snapshot, "databaseErrorClusters", dbClusters),
    financialMovement: observedMovement,
    queueHealthy,
    telemetryAvailable,
    ...(typeof snapshot.notificationQueueHealthy === "boolean" ? { notificationQueueHealthy: snapshot.notificationQueueHealthy } : {}),
    ...(typeof snapshot.retryQueueHealthy === "boolean" ? { retryQueueHealthy: snapshot.retryQueueHealthy } : {}),
    ...(snapshot.queueOverdue !== undefined ? { queueOverdue: snapshot.queueOverdue === true } : {}),
    ...(input.thresholds || (snapshot.thresholds && typeof snapshot.thresholds === "object")
      ? { thresholds: input.thresholds ?? snapshot.thresholds as PilotObservationThresholds }
      : {}),
    ...(snapshotBefore ? { rewardSnapshotBefore: snapshotBefore } : {}),
    ...(snapshotAfter ? { rewardSnapshotAfter: snapshotAfter } : {}),
  };
}

function day(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(0, 10) : null;
}

function maxMetric(observations: readonly PilotExitObservation[], key: string) {
  return Math.max(0, ...observations.map((item) => count(item[key])));
}

function hasMovement(observation: PilotExitObservation) {
  const raw = observation.financialMovement;
  if (!raw || typeof raw !== "object") return false;
  return Object.values(raw as unknown as Record<string, unknown>).some((value) => typeof value === "number" && value !== 0);
}

function snapshotsMoved(observation: PilotExitObservation) {
  const before = observation.rewardSnapshotBefore;
  const after = observation.rewardSnapshotAfter;
  if (!before || !after) return false;
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].some((key) => before[key] !== after[key]);
}

const REQUIRED_THRESHOLD_KEYS: readonly (keyof PilotObservationThresholds)[] = [
  "maxQueueAgeSeconds",
  "maxReviewLatencySeconds",
  "maxOverdueItems",
  "maxUnexpected5xx",
  "maxDatabaseErrorClusters",
  "maxNotificationDeadLetters",
];

const REQUIRED_COUNT_KEYS = [
  "workflowCount", "submissionCount", "proofAttemptCount", "completionDecisionCount",
  "pendingRewards", "completedWorkflows", "integrityIncidents", "tenantIsolationIncidents",
  "illegalTransitions", "duplicateDecisions", "missingRewardContracts", "notificationRetries",
  "notificationDeadLetters", "maxQueueAgeSeconds", "reviewLatencySeconds", "overdueItems",
  "unexpected5xx", "requestErrorClusters", "databaseErrorClusters",
] as const;

function completeThresholds(value: unknown): value is PilotObservationThresholds {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return REQUIRED_THRESHOLD_KEYS.every((key) => typeof record[key] === "number" && Number.isFinite(record[key]));
}

function completeSnapshot(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entries = Object.entries(value as Record<string, unknown>);
  return entries.length > 0 && entries.every(([, item]) => typeof item === "number" && Number.isFinite(item));
}

function completeFinancialMovement(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return ["points", "cash", "xp", "ledgerRows"].every((key) => typeof record[key] === "number" && Number.isFinite(record[key]));
}

function completenessReasons(observation: PilotExitObservation, index: number, scope: { workspaceId: string; missionId: string } | null) {
  const prefix = `observation ${index + 1}`;
  const reasons: string[] = [];
  if (typeof observation.observedAt !== "string" || Number.isNaN(Date.parse(observation.observedAt))) reasons.push(`${prefix} observedAt is invalid`);
  if (typeof observation.workspaceId !== "string" || !observation.workspaceId.trim()) reasons.push(`${prefix} workspace scope is missing`);
  if (typeof observation.missionId !== "string" || !observation.missionId.trim()) reasons.push(`${prefix} mission scope is missing`);
  if (scope && (observation.workspaceId !== scope.workspaceId || observation.missionId !== scope.missionId)) reasons.push(`${prefix} scope differs from selected pilot`);
  if (typeof observation.creatorIdentityHash !== "string" || !/^[a-f0-9]{64}$/i.test(observation.creatorIdentityHash)) reasons.push(`${prefix} creator identity hash is missing or invalid`);
  if (!Array.isArray(observation.workflowIds) || observation.workflowIds.some((id) => typeof id !== "string" || !/^[a-f0-9]{64}$/i.test(id))) reasons.push(`${prefix} workflow identities are missing or not opaque hashes`);
  for (const key of REQUIRED_COUNT_KEYS) {
    const value = observation[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) reasons.push(`${prefix} ${key} is missing, invalid, or negative`);
  }
  if (typeof observation.completedCreatorCount !== "number" || !Number.isFinite(observation.completedCreatorCount) || observation.completedCreatorCount < 0) reasons.push(`${prefix} completed creator count is missing, invalid, or negative`);
  if (typeof observation.queueHealthy !== "boolean") reasons.push(`${prefix} queue health is missing`);
  if (observation.telemetryAvailable !== true) reasons.push(`${prefix} operational telemetry is unavailable`);
  if (observation.telemetryAvailable === true) {
    for (const key of REQUIRED_OPERATIONAL_BOOLEAN_KEYS) {
      if (typeof observation[key] !== "boolean") reasons.push(`${prefix} ${key} is missing or invalid`);
    }
  }
  for (const key of OPTIONAL_OPERATIONAL_BOOLEAN_KEYS) {
    if (observation[key] !== undefined && typeof observation[key] !== "boolean") reasons.push(`${prefix} ${key} is missing or invalid`);
  }
  if (!completeFinancialMovement(observation.financialMovement)) reasons.push(`${prefix} financial movement is incomplete`);
  if (!completeSnapshot(observation.rewardSnapshotBefore) || !completeSnapshot(observation.rewardSnapshotAfter)) reasons.push(`${prefix} financial snapshots are incomplete`);
  if (!completeThresholds(observation.thresholds)) reasons.push(`${prefix} approved thresholds are incomplete`);
  return reasons;
}

/** Pure seven-day exit gate. No database or network access is performed. */
export function evaluatePilotExit(
  observations: readonly PilotExitObservation[],
  containment: ContainmentResult,
): PilotExitDecision {
  const containReasons: string[] = [];
  if (observations.some((item) => count(item.integrityIncidents) > 0 || count(item.illegalTransitions) > 0 || count(item.duplicateDecisions) > 0)) {
    containReasons.push("integrity incident detected");
  }
  if (observations.some((item) => count(item.tenantIsolationIncidents) > 0)) containReasons.push("tenant isolation incident detected");
  if (observations.some((item) => hasMovement(item) || snapshotsMoved(item))) containReasons.push("financial movement detected");
  if (containReasons.length) return { decision: "contain", reasons: containReasons };

  const reasons: string[] = [];
  const scope = observations.length > 0 && typeof observations[0]?.workspaceId === "string" && typeof observations[0]?.missionId === "string"
    ? { workspaceId: observations[0].workspaceId, missionId: observations[0].missionId }
    : null;
  for (let index = 0; index < observations.length; index += 1) reasons.push(...completenessReasons(observations[index]!, index, scope));
  if (observations.length === 0) reasons.push("no pilot observations supplied");
  if (reasons.length) return { decision: "hold", reasons: [...new Set(reasons)] };
  const approvedThresholds = containment.thresholds
    ?? containment.approvedEvidence?.thresholds
    ?? observations.find((item) => item.thresholds)?.thresholds;
  if (!approvedThresholds || !completeThresholds(approvedThresholds)) {
    reasons.push("approved observation thresholds are missing");
  }
  const days = [...new Set(observations.map((item) => day(item.observedAt)).filter((value): value is string => Boolean(value)))].sort();
  if (days.length < 7) reasons.push("fewer than seven distinct stable calendar days");
  else {
    for (let index = 1; index < days.length; index += 1) {
      const previous = Date.parse(`${days[index - 1]}T00:00:00Z`);
      const current = Date.parse(`${days[index]}T00:00:00Z`);
      if (current - previous !== 86_400_000) {
        reasons.push("stable observation days are not consecutive");
        break;
      }
    }
  }
  if (maxMetric(observations, "completedWorkflows") !== 1 || maxMetric(observations, "pendingRewards") !== 1) {
    reasons.push("exactly one completed workflow and pending reward are required");
  }
  const completedCreators = maxMetric(observations, "completedCreatorCount");
  if (completedCreators !== 1) reasons.push("exactly one completed pilot creator is required");
  if (maxMetric(observations, "unexpected5xx") > (approvedThresholds?.maxUnexpected5xx ?? 0)) reasons.push("new unexpected 5xx detected");
  if (maxMetric(observations, "databaseErrorClusters") > (approvedThresholds?.maxDatabaseErrorClusters ?? 0)) reasons.push("new database error cluster detected");
  if (observations.some((item) => item.queueHealthy === false)) reasons.push("retry queues are unhealthy");
  if (observations.some((item) => item.queueOverdue === true)) reasons.push("retry queue is over age threshold");
  if (maxMetric(observations, "notificationDeadLetters") > (approvedThresholds?.maxNotificationDeadLetters ?? 0)) reasons.push("notification dead letters detected");
  if (maxMetric(observations, "maxQueueAgeSeconds") > (approvedThresholds?.maxQueueAgeSeconds ?? 0)) reasons.push("retry queue is over age threshold");
  if (maxMetric(observations, "reviewLatencySeconds") > (approvedThresholds?.maxReviewLatencySeconds ?? 0)) reasons.push("review latency is over threshold");
  if (maxMetric(observations, "overdueItems") > (approvedThresholds?.maxOverdueItems ?? 0)) reasons.push("overdue workflow items detected");
  if (!containment.passed || containment.drillPassed === false) reasons.push("containment drill failed");
  return reasons.length ? { decision: "hold", reasons } : { decision: "expand", reasons: [] };
}

export async function runObserverCli(
  command: "observe" | "evaluate",
  client: ObserverClient,
  input: ObserverInput,
  observations: readonly PilotExitObservation[] = [],
  containment: ContainmentResult = { passed: false },
) {
  if (command === "observe") return observePilot(client, input);
  if (command === "evaluate") return evaluatePilotExit(observations, containment);
  throw new Error("usage: observer.ts observe|evaluate");
}

function envValue(env: NodeJS.ProcessEnv, key: string) {
  const value = env[key]?.trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function jsonEnv<T>(env: NodeJS.ProcessEnv, key: string): T {
  const value = envValue(env, key);
  try { return JSON.parse(value) as T; } catch { throw new Error(`${key} must contain valid JSON`); }
}

function serviceClient(env: NodeJS.ProcessEnv): ObserverClient {
  const url = env.RELEASE_SUPABASE_URL ?? env.SUPABASE_URL;
  const key = env.RELEASE_SUPABASE_SERVICE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("explicit Supabase service client configuration is required");
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error("Supabase service URL is invalid"); }
  if (!/^https?:$/.test(parsed.protocol)) throw new Error("Supabase service URL is invalid");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } }) as unknown as ObserverClient;
}

function parsedFile<T>(path: string, raw: string): T {
  try { return JSON.parse(raw) as T; } catch { throw new Error(`${path} must contain valid JSON`); }
}

export async function executeObserverCli(args: readonly string[], env: NodeJS.ProcessEnv = process.env) {
  const command = args[0] ?? "observe";
  if (command === "evaluate") {
    const observationsPath = envValue(env, "RELEASE_PILOT_OBSERVATIONS_PATH");
    const observations = parsedFile<readonly PilotExitObservation[]>(observationsPath, await readFile(observationsPath, "utf8"));
    const containment = env.RELEASE_PILOT_CONTAINMENT_JSON
      ? jsonEnv<ContainmentResult>(env, "RELEASE_PILOT_CONTAINMENT_JSON")
      : env.RELEASE_PILOT_CONTAINMENT_PATH
        ? parsedFile<ContainmentResult>(env.RELEASE_PILOT_CONTAINMENT_PATH, await readFile(env.RELEASE_PILOT_CONTAINMENT_PATH, "utf8"))
        : (() => { throw new Error("RELEASE_PILOT_CONTAINMENT_JSON or RELEASE_PILOT_CONTAINMENT_PATH is required"); })();
    return runObserverCli("evaluate", {}, { workspaceId: "approved", missionId: "approved" }, observations, containment);
  }
  if (command === "observe") {
    const workspaceId = envValue(env, "RELEASE_PILOT_WORKSPACE_ID");
    const missionId = envValue(env, "RELEASE_PILOT_MISSION_ID");
    const thresholds = jsonEnv<PilotObservationThresholds>(env, "RELEASE_PILOT_THRESHOLDS_JSON");
    const input: ObserverInput = {
      workspaceId,
      missionId,
      observedAt: env.RELEASE_PILOT_OBSERVED_AT ?? new Date().toISOString(),
      creatorIdentitySalt: env.RELEASE_PILOT_IDENTITY_SALT,
      thresholds,
      ...(env.RELEASE_PILOT_SNAPSHOT_JSON ? { snapshot: jsonEnv<ObserverInput["snapshot"]>(env, "RELEASE_PILOT_SNAPSHOT_JSON") } : {}),
    };
    return runObserverCli("observe", serviceClient(env), input);
  }
  throw new Error("usage: observer.ts observe|evaluate");
}

function sanitizedError(error: unknown) {
  const message = error instanceof Error ? error.message : "observer command failed";
  return message.replace(/(?:postgres(?:ql)?:\/\/|eyJ)[^\s"']+/gi, "[REDACTED]");
}

const isViteNodeCli = /(?:^|[\\/])vite-node(?:\\.mjs)?$/i.test(process.argv[1] ?? "");
const isDirectNodeCli = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isViteNodeCli || isDirectNodeCli) {
  try {
    const result = await executeObserverCli(process.argv.slice(2), process.env);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if ("decision" in (result as object) && (result as { decision: string }).decision !== "expand") process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ status: "failed", error: sanitizedError(error) })}\n`);
    process.exitCode = 1;
  }
}
