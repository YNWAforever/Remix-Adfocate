import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { mockNavigate, trackActivationEvent } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  trackActivationEvent: vi.fn(),
}));
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, useNavigate: () => mockNavigate, Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a> };
});

vi.mock("@/lib/activationAnalytics", () => ({
  trackActivationEvent,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { auth: { signInWithOtp: vi.fn(), verifyOtp: vi.fn(), signInWithOAuth: vi.fn() } },
}));
const { mockFinishAuth } = vi.hoisted(() => ({ mockFinishAuth: vi.fn() }));
vi.mock("@/lib/auth-flow", () => ({ finishAuth: mockFinishAuth }));

import { supabase } from "@/lib/supabase";
import { Route } from "./_app.login";

vi.spyOn(Route, "useParams").mockReturnValue({ slug: "demo" } as never);

function renderLogin() {
  const LoginComponent = Route.options.component as React.ComponentType;
  return render(<LoginComponent />);
}

describe("Login (WhatsApp primary)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(supabase.auth.signInWithOtp).mockResolvedValue({ data: {}, error: null } as never);
    vi.mocked(supabase.auth.verifyOtp).mockResolvedValue({ data: { session: { access_token: "t" } }, error: null } as never);
    mockFinishAuth.mockResolvedValue(undefined);
  });

  it("shows the WhatsApp phone field by default", () => {
    renderLogin();
    expect(screen.getByLabelText("WhatsApp 電話號碼")).toBeInTheDocument();
  });

  it("sends a WhatsApp OTP then verifies and calls finishAuth", async () => {
    renderLogin();
    fireEvent.change(screen.getByLabelText("WhatsApp 電話號碼"), { target: { value: "91234567" } });
    fireEvent.submit(screen.getByLabelText("WhatsApp 電話號碼").closest("form")!);
    await waitFor(() =>
      expect(supabase.auth.signInWithOtp).toHaveBeenCalledWith({
        phone: "+85291234567",
        options: { channel: "whatsapp" },
      }),
    );
    fireEvent.change(await screen.findByLabelText("驗證碼"), { target: { value: "123456" } });
    fireEvent.submit(screen.getByLabelText("驗證碼").closest("form")!);
    await waitFor(() =>
      expect(supabase.auth.verifyOtp).toHaveBeenCalledWith({ phone: "+85291234567", token: "123456", type: "sms" }),
    );
    expect(mockFinishAuth).toHaveBeenCalledWith(mockNavigate);
  });

  it("shows an error when sending the OTP fails", async () => {
    vi.mocked(supabase.auth.signInWithOtp).mockResolvedValue({ data: {}, error: { message: "rate limited", status: 429 } } as never);
    renderLogin();
    fireEvent.change(screen.getByLabelText("WhatsApp 電話號碼"), { target: { value: "91234567" } });
    fireEvent.submit(screen.getByLabelText("WhatsApp 電話號碼").closest("form")!);
    const alert = await screen.findByRole("alert");
    expect(alert).not.toHaveTextContent("rate limited");
    expect(screen.queryByLabelText("驗證碼")).not.toBeInTheDocument();
  });

  it("reveals secondary methods (email magic-link + Google)", async () => {
    renderLogin();
    fireEvent.click(screen.getByText("其他登入方式"));
    expect(screen.getByLabelText("電郵地址")).toBeInTheDocument();
    expect(screen.getByText("用 Google 登入")).toBeInTheDocument();
  });

  it("sends a magic link via the secondary email form", async () => {
    renderLogin();
    fireEvent.click(screen.getByText("其他登入方式"));
    fireEvent.change(screen.getByLabelText("電郵地址"), { target: { value: "user@example.com" } });
    fireEvent.submit(screen.getByLabelText("電郵地址").closest("form")!);
    await waitFor(() =>
      expect(supabase.auth.signInWithOtp).toHaveBeenCalledWith({
        email: "user@example.com",
        options: { emailRedirectTo: expect.stringContaining("/auth/callback") },
      }),
    );
    expect(await screen.findByText(/登入連結已傳送/)).toBeInTheDocument();
  });

  it("shows visible, associated labels and help for phone, code, and email", async () => {
    renderLogin();

    const phone = screen.getByLabelText("WhatsApp 電話號碼");
    expect(screen.getByText("WhatsApp 電話號碼", { selector: "label" })).toHaveAttribute("for", "login-phone");
    expect(phone).toHaveAttribute("aria-describedby", "login-phone-help");
    expect(document.getElementById("login-phone-help")).not.toBeEmptyDOMElement();

    fireEvent.change(phone, { target: { value: "91234567" } });
    fireEvent.submit(phone.closest("form")!);
    const code = await screen.findByLabelText("驗證碼");
    expect(screen.getByText("驗證碼", { selector: "label" })).toHaveAttribute("for", "login-code");
    expect(code).toHaveAttribute("aria-describedby", "login-code-help");

    fireEvent.click(screen.getByText("其他登入方式"));
    const email = screen.getByLabelText("電郵地址");
    expect(screen.getByText("電郵地址", { selector: "label" })).toHaveAttribute("for", "login-email");
    expect(email).toHaveAttribute("aria-describedby", "login-email-help");
    expect(document.getElementById("login-email-help")).not.toBeEmptyDOMElement();
  });

  it("announces a busy email request while submission is pending", async () => {
    let resolveRequest!: (value: unknown) => void;
    vi.mocked(supabase.auth.signInWithOtp).mockReturnValueOnce(new Promise((resolve) => {
      resolveRequest = resolve;
    }) as never);
    renderLogin();
    fireEvent.click(screen.getByText("其他登入方式"));
    const email = screen.getByLabelText("電郵地址");
    fireEvent.change(email, { target: { value: "user@example.com" } });
    fireEvent.submit(email.closest("form")!);

    await waitFor(() => expect(screen.getByRole("button", { name: "傳送中…" })).toBeDisabled());
    expect(email.closest("form")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toBeInTheDocument();

    resolveRequest({ data: {}, error: null });
    await screen.findByText(/登入連結已傳送/);
  });

  it("retries a failed email request with the preserved address and PII-free analytics", async () => {
    const rawMessage = "rate limit exceeded for user@example.com";
    vi.mocked(supabase.auth.signInWithOtp).mockResolvedValueOnce({
      data: {},
      error: { code: "over_email_send_rate_limit", message: rawMessage, status: 429 },
    } as never);
    renderLogin();
    fireEvent.click(screen.getByText("其他登入方式"));
    const email = screen.getByLabelText("電郵地址");
    fireEvent.change(email, { target: { value: "user@example.com" } });
    fireEvent.submit(email.closest("form")!);

    const alert = await screen.findByRole("alert");
    expect(alert).not.toHaveTextContent(rawMessage);
    expect(email).toHaveValue("user@example.com");
    expect(trackActivationEvent).toHaveBeenCalledWith("auth_link_requested", {
      locale: "zh",
      method: "email_magic_link",
    });
    expect(trackActivationEvent).toHaveBeenCalledWith("auth_link_failed", {
      locale: "zh",
      method: "email_magic_link",
      errorCategory: "rate_limited",
    });
    expect(JSON.stringify(trackActivationEvent.mock.calls)).not.toContain("user@example.com");
    expect(JSON.stringify(trackActivationEvent.mock.calls)).not.toContain(rawMessage);

    fireEvent.click(screen.getByRole("button", { name: "重試" }));

    await waitFor(() => expect(supabase.auth.signInWithOtp).toHaveBeenCalledTimes(2));
    expect(supabase.auth.signInWithOtp).toHaveBeenLastCalledWith({
      email: "user@example.com",
      options: { emailRedirectTo: expect.stringContaining("/auth/callback") },
    });
    expect(trackActivationEvent.mock.calls.filter(([name]) => name === "auth_link_requested"))
      .toHaveLength(2);
    expect(await screen.findByText(/登入連結已傳送/)).toHaveTextContent("user@example.com");
  });
});
