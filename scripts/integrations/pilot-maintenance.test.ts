// @vitest-environment node
import { expect, it, vi } from "vitest";
import { MemoryIntegrationRepository } from "../../server/lib/integrations/memoryRepo.js";
import { dryRunPilotMaintenance } from "./pilot-maintenance.js";
const actor = { workspaceId: "synthetic-workspace", creatorId: "synthetic-creator" };
const target = { kind: "memory-repository" as const, id: "fixture-pilot" };
it("refuses live or mismatched targets and source drift before repository access", async () => {
  const repo = new MemoryIntegrationRepository(), access = vi.spyOn(repo, "command");
  const options = { repo, target, expectedTargetId: target.id, sourceSha: "a".repeat(40), expectedSourceSha: "a".repeat(40), actors: [actor], dryRun: true as const };
  await expect(dryRunPilotMaintenance({ ...options, target: { ...target, id: "other" } })).rejects.toThrow("PILOT_TARGET_MISMATCH");
  await expect(dryRunPilotMaintenance({ ...options, sourceSha: "b".repeat(40) })).rejects.toThrow("PILOT_SOURCE_MISMATCH");
  await expect(dryRunPilotMaintenance({ ...options, dryRun: false } as unknown as typeof options)).rejects.toThrow("D0_DRY_RUN_ONLY");
  expect(access).not.toHaveBeenCalled();
});
it("returns only bounded aggregate counts and never acquires a lease or mutates data", async () => {
  const repo = new MemoryIntegrationRepository(), access = vi.spyOn(repo, "command");
  const result = await dryRunPilotMaintenance({ repo, target, expectedTargetId: target.id, sourceSha: "a".repeat(40), expectedSourceSha: "a".repeat(40), actors: [actor, actor], dryRun: true, batchSize: 2 });
  expect(result).toMatchObject({ stage: "D0", dryRun: true, externalAccess: false, actorsInspected: 1, counts: { snapshots: 0 } });
  expect(access.mock.calls).toHaveLength(1);
  expect(access.mock.calls[0][2]).toBe("maintenance");
  expect(access.mock.calls[0][3]).toEqual({ dryRun: true, batchSize: 2 });
  expect(JSON.stringify(result)).not.toContain(actor.creatorId);
});
