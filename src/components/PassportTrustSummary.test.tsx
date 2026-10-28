import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PassportTrustSummary } from "./PassportTrustSummary";
import { I18nProvider } from "@/lib/i18n";

const renderEn = (ui: React.ReactNode) => { window.localStorage.setItem("lang", "en"); return render(<I18nProvider>{ui}</I18nProvider>); };

describe("PassportTrustSummary", () => {
  it("renders private synced metrics and trust labels", () => {
    renderEn(
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

  it("shows legacy-only and failed accounts using the supplied private projection", () => {
    renderEn(<PassportTrustSummary socialTrust={{ accounts: [], badges: [], presentations: [
      { accountId: null, platform: "youtube", handle: "legacy", source: "legacy", syncStatus: "not_connected", ownershipVerified: false, lastSyncedAt: null, legacyHandles: [] },
      { accountId: "failed", platform: "instagram", handle: "current", source: "conflict", syncStatus: "failed", ownershipVerified: false, lastSyncedAt: null, legacyHandles: ["@old"] },
    ] }} />);
    expect(screen.getByText("@legacy")).toBeInTheDocument();
    expect(screen.getByText("@current")).toBeInTheDocument();
    expect(screen.getByText("Self-reported")).toBeInTheDocument();
    expect(screen.getByText("Sync failed")).toBeInTheDocument();
    expect(screen.getByText(/@old/)).toBeInTheDocument();
    expect(screen.queryByText("Ownership verified")).not.toBeInTheDocument();
  });
});
