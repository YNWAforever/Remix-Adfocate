import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a>,
  };
});

vi.mock("@/lib/supabase", () => ({
  supabase: { auth: { exchangeCodeForSession: vi.fn(), updateUser: vi.fn() } },
}));

const { mockFinishAuth } = vi.hoisted(() => ({ mockFinishAuth: vi.fn() }));
vi.mock("@/lib/auth-flow", () => ({ finishAuth: mockFinishAuth }));

import { supabase } from "@/lib/supabase";
import { dict } from "@/lib/i18n.dict";
import { Route } from "./_app.auth.reset-password";

function renderResetPassword() {
  const ResetPassword = Route.options.component as React.ComponentType;
  return render(<ResetPassword />);
}

/** Waits for the recovery exchange to resolve into the new-password form. */
async function renderForm() {
  const utils = renderResetPassword();
  await screen.findByLabelText(dict.zh["app.resetPassword.newLabel"]);
  return utils;
}

function fill(newPassword: string, confirmation: string) {
  fireEvent.change(screen.getByLabelText(dict.zh["app.resetPassword.newLabel"]), {
    target: { value: newPassword },
  });
  fireEvent.change(screen.getByLabelText(dict.zh["app.resetPassword.confirmLabel"]), {
    target: { value: confirmation },
  });
}

function submit() {
  fireEvent.click(screen.getByRole("button", { name: dict.zh["app.resetPassword.cta"] }));
}

describe("Reset password (recovery landing)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    window.history.replaceState({}, "", "/auth/reset-password?code=recovery123");
    vi.mocked(supabase.auth.exchangeCodeForSession).mockResolvedValue({
      data: { session: { user: { app_metadata: { provider: "email" } } } },
      error: null,
    } as never);
    vi.mocked(supabase.auth.updateUser).mockResolvedValue({ data: { user: {} }, error: null } as never);
    mockFinishAuth.mockResolvedValue({ created: false, onboardingCompleted: true, destination: "/home" });
  });

  it("exchanges the recovery code once and shows the form", async () => {
    await renderForm();

    expect(supabase.auth.exchangeCodeForSession).toHaveBeenCalledTimes(1);
    expect(supabase.auth.exchangeCodeForSession).toHaveBeenCalledWith("recovery123");
    expect(screen.getByLabelText(dict.zh["app.resetPassword.confirmLabel"])).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders feedback and no form when the link carries no code", async () => {
    window.history.replaceState({}, "", "/auth/reset-password");
    renderResetPassword();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      dict.zh["app.auth.feedback.malformed.title"],
    );
    expect(supabase.auth.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(screen.queryByLabelText(dict.zh["app.resetPassword.newLabel"])).not.toBeInTheDocument();
  });

  it("classifies an expired recovery link and offers a new one", async () => {
    window.history.replaceState({}, "", "/auth/reset-password?error=access_denied&error_code=otp_expired");
    renderResetPassword();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(dict.zh["app.auth.feedback.expired.title"]);
    expect(screen.getByRole("link", { name: dict.zh["app.auth.action.requestNewLink"] }))
      .toHaveAttribute("href", "/login");
    expect(screen.queryByLabelText(dict.zh["app.resetPassword.newLabel"])).not.toBeInTheDocument();
  });

  it("renders feedback and no form when the exchange fails", async () => {
    vi.mocked(supabase.auth.exchangeCodeForSession).mockResolvedValue({
      data: {},
      error: { message: "code verifier missing" },
    } as never);
    renderResetPassword();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      dict.zh["app.auth.feedback.unknown.title"],
    );
    expect(document.body).not.toHaveTextContent("code verifier missing");
    expect(screen.queryByLabelText(dict.zh["app.resetPassword.newLabel"])).not.toBeInTheDocument();
  });

  it("rejects mismatched passwords without calling updateUser", async () => {
    await renderForm();
    fill("longenough1", "longenough2");
    submit();

    expect(await screen.findByRole("alert")).toHaveTextContent(dict.zh["app.resetPassword.mismatch"]);
    expect(supabase.auth.updateUser).not.toHaveBeenCalled();
    expect(mockFinishAuth).not.toHaveBeenCalled();
    expect(screen.getByLabelText(dict.zh["app.resetPassword.confirmLabel"]))
      .toHaveAttribute("aria-invalid", "true");
  });

  it("rejects a short password without calling updateUser", async () => {
    await renderForm();
    fill("short7", "short7");
    submit();

    expect(await screen.findByRole("alert")).toHaveTextContent(dict.zh["app.resetPassword.tooShort"]);
    expect(supabase.auth.updateUser).not.toHaveBeenCalled();
    expect(mockFinishAuth).not.toHaveBeenCalled();
    expect(screen.getByLabelText(dict.zh["app.resetPassword.newLabel"]))
      .toHaveAttribute("aria-invalid", "true");
  });

  it("saves the new password then runs the shared post-auth branch", async () => {
    await renderForm();
    fill("brand-new-pass", "brand-new-pass");
    submit();

    await waitFor(() => expect(supabase.auth.updateUser).toHaveBeenCalledWith({ password: "brand-new-pass" }));
    await waitFor(() => expect(mockFinishAuth).toHaveBeenCalledWith(mockNavigate));
    expect(await screen.findByText(dict.zh["app.resetPassword.success"])).toBeInTheDocument();
  });

  it("updates the password only once when the form is submitted twice", async () => {
    let release: (value: { data: object; error: null }) => void = () => {};
    vi.mocked(supabase.auth.updateUser).mockReturnValue(
      new Promise((resolve) => { release = resolve; }) as never,
    );
    const { container } = await renderForm();
    fill("brand-new-pass", "brand-new-pass");
    const form = container.querySelector("form");
    if (!form) throw new Error("expected the new-password form");
    // Two submits in the same tick: the disabled button has not re-rendered yet.
    fireEvent.submit(form);
    fireEvent.submit(form);

    release({ data: { user: {} }, error: null });
    await waitFor(() => expect(mockFinishAuth).toHaveBeenCalledTimes(1));
    expect(supabase.auth.updateUser).toHaveBeenCalledTimes(1);
  });

  it("classifies a weak password rejected by Supabase", async () => {
    vi.mocked(supabase.auth.updateUser).mockResolvedValue({
      data: { user: null },
      error: { code: "weak_password", message: "Password should be at least 8 characters" },
    } as never);
    await renderForm();
    fill("passwordpassword", "passwordpassword");
    submit();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      dict.zh["app.auth.feedback.weakPassword.title"],
    );
    expect(mockFinishAuth).not.toHaveBeenCalled();
    expect(screen.getByLabelText(dict.zh["app.resetPassword.newLabel"])).toBeInTheDocument();
  });

  it("surfaces a failing post-auth branch without losing the saved state", async () => {
    mockFinishAuth.mockRejectedValueOnce({ message: "bootstrap rate limited", status: 429 });
    await renderForm();
    fill("brand-new-pass", "brand-new-pass");
    submit();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(dict.zh["app.auth.feedback.rateLimited.title"]);
    expect(document.body).not.toHaveTextContent("bootstrap rate limited");

    fireEvent.click(screen.getByRole("button", { name: dict.zh["app.auth.action.retry"] }));

    await waitFor(() => expect(mockFinishAuth).toHaveBeenCalledTimes(2));
    expect(supabase.auth.updateUser).toHaveBeenCalledTimes(1);
  });
});
