import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  RouterProvider,
  createRouter,
  createRootRoute,
  createRoute,
  createMemoryHistory,
} from "@tanstack/react-router";

// Stable navigate spy shared across renders (hoisted so the vi.mock factory can close over it).
const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }));

// Partial-mock the router: keep the real RouterProvider/createRouter/etc., but replace
// useNavigate so we can assert navigation without registering the target route tree.
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, useNavigate: () => mockNavigate };
});

// Mock supabase auth
vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      signInWithOtp: vi.fn(),
      verifyOtp: vi.fn(),
      refreshSession: vi.fn(),
    },
  },
}));

// Mock apiFetch
vi.mock("@/lib/api", () => ({ apiFetch: vi.fn() }));

import { supabase } from "@/lib/supabase";
import { apiFetch } from "@/lib/api";
import { Route } from "./kocmax.$slug.login";

// Patch Route.useParams to return a fixed slug — avoids needing the full
// TanStack router route tree to be registered.
vi.spyOn(Route, "useParams").mockReturnValue({ slug: "demo" } as never);

function renderLogin() {
  const LoginComponent = Route.options.component as React.ComponentType;
  // Wrap in a minimal RouterProvider so the component has router context.
  const root = createRootRoute({ component: () => <LoginComponent /> });
  const index = createRoute({ getParentRoute: () => root, path: "/", component: () => null });
  const router = createRouter({
    routeTree: root.addChildren([index]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  return render(<RouterProvider router={router as never} />);
}

async function advanceToCodeStage(email = "test@example.com") {
  await waitFor(() => expect(screen.getByLabelText("電郵地址")).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText("電郵地址"), { target: { value: email } });
  fireEvent.submit(screen.getByLabelText("電郵地址").closest("form")!);
  await waitFor(() => expect(screen.getByLabelText("驗證碼")).toBeInTheDocument());
}

function submitCode(code: string) {
  fireEvent.change(screen.getByLabelText("驗證碼"), { target: { value: code } });
  fireEvent.submit(screen.getByLabelText("驗證碼").closest("form")!);
}

describe("Login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(supabase.auth.signInWithOtp).mockResolvedValue({ data: {}, error: null } as never);
    vi.mocked(supabase.auth.verifyOtp).mockResolvedValue({ data: {}, error: null } as never);
    vi.mocked(supabase.auth.refreshSession).mockResolvedValue({ data: {}, error: null } as never);
    vi.mocked(apiFetch).mockResolvedValue({} as never);
  });

  it("shows email stage by default", async () => {
    renderLogin();
    await waitFor(() => expect(screen.getByRole("heading", { name: /登入/ })).toBeInTheDocument());
    expect(screen.getByLabelText("電郵地址")).toBeInTheDocument();
  });

  it("advances to code stage after OTP send", async () => {
    renderLogin();
    await advanceToCodeStage();
    expect(screen.getByLabelText("驗證碼")).toBeInTheDocument();
  });

  it("shows error when OTP send fails", async () => {
    vi.mocked(supabase.auth.signInWithOtp).mockResolvedValue({ data: {}, error: { message: "rate limited" } } as never);
    renderLogin();
    await waitFor(() => expect(screen.getByLabelText("電郵地址")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("電郵地址"), { target: { value: "test@example.com" } });
    fireEvent.submit(screen.getByLabelText("電郵地址").closest("form")!);
    await waitFor(() => expect(screen.getByText("rate limited")).toBeInTheDocument());
  });

  it("back button returns to email stage", async () => {
    renderLogin();
    await advanceToCodeStage();
    fireEvent.click(screen.getByText("使用其他電郵"));
    await waitFor(() => expect(screen.getByLabelText("電郵地址")).toBeInTheDocument());
  });

  it("verifies OTP, bootstraps, refreshes the session and navigates on success", async () => {
    renderLogin();
    await advanceToCodeStage();
    submitCode("123456");
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith({ to: "/kocmax/$slug", params: { slug: "demo" } }),
    );
    expect(supabase.auth.verifyOtp).toHaveBeenCalledWith({
      email: "test@example.com",
      token: "123456",
      type: "email",
    });
    expect(apiFetch).toHaveBeenCalledWith("/me/bootstrap", expect.objectContaining({ method: "POST" }));
    expect(supabase.auth.refreshSession).toHaveBeenCalled();
  });

  it("surfaces an error and does NOT navigate when bootstrap fails", async () => {
    vi.mocked(apiFetch).mockRejectedValue(new Error("boom"));
    renderLogin();
    await advanceToCodeStage();
    submitCode("123456");
    await waitFor(() => expect(screen.getByText("登入未能完成，請稍後再試")).toBeInTheDocument());
    expect(supabase.auth.refreshSession).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("surfaces an error and does NOT navigate when the session refresh fails", async () => {
    vi.mocked(supabase.auth.refreshSession).mockResolvedValue({ data: {}, error: { message: "refresh failed" } } as never);
    renderLogin();
    await advanceToCodeStage();
    submitCode("123456");
    await waitFor(() => expect(screen.getByText("登入未能完成，請稍後再試")).toBeInTheDocument());
    expect(apiFetch).toHaveBeenCalledWith("/me/bootstrap", expect.objectContaining({ method: "POST" }));
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("shows the OTP error and skips bootstrap when verification fails", async () => {
    vi.mocked(supabase.auth.verifyOtp).mockResolvedValue({ data: {}, error: { message: "invalid code" } } as never);
    renderLogin();
    await advanceToCodeStage();
    submitCode("123456");
    await waitFor(() => expect(screen.getByText("invalid code")).toBeInTheDocument());
    expect(apiFetch).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("strips non-digits and caps the OTP input at 6 characters", async () => {
    renderLogin();
    await advanceToCodeStage();
    const otp = screen.getByLabelText("驗證碼") as HTMLInputElement;
    fireEvent.change(otp, { target: { value: "1a2b3c4d5e6f7" } });
    expect(otp.value).toBe("123456");
  });
});
