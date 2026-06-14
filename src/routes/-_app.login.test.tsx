import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }));
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, useNavigate: () => mockNavigate };
});

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
    vi.mocked(supabase.auth.signInWithOtp).mockResolvedValue({ data: {}, error: { message: "rate limited" } } as never);
    renderLogin();
    fireEvent.change(screen.getByLabelText("WhatsApp 電話號碼"), { target: { value: "91234567" } });
    fireEvent.submit(screen.getByLabelText("WhatsApp 電話號碼").closest("form")!);
    await waitFor(() => expect(screen.getByText("rate limited")).toBeInTheDocument());
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
});
