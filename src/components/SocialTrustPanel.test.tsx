import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n";
import { SocialTrustPanel } from "./SocialTrustPanel";

function renderEn(ui: React.ReactElement) {
  window.localStorage.setItem("lang", "en");
  return render(<I18nProvider>{ui}</I18nProvider>);
}

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
  issue: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock("@/lib/queries/kocmax", () => ({
  useSocialAccounts: () => ({ data: hoisted.accounts, isLoading: false, isError: false }),
  useAddSocialAccount: () => ({ mutateAsync: hoisted.add, isPending: false }),
  useScanSocialAccount: () => ({ mutateAsync: hoisted.scan, isPending: false }),
  useUseSocialAvatar: () => ({ mutateAsync: hoisted.avatar, isPending: false }),
  useIssueVerification: () => ({ mutateAsync: hoisted.issue, isPending: false }),
  useConfirmVerification: () => ({ mutateAsync: hoisted.confirm, isPending: false }),
}));

describe("SocialTrustPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.add.mockResolvedValue({});
    hoisted.scan.mockResolvedValue({});
    hoisted.avatar.mockResolvedValue({});
    hoisted.issue.mockResolvedValue({ code: "ADFO-1234", expiresAt: "2026-06-22T00:00:00.000Z" });
    hoisted.confirm.mockResolvedValue({ account: { ...hoisted.accounts[0], owner_verified: true } });
  });

  it("shows synced metrics with a verify button when unverified", () => {
    renderEn(<SocialTrustPanel />);
    expect(screen.getByText("Instagram")).toBeInTheDocument();
    expect(screen.getByText("@ming")).toBeInTheDocument();
    expect(screen.getByText("12,000")).toBeInTheDocument();
    expect(screen.getByText("API-synced")).toBeInTheDocument();
    expect(screen.getByText("4.5%")).toBeInTheDocument();
    // Verify CTA present (unverified, no code yet)
    expect(screen.getByText("Verify ownership")).toBeInTheDocument();
  });

  it("shows the bio code after tapping verify ownership", async () => {
    renderEn(<SocialTrustPanel />);
    fireEvent.click(screen.getByText("Verify ownership"));
    await waitFor(() => expect(hoisted.issue).toHaveBeenCalledWith("acc-1"));
    expect(screen.getByText("ADFO-1234")).toBeInTheDocument();
    expect(screen.getByText("Verify now")).toBeInTheDocument();
    expect(screen.getByText("Get a new code")).toBeInTheDocument();
  });

  it("clears the code after successful confirm", async () => {
    renderEn(<SocialTrustPanel />);
    fireEvent.click(screen.getByText("Verify ownership"));
    await waitFor(() => screen.getByText("Verify now"));
    fireEvent.click(screen.getByText("Verify now"));
    await waitFor(() => expect(hoisted.confirm).toHaveBeenCalledWith("acc-1"));
    // Code display disappears after success
    expect(screen.queryByText("ADFO-1234")).not.toBeInTheDocument();
  });

  it("shows per-error copy on confirm failure", async () => {
    hoisted.confirm.mockRejectedValueOnce(Object.assign(new Error("not found"), { code: "code_not_in_bio" }));
    renderEn(<SocialTrustPanel />);
    fireEvent.click(screen.getByText("Verify ownership"));
    await waitFor(() => screen.getByText("Verify now"));
    fireEvent.click(screen.getByText("Verify now"));
    await waitFor(() =>
      expect(screen.getByText("We couldn't find the code in your bio yet. Save your bio and try again.")).toBeInTheDocument(),
    );
  });

  it("shows verified badge when owner_verified is true", () => {
    hoisted.accounts[0].owner_verified = true;
    renderEn(<SocialTrustPanel />);
    expect(screen.getByText(/Ownership verified/)).toBeInTheDocument();
    hoisted.accounts[0].owner_verified = false; // reset
  });

  it("adds a Threads handle and scans an account", async () => {
    renderEn(<SocialTrustPanel />);
    fireEvent.change(screen.getByLabelText("Threads handle"), { target: { value: "@threadming" } });
    fireEvent.click(screen.getByText("Save Threads"));
    await waitFor(() => expect(hoisted.add).toHaveBeenCalledWith({ platform: "threads", handle: "@threadming" }));

    fireEvent.click(screen.getByText("Refresh Instagram"));
    await waitFor(() => expect(hoisted.scan).toHaveBeenCalledWith("acc-1"));
  });

  it("retains a handle and offers a readable error when saving fails", async () => {
    hoisted.add.mockRejectedValueOnce(new Error("internal database details"));
    renderEn(<SocialTrustPanel />);
    fireEvent.change(screen.getByLabelText("Threads handle"), { target: { value: "@keepthis" } });
    fireEvent.click(screen.getByText("Save Threads"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Your input is kept");
    expect(screen.getByLabelText("Threads handle")).toHaveValue("@keepthis");
    expect(screen.queryByText("internal database details")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Save Threads"));
    await waitFor(() => expect(hoisted.add).toHaveBeenCalledTimes(2));
  });

  it("keeps every canonical account on a platform visible", () => {
    hoisted.accounts.push({ ...hoisted.accounts[0], id: "acc-second", handle: "second" });
    try {
      renderEn(<SocialTrustPanel />);
      expect(screen.getByText("@ming")).toBeInTheDocument();
      expect(screen.getByText("@second")).toBeInTheDocument();
    } finally { hoisted.accounts.pop(); }
  });

  it("can add a corrected handle when the platform already has an account", async () => {
    renderEn(<SocialTrustPanel />);
    fireEvent.change(screen.getByLabelText("Instagram handle"), { target: { value: "@corrected" } });
    fireEvent.click(screen.getByText("Save Instagram"));
    await waitFor(() => expect(hoisted.add).toHaveBeenCalledWith({ platform: "instagram", handle: "@corrected" }));
    expect(screen.getByText("@ming")).toBeInTheDocument();
  });

  it("uses the scanned avatar only after explicit selection", async () => {
    renderEn(<SocialTrustPanel />);
    fireEvent.click(screen.getByText("Use as Adfocate avatar"));
    await waitFor(() => expect(hoisted.avatar).toHaveBeenCalledWith("acc-1"));
  });
});
