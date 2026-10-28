import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { enablePilot, inspectPilotCandidate } from "./pilot";

type Row = Record<string, unknown>;

function fakeSupabase(input: {
  mission?: Row;
  submissions?: Row[];
  workflows?: Row[];
  activePilotCount?: number;
  capabilities?: Row[];
}) {
  const tables: Record<string, Row[]> = {
    missions: input.mission ? [{ ...input.mission }] : [],
    mission_submissions: input.submissions ?? [],
    mission_workflows: input.workflows ?? [],
    release_capabilities: input.capabilities ?? [],
  };
  const update = vi.fn(async (args: { values?: Row; table?: string; filters?: Row }) => {
    const mission = tables.missions[0];
    if (!mission || mission.creator_workflow_mode !== "legacy") return { data: [], error: null };
    Object.assign(mission, args.values ?? {});
    return { data: [{ id: mission.id }], error: null };
  });
  const client = {
    mission: tables.missions[0],
    activePilotCount: input.activePilotCount ?? 0,
    enablePilotAtomically: vi.fn(async (args: { nextWorkflowMode: string }) => {
      const current = tables.missions[0];
      if (!current || current.creator_workflow_mode !== "legacy") return { data: [], error: null };
      Object.assign(current, { creator_workflow_mode: args.nextWorkflowMode });
      return { data: [{ id: current.id }], error: null };
    }),
    from(table: string) {
      const rows = tables[table] ?? [];
      const filters: Row = {};
      const builder = {
        select: vi.fn(() => builder),
        eq: vi.fn((key: string, value: unknown) => {
          filters[key] = value;
          return builder;
        }),
        in: vi.fn(() => builder),
        limit: vi.fn(() => builder),
        maybeSingle: vi.fn(async () => ({ data: rows.find((row) => Object.entries(filters).every(([k, v]) => row[k] === v)) ?? null, error: null })),
        then: (resolve: (result: { data: Row[]; error: null }) => unknown) =>
          Promise.resolve({ data: rows.filter((row) => Object.entries(filters).every(([k, v]) => row[k] === v)), error: null }).then(resolve),
      };
      return builder;
    },
    update,
  };
  return client;
}

const mission = {
  id: "mission-1",
  workspace_id: "workspace-1",
  creator_workflow_mode: "legacy",
  status: "draft",
  points_reward: 100,
  cash_reward: null,
};

const HOUR = 60 * 60 * 1000;

/**
 * Frozen inspection clock. Every evidence timestamp below is derived from it, and it is
 * injected into both `inspectPilotCandidate` and `enablePilot`, so wall-clock time never
 * reaches the expiry guard and these fixtures cannot rot.
 */
const NOW = new Date("2026-08-01T00:00:00.000Z");

function gates(digest = "a".repeat(64)) {
  return {
    approvedEvidenceDigest: digest,
    expectedCapabilities: ["table:public.mission_workflows"],
    capabilities: [{ name: "table:public.mission_workflows", status: "present" as const }],
    approvedCommit: "c".repeat(40),
    deployment: { status: "passed" as const, deploymentReadyState: "READY" as const, commit: "c".repeat(40) },
    compatibilityEvidence: true,
    evidenceCreatedAt: new Date(NOW.getTime() - 24 * HOUR).toISOString(),
    evidenceExpiresAt: new Date(NOW.getTime() + 24 * HOUR).toISOString(),
    now: NOW,
  };
}

describe("pilot candidate guard", () => {
  // These tests previously passed only because the real clock happened to sit inside the
  // evidence window; they began failing the day it elapsed. Pinning the system clock far
  // past every fixture means any code path that reads wall-clock time instead of the
  // injected `now` fails here immediately, rather than years later.
  // Only Date is faked — faking timers would stall the promise-based fake client.
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2099-01-01T00:00:00.000Z"));
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  it("accepts one new legacy mission and exposes a frozen neutral join contract", async () => {
    const client = fakeSupabase({ mission });
    const report = await inspectPilotCandidate(client, {
      workspaceId: "workspace-1",
      missionId: "mission-1",
      ...gates(),
    });
    expect(report.eligible).toBe(true);
    expect(report.joinContract).toEqual({
      points_amount: 100,
      cash_amount: 0,
      currency: "HKD",
      xp_amount: 0,
    });
    await enablePilot(client, { ...report, now: NOW, apply: false, evidenceDigest: "a".repeat(64), approval: "" });
    expect(client.update).not.toHaveBeenCalled();
  });

  it("rejects submissions, cross-workspace missions, or a second active pilot", async () => {
    await expect(inspectPilotCandidate(fakeSupabase({ mission, submissions: [{ id: "s1", workspace_id: "workspace-1", mission_id: mission.id }] }), {
      workspaceId: "workspace-1",
      missionId: "mission-1",
      ...gates(),
    })).resolves.toMatchObject({ eligible: false });
    await expect(inspectPilotCandidate(fakeSupabase({ mission: { ...mission, workspace_id: "other" } }), {
      workspaceId: "workspace-1",
      missionId: "mission-1",
      ...gates(),
    })).resolves.toMatchObject({ eligible: false });
    await expect(inspectPilotCandidate(fakeSupabase({ mission, activePilotCount: 1 }), {
      workspaceId: "workspace-1",
      missionId: "mission-1",
      ...gates("b".repeat(64)),
    })).resolves.toMatchObject({ eligible: false });
  });

  it("requires exact approval, re-inspects, and performs one conditional mode update", async () => {
    const client = fakeSupabase({ mission });
    const digest = "b".repeat(64);
    const report = await inspectPilotCandidate(client, { workspaceId: "workspace-1", missionId: "mission-1", ...gates(digest) });
    await expect(enablePilot(client, { ...report, now: NOW, apply: true, evidenceDigest: digest, approval: "ENABLE PILOT wrong" }))
      .rejects.toThrow("exact approval");
    const enabled = await enablePilot(client, {
      ...report,
      now: NOW,
      apply: true,
      evidenceDigest: digest,
      approval: `ENABLE PILOT workspace-1 mission-1 ${digest}`,
    });
    expect(enabled.applied).toBe(true);
    expect(client.enablePilotAtomically).toHaveBeenCalledTimes(1);
    expect(client.mission?.creator_workflow_mode).toBe("active_workspace");
    expect(client.mission?.status).toBe("draft");
  });

  it("rejects a conditional update race and never publishes", async () => {
    const client = fakeSupabase({ mission });
    client.enablePilotAtomically.mockResolvedValueOnce({ data: [], error: null });
    const raceDigest = "c".repeat(64);
    const report = await inspectPilotCandidate(client, { workspaceId: "workspace-1", missionId: "mission-1", ...gates(raceDigest) });
    await expect(enablePilot(client, {
      ...report,
      now: NOW,
      apply: true,
      evidenceDigest: raceDigest,
      approval: `ENABLE PILOT workspace-1 mission-1 ${raceDigest}`,
    })).rejects.toThrow("submission race");
    expect(mission.status).toBe("draft");
  });

  it("still rejects evidence that expired before the inspection clock", async () => {
    const report = await inspectPilotCandidate(fakeSupabase({ mission }), {
      workspaceId: "workspace-1",
      missionId: "mission-1",
      ...gates(),
      evidenceExpiresAt: new Date(NOW.getTime() - HOUR).toISOString(),
    });

    expect(report.eligible).toBe(false);
    expect(report.reasons).toContain("approved evidence has expired");
  });

  it("refuses to enable when the re-inspection clock is past the evidence expiry", async () => {
    const client = fakeSupabase({ mission });
    const digest = "d".repeat(64);
    const report = await inspectPilotCandidate(client, { workspaceId: "workspace-1", missionId: "mission-1", ...gates(digest) });
    expect(report.eligible).toBe(true);

    // Evidence valid at inspection, expired by the time enablement re-inspects.
    await expect(enablePilot(client, {
      ...report,
      now: new Date(NOW.getTime() + 48 * HOUR),
      apply: true,
      evidenceDigest: digest,
      approval: `ENABLE PILOT workspace-1 mission-1 ${digest}`,
    })).rejects.toThrow("approved evidence has expired");
    expect(client.enablePilotAtomically).not.toHaveBeenCalled();
    expect(client.mission?.creator_workflow_mode).toBe("legacy");
  });
});
