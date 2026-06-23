import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({ count: 0 as number | undefined }));
vi.mock("@/lib/queries/kocmax", () => ({ useUnreadCount: () => ({ data: h.count }) }));

import { NotificationBadge } from "./NotificationBadge";

describe("NotificationBadge", () => {
  it("renders nothing at zero", () => {
    h.count = 0;
    const { container } = render(<NotificationBadge />);
    expect(container.textContent).toBe("");
  });
  it("renders the count", () => {
    h.count = 3;
    render(<NotificationBadge />);
    expect(screen.getByText("3")).toBeInTheDocument();
  });
  it("caps at 9+", () => {
    h.count = 42;
    render(<NotificationBadge />);
    expect(screen.getByText("9+")).toBeInTheDocument();
  });
});
