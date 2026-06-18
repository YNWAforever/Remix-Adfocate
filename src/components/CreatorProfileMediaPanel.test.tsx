import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CreatorProfileMedia } from "@/lib/queries/kocmax";

const hoisted = vi.hoisted(() => ({
  defaultProfileMedia: (): CreatorProfileMedia => ({
    avatarUrl: null,
    portfolioLinks: [
      {
        id: "link-1",
        creatorId: "creator-1",
        workspaceId: "workspace-1",
        url: "https://example.com/public",
        title: "Launch reel",
        platformType: "instagram",
        caption: "Launch caption",
        sortOrder: 1,
        publicHighlight: true,
        createdAt: "2026-06-18T00:00:00.000Z",
        updatedAt: "2026-06-18T00:00:00.000Z",
      },
    ],
    publicHighlights: [
      {
        url: "https://example.com/public",
        title: "Launch reel",
        platform_type: "instagram",
        caption: "Launch caption",
        sort_order: 1,
      },
    ],
    published: { avatarUrl: null, highlights: [], publishedAt: null },
    completeness: {
      score: 57,
      items: [{ key: "portfolio", label: "Portfolio link added", complete: true }],
    },
  }),
  profileMedia: {
    data: null as CreatorProfileMedia | null,
    isLoading: false,
    isError: false,
  },
  createUpload: vi.fn(),
  selectAvatar: vi.fn(),
  createLink: vi.fn(),
  updateLink: vi.fn(),
  deleteLink: vi.fn(),
  publish: vi.fn(),
  upload: vi.fn(),
}));

vi.mock("@/lib/queries/kocmax", () => ({
  useProfileMedia: () => hoisted.profileMedia,
  useCreateAvatarUpload: () => ({ mutateAsync: hoisted.createUpload, isPending: false }),
  useSelectUploadedAvatar: () => ({ mutateAsync: hoisted.selectAvatar, isPending: false }),
  useCreatePortfolioLink: () => ({ mutateAsync: hoisted.createLink, isPending: false }),
  useUpdatePortfolioLink: () => ({ mutateAsync: hoisted.updateLink, isPending: false }),
  useDeletePortfolioLink: () => ({ mutateAsync: hoisted.deleteLink, isPending: false }),
  usePublishProfileMedia: () => ({ mutateAsync: hoisted.publish, isPending: false }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    storage: {
      from: () => ({ upload: hoisted.upload }),
    },
  },
}));

import { CreatorProfileMediaPanel } from "./CreatorProfileMediaPanel";

function renderPanel() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <CreatorProfileMediaPanel />
    </QueryClientProvider>,
  );
}

describe("CreatorProfileMediaPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.profileMedia.data = hoisted.defaultProfileMedia();
    hoisted.createUpload.mockResolvedValue({
      bucket: "creator-avatars",
      path: "creator-1/avatar.png",
      publicUrl: "https://cdn.example.com/avatar.png",
      contentType: "image/png",
      maxSizeBytes: 5_242_880,
    });
    hoisted.upload.mockResolvedValue({ error: null });
    hoisted.selectAvatar.mockResolvedValue({ avatarUrl: "https://cdn.example.com/avatar.png" });
    hoisted.createLink.mockResolvedValue({});
    hoisted.updateLink.mockResolvedValue({});
    hoisted.deleteLink.mockResolvedValue({});
    hoisted.publish.mockResolvedValue({});
  });

  it("renders completeness, portfolio links, and publish action", () => {
    renderPanel();
    expect(screen.getByRole("heading", { name: "創作者媒體" })).toBeInTheDocument();
    expect(screen.getByText("57%")).toBeInTheDocument();
    expect(screen.getByText("Launch reel")).toBeInTheDocument();
    expect(screen.getByLabelText("發佈到公開護照")).toBeInTheDocument();
  });

  it("creates a portfolio link", async () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText("作品標題"), { target: { value: "New work" } });
    fireEvent.change(screen.getByLabelText("作品連結"), { target: { value: "https://example.com/new" } });
    fireEvent.change(screen.getByLabelText("作品類型"), { target: { value: "website" } });
    fireEvent.click(screen.getByLabelText("新增作品"));

    await waitFor(() =>
      expect(hoisted.createLink).toHaveBeenCalledWith({
        title: "New work",
        url: "https://example.com/new",
        platform_type: "website",
        caption: "",
        public_highlight: false,
      }),
    );
  });

  it("uploads and selects an avatar", async () => {
    renderPanel();
    const file = new File(["avatar"], "avatar.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("上載頭像"), { target: { files: [file] } });

    await waitFor(() =>
      expect(hoisted.createUpload).toHaveBeenCalledWith({
        fileName: "avatar.png",
        contentType: "image/png",
        sizeBytes: file.size,
      }),
    );
    expect(hoisted.upload).toHaveBeenCalledWith("creator-1/avatar.png", file, {
      contentType: "image/png",
      upsert: false,
    });
    expect(hoisted.selectAvatar).toHaveBeenCalledWith("creator-1/avatar.png");
  });

  it("toggles a public highlight and publishes", async () => {
    renderPanel();
    const toggle = screen.getByLabelText("切換公開精選 Launch reel");
    expect(toggle).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(toggle);
    await waitFor(() =>
      expect(hoisted.updateLink).toHaveBeenCalledWith({
        id: "link-1",
        patch: { public_highlight: false },
      }),
    );

    fireEvent.click(screen.getByLabelText("發佈到公開護照"));
    await waitFor(() => expect(hoisted.publish).toHaveBeenCalled());
  });

  it("edits an existing portfolio link", async () => {
    renderPanel();

    fireEvent.click(screen.getByLabelText("編輯作品 Launch reel"));
    fireEvent.change(screen.getByLabelText("編輯作品標題 Launch reel"), { target: { value: "Updated reel" } });
    fireEvent.change(screen.getByLabelText("編輯作品連結 Launch reel"), { target: { value: "https://example.com/updated" } });
    fireEvent.change(screen.getByLabelText("編輯作品類型 Launch reel"), { target: { value: "youtube" } });
    fireEvent.change(screen.getByLabelText("編輯作品說明 Launch reel"), { target: { value: "Updated caption" } });
    fireEvent.change(screen.getByLabelText("編輯排序 Launch reel"), { target: { value: "4" } });
    fireEvent.click(screen.getByLabelText("儲存作品 Launch reel"));

    await waitFor(() =>
      expect(hoisted.updateLink).toHaveBeenCalledWith({
        id: "link-1",
        patch: {
          title: "Updated reel",
          url: "https://example.com/updated",
          platform_type: "youtube",
          caption: "Updated caption",
          sort_order: 4,
        },
      }),
    );
  });

  it("guards the 3-highlight cap against fast repeated enable clicks", async () => {
    let resolveUpdate: (() => void) | null = null;
    hoisted.updateLink.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUpdate = () => resolve({});
        }),
    );
    hoisted.profileMedia.data = {
      ...hoisted.defaultProfileMedia(),
      portfolioLinks: [
        {
          id: "link-1",
          creatorId: "creator-1",
          workspaceId: "workspace-1",
          url: "https://example.com/highlight-1",
          title: "Highlight one",
          platformType: "instagram",
          caption: null,
          sortOrder: 1,
          publicHighlight: true,
          createdAt: "2026-06-18T00:00:00.000Z",
          updatedAt: "2026-06-18T00:00:00.000Z",
        },
        {
          id: "link-2",
          creatorId: "creator-1",
          workspaceId: "workspace-1",
          url: "https://example.com/highlight-2",
          title: "Highlight two",
          platformType: "threads",
          caption: null,
          sortOrder: 2,
          publicHighlight: true,
          createdAt: "2026-06-18T00:00:00.000Z",
          updatedAt: "2026-06-18T00:00:00.000Z",
        },
        {
          id: "link-3",
          creatorId: "creator-1",
          workspaceId: "workspace-1",
          url: "https://example.com/candidate-1",
          title: "Candidate one",
          platformType: "website",
          caption: null,
          sortOrder: 3,
          publicHighlight: false,
          createdAt: "2026-06-18T00:00:00.000Z",
          updatedAt: "2026-06-18T00:00:00.000Z",
        },
        {
          id: "link-4",
          creatorId: "creator-1",
          workspaceId: "workspace-1",
          url: "https://example.com/candidate-2",
          title: "Candidate two",
          platformType: "website",
          caption: null,
          sortOrder: 4,
          publicHighlight: false,
          createdAt: "2026-06-18T00:00:00.000Z",
          updatedAt: "2026-06-18T00:00:00.000Z",
        },
      ],
      publicHighlights: [],
    } satisfies CreatorProfileMedia;

    renderPanel();

    const firstEnable = screen.getByLabelText("切換公開精選 Candidate one");
    const secondEnable = screen.getByLabelText("切換公開精選 Candidate two");
    expect(firstEnable).toHaveAttribute("aria-pressed", "false");
    expect(secondEnable).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(firstEnable);
    fireEvent.click(secondEnable);

    await waitFor(() =>
      expect(hoisted.updateLink).toHaveBeenCalledWith({
        id: "link-3",
        patch: { public_highlight: true },
      }),
    );
    expect(hoisted.updateLink).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveUpdate?.();
    });
  });

  it("deletes an existing portfolio link", async () => {
    renderPanel();

    fireEvent.click(screen.getByLabelText("刪除作品 Launch reel"));

    await waitFor(() => expect(hoisted.deleteLink).toHaveBeenCalledWith("link-1"));
  });
});
