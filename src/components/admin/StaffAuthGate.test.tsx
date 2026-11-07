import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const hoisted = vi.hoisted(() => ({
  session: null as { access_token: string } | null,
  meStatus: 200,
  lang: "en" as "en" | "zh",
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
vi.mock("@/lib/i18n", async () => {
  const { dict } = await import("@/lib/i18n.dict");
  return { useI18n: () => ({ lang: hoisted.lang, t: (key: string) => dict[hoisted.lang][key] ?? key }) };
});

import { StaffAuthGate } from "./StaffAuthGate";

beforeEach(() => {
  hoisted.session = null;
  hoisted.meStatus = 200;
  hoisted.lang = "en";
  vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
    new Response(JSON.stringify({ staff: { userId: "u1", email: "a@fimmick.com" } }), { status: hoisted.meStatus }),
  );
});

describe("StaffAuthGate", () => {
  it("shows the Google sign-in button when there is no session", async () => {
    render(<StaffAuthGate>{() => <div>shell</div>}</StaffAuthGate>);
    await waitFor(() => expect(screen.getByRole("button", { name: "Sign in with Google" })).toBeInTheDocument());
    expect(screen.queryByText("shell")).not.toBeInTheDocument();
  });

  it("renders children when session + /admin/me 200", async () => {
    hoisted.session = { access_token: "jwt" };
    render(<StaffAuthGate>{() => <div>shell</div>}</StaffAuthGate>);
    await waitFor(() => expect(screen.getByText("shell")).toBeInTheDocument());
  });

  it.each([
    ["en", "This account isn't authorized for the operator console."],
    ["zh", "此帳戶未獲授權使用營運後台。"],
  ] as const)("shows identity-neutral %s denial + sign-out on 403", async (lang, denial) => {
    hoisted.lang = lang;
    hoisted.session = { access_token: "jwt" };
    hoisted.meStatus = 403;
    render(<StaffAuthGate>{() => <div>shell</div>}</StaffAuthGate>);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(denial));
    expect(screen.getByRole("button", { name: lang === "en" ? "Sign out" : "登出" })).toBeInTheDocument();
  });
});
