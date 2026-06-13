import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Mock supabase auth — magic-link flow only needs signInWithOtp.
vi.mock("@/lib/supabase", () => ({
  supabase: { auth: { signInWithOtp: vi.fn() } },
}));

import { supabase } from "@/lib/supabase";
import { Route } from "./kocmax.$slug.login";

// Patch Route.useParams to return a fixed slug — the component reads it for emailRedirectTo.
vi.spyOn(Route, "useParams").mockReturnValue({ slug: "demo" } as never);

function renderLogin() {
  // Login no longer uses useNavigate, so it needs no router context.
  const LoginComponent = Route.options.component as React.ComponentType;
  return render(<LoginComponent />);
}

describe("Login (magic link)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(supabase.auth.signInWithOtp).mockResolvedValue({ data: {}, error: null } as never);
  });

  it("shows the email form by default", () => {
    renderLogin();
    expect(screen.getByLabelText("電郵地址")).toBeInTheDocument();
  });

  it("sends a magic link to the callback route and shows a confirmation", async () => {
    renderLogin();
    fireEvent.change(screen.getByLabelText("電郵地址"), { target: { value: "user@example.com" } });
    fireEvent.submit(screen.getByLabelText("電郵地址").closest("form")!);
    await waitFor(() =>
      expect(supabase.auth.signInWithOtp).toHaveBeenCalledWith({
        email: "user@example.com",
        options: { emailRedirectTo: expect.stringContaining("/kocmax/demo/auth/callback") },
      }),
    );
    expect(await screen.findByText(/登入連結已傳送/)).toBeInTheDocument();
    // No code-entry field in the magic-link flow.
    expect(screen.queryByLabelText("驗證碼")).not.toBeInTheDocument();
  });

  it("shows an error when sending the link fails", async () => {
    vi.mocked(supabase.auth.signInWithOtp).mockResolvedValue({ data: {}, error: { message: "rate limited" } } as never);
    renderLogin();
    fireEvent.change(screen.getByLabelText("電郵地址"), { target: { value: "user@example.com" } });
    fireEvent.submit(screen.getByLabelText("電郵地址").closest("form")!);
    await waitFor(() => expect(screen.getByText("rate limited")).toBeInTheDocument());
    // Failure keeps the user on the form, not the confirmation.
    expect(screen.queryByText(/登入連結已傳送/)).not.toBeInTheDocument();
  });

  it("lets the user return to the form to use another email", async () => {
    renderLogin();
    fireEvent.change(screen.getByLabelText("電郵地址"), { target: { value: "user@example.com" } });
    fireEvent.submit(screen.getByLabelText("電郵地址").closest("form")!);
    await screen.findByText(/登入連結已傳送/);
    fireEvent.click(screen.getByText("使用其他電郵"));
    expect(screen.getByLabelText("電郵地址")).toBeInTheDocument();
  });
});
