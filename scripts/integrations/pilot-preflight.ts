import { inspectPilotTarget, type PilotTarget } from "../../server/lib/integrations/pilotPolicy.js";
import type { Actor } from "../../server/lib/integrations/types.js";

export type OfflinePilotReceipt = {
  expected: PilotTarget; observed: PilotTarget; productionProjects: string[];
  creators: Actor[]; expectedCreators: Actor[]; fixtures: string[]; expectedFixtures: string[];
};
function sameSet(actual: string[], expected: string[]) {
  return actual.length > 0 && actual.length <= 100 && actual.every(value=>value.length>0 && value.length<=600)
    && new Set(actual).size === actual.length && new Set(expected).size === expected.length
    && actual.length === expected.length && actual.every(value=>expected.includes(value));
}
/** Receipt comparison only. No env client, DB constructor, provider transport or deployment action. */
export function inspectOfflinePilot(input: OfflinePilotReceipt) {
  const target = inspectPilotTarget(input.expected,input.observed,input.productionProjects);
  const creatorKey = (actor: Actor) => actor.creatorId && actor.workspaceId ? JSON.stringify([actor.workspaceId,actor.creatorId]) : "";
  const identitiesMatch = sameSet(input.creators.map(creatorKey),input.expectedCreators.map(creatorKey));
  const fixturesMatch = sameSet(input.fixtures,input.expectedFixtures);
  return { stage:"D0" as const, offlineContractMatches:target.matches && identitiesMatch && fixturesMatch,
    externalAccess:false as const, liveTests:"NOT_RUN" as const, reason:"PILOT_APPROVAL_REQUIRED" as const,
    checks:{target:target.matches,identities:identitiesMatch,fixtures:fixturesMatch} };
}
