import { describe, it, expect, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  createShare: vi.fn().mockResolvedValue({ token: "token", publicUrl: "/passport/token" }),
  revokeShare: vi.fn().mockResolvedValue({ revoked: true }),
  refetch: vi.fn(),
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
  useMyPassport: () => ({ ...hoisted.passport, refetch: hoisted.refetch }),
  useCreatePassportShare: () => ({ mutateAsync: hoisted.createShare }),
  useRevokePassportShare: () => ({ mutateAsync: hoisted.revokeShare }),
}));

import { Route } from "./_app.passport";

function renderPassport() {
  const C = Route.options.component as React.ComponentType;
  return render(<C />);
}

describe("Passport page", () => {
  beforeEach(() => { vi.clearAllMocks(); hoisted.passport.isError = false; });
  it("keeps saved scores and offers retry when a refetch fails", () => {
    hoisted.passport.isError = true; renderPassport();
    expect(screen.getByText("50")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重試" }));
    expect(hoisted.refetch).toHaveBeenCalledTimes(1);
  });
  it("shows a recoverable create-link failure", async () => {
    hoisted.createShare.mockRejectedValueOnce(new Error("private storage error")); renderPassport();
    fireEvent.click(screen.getByRole("button", { name: "建立連結" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("儲存失敗，請重試");
    expect(screen.queryByText("private storage error")).not.toBeInTheDocument();
  });
  it("keeps the existing link visible if revoke fails", async () => {
    hoisted.revokeShare.mockRejectedValueOnce(new Error("outage")); renderPassport();
    fireEvent.click(screen.getByRole("button", { name: "建立連結" }));
    await screen.findByText("/passport/token");
    fireEvent.click(screen.getByRole("button", { name: "撤銷連結" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("儲存失敗，請重試");
    expect(screen.getByText("/passport/token")).toBeInTheDocument();
  });
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

  it("shows the provisional notes on influence ownership and proxy scores", () => {
    renderPassport();
    expect(screen.getByText("品牌安全為暫定代理指標")).toBeInTheDocument();
    expect(screen.getByText("影響力包含自填或 API 同步數據，擁有權狀態請參閱各帳戶")).toBeInTheDocument();
  });

  it("renders earned badge labels", () => {
    renderPassport();
    expect(screen.getByText("升級者")).toBeInTheDocument();
    expect(screen.getByText("內容達人")).toBeInTheDocument();
  });

  it("renders the identity hero with name and level progress", () => {
    renderPassport();
    expect(screen.getByRole("heading", { name: "阿明" })).toBeInTheDocument();
    expect(screen.getByText("KOC 新手")).toBeInTheDocument();
    expect(screen.getByText("還需 1400 XP 升至 信譽 KOC")).toBeInTheDocument();
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

    fireEvent.click(screen.getByRole("button", { name: "建立連結" }));

    await waitFor(() => expect(hoisted.createShare).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("/passport/token")).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith("/passport/token");

    fireEvent.click(screen.getByRole("button", { name: "撤銷連結" }));

    await waitFor(() => expect(hoisted.revokeShare).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByText("/passport/token")).not.toBeInTheDocument());
  });
});
