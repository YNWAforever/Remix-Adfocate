import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const { mockNavigate, trackActivationEvent } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  trackActivationEvent: vi.fn(),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, useNavigate: () => mockNavigate, Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a> };
});

vi.mock("@/lib/activationAnalytics", () => ({
  getDeviceCategory: () => "desktop",
  trackActivationEvent,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { auth: { exchangeCodeForSession: vi.fn() } },
}));
const { mockFinishAuth } = vi.hoisted(() => ({ mockFinishAuth: vi.fn() }));
vi.mock("@/lib/auth-flow", () => ({ finishAuth: mockFinishAuth }));

import { supabase } from "@/lib/supabase";
import { dict } from "@/lib/i18n.dict";
import { Route } from "./_app.auth.callback";

vi.spyOn(Route, "useParams").mockReturnValue({ slug: "demo" } as never);

function renderCallback() {
  const Callback = Route.options.component as React.ComponentType;
  return render(<Callback />);
}

describe("Auth callback (PKCE landing)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, "", "/kocmax/demo/auth/callback?code=abc123");
    vi.mocked(supabase.auth.exchangeCodeForSession).mockResolvedValue({
      data: { session: { user: { app_metadata: { provider: "email" } } } },
      error: null,
    } as never);
    mockFinishAuth.mockResolvedValue({ created: false, onboardingCompleted: false, destination: "/onboarding" });
  });

  it("exchanges the code then delegates to finishAuth", async () => {
    renderCallback();
    await waitFor(() => expect(supabase.auth.exchangeCodeForSession).toHaveBeenCalledWith("abc123"));
    expect(mockFinishAuth).toHaveBeenCalledWith(mockNavigate);
    expect(trackActivationEvent).not.toHaveBeenCalledWith("signup_completed", expect.anything());
  });

  it("emits signup_completed only when bootstrap created a creator", async () => {
    mockFinishAuth.mockResolvedValue({ created: true, onboardingCompleted: false, destination: "/onboarding" });
    renderCallback();

    await waitFor(() => expect(trackActivationEvent).toHaveBeenCalledWith("signup_completed", {
      locale: "zh",
      deviceCategory: "desktop",
      method: "email_magic_link",
    }));
  });

  it("shows the recovery state when no code is present", async () => {
    window.history.replaceState({}, "", "/kocmax/demo/auth/callback");
    renderCallback();
    await waitFor(() => expect(screen.getByText(/登入未能完成/)).toBeInTheDocument());
    expect(supabase.auth.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(mockFinishAuth).not.toHaveBeenCalled();
  });

  it("classifies an expired callback and offers a new link", async () => {
    window.history.replaceState({}, "", "/kocmax/demo/auth/callback?error=access_denied&error_code=otp_expired");
    renderCallback();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(dict.zh["app.auth.feedback.expired.title"]);
    expect(screen.getByRole("link", { name: dict.zh["app.auth.action.requestNewLink"] }))
      .toHaveAttribute("href", "/login");
  });

  it("classifies an access-denied callback as an already-used link", async () => {
    window.history.replaceState({}, "", "/kocmax/demo/auth/callback?error=access_denied&error_description=link+already+used");
    renderCallback();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      dict.zh["app.auth.feedback.alreadyUsed.title"],
    );
  });

  it("shows the recovery state when the exchange fails", async () => {
    vi.mocked(supabase.auth.exchangeCodeForSession).mockResolvedValue({ data: {}, error: { message: "bad code" } } as never);
    renderCallback();
    await waitFor(() => expect(screen.getByText(/登入未能完成/)).toBeInTheDocument());
    expect(document.body).not.toHaveTextContent("bad code");
    expect(mockFinishAuth).not.toHaveBeenCalled();
  });

  it("shows the recovery state when finishAuth throws", async () => {
    mockFinishAuth.mockRejectedValue(new Error("bootstrap private detail"));
    renderCallback();
    await waitFor(() => expect(screen.getByText(/登入未能完成/)).toBeInTheDocument());
    expect(document.body).not.toHaveTextContent("bootstrap private detail");
    expect(trackActivationEvent).not.toHaveBeenCalledWith("signup_completed", expect.anything());
  });

  it("preserves the strict admin redirect without creator bootstrap", async () => {
    window.history.replaceState({}, "", "/kocmax/demo/auth/callback?code=abc123&next=/admin/review");
    renderCallback();

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith({ to: "/admin/review" }));
    expect(mockFinishAuth).not.toHaveBeenCalled();
    expect(trackActivationEvent).not.toHaveBeenCalled();
  });
});
