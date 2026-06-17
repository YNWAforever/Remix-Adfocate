import { describe, it, expect } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  createShare: vi.fn().mockResolvedValue({ token: "token", publicUrl: "/passport/token" }),
  revokeShare: vi.fn().mockResolvedValue({ revoked: true }),
  me: { data: { id: "u1", display_name: "阿明", avatar_url: null } },
  passport: {
    data: {
      level: "L1",
      xp: 600,
      scores: { influence: 50, reliability: 70, content: 80, brandSafety: 90 },
      badges: ["level_l1", "content_pro"],
      socialTrust: {
        badges: ["social_scan_connected"],
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
      },
    },
    isLoading: false,
    isError: false,
  },
}));
vi.mock("@/lib/queries/kocmax", () => ({
  useMe: () => hoisted.me,
  useMyPassport: () => hoisted.passport,
  useCreatePassportShare: () => ({ mutateAsync: hoisted.createShare }),
  useRevokePassportShare: () => ({ mutateAsync: hoisted.revokeShare }),
}));

import { Route } from "./_app.passport";

function renderPassport() {
  const C = Route.options.component as React.ComponentType;
  return render(<C />);
}

describe("Passport page", () => {
  it("renders the trust summary with synced private metrics", () => {
    renderPassport();
    expect(screen.getByText("Social trust")).toBeInTheDocument();
    expect(screen.getByText("12,000 followers")).toBeInTheDocument();
    expect(screen.getByText("4.5% engagement")).toBeInTheDocument();
    expect(screen.getByText("API-synced")).toBeInTheDocument();
    expect(screen.getByText("Ownership not verified")).toBeInTheDocument();
  });

  it("renders the four score labels and their computed values", () => {
    renderPassport();
    expect(screen.getByText("影響力")).toBeInTheDocument();
    expect(screen.getByText("內容")).toBeInTheDocument();
    expect(screen.getByText("可靠度")).toBeInTheDocument();
    expect(screen.getByText("品牌安全")).toBeInTheDocument();
    expect(screen.getByText("50")).toBeInTheDocument();
    expect(screen.getByText("80")).toBeInTheDocument();
    expect(screen.getByText("90")).toBeInTheDocument();
  });

  it("shows the provisional notes on self-reported / proxy scores", () => {
    renderPassport();
    expect(screen.getByText("品牌安全為暫定代理指標")).toBeInTheDocument();
    expect(screen.getByText("影響力為自填數據，未驗證")).toBeInTheDocument();
  });

  it("renders earned badge labels", () => {
    renderPassport();
    expect(screen.getByText("升級者")).toBeInTheDocument();
    expect(screen.getByText("內容達人")).toBeInTheDocument();
  });

  it("creates and revokes a public passport link", async () => {
    hoisted.createShare.mockClear();
    hoisted.revokeShare.mockClear();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis.navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    renderPassport();

    fireEvent.click(screen.getByRole("button", { name: "Create link" }));

    await waitFor(() => expect(hoisted.createShare).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("/passport/token")).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith("/passport/token");

    fireEvent.click(screen.getByRole("button", { name: "Revoke link" }));

    await waitFor(() => expect(hoisted.revokeShare).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByText("/passport/token")).not.toBeInTheDocument());
  });
});
