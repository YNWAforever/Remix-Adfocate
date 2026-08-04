import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
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

function scoped(rows: readonly Row[], workspaceId: string, missionId: string) {
  return rows.filter((row) => {
    const rowMission = row.mission_id ?? row.missionId;
    const rowWorkspace = row.workspace_id ?? row.workspaceId;
    return (rowMission === undefined || rowMission === missionId)
      && (rowWorkspace === undefined || rowWorkspace === workspaceId);
  });
}

async function queryRows(client: ObserverClient, table: string, workspaceId: string, missionId: string) {
  const direct = client[table];
  if (Array.isArray(direct)) return scoped(asRows(direct), workspaceId, missionId);
  if (direct && typeof direct === "object" && "data" in direct) return scoped(asRows((direct as { data?: unknown }).data), workspaceId, missionId);
  if (typeof client.from !== "function") return [];
  try {
    let builder = client.from(table) as QueryBuilder;
    if (builder.select) builder = builder.select("*");
    const eq = builder.eq;
    if (eq) {
      builder = eq.call(builder, "workspace_id", workspaceId);
      builder = eq.call(builder, "mission_id", missionId);
    }
    const result = await Promise.resolve(builder as unknown as PromiseLike<QueryResult>);
    return scoped(asRows(result.data), workspaceId, missionId);
  } catch {
    return [];
  }
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
    points: count(raw.points ?? raw.points_amount ?? raw.pointsMovement),
    cash: count(raw.cash ?? raw.cash_amount ?? raw.cashMovement),
    xp: count(raw.xp ?? raw.xp_amount ?? raw.xpMovement),
    ledgerRows: count(raw.ledgerRows ?? raw.ledger_rows),
  };
}

function valueOrSnapshot(snapshot: Record<string, unknown>, key: string, fallback: number) {
  return snapshot[key] === undefined ? fallback : count(snapshot[key]);
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

  const [workflows, submissions, proofAttempts, completionDecisions, handoffs, notifications, errors] = await Promise.all([
    queryRows(client, "mission_workflows", workspaceId, missionId),
    queryRows(client, "mission_submissions", workspaceId, missionId),
    queryRows(client, "mission_proof_attempts", workspaceId, missionId),
    queryRows(client, "mission_completion_decisions", workspaceId, missionId),
    queryRows(client, "mission_reward_handoffs", workspaceId, missionId),
    queryRows(client, "notification_deliveries", workspaceId, missionId),
    queryRows(client, "runtime_errors", workspaceId, missionId),
  ]);
  const pending = workflows.filter((row) => row.state === "reward_pending").length
    + handoffs.filter((row) => row.status === "pending" || row.state === "reward_pending").length;
  const completed = workflows.filter((row) => ["completed", "reward_pending", "proof_verified"].includes(text(row.state))).length;
  const creatorIds = new Set([...workflows, ...submissions].map((row) => text(row.creator_id ?? row.creatorId)).filter(Boolean));
  const workflowHashes = workflows
    .map((row) => text(row.id ?? row.workflow_id ?? row.workflowId))
    .filter(Boolean)
    .map((id) => hashOpaque(id));
  const deadLetters = notifications.filter((row) => ["dead_letter", "dead-letter", "failed"].includes(text(row.status))).length;
  const retries = notifications.reduce((sum, row) => sum + count(row.retry_count ?? row.retries), 0);
  const error5xx = errors.filter((row) => count(row.status_code ?? row.statusCode) >= 500).length;
  const dbClusters = new Set(errors.map((row) => text(row.cluster_id ?? row.database_cluster ?? row.message)).filter(Boolean)).size;
  const observedMovement = movement(snapshot.financialMovement ?? client.financialMovement);
  const snapshotBefore = numericRecord(snapshot.rewardSnapshotBefore ?? client.rewardSnapshotBefore);
  const snapshotAfter = numericRecord(snapshot.rewardSnapshotAfter ?? client.rewardSnapshotAfter);
  const queueHealthy = snapshot.queueHealthy !== false
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
    databaseErrorClusters: valueOrSnapshot(snapshot, "databaseErrorClusters", dbClusters),
    financialMovement: observedMovement,
    queueHealthy,
    ...(input.thresholds ? { thresholds: input.thresholds } : {}),
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

function threshold(observations: readonly PilotExitObservation[], key: keyof PilotObservationThresholds, fallback: number) {
  for (const observation of observations) {
    const value = observation.thresholds?.[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return fallback;
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
  if (observations.some(hasMovement)) containReasons.push("financial movement detected");
  if (containReasons.length) return { decision: "contain", reasons: containReasons };

  const reasons: string[] = [];
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
  const completedCreators = maxMetric(observations, "completedCreatorCount") || (maxMetric(observations, "completedWorkflows") === 1 ? 1 : 0);
  if (completedCreators !== 1) reasons.push("exactly one completed pilot creator is required");
  if (maxMetric(observations, "unexpected5xx") > threshold(observations, "maxUnexpected5xx", 0)) reasons.push("new unexpected 5xx detected");
  if (maxMetric(observations, "databaseErrorClusters") > threshold(observations, "maxDatabaseErrorClusters", 0)) reasons.push("new database error cluster detected");
  if (observations.some((item) => item.queueHealthy === false)) reasons.push("retry queues are unhealthy");
  if (maxMetric(observations, "notificationDeadLetters") > threshold(observations, "maxNotificationDeadLetters", 0)) reasons.push("notification dead letters detected");
  if (maxMetric(observations, "maxQueueAgeSeconds") > threshold(observations, "maxQueueAgeSeconds", Number.POSITIVE_INFINITY)) reasons.push("retry queue is over age threshold");
  if (maxMetric(observations, "reviewLatencySeconds") > threshold(observations, "maxReviewLatencySeconds", Number.POSITIVE_INFINITY)) reasons.push("review latency is over threshold");
  if (maxMetric(observations, "overdueItems") > threshold(observations, "maxOverdueItems", 0)) reasons.push("overdue workflow items detected");
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

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stderr.write("observer.ts requires an injected Supabase service client\n");
  process.exitCode = 1;
}
