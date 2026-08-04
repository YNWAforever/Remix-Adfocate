import { describe, expect, it, vi } from "vitest";
import { evaluatePilotExit, observePilot } from "./observer";

describe("pilot observer and seven-day exit", () => {
  it("expands only after seven distinct stable days with one neutral handoff", () => {
    const observations = Array.from({ length: 7 }, (_, day) => ({
      observedAt: new Date(Date.UTC(2026, 7, day + 1)).toISOString(),
      unexpected5xx: 0,
      integrityIncidents: 0,
      tenantIsolationIncidents: 0,
      notificationDeadLetters: 0,
      pendingRewards: day === 6 ? 1 : 0,
      completedWorkflows: day === 6 ? 1 : 0,
      financialMovement: { points: 0, cash: 0, xp: 0, ledgerRows: 0 },
    }));
    expect(evaluatePilotExit(observations, { passed: true })).toEqual({ decision: "expand", reasons: [] });
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
        ? [{ id: "workflow-1", mission_id: "mission-1", workspace_id: "workspace-1", state: "reward_pending", creator_id: "creator-1" }]
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
});
