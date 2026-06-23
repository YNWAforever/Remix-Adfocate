import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, Link: ({ to, children, ...rest }: { to: string; children?: React.ReactNode } & Record<string, unknown>) => (<a href={to} {...rest}>{children}</a>) };
});

const h = vi.hoisted(() => ({
  list: { data: { items: [] as unknown[], unread_count: 0 }, isLoading: false, isError: false },
}));
vi.mock("@/lib/queries/kocmax", () => ({
  useNotifications: () => h.list,
  useMarkRead: () => ({ mutate: vi.fn() }),
  useMarkAllRead: () => ({ mutate: vi.fn() }),
}));

import { Route } from "./_app.notifications";

function renderPage() {
  const C = Route.options.component as React.ComponentType;
  return render(<C />);
}

const item = (over: Record<string, unknown> = {}) => ({
  id: "n1", type: "submission_approved", data: { mission_title: "夏日開箱", mission_slug: "summer", points: 200, xp: 100 },
  entity_type: null, entity_id: null, read_at: null, created_at: "2026-06-23T00:00:00Z", ...over,
});

beforeEach(() => { h.list = { data: { items: [], unread_count: 0 }, isLoading: false, isError: false }; });

describe("Notifications page", () => {
  it("renders the heading", () => {
    renderPage();
    expect(screen.getByText("通知")).toBeInTheDocument();
  });
  it("renders the empty state", () => {
    renderPage();
    expect(screen.getByText("暫時未有通知。")).toBeInTheDocument();
  });
  it("renders a notification's rendered title + body", () => {
    h.list = { data: { items: [item()], unread_count: 1 }, isLoading: false, isError: false };
    renderPage();
    expect(screen.getByText("內容已通過！")).toBeInTheDocument();
    expect(screen.getByText(/夏日開箱/)).toBeInTheDocument();
  });
});
