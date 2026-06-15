import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const hoisted = vi.hoisted(() => ({
  gen: { mutateAsync: vi.fn(), isPending: false, isError: false, data: undefined as unknown },
  me: { data: { social_handles: [{ platform: "tiktok", handle: "@x" }] } as unknown },
}));
vi.mock("@/lib/queries/kocmax", () => ({
  useGenerateHooks: () => hoisted.gen,
  useMe: () => hoisted.me,
}));

import { HookPanel, normalizePlatform } from "./HookPanel";

describe("normalizePlatform", () => {
  it("maps known platform strings, defaulting to instagram", () => {
    expect(normalizePlatform("小紅書")).toBe("xiaohongshu");
    expect(normalizePlatform("TikTok")).toBe("tiktok");
    expect(normalizePlatform("YouTube")).toBe("youtube");
    expect(normalizePlatform("instagram")).toBe("instagram");
    expect(normalizePlatform(undefined)).toBe("instagram");
  });
});

describe("HookPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.gen.isPending = false; hoisted.gen.isError = false; hoisted.gen.data = undefined;
    hoisted.me.data = { social_handles: [{ platform: "tiktok", handle: "@x" }] };
    hoisted.gen.mutateAsync.mockResolvedValue(undefined);
  });

  it("defaults the platform to the creator's primary handle", () => {
    render(<HookPanel missionSlug="m1" />);
    expect(screen.getByRole("button", { name: "TikTok" })).toHaveAttribute("aria-pressed", "true");
  });

  it("generates hooks with the selected platform", async () => {
    render(<HookPanel missionSlug="m1" />);
    fireEvent.click(screen.getByText("生成"));
    await waitFor(() => expect(hoisted.gen.mutateAsync).toHaveBeenCalledWith({ mission_slug: "m1", platform: "tiktok" }));
  });

  it("renders 5 hooks with angle pills, source badge, and copy buttons", () => {
    hoisted.gen.data = { source: "template", hooks: [
      { angle: "問題式", text: "h1" }, { angle: "好奇式", text: "h2" }, { angle: "優惠式", text: "h3" },
      { angle: "體驗式", text: "h4" }, { angle: "對比式", text: "h5" },
    ] };
    render(<HookPanel missionSlug="m1" />);
    expect(screen.getByText("範本")).toBeInTheDocument();
    expect(screen.getByText("h1")).toBeInTheDocument();
    expect(screen.getAllByLabelText("複製")).toHaveLength(5);
  });

  it("shows an error message on failure", () => {
    hoisted.gen.isError = true;
    render(<HookPanel missionSlug="m1" />);
    expect(screen.getByText("生成失敗，請重試")).toBeInTheDocument();
  });
});
