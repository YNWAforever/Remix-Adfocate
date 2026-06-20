/**
 * Smoke tests for the 8 ported public marketing pages.
 *
 * Strategy:
 * - Mock @tanstack/react-router so route modules import cleanly without a RouterProvider.
 * - Mock @/lib/supabase (the home page calls supabase.auth.getSession in beforeLoad).
 * - Wrap each render in <I18nProvider> (matches the existing MarketingHeader test pattern).
 * - IntersectionObserver is polyfilled globally in src/test/setup.ts.
 * - Assert each page mounts without crashing via getByRole("heading", { level: 1 }).
 * - Two CTA-target assertions: home hero → /creators, brands hero → /contact.
 */

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Mock the router so all createFileRoute / Link / redirect calls are no-ops.
vi.mock("@tanstack/react-router", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Link: ({ to, children, ...p }: any) => <a href={to} {...p}>{children}</a>,
  createFileRoute: () => (opts: unknown) => opts,
  redirect: (o: unknown) => o,
  Outlet: () => null,
  useNavigate: () => () => {},
  useRouter: () => ({}),
}));

// Mock supabase — index page calls getSession in its beforeLoad.
vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
}));

import { I18nProvider } from "@/lib/i18n";

// Because createFileRoute is a no-op that returns (opts) => opts, the exported
// `Route` object IS the options object. Extract the component robustly whether
// the shape is { component } or { options: { component } }.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function comp(R: any): React.ComponentType {
  return R?.options?.component ?? R?.component;
}

// Page imports — must come after vi.mock declarations (Vitest hoists mocks).
import { Route as IndexRoute } from "./_site.index";
import { Route as CreatorsRoute } from "./_site.creators";
import { Route as BrandsRoute } from "./_site.brands";
import { Route as PackagesRoute } from "./_site.packages";
import { Route as EarnRoute } from "./_site.earn";
import { Route as StoriesRoute } from "./_site.stories";
import { Route as PlaybooksRoute } from "./_site.playbooks";
import { Route as ContactRoute } from "./_site.contact";

function renderPage(C: React.ComponentType) {
  return render(
    <I18nProvider>
      <C />
    </I18nProvider>,
  );
}

describe("_site smoke renders", () => {
  it("home (_site.index) mounts and has an h1", () => {
    renderPage(comp(IndexRoute));
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });

  it("creators (_site.creators) mounts and has an h1", () => {
    renderPage(comp(CreatorsRoute));
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });

  it("brands (_site.brands) mounts and has an h1", () => {
    renderPage(comp(BrandsRoute));
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });

  it("packages (_site.packages) mounts and has an h1", () => {
    renderPage(comp(PackagesRoute));
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });

  it("earn (_site.earn) mounts and has an h1", () => {
    renderPage(comp(EarnRoute));
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });

  it("stories (_site.stories) mounts and has an h1", () => {
    renderPage(comp(StoriesRoute));
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });

  it("playbooks (_site.playbooks) mounts and has an h1", () => {
    renderPage(comp(PlaybooksRoute));
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });

  it("contact (_site.contact) mounts and has an h1", () => {
    renderPage(comp(ContactRoute));
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });
});

describe("_site CTA targets", () => {
  it("home hero renders a link to /creators (primary join CTA)", () => {
    renderPage(comp(IndexRoute));
    const links = screen.getAllByRole("link", { name: /join as creator/i });
    expect(links.length).toBeGreaterThan(0);
    expect(links[0]).toHaveAttribute("href", "/creators");
  });

  it("brands hero renders a link to /contact (Launch a Campaign CTA)", () => {
    renderPage(comp(BrandsRoute));
    const links = screen.getAllByRole("link", { name: /launch a campaign/i });
    expect(links.length).toBeGreaterThan(0);
    expect(links[0]).toHaveAttribute("href", "/contact");
  });
});
