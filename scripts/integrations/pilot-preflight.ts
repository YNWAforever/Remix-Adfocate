import { inspectPilotTarget, type PilotTarget } from "../../server/lib/integrations/pilotPolicy.js";
import type { Actor } from "../../server/lib/integrations/types.js";
import { verifyPilotAdmission } from "../../server/lib/integrations/pilotRuntime.js";

export type OfflinePilotReceipt = {
  expected: PilotTarget; observed: PilotTarget; productionProjects: string[];
  creators: Actor[]; expectedCreators: Actor[]; fixtures: string[]; expectedFixtures: string[];
};
function sameSet(actual: string[], expected: string[]) {
  return actual.length > 0 && actual.length <= 100 && actual.every(value=>value.length>0 && value.length<=600)
    && new Set(actual).size === actual.length && new Set(expected).size === expected.length
    && actual.length === expected.length && actual.every(value=>expected.includes(value));
}
function isReceipt(value: unknown): value is OfflinePilotReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as OfflinePilotReceipt;
  const actors = (entries: unknown): entries is Actor[] => Array.isArray(entries) && entries.length <= 100
    && entries.every(actor => !!actor && typeof actor === "object" && !Array.isArray(actor)
      && typeof actor.creatorId === "string" && typeof actor.workspaceId === "string");
  const strings = (entries: unknown): entries is string[] => Array.isArray(entries) && entries.length <= 100 && entries.every(entry => typeof entry === "string");
  return actors(row.creators) && actors(row.expectedCreators) && strings(row.fixtures) && strings(row.expectedFixtures) && strings(row.productionProjects);
}
/** Receipt comparison only. No env client, DB constructor, provider transport or deployment action. */
export function inspectOfflinePilot(input: unknown) {
  const row = isReceipt(input) ? input : null;
  const target = row ? inspectPilotTarget(row.expected,row.observed,row.productionProjects) : {matches:false};
  const creatorKey = (actor: Actor) => actor.creatorId && actor.workspaceId ? JSON.stringify([actor.workspaceId,actor.creatorId]) : "";
  const identitiesMatch = row !== null && sameSet(row.creators.map(creatorKey),row.expectedCreators.map(creatorKey));
  const fixturesMatch = row !== null && sameSet(row.fixtures,row.expectedFixtures);
  return { stage:"D0" as const, offlineContractMatches:target.matches && identitiesMatch && fixturesMatch,
    externalAccess:false as const, liveTests:"NOT_RUN" as const, reason:"PILOT_APPROVAL_REQUIRED" as const,
    checks:{target:target.matches,identities:identitiesMatch,fixtures:fixturesMatch} };
}

/** D1 accepts only an in-process observation issued by the trusted server observer.
 * Local comparison output still cannot claim any OAuth/account/remote test was run.
 */
export function inspectD1Pilot(record: unknown, observed: unknown, now: Date) {
  return { ...verifyPilotAdmission(record, observed, now), stage: "D1" as const, externalAccess: false as const, liveTests: "NOT_RUN" as const };
}
