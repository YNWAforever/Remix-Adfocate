import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }));
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    Link: ({ to, children, ...rest }: { to: string; children?: React.ReactNode } & Record<string, unknown>) => (
      <a href={to} {...rest}>
        {children}
      </a>
    ),
  };
});

const hoisted = vi.hoisted(() => ({
  update: vi.fn(),
  signOut: vi.fn(),
  me: {
    data: {
      id: "u1",
      display_name: "阿明",
      level: "L1",
      level_seen: "L1",
      xp: 600,
      categories: ["美容", "科技"],
      social_handles: [{ platform: "Instagram", handle: "@ming", followers: 500, verified: true }],
      onboarding_step: 5,
      onboarding_completed: true,
      referral_code: "ABCD1234",
    },
    isLoading: false,
    isError: false,
  },
}));
vi.mock("@/lib/queries/kocmax", () => ({
  useMe: () => hoisted.me,
  useUpdateProfile: () => ({ mutateAsync: hoisted.update, isPending: false }),
  useSocialAccounts: () => ({ data: [], isLoading: false, isError: false }),
  useAddSocialAccount: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useScanSocialAccount: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUseSocialAvatar: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useProfileMedia: () => ({
    data: {
      avatarUrl: null,
      portfolioLinks: [],
      publicHighlights: [],
      published: { avatarUrl: null, highlights: [], publishedAt: null },
      completeness: { score: 0, items: [] },
    },
    isLoading: false,
    isError: false,
  }),
  useCreateAvatarUpload: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSelectUploadedAvatar: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCreatePortfolioLink: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdatePortfolioLink: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeletePortfolioLink: () => ({ mutateAsync: vi.fn(), isPending: false }),
  usePublishProfileMedia: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/supabase", () => ({ supabase: { auth: { signOut: hoisted.signOut } } }));

import { Route } from "./_app.profile";

function renderProfile() {
  const C = Route.options.component as React.ComponentType;
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <C />
    </QueryClientProvider>,
  );
}

describe("Profile page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.update.mockResolvedValue({});
    hoisted.signOut.mockResolvedValue({ error: null });
  });

  it("renders name, level, categories and referral code", () => {
    renderProfile();
    expect(screen.getByText("阿明")).toBeInTheDocument();
    expect(screen.getByText("Explorer")).toBeInTheDocument();
    expect(screen.getByText(/看護照/).closest("a")).toHaveAttribute("href", "/passport");
    expect(screen.getByText("美容")).toBeInTheDocument();
    expect(screen.getByText("Social trust")).toBeInTheDocument();
    expect(screen.getByText("ABCD1234")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "創作者媒體" })).toBeInTheDocument();
  });

  it("reveals edit inputs when 編輯 is tapped", () => {
    renderProfile();
    fireEvent.click(screen.getByText("編輯"));
    expect(screen.getByLabelText("顯示名稱")).toBeInTheDocument();
    expect(screen.getByLabelText("Instagram 帳號")).toBeInTheDocument();
  });

  it("saves edited values via useUpdateProfile (handles preserved on edit)", async () => {
    renderProfile();
    fireEvent.click(screen.getByText("編輯"));
    fireEvent.change(screen.getByLabelText("顯示名稱"), { target: { value: "新名稱" } });
    fireEvent.click(screen.getByText("儲存"));
    await waitFor(() =>
      expect(hoisted.update).toHaveBeenCalledWith({
        display_name: "新名稱",
        categories: ["美容", "科技"],
        social_handles: [{ platform: "Instagram", handle: "@ming", followers: 500, verified: true }],
      }),
    );
  });

  it("links to the creator passport via the level chip", () => {
    renderProfile();
    expect(screen.getByText(/看護照/).closest("a")).toHaveAttribute("href", "/passport");
  });

  it("signs out and redirects to /login", async () => {
    renderProfile();
    fireEvent.click(screen.getByText("登出"));
    await waitFor(() => expect(hoisted.signOut).toHaveBeenCalled());
    expect(mockNavigate).toHaveBeenCalledWith({ to: "/login" });
  });

  it("shows an error and stays in edit mode when save fails", async () => {
    hoisted.update.mockRejectedValueOnce(new Error("network"));
    renderProfile();
    fireEvent.click(screen.getByText("編輯"));
    fireEvent.click(screen.getByText("儲存"));
    expect(await screen.findByText("儲存失敗，請重試")).toBeInTheDocument();
    // still in edit mode → the display-name input is still present
    expect(screen.getByLabelText("顯示名稱")).toBeInTheDocument();
  });
});
