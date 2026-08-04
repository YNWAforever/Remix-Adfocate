import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { executePilotCli } from "./pilot";
import { executeObserverCli } from "./observer";

const thresholds = {
  maxQueueAgeSeconds: 3600,
  maxReviewLatencySeconds: 86400,
  maxOverdueItems: 0,
  maxUnexpected5xx: 0,
  maxDatabaseErrorClusters: 0,
  maxNotificationDeadLetters: 0,
};

function observation(day: number, completed = 0, pending = 0) {
  return {
    observedAt: new Date(Date.UTC(2026, 7, day)).toISOString(),
    workspaceId: "workspace-1",
    missionId: "mission-1",
    workflowCount: 1,
    submissionCount: 1,
    proofAttemptCount: 1,
    completionDecisionCount: 1,
    pendingRewards: pending,
    completedWorkflows: completed,
    completedCreatorCount: 1,
    creatorIdentityHash: "1".repeat(64),
    workflowIds: ["2".repeat(64)],
    integrityIncidents: 0,
    tenantIsolationIncidents: 0,
    illegalTransitions: 0,
    duplicateDecisions: 0,
    missingRewardContracts: 0,
    notificationRetries: 0,
    notificationDeadLetters: 0,
    maxQueueAgeSeconds: 0,
    reviewLatencySeconds: 0,
    overdueItems: 0,
    unexpected5xx: 0,
    requestErrorClusters: 0,
    databaseErrorClusters: 0,
    queueHealthy: true,
    financialMovement: { points: 0, cash: 0, xp: 0, ledgerRows: 0 },
    rewardSnapshotBefore: { points: 10, cash: 0, xp: 0 },
    rewardSnapshotAfter: { points: 10, cash: 0, xp: 0 },
    thresholds,
  };
}

describe("guarded pilot/observer commands", () => {
  it("refuses pilot inspect without explicit service-client configuration", async () => {
    await expect(executePilotCli(["inspect"], {
      RELEASE_PILOT_WORKSPACE_ID: "workspace-1",
      RELEASE_PILOT_MISSION_ID: "mission-1",
    })).rejects.toThrow("explicit Supabase service client configuration");
  });

  it("evaluates observations from an approved input path without a database client", async () => {
    const directory = await mkdtemp(join(tmpdir(), "adfocate-pilot-cli-"));
    const observationsPath = join(directory, "observations.json");
    const observations = Array.from({ length: 7 }, (_, index) => observation(index + 1, index === 6 ? 1 : 0, index === 6 ? 1 : 0));
    await writeFile(observationsPath, JSON.stringify(observations), "utf8");
    try {
      const result = await executeObserverCli(["evaluate"], {
        RELEASE_PILOT_OBSERVATIONS_PATH: observationsPath,
        RELEASE_PILOT_CONTAINMENT_JSON: JSON.stringify({ passed: true, thresholds }),
      });
      expect(result).toEqual({ decision: "expand", reasons: [] });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("fails closed when evaluate input or containment evidence is missing", async () => {
    await expect(executeObserverCli(["evaluate"], {})).rejects.toThrow("RELEASE_PILOT_OBSERVATIONS_PATH");
  });
});
