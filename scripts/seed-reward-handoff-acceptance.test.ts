import { describe, expect, it } from "vitest";
import {
  REWARD_HANDOFF_CANCELLATION_REASON,
  REWARD_HANDOFF_SCENARIO_LABELS,
  REWARD_NEUTRALITY_SNAPSHOT_FIELDS,
  rewardHandoffAcceptanceSummary,
  structuralCountsFromAssertions,
} from "./seed-reward-handoff-acceptance";

describe("reward handoff acceptance seed contract", () => {
  it("uses a migration-supported cancellation category", () => {
    expect(REWARD_HANDOFF_CANCELLATION_REASON).toBe("eligibility_error");
  });
  it("covers every required deterministic release scenario exactly once", () => {
    expect(REWARD_HANDOFF_SCENARIO_LABELS).toEqual([
      "new_join_contract",
      "existing_workflow_needing_backfill",
      "eligible_proof_verified",
      "blocked_required_proof",
      "pending_handoff",
      "cancelled_and_reassessable_handoff",
      "configured_sla_workspace",
      "missing_sla_workspace",
    ]);
    expect(new Set(REWARD_HANDOFF_SCENARIO_LABELS).size).toBe(
      REWARD_HANDOFF_SCENARIO_LABELS.length,
    );
  });

  it("captures exact before-snapshot fields for every reward-neutral surface", () => {
    expect(REWARD_NEUTRALITY_SNAPSHOT_FIELDS).toEqual([
      "points",
      "xp",
      "earnings",
      "issuedRewards",
      "redemptions",
      "workspaceBudget",
    ]);
  });

  it("cannot report success when any scenario lacks an executed assertion", () => {
    const incomplete = new Set(REWARD_HANDOFF_SCENARIO_LABELS.slice(0, -1));
    expect(() => structuralCountsFromAssertions(incomplete, 5))
      .toThrow(/missing_sla_workspace/);
    const complete = structuralCountsFromAssertions(
      new Set(REWARD_HANDOFF_SCENARIO_LABELS),
      5,
    );
    expect(Object.values(complete.scenarioCounts)).toEqual(
      REWARD_HANDOFF_SCENARIO_LABELS.map(() => 1),
    );
  });
  it("logs structural labels and counts without fixture identities or secrets", () => {
    const summary = rewardHandoffAcceptanceSummary({
      scenarioCounts: Object.fromEntries(
        REWARD_HANDOFF_SCENARIO_LABELS.map((label) => [label, 1]),
      ),
      neutralitySnapshotCounts: Object.fromEntries(
        REWARD_NEUTRALITY_SNAPSHOT_FIELDS.map((field) => [field, 6]),
      ),
    });

    expect(summary).toEqual({
      scenarios: REWARD_HANDOFF_SCENARIO_LABELS.map((label) => ({ label, count: 1 })),
      rewardNeutralityBeforeSnapshots: REWARD_NEUTRALITY_SNAPSHOT_FIELDS.map(
        (label) => ({ label, count: 6 }),
      ),
    });
    const output = JSON.stringify(summary);
    expect(output).not.toMatch(/@|jwt|token|supabase|signed[_-]?url/i);
    expect(output).not.toMatch(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i,
    );
  });
});