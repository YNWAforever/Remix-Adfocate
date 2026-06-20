import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// Mock the router Link so we can assert hrefs without a RouterProvider.
vi.mock("@tanstack/react-router", async (importActual) => {
  const actual = await importActual<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({ to, children, ...p }: { to: string; children: React.ReactNode; [k: string]: unknown }) => (
      <a href={to} {...p}>{children}</a>
    ),
  };
});

// Controllable session mock.
const getSession = vi.fn();
vi.mock("@/lib/supabase", () => ({ supabase: { auth: { getSession: () => getSession() } } }));

import { I18nProvider } from "@/lib/i18n";
import { MarketingHeader } from "./MarketingHeader";

function renderHeader() {
  return render(
    <I18nProvider>
      <MarketingHeader />
    </I18nProvider>,
  );
}

describe("MarketingHeader", () => {
  beforeEach(() => getSession.mockReset());

  it("logged-out: shows Log in / Join linking to /login", async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    renderHeader();
    const join = await screen.findByRole("link", { name: /join|加入|成為創作者/i });
    expect(join).toHaveAttribute("href", "/login");
  });

  it("logged-in: shows an app-entry CTA linking to /home", async () => {
    getSession.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });
    renderHeader();
    const cta = await screen.findByRole("link", { name: /KOCmax|前往|app/i });
    expect(cta).toHaveAttribute("href", "/home");
  });
});
