import { IntegrationError } from "./policy.js";
import type { Actor, ProviderId } from "./types.js";
import { PRODUCT_HOSTING_PROJECT_IDS, PRODUCT_HOSTNAMES, PRODUCT_SUPABASE_PROJECT_REF } from "./pilotPolicy.js";

export type PilotActor = Actor & { subject: string };
export type PilotTargetIdentity = {
  sourceSha: string; schemaDigest: string; artifactDigest: string;
  deploymentId: string; hostingProjectId: string; projectRef: string; origin: string;
  googleProjectId: string; googleClientId: string; metaAppId: string; instagramAppId: string;
};
/** Server-only owner registry record. Not an HTTP request or an environment flag. */
export type PilotApprovalRecord = PilotTargetIdentity & {
  stage: "D1"; ownerApprovalReference: string; issuedAt: string; expiresAt: string;
  actors: PilotActor[]; fixtureIds: string[];
  providerEnablement: { google_drive: false; instagram: false };
};
export type PilotApprovedTargetIds = Pick<PilotTargetIdentity,
  "deploymentId" | "hostingProjectId" | "projectRef" | "googleProjectId" | "googleClientId" | "metaAppId" | "instagramAppId">;
/** Trusted server composition only: read control-plane and read-only identity metadata.
 * Implementations MUST constrain every underlying query to these IDs. No app-data,
 * credential, OAuth, provider-content or arbitrary-URL lookup belongs in this port.
 * Source/schema/artifact/origin/identities must come from independent observations.
 */
export interface PilotControlPlaneReadPort {
  readApproval(reference: { ownerApprovalReference: string }): Promise<unknown>;
  readTarget(ids: Readonly<PilotApprovedTargetIds>): Promise<unknown>;
}
export type PilotAdmission = {
  admitted: boolean; phase: "D1_BLOCKED" | "D1_ENVIRONMENT_READY";
  providerStates: { google_drive: "disabled"; instagram: "disabled" }; reasons: string[];
};
export interface PilotRuntime {
  admission(): PilotAdmission;
  readonly approvedOrigin: string | null;
  readonly approvedActors: readonly Readonly<PilotActor>[];
  authorizeActor(actor: unknown, verifiedSubject: unknown): Readonly<PilotActor>;
  getIntegrationService(): null;
  getOAuthCoordinator(): null;
  requireProviderAccess(provider: ProviderId, operation: "oauth" | "token" | "content"): never;
}

const TARGET_KEYS = ["sourceSha", "schemaDigest", "artifactDigest", "deploymentId", "hostingProjectId", "projectRef", "origin", "googleProjectId", "googleClientId", "metaAppId", "instagramAppId"] as const;
const APPROVAL_KEYS = [...TARGET_KEYS, "stage", "ownerApprovalReference", "issuedAt", "expiresAt", "actors", "fixtureIds", "providerEnablement"];
const PRODUCT_PROJECTS = new Set(PRODUCT_HOSTING_PROJECT_IDS.map(id => id.toLowerCase()));
const PRODUCT_DATABASE = PRODUCT_SUPABASE_PROJECT_REF;
const MAX_EVIDENCE_AGE_MS = 5 * 60_000;
type Observation = {
  provenance: { source: "control-plane"; ownerApprovalReference: string; observedAt: string };
  target: PilotTargetIdentity & { hostingProjectName: string }; actors: PilotActor[]; fixtureIds: string[];
};
/** Only this module can mint observation handles; serialized receipts are not capabilities. */
const observations = new WeakMap<object, { approval: string; evidence: Observation }>();
const fail = (code: string): never => { throw new IntegrationError(code, 503); };

function object(value: unknown, keys: readonly string[], code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail(code);
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) return fail(code);
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || ownKeys.some(key => typeof key !== "string" || !keys.includes(key)
    || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, "value"))) return fail(code);
  return value as Record<string, unknown>;
}
function text(value: unknown, code: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,254}$/.test(value)) return fail(code);
  return value;
}
function timestamp(value: unknown, code: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) return fail(code);
  return value;
}
function list(value: unknown, code: string): unknown[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100 || Object.keys(value).length !== value.length) return fail(code);
  return value;
}
function actorList(value: unknown, code: string): PilotActor[] {
  const actors = list(value, code).map(entry => {
    const row = object(entry, ["creatorId", "workspaceId", "subject"], code);
    return { creatorId: text(row.creatorId, code), workspaceId: text(row.workspaceId, code), subject: text(row.subject, code) };
  });
  for (const keys of [["workspaceId", "creatorId"], ["workspaceId", "subject"]] as const) {
    if (new Set(actors.map(actor => JSON.stringify(keys.map(key => actor[key])))).size !== actors.length) return fail(code);
  }
  return actors.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}
function fixtureList(value: unknown, code: string): string[] {
  const fixtures = list(value, code).map(entry => text(entry, code));
  if (new Set(fixtures).size !== fixtures.length) return fail(code);
  return fixtures.sort();
}
function targetFields(row: Record<string, unknown>, code: string): PilotTargetIdentity {
  const target = Object.fromEntries(TARGET_KEYS.map(key => [key, key === "origin" ? row[key] : text(row[key], code)])) as PilotTargetIdentity;
  if (!/^[0-9a-f]{40}$/.test(target.sourceSha) || !/^[0-9a-f]{64}$/.test(target.schemaDigest)
    || !/^[0-9a-f]{64}$/.test(target.artifactDigest) || !/^[a-z0-9-]{3,63}$/.test(target.projectRef)) return fail(code);
  try {
    const origin = new URL(target.origin);
    if (typeof target.origin !== "string" || origin.protocol !== "https:" || origin.origin !== target.origin || origin.username || origin.password) return fail(code);
  } catch { return fail(code); }
  return target;
}
/** Validate untrusted JSON at the server boundary; unknown switches are rejected. */
export function parsePilotApprovalRecord(value: unknown): PilotApprovalRecord {
  const code = "PILOT_APPROVAL_INVALID", row = object(value, APPROVAL_KEYS, code);
  const enablement = object(row.providerEnablement, ["google_drive", "instagram"], code);
  if (row.stage !== "D1" || enablement.google_drive !== false || enablement.instagram !== false) return fail(code);
  const record: PilotApprovalRecord = {
    ...targetFields(row, code), stage: "D1", ownerApprovalReference: text(row.ownerApprovalReference, code),
    issuedAt: timestamp(row.issuedAt, code), expiresAt: timestamp(row.expiresAt, code),
    actors: actorList(row.actors, code), fixtureIds: fixtureList(row.fixtureIds, code),
    providerEnablement: { google_drive: false, instagram: false },
  };
  if (Date.parse(record.expiresAt) <= Date.parse(record.issuedAt)) return fail(code);
  return record;
}
function assertIsolated(target: PilotTargetIdentity, hostingProjectName?: string) {
  const hostname = new URL(target.origin).hostname;
  if (target.projectRef === PRODUCT_DATABASE || PRODUCT_PROJECTS.has(target.hostingProjectId.toLowerCase())
    || (hostingProjectName !== undefined && PRODUCT_PROJECTS.has(hostingProjectName.toLowerCase()))
    || PRODUCT_HOSTNAMES.includes(hostname)) return fail("PILOT_PRODUCTION_TARGET");
}
function assertCurrent(record: PilotApprovalRecord, now: Date) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) return fail("PILOT_TIME_INVALID");
  if (now.getTime() >= Date.parse(record.expiresAt)) return fail("PILOT_APPROVAL_EXPIRED");
  if (now.getTime() < Date.parse(record.issuedAt)) return fail("PILOT_APPROVAL_NOT_CURRENT");
}
function parseObservation(value: unknown): Observation {
  const code = "PILOT_OBSERVATION_INVALID", row = object(value, ["provenance", "target", "actors", "fixtureIds"], code);
  const provenance = object(row.provenance, ["source", "ownerApprovalReference", "observedAt"], code);
  if (provenance.source !== "control-plane") return fail(code);
  const target = object(row.target, [...TARGET_KEYS, "hostingProjectName"], code);
  return {
    provenance: { source: "control-plane", ownerApprovalReference: text(provenance.ownerApprovalReference, code), observedAt: timestamp(provenance.observedAt, code) },
    target: { ...targetFields(target, code), hostingProjectName: text(target.hostingProjectName, code) },
    actors: actorList(row.actors, code), fixtureIds: fixtureList(row.fixtureIds, code),
  };
}
function assertEvidence(record: PilotApprovalRecord, evidence: Observation, now: Date) {
  assertCurrent(record, now); assertIsolated(evidence.target, evidence.target.hostingProjectName);
  const observedAt = Date.parse(evidence.provenance.observedAt);
  if (evidence.provenance.ownerApprovalReference !== record.ownerApprovalReference) return fail("PILOT_OBSERVATION_PROVENANCE");
  if (observedAt > now.getTime() || observedAt < Date.parse(record.issuedAt) || now.getTime() - observedAt > MAX_EVIDENCE_AGE_MS) return fail("PILOT_OBSERVATION_STALE");
  if (TARGET_KEYS.some(key => record[key] !== evidence.target[key])) return fail("PILOT_TARGET_MISMATCH");
  if (JSON.stringify(record.actors) !== JSON.stringify(evidence.actors) || JSON.stringify(record.fixtureIds) !== JSON.stringify(evidence.fixtureIds)) return fail("PILOT_IDENTITY_MISMATCH");
}
function admission(reasons: string[]): PilotAdmission {
  return { admitted: reasons.length === 0, phase: reasons.length === 0 ? "D1_ENVIRONMENT_READY" : "D1_BLOCKED",
    providerStates: { google_drive: "disabled", instagram: "disabled" }, reasons };
}
export function verifyPilotAdmission(input: unknown, observed: unknown, now: Date): PilotAdmission {
  try {
    const record = parsePilotApprovalRecord(input);
    assertIsolated(record); assertCurrent(record, now);
    const receipt = observed && typeof observed === "object" ? observations.get(observed) : undefined;
    if (!receipt) return admission(["PILOT_OBSERVATION_REQUIRED"]);
    if (receipt.approval !== JSON.stringify(record)) return admission(["PILOT_OWNER_APPROVAL_MISMATCH"]);
    assertEvidence(record, receipt.evidence, now);
    return admission([]);
  } catch (error) { return admission([error instanceof IntegrationError ? error.code : "PILOT_APPROVAL_INVALID"]); }
}
async function readControlPlane(read: () => Promise<unknown>): Promise<unknown> {
  try { return await read(); } catch { return fail("PILOT_OBSERVATION_FAILED"); }
}
/** No network implementation is installed here. The host supplies a trusted read-only port.
 * No expected source/schema/origin/actor data is sent to the target reader.
 */
export async function observePilotTarget(input: unknown, port: PilotControlPlaneReadPort, clock: () => Date = () => new Date()): Promise<object> {
  const record = parsePilotApprovalRecord(input);
  assertIsolated(record); assertCurrent(record, clock());
  const ownerRecord = await readControlPlane(() => port.readApproval(Object.freeze({ ownerApprovalReference: record.ownerApprovalReference })));
  let ownerApproval: PilotApprovalRecord;
  try { ownerApproval = parsePilotApprovalRecord(ownerRecord); } catch { return fail("PILOT_OWNER_APPROVAL_MISMATCH"); }
  if (JSON.stringify(ownerApproval) !== JSON.stringify(record)) return fail("PILOT_OWNER_APPROVAL_MISMATCH");
  assertCurrent(record, clock());
  const ids: PilotApprovedTargetIds = {
    deploymentId: record.deploymentId, hostingProjectId: record.hostingProjectId, projectRef: record.projectRef,
    googleProjectId: record.googleProjectId, googleClientId: record.googleClientId, metaAppId: record.metaAppId, instagramAppId: record.instagramAppId,
  };
  const raw = await readControlPlane(() => port.readTarget(Object.freeze(ids)));
  // Reject TOCTOU expiry before processing any downstream data or returning admission.
  assertCurrent(record, clock());
  const evidence = parseObservation(raw);
  assertEvidence(record, evidence, clock());
  const handle = Object.freeze({ kind: "server-pilot-observation" });
  observations.set(handle, { approval: JSON.stringify(record), evidence });
  return handle;
}

/** D1 preparation only: there is no factory hook, provider injection or D2 branch.
 * Retaining this facade cannot retain an expired admission or mint a network client.
 */
export function createPilotRuntime(record: unknown, observed: unknown, clock: () => Date = () => new Date()): PilotRuntime {
  let snapshot: PilotApprovalRecord | null;
  try { snapshot = parsePilotApprovalRecord(record); } catch { snapshot = null; }
  const approvedActors = Object.freeze((snapshot?.actors ?? []).map(actor => Object.freeze({ ...actor })));
  return Object.freeze({
    admission: () => verifyPilotAdmission(snapshot, observed, clock()),
    approvedOrigin: snapshot?.origin ?? null,
    approvedActors,
    /** Subject MUST come from verified server Auth metadata, never an HTTP body. */
    authorizeActor(actor: unknown, subject: unknown): Readonly<PilotActor> {
      const checked = verifyPilotAdmission(snapshot, observed, clock());
      if (!checked.admitted) return fail(checked.reasons[0]);
      let who: Record<string, unknown>;
      try { who = object(actor, ["creatorId", "workspaceId"], "PILOT_ACTOR_DENIED"); } catch { return fail("PILOT_ACTOR_DENIED"); }
      const authorized = approvedActors.find(entry => entry.creatorId === who.creatorId && entry.workspaceId === who.workspaceId && entry.subject === subject);
      return authorized ?? fail("PILOT_ACTOR_DENIED");
    },
    getIntegrationService: () => null,
    getOAuthCoordinator: () => null,
    requireProviderAccess(): never { throw new IntegrationError("LIVE_PROVIDER_DISABLED", 503); },
  });
}
