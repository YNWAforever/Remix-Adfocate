import { describe, expect, it, vi } from "vitest";
import { evaluatePilotExit, observePilot } from "./observer";

describe("pilot observer and seven-day exit", () => {
  it("expands only after seven distinct stable days with one neutral handoff", () => {
    const thresholds = {
      maxQueueAgeSeconds: 3600,
      maxReviewLatencySeconds: 86400,
      maxOverdueItems: 0,
      maxUnexpected5xx: 0,
      maxDatabaseErrorClusters: 0,
      maxNotificationDeadLetters: 0,
    };
    const observations = Array.from({ length: 7 }, (_, day) => ({
      observedAt: new Date(Date.UTC(2026, 7, day + 1)).toISOString(),
      workspaceId: "workspace-1",
      missionId: "mission-1",
      workflowCount: 1,
      submissionCount: 1,
      proofAttemptCount: 1,
      completionDecisionCount: 1,
      unexpected5xx: 0,
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
      requestErrorClusters: 0,
      databaseErrorClusters: 0,
      pendingRewards: day === 6 ? 1 : 0,
      completedWorkflows: day === 6 ? 1 : 0,
      completedCreatorCount: 1,
      creatorIdentityHash: "1".repeat(64),
      workflowIds: ["2".repeat(64)],
      queueHealthy: true,
      financialMovement: { points: 0, cash: 0, xp: 0, ledgerRows: 0 },
      rewardSnapshotBefore: { points: 10, cash: 0, xp: 0 },
      rewardSnapshotAfter: { points: 10, cash: 0, xp: 0 },
      thresholds,
    }));
    expect(evaluatePilotExit(observations, {
      passed: true,
      thresholds,
    })).toEqual({ decision: "expand", reasons: [] });
  });

  it("holds for fewer than seven days and contains integrity, isolation, or money movement", () => {
    const base = {
      observedAt: "2026-08-01T00:00:00.000Z",
      unexpected5xx: 0,
      integrityIncidents: 1,
      tenantIsolationIncidents: 0,
      notificationDeadLetters: 0,
      pendingRewards: 0,
      completedWorkflows: 0,
      financialMovement: { points: 0, cash: 0, xp: 0, ledgerRows: 0 },
    };
    expect(evaluatePilotExit([base], { passed: true }).decision).toBe("contain");
    expect(evaluatePilotExit([{
      ...base,
      integrityIncidents: 0,
      financialMovement: { points: 0, cash: 1, xp: 0, ledgerRows: 1 },
    }], { passed: true }).decision).toBe("contain");
    expect(evaluatePilotExit([{
      ...base,
      integrityIncidents: 0,
      observedAt: "2026-08-02T00:00:00.000Z",
    }], { passed: true }).decision).toBe("hold");
  });

  it("records structural counts and hashes identities without leaking raw IDs", async () => {
    const from = vi.fn((table: string) => {
      const rows = table === "mission_workflows"
      ? [{ id: "workflow-1", mission_submission_id: "submission-1", workspace_id: "workspace-1", state: "reward_pending", creator_id: "creator-1" }]
        : table === "mission_submissions"
          ? [{ id: "submission-1", mission_id: "mission-1", workspace_id: "workspace-1", creator_id: "creator-1" }]
          : [];
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        then: (resolve: (result: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve),
      };
      return builder;
    });
    const observation = await observePilot({ from }, {
      workspaceId: "workspace-1",
      missionId: "mission-1",
      observedAt: new Date("2026-08-01T00:00:00Z"),
    });
    expect(observation.workflowCount).toBe(1);
    expect(observation.submissionCount).toBe(1);
    expect(observation.creatorIdentityHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(observation)).not.toContain("creator-1");
    expect(JSON.stringify(observation)).not.toContain("workflow-1");
  });

  it("rejects missing or mismatched row scope instead of filtering it away", async () => {
    const from = (table: string) => {
      const rows = table === "mission_workflows"
        ? [{ id: "workflow-1", mission_id: "mission-1", state: "reward_pending", creator_id: "creator-1" }]
        : [];
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        then: (resolve: (result: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve),
      };
      return builder;
    };
    await expect(observePilot({ from }, {
      workspaceId: "workspace-1",
      missionId: "mission-1",
      observedAt: new Date("2026-08-01T00:00:00Z"),
    })).rejects.toThrow("scope mismatch");
    await expect(observePilot({}, {
      workspaceId: "workspace-1",
      missionId: "mission-1",
    })).rejects.toThrow("client unavailable");
  });
});
