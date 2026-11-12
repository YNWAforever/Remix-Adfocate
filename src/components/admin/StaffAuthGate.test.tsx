import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const hoisted = vi.hoisted(() => ({
  session: null as { access_token: string } | null,
  meStatus: 200,
  mfaRequired: false,
  lang: "en" as "en" | "zh",
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: hoisted.session } })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      signInWithOAuth: vi.fn(),
      signOut: vi.fn(),
      refreshSession: vi.fn(async () => ({ data: {}, error: null })),
      mfa: {
        listFactors: vi.fn(async () => ({ data: { totp: [] }, error: null })),
        enroll: vi.fn(async () => ({ data: { id: "f1", totp: { qr_code: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=", secret: "SECRET" } }, error: null })),
        challenge: vi.fn(async () => ({ data: { id: "c1" }, error: null })),
        verify: vi.fn(async () => ({ data: {}, error: null })),
        unenroll: vi.fn(async () => ({ error: null })),
      },
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
  hoisted.mfaRequired = false;
  hoisted.lang = "en";
  vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
    new Response(JSON.stringify({ staff: { userId: "u1", email: "a@fimmick.com" }, mfa_required: hoisted.mfaRequired }), { status: hoisted.meStatus }),
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

  it("holds the shell behind MFA enrollment when /admin/me reports mfa_required", async () => {
    hoisted.session = { access_token: "jwt" };
    hoisted.mfaRequired = true;
    render(<StaffAuthGate>{() => <div>shell</div>}</StaffAuthGate>);
    await waitFor(() => expect(screen.getByText("Staff verification")).toBeInTheDocument());
    expect(screen.queryByText("shell")).not.toBeInTheDocument();
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
