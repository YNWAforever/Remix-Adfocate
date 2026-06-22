import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const hoisted = vi.hoisted(() => ({
  session: null as { access_token: string } | null,
  meStatus: 200,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: hoisted.session } })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      signInWithOAuth: vi.fn(),
      signOut: vi.fn(),
    },
  },
}));
vi.mock("@/lib/i18n", () => ({ useI18n: () => ({ t: (k: string) => k }) }));

import { StaffAuthGate } from "./StaffAuthGate";
import { supabase } from "@/lib/supabase";

beforeEach(() => {
  hoisted.session = null;
  hoisted.meStatus = 200;
  vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
    new Response(JSON.stringify({ staff: { userId: "u1", email: "a@fimmick.com" } }), { status: hoisted.meStatus }),
  );
});

describe("StaffAuthGate", () => {
  it("shows the Google sign-in button when there is no session", async () => {
    render(<StaffAuthGate>{() => <div>shell</div>}</StaffAuthGate>);
    await waitFor(() => expect(screen.getByText("app.admin.signInGoogle")).toBeInTheDocument());
    expect(screen.queryByText("shell")).not.toBeInTheDocument();
  });

  it("renders children when session + /admin/me 200", async () => {
    hoisted.session = { access_token: "jwt" };
    render(<StaffAuthGate>{() => <div>shell</div>}</StaffAuthGate>);
    await waitFor(() => expect(screen.getByText("shell")).toBeInTheDocument());
  });

  it("shows not-authorized + sign-out on 403", async () => {
    hoisted.session = { access_token: "jwt" };
    hoisted.meStatus = 403;
    render(<StaffAuthGate>{() => <div>shell</div>}</StaffAuthGate>);
    await waitFor(() => expect(screen.getByText("app.admin.notStaff")).toBeInTheDocument());
    expect(screen.getByText("app.admin.signOut")).toBeInTheDocument();
  });
});
