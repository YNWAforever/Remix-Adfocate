import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AuthFeedback } from "./AuthFeedback";
import { classifyAuthError } from "@/lib/authFeedback";

vi.mock("@tanstack/react-router", () => ({ Link: ({ to, search, children }: { to: string; search?: Record<string,string>; children: React.ReactNode }) =>
  <a href={to + (search ? `?${new URLSearchParams(search)}` : "")}>{children}</a> }));
describe("Auth recovery return", () => {
  beforeEach(() => window.history.replaceState({}, "", "/auth/callback"));
  it("keeps a safe work destination when requesting a replacement link", () => {
    window.history.replaceState({}, "", "/auth/callback?next=%2Fprofile#error_code=otp_expired");
    render(<AuthFeedback feedback={classifyAuthError({ code: "otp_expired" })} />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/login?next=%2Fprofile");
  });
  it("does not carry an external destination into a replacement link", () => {
    window.history.replaceState({}, "", "/auth/callback?next=https%3A%2F%2Foutside.example");
    render(<AuthFeedback feedback={classifyAuthError({ code: "otp_expired" })} />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/login");
  });
});
