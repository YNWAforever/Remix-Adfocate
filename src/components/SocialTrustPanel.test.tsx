import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SocialTrustPanel } from "./SocialTrustPanel";

const hoisted = vi.hoisted(() => ({
  accounts: [
    {
      id: "acc-1",
      platform: "instagram",
      handle: "ming",
      owner_verified: false,
      sync_status: "synced",
      follower_count: 12000,
      engagement_rate: 4.5,
      avg_likes: 500,
      avg_comments: 40,
      api_synced_at: "2026-06-17T00:00:00.000Z",
      external_avatar_url: "https://cdn.example.com/avatar.jpg",
    },
  ],
  add: vi.fn(),
  scan: vi.fn(),
  avatar: vi.fn(),
}));

vi.mock("@/lib/queries/kocmax", () => ({
  useSocialAccounts: () => ({ data: hoisted.accounts, isLoading: false, isError: false }),
  useAddSocialAccount: () => ({ mutateAsync: hoisted.add, isPending: false }),
  useScanSocialAccount: () => ({ mutateAsync: hoisted.scan, isPending: false }),
  useUseSocialAvatar: () => ({ mutateAsync: hoisted.avatar, isPending: false }),
}));

describe("SocialTrustPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.add.mockResolvedValue({});
    hoisted.scan.mockResolvedValue({});
    hoisted.avatar.mockResolvedValue({});
  });

  it("shows synced metrics with required trust labels", () => {
    render(<SocialTrustPanel />);
    expect(screen.getByText("Instagram")).toBeInTheDocument();
    expect(screen.getByText("@ming")).toBeInTheDocument();
    expect(screen.getByText("12,000")).toBeInTheDocument();
    expect(screen.getByText("API-synced")).toBeInTheDocument();
    expect(screen.getByText("Ownership not verified")).toBeInTheDocument();
    expect(screen.getByText("4.5%")).toBeInTheDocument();
  });

  it("adds a Threads handle and scans an account", async () => {
    render(<SocialTrustPanel />);
    fireEvent.change(screen.getByLabelText("Threads handle"), { target: { value: "@threadming" } });
    fireEvent.click(screen.getByText("Save Threads"));
    await waitFor(() => expect(hoisted.add).toHaveBeenCalledWith({ platform: "threads", handle: "@threadming" }));

    fireEvent.click(screen.getByText("Refresh Instagram"));
    await waitFor(() => expect(hoisted.scan).toHaveBeenCalledWith("acc-1"));
  });

  it("uses the scanned avatar only after explicit selection", async () => {
    render(<SocialTrustPanel />);
    fireEvent.click(screen.getByText("Use as Adfocate avatar"));
    await waitFor(() => expect(hoisted.avatar).toHaveBeenCalledWith("acc-1"));
  });
});
