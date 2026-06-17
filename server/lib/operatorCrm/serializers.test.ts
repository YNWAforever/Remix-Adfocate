import { describe, expect, it } from "vitest";
import {
  DEFAULT_REVIEW_STATUS,
  lastActivityAt,
  parseReviewStatus,
  parseRiskLevel,
  projectReviewStatus,
  summarizeSocialAccounts,
} from "./serializers";

describe("operator CRM serializers", () => {
  it("projects a missing review row as needs_review with unknown risk", () => {
    expect(projectReviewStatus(null)).toEqual(DEFAULT_REVIEW_STATUS);
  });

  it("projects an existing review row into the operator response shape", () => {
    expect(
      projectReviewStatus({
        status: "approved",
        risk_level: "low",
        summary: "Consistent creator",
        reviewed_by: "op-1",
        last_reviewed_at: "2026-06-18T01:00:00.000Z",
        updated_at: "2026-06-18T01:00:00.000Z",
      }),
    ).toEqual({
      status: "approved",
      riskLevel: "low",
      summary: "Consistent creator",
      reviewedBy: "op-1",
      lastReviewedAt: "2026-06-18T01:00:00.000Z",
      updatedAt: "2026-06-18T01:00:00.000Z",
    });
  });

  it("rejects unknown enum values", () => {
    expect(parseReviewStatus("flagged")).toBe("flagged");
    expect(parseReviewStatus("paused")).toBeNull();
    expect(parseRiskLevel("high")).toBe("high");
    expect(parseRiskLevel("severe")).toBeNull();
  });

  it("summarizes API-synced social accounts without ownership claims", () => {
    expect(
      summarizeSocialAccounts([
        {
          platform: "instagram",
          sync_status: "synced",
          follower_count: 45000,
          engagement_rate: 3.2,
          api_synced_at: "2026-06-18T02:00:00.000Z",
        },
        {
          platform: "threads",
          sync_status: "pending",
          follower_count: null,
          engagement_rate: null,
          api_synced_at: null,
        },
      ]),
    ).toEqual({
      platforms: ["instagram", "threads"],
      syncStatus: "synced",
      followerCount: 45000,
      engagementRate: 3.2,
      apiSyncedAt: "2026-06-18T02:00:00.000Z",
      label: "API-synced",
      ownershipLabel: "Ownership not verified",
    });
  });

  it("chooses the newest non-null activity timestamp", () => {
    expect(
      lastActivityAt([
        "2026-06-17T02:00:00.000Z",
        null,
        "2026-06-18T02:00:00.000Z",
        "2026-06-16T02:00:00.000Z",
      ]),
    ).toBe("2026-06-18T02:00:00.000Z");
  });
});
