import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  RouterProvider,
  createRouter,
  createRootRoute,
  createRoute,
  createMemoryHistory,
} from "@tanstack/react-router";

// Mock supabase
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
import { Route } from "./kocmax.$slug.login";

// Patch Route.useParams to return a fixed slug — avoids needing the full
// TanStack router route tree to be registered.
vi.spyOn(Route, "useParams").mockReturnValue({ slug: "demo" } as never);

async function renderLogin() {
  const LoginComponent = Route.options.component as React.ComponentType;
  // Wrap in a minimal RouterProvider so useNavigate() has router context.
  const root = createRootRoute({ component: () => <LoginComponent /> });
  const index = createRoute({ getParentRoute: () => root, path: "/", component: () => null });
  const router = createRouter({
    routeTree: root.addChildren([index]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  return render(<RouterProvider router={router as never} />);
}

describe("Login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(supabase.auth.signInWithOtp).mockResolvedValue({ data: {}, error: null } as never);
    vi.mocked(supabase.auth.verifyOtp).mockResolvedValue({ data: {}, error: null } as never);
    vi.mocked(supabase.auth.refreshSession).mockResolvedValue({ data: {}, error: null } as never);
  });

  it("shows email stage by default", async () => {
    renderLogin();
    await waitFor(() => expect(screen.getByRole("heading", { name: /登入/ })).toBeInTheDocument());
    expect(screen.getByLabelText("電郵地址")).toBeInTheDocument();
  });

  it("advances to code stage after OTP send", async () => {
    renderLogin();
    await waitFor(() => expect(screen.getByLabelText("電郵地址")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("電郵地址"), { target: { value: "test@example.com" } });
    fireEvent.submit(screen.getByLabelText("電郵地址").closest("form")!);
    await waitFor(() => expect(screen.getByLabelText("驗證碼")).toBeInTheDocument());
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
    await waitFor(() => expect(screen.getByLabelText("電郵地址")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("電郵地址"), { target: { value: "test@example.com" } });
    fireEvent.submit(screen.getByLabelText("電郵地址").closest("form")!);
    await waitFor(() => expect(screen.getByText("使用其他電郵")).toBeInTheDocument());
    fireEvent.click(screen.getByText("使用其他電郵"));
    await waitFor(() => expect(screen.getByLabelText("電郵地址")).toBeInTheDocument());
  });
});
