import { MemoryIntegrationRepository } from "../../server/lib/integrations/memoryRepo.js";
import { inspectIntegrationMaintenance, type MaintenanceCounts } from "../../server/lib/integrations/lifecycle.js";
import type { Actor } from "../../server/lib/integrations/types.js";

export type D0MaintenanceInput = {
  repo: MemoryIntegrationRepository;
  target: { kind: "memory-repository"; id: string };
  expectedTargetId: string;
  sourceSha: string;
  expectedSourceSha: string;
  actors: Actor[];
  dryRun: true;
  batchSize?: number;
};

/** D0 entry point has no env URL, Supabase client, provider client or executable schedule. */
export async function dryRunPilotMaintenance(input: D0MaintenanceInput) {
  if (input.dryRun !== true) throw new Error("D0_DRY_RUN_ONLY");
  if (input.target.kind !== "memory-repository" || !(input.repo instanceof MemoryIntegrationRepository) || !input.target.id || input.target.id !== input.expectedTargetId) throw new Error("PILOT_TARGET_MISMATCH");
  if (!/^[a-f0-9]{40}$/.test(input.sourceSha) || input.sourceSha !== input.expectedSourceSha) throw new Error("PILOT_SOURCE_MISMATCH");
  const batchSize = input.batchSize ?? 50;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100 || !Array.isArray(input.actors) || input.actors.length < 1 || input.actors.length > 100 || input.actors.some(actor => !actor.creatorId || !actor.workspaceId)) throw new Error("PILOT_BATCH_INVALID");
  const actors = [...new Map(input.actors.map(actor => [JSON.stringify([actor.workspaceId, actor.creatorId]), actor])).values()];
  const counts: MaintenanceCounts = { snapshots: 0, credentials: 0, states: 0, permits: 0, events: 0 };
  let hasMore = false, pendingRevocations = 0, manualAction = 0;
  for (const actor of actors) {
    const result = await inspectIntegrationMaintenance(input.repo, actor, batchSize);
    for (const key of Object.keys(counts) as Array<keyof MaintenanceCounts>) counts[key] += result.counts[key];
    hasMore ||= result.hasMore; pendingRevocations += result.pendingRevocations; manualAction += result.manualAction;
  }
  return { stage: "D0" as const, dryRun: true as const, externalAccess: false as const, actorsInspected: actors.length, batchSize, counts, hasMore, pendingRevocations, manualAction };
}
