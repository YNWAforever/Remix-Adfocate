import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

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
import { I18nProvider } from "@/lib/i18n";
import { Route } from "./_app.auth.callback";

vi.spyOn(Route, "useParams").mockReturnValue({ slug: "demo" } as never);

function renderCallback() {
  const Callback = Route.options.component as React.ComponentType;
  return render(<Callback />);
}

function renderHydratedCallback() {
  const Callback = Route.options.component as React.ComponentType;
  return render(
    <I18nProvider>
      <Callback />
    </I18nProvider>,
  );
}

describe("Auth callback (PKCE landing)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
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

  it("exchanges and completes exactly once when the stored locale hydrates", async () => {
    window.localStorage.setItem("lang", "en");
    mockFinishAuth.mockResolvedValue({ created: true, onboardingCompleted: false, destination: "/onboarding" });
    renderHydratedCallback();

    await waitFor(() => expect(trackActivationEvent).toHaveBeenCalledWith("signup_completed", {
      locale: "en",
      deviceCategory: "desktop",
      method: "email_magic_link",
    }));
    expect(supabase.auth.exchangeCodeForSession).toHaveBeenCalledTimes(1);
    expect(mockFinishAuth).toHaveBeenCalledTimes(1);
    expect(trackActivationEvent.mock.calls.filter(([name]) => name === "signup_completed"))
      .toHaveLength(1);
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

  it("shows the same expired-link recovery when Auth returns an error fragment", async () => {
    window.history.replaceState({}, "", "/auth/callback#error=access_denied&error_code=otp_expired");
    renderCallback();
    expect(await screen.findByRole("alert")).toHaveTextContent(dict.zh["app.auth.feedback.expired.title"]);
    expect(supabase.auth.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(mockFinishAuth).not.toHaveBeenCalled();
  });

  it("shows the recovery state when the exchange fails", async () => {
    vi.mocked(supabase.auth.exchangeCodeForSession).mockResolvedValue({ data: {}, error: { message: "bad code" } } as never);
    renderCallback();
    await waitFor(() => expect(screen.getByText(/登入未能完成/)).toBeInTheDocument());
    expect(document.body).not.toHaveTextContent("bad code");
    expect(mockFinishAuth).not.toHaveBeenCalled();
  });

  it("retries a rate-limited exchange and completes after the retry succeeds", async () => {
    vi.mocked(supabase.auth.exchangeCodeForSession)
      .mockResolvedValueOnce({ data: {}, error: { message: "rate limited", status: 429 } } as never)
      .mockResolvedValueOnce({
        data: { session: { user: { app_metadata: { provider: "email" } } } },
        error: null,
      } as never);
    renderCallback();

    fireEvent.click(await screen.findByRole("button", {
      name: dict.zh["app.auth.action.retry"],
    }));

    await waitFor(() => expect(supabase.auth.exchangeCodeForSession).toHaveBeenCalledTimes(2));
    expect(mockFinishAuth).toHaveBeenCalledTimes(1);
  });

  it("retries bootstrap without replaying a successful one-time exchange", async () => {
    mockFinishAuth
      .mockRejectedValueOnce({ message: "bootstrap rate limited", status: 429 })
      .mockResolvedValueOnce({
        created: false,
        onboardingCompleted: false,
        destination: "/onboarding",
      });
    renderCallback();

    const retry = await screen.findByRole("button", {
      name: dict.zh["app.auth.action.retry"],
    });
    expect(supabase.auth.exchangeCodeForSession).toHaveBeenCalledTimes(1);
    expect(mockFinishAuth).toHaveBeenCalledTimes(1);

    fireEvent.click(retry);

    await waitFor(() => expect(mockFinishAuth).toHaveBeenCalledTimes(2));
    expect(supabase.auth.exchangeCodeForSession).toHaveBeenCalledTimes(1);
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
