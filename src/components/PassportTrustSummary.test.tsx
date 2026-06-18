import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PassportTrustSummary } from "./PassportTrustSummary";

describe("PassportTrustSummary", () => {
  it("renders private synced metrics and trust labels", () => {
    render(
      <PassportTrustSummary
        socialTrust={{
          badges: ["social_scan_connected", "active_creator"],
          accounts: [
            {
              id: "acc-1",
              platform: "instagram",
              handle: "ming",
              followerCount: 12000,
              engagementRate: 4.5,
              avgLikes: 500,
              avgComments: 40,
              freshnessScore: 100,
              apiSyncedAt: "2026-06-17T00:00:00.000Z",
              ownerVerified: false,
              labels: ["API-synced", "Ownership not verified"],
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("12,000 followers")).toBeInTheDocument();
    expect(screen.getByText("4.5% engagement")).toBeInTheDocument();
    expect(screen.getByText("API-synced")).toBeInTheDocument();
    expect(screen.getByText("Ownership not verified")).toBeInTheDocument();
  });
});
