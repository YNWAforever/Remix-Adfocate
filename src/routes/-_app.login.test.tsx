import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

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
  supabase: {
    auth: {
      signInWithOtp: vi.fn(),
      verifyOtp: vi.fn(),
      signInWithOAuth: vi.fn(),
      signInWithPassword: vi.fn(),
      signUp: vi.fn(),
      resetPasswordForEmail: vi.fn(),
    },
  },
}));

// The flags are read at render time, so getters let one suite exercise the shipping
// (!WHATSAPP_LOGIN) branch while another keeps the WhatsApp-primary branch.
const { flags } = vi.hoisted(() => ({ flags: { whatsapp: true, google: true } }));
vi.mock("@/lib/features", () => ({
  get WHATSAPP_LOGIN() {
    return flags.whatsapp;
  },
  get GOOGLE_LOGIN() {
    return flags.google;
  },
}));
const { mockFinishAuth } = vi.hoisted(() => ({ mockFinishAuth: vi.fn() }));
vi.mock("@/lib/auth-flow", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/auth-flow")>(), finishAuth: mockFinishAuth }));

import { supabase } from "@/lib/supabase";
import { Route } from "./_app.login";

vi.spyOn(Route, "useParams").mockReturnValue({ slug: "demo" } as never);

function renderLogin() {
  const LoginComponent = Route.options.component as React.ComponentType;
  return render(<LoginComponent />);
}

describe("D13 shared email access", () => {
  beforeEach(() => { vi.clearAllMocks(); flags.whatsapp = false; flags.google = true; });
  it("uses the Adfocate brand and one email field across methods", () => {
    renderLogin();
    expect(screen.getByRole("heading", { name: "登入 Adfocate" })).toBeInTheDocument();
    expect(screen.getAllByLabelText("電郵地址")).toHaveLength(1);
  });
  it("keeps the email while switching from password to magic link", async () => {
    vi.mocked(supabase.auth.signInWithOtp).mockResolvedValue({ data: {}, error: null } as never);
    renderLogin();
    fireEvent.change(screen.getAllByLabelText("電郵地址")[0], { target: { value: "fixture@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "選擇電郵登入連結" }));
    expect(screen.getAllByLabelText("電郵地址")).toHaveLength(1);
    expect(screen.getByLabelText("電郵地址")).toHaveValue("fixture@example.test");
    fireEvent.submit(screen.getByLabelText("電郵地址").closest("form")!);
    await waitFor(() => expect(supabase.auth.signInWithOtp).toHaveBeenCalledWith(expect.objectContaining({ email: "fixture@example.test" })));
    expect(supabase.auth.signInWithPassword).not.toHaveBeenCalled();
  });
});

describe("Login (WhatsApp primary)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    flags.whatsapp = true;
    flags.google = true;
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

  it("reveals secondary methods (password, email magic-link + Google)", async () => {
    renderLogin();
    fireEvent.click(screen.getByText("其他登入方式"));
    // Password stays reachable here too, so enabling WhatsApp never strands a creator
    // who signed up with one.
    expect(section(PASSWORD_SECTION)).toBeInTheDocument();
    expect(within(section(MAGIC_SECTION)).getByLabelText("電郵地址")).toBeInTheDocument();
    expect(screen.getByText("用 Google 登入")).toBeInTheDocument();
  });

  it("sends a magic link via the secondary email form", async () => {
    renderLogin();
    fireEvent.click(screen.getByText("其他登入方式"));
    const magic = within(section(MAGIC_SECTION));
    fireEvent.change(magic.getByLabelText("電郵地址"), { target: { value: "user@example.com" } });
    fireEvent.submit(magic.getByLabelText("電郵地址").closest("form")!);
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
    const magic = within(section(MAGIC_SECTION));
    const email = magic.getByLabelText("電郵地址");
    expect(magic.getByText("電郵地址", { selector: "label" })).toHaveAttribute("for", "login-password-email");
    expect(email).toHaveAttribute("aria-describedby", "login-forgot-help");
    expect(document.getElementById("login-forgot-help")).not.toBeEmptyDOMElement();
  });

  it("announces a busy email request while submission is pending", async () => {
    let resolveRequest!: (value: unknown) => void;
    vi.mocked(supabase.auth.signInWithOtp).mockReturnValueOnce(new Promise((resolve) => {
      resolveRequest = resolve;
    }) as never);
    renderLogin();
    fireEvent.click(screen.getByText("其他登入方式"));
    const email = within(section(MAGIC_SECTION)).getByLabelText("電郵地址");
    fireEvent.change(email, { target: { value: "user@example.com" } });
    fireEvent.submit(email.closest("form")!);
    expect(email).toBeDisabled();

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
    const email = within(section(MAGIC_SECTION)).getByLabelText("電郵地址");
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

const PASSWORD_SECTION = "用密碼登入";
const SIGN_UP_SECTION = "建立你的帳戶";
const FORGOT_SECTION = "重設密碼";
const MAGIC_SECTION = "想改用一次性連結？";

const section = (name: string) => {
  // Both methods stay reachable through the single email step.
  if (name === MAGIC_SECTION && !screen.queryByRole("region", { name })) fireEvent.click(screen.getByRole("button", { name: "選擇電郵登入連結" }));
  return screen.getByRole("region", { name });
};
const submitSection = (name: string) =>
  fireEvent.submit(within(section(name)).getByLabelText("電郵地址").closest("form")!);

function fillCredentials(name: string, email: string, password?: string) {
  const scope = within(section(name));
  fireEvent.change(scope.getByLabelText("電郵地址"), { target: { value: email } });
  if (password !== undefined) {
    fireEvent.change(scope.getByLabelText("密碼"), { target: { value: password } });
  }
}

describe("Login (email + password primary)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    flags.whatsapp = false;
    flags.google = false;
    vi.mocked(supabase.auth.signInWithOtp).mockResolvedValue({ data: {}, error: null } as never);
    vi.mocked(supabase.auth.signInWithPassword).mockResolvedValue({
      data: { session: { access_token: "t" } },
      error: null,
    } as never);
    vi.mocked(supabase.auth.signUp).mockResolvedValue({
      data: { user: { id: "u1" }, session: { access_token: "t" } },
      error: null,
    } as never);
    vi.mocked(supabase.auth.resetPasswordForEmail).mockResolvedValue({ data: {}, error: null } as never);
    mockFinishAuth.mockResolvedValue(undefined);
  });

  it("offers password and magic link methods with one email field, and no phone field", () => {
    renderLogin();
    expect(section(PASSWORD_SECTION)).toBeInTheDocument();
    expect(section(MAGIC_SECTION)).toBeInTheDocument();
    expect(screen.queryByLabelText("WhatsApp 電話號碼")).not.toBeInTheDocument();
    expect(screen.queryByText("用 Google 登入")).not.toBeInTheDocument();
  });

  it("shows the Google button alongside the password form when the flag is on", () => {
    flags.google = true;
    renderLogin();
    expect(section(PASSWORD_SECTION)).toBeInTheDocument();
    expect(screen.getByText("用 Google 登入")).toBeInTheDocument();
  });

  it("signs in with a password and hands off to the shared post-auth branch", async () => {
    renderLogin();
    fillCredentials(PASSWORD_SECTION, "user@example.com", "hunter2hunter2");
    submitSection(PASSWORD_SECTION);

    await waitFor(() =>
      expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({
        email: "user@example.com",
        password: "hunter2hunter2",
      }),
    );
    await waitFor(() => expect(mockFinishAuth).toHaveBeenCalledWith(mockNavigate));
    expect(trackActivationEvent).toHaveBeenCalledWith("auth_link_requested", {
      locale: "zh",
      method: "email_password",
    });
    const events = JSON.stringify(trackActivationEvent.mock.calls);
    expect(events).not.toContain("user@example.com");
    expect(events).not.toContain("hunter2hunter2");
  });

  it("renders the invalid-credentials feedback for a wrong password", async () => {
    const rawMessage = "Invalid login credentials for user@example.com";
    vi.mocked(supabase.auth.signInWithPassword).mockResolvedValue({
      data: { session: null },
      error: { code: "invalid_credentials", message: rawMessage, status: 400 },
    } as never);
    renderLogin();
    fillCredentials(PASSWORD_SECTION, "user@example.com", "wrong-password");
    submitSection(PASSWORD_SECTION);

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByRole("heading")).toHaveTextContent("電郵與密碼不符");
    expect(alert).not.toHaveTextContent(rawMessage);
    expect(mockFinishAuth).not.toHaveBeenCalled();
    expect(within(section(PASSWORD_SECTION)).getByLabelText("密碼")).toHaveAttribute("aria-invalid", "true");
    expect(trackActivationEvent).toHaveBeenCalledWith("auth_link_failed", {
      locale: "zh",
      method: "email_password",
      errorCategory: "invalid_credentials",
    });
    expect(JSON.stringify(trackActivationEvent.mock.calls)).not.toContain(rawMessage);
  });

  it("rejects a short password before calling signUp", async () => {
    renderLogin();
    fireEvent.click(screen.getByRole("button", { name: "初次使用 Adfocate？建立帳戶" }));
    fillCredentials(SIGN_UP_SECTION, "user@example.com", "short");
    submitSection(SIGN_UP_SECTION);

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByRole("heading")).toHaveTextContent("請選一個更強的密碼");
    expect(supabase.auth.signUp).not.toHaveBeenCalled();
    expect(within(section(SIGN_UP_SECTION)).getByLabelText("密碼")).toHaveAttribute("aria-invalid", "true");
  });

  it("signs up and hands off to the shared post-auth branch when a session comes back", async () => {
    renderLogin();
    fireEvent.click(screen.getByRole("button", { name: "初次使用 Adfocate？建立帳戶" }));
    fillCredentials(SIGN_UP_SECTION, "new@example.com", "hunter2hunter2");
    submitSection(SIGN_UP_SECTION);

    await waitFor(() =>
      expect(supabase.auth.signUp).toHaveBeenCalledWith({
        email: "new@example.com",
        password: "hunter2hunter2",
      }),
    );
    await waitFor(() => expect(mockFinishAuth).toHaveBeenCalledWith(mockNavigate));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("tells the creator to check their inbox if sign-up returns no session", async () => {
    vi.mocked(supabase.auth.signUp).mockResolvedValue({
      data: { user: { id: "u1" }, session: null },
      error: null,
    } as never);
    renderLogin();
    fireEvent.click(screen.getByRole("button", { name: "初次使用 Adfocate？建立帳戶" }));
    fillCredentials(SIGN_UP_SECTION, "new@example.com", "hunter2hunter2");
    submitSection(SIGN_UP_SECTION);

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("new@example.com"));
    expect(mockFinishAuth).not.toHaveBeenCalled();
  });

  it("requests a reset link pointing at /auth/reset-password", async () => {
    renderLogin();
    fillCredentials(PASSWORD_SECTION, "user@example.com");
    fireEvent.click(screen.getByRole("button", { name: "忘記密碼？" }));
    expect(within(section(FORGOT_SECTION)).queryByLabelText("密碼")).not.toBeInTheDocument();
    submitSection(FORGOT_SECTION);

    await waitFor(() =>
      expect(supabase.auth.resetPasswordForEmail).toHaveBeenCalledWith("user@example.com", {
        redirectTo: expect.stringContaining("/auth/reset-password"),
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("重設連結已傳送至 user@example.com"),
    );
    expect(mockFinishAuth).not.toHaveBeenCalled();
  });

  it("toggles password visibility with a pressed state", () => {
    renderLogin();
    const field = within(section(PASSWORD_SECTION)).getByLabelText("密碼");
    expect(field).toHaveAttribute("type", "password");
    const toggle = screen.getByRole("button", { name: "顯示密碼" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(toggle);

    expect(field).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "隱藏密碼" })).toHaveAttribute("aria-pressed", "true");
  });

  it("clears a stale error when switching between sign-in and sign-up", async () => {
    vi.mocked(supabase.auth.signInWithPassword).mockResolvedValue({
      data: { session: null },
      error: { code: "invalid_credentials", message: "Invalid login credentials", status: 400 },
    } as never);
    renderLogin();
    fillCredentials(PASSWORD_SECTION, "user@example.com", "wrong-password");
    submitSection(PASSWORD_SECTION);
    await screen.findByRole("alert");

    fireEvent.click(screen.getByRole("button", { name: "初次使用 Adfocate？建立帳戶" }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(within(section(SIGN_UP_SECTION)).getByLabelText("密碼")).toHaveAttribute("aria-invalid", "false");
  });

  it("still sends a magic link from the peer section", async () => {
    renderLogin();
    const scope = within(section(MAGIC_SECTION));
    fireEvent.change(scope.getByLabelText("電郵地址"), { target: { value: "user@example.com" } });
    submitSection(MAGIC_SECTION);

    await waitFor(() =>
      expect(supabase.auth.signInWithOtp).toHaveBeenCalledWith({
        email: "user@example.com",
        options: { emailRedirectTo: expect.stringContaining("/auth/callback") },
      }),
    );
    expect(await screen.findByText(/登入連結已傳送/)).toBeInTheDocument();
    expect(supabase.auth.signInWithPassword).not.toHaveBeenCalled();
  });
});
