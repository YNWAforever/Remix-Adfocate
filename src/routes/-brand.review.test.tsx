import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  fetchBrandSubmissions: vi.fn(),
  fetchBrandApplications: vi.fn(),
  fetchBrandEngaged: vi.fn(),
  approveBrandSubmission: vi.fn(),
  rejectBrandSubmission: vi.fn(),
  acceptBrandApplication: vi.fn(),
  declineBrandApplication: vi.fn(),
  fetchBrandBudget: vi.fn().mockResolvedValue({ budget: { balance: 0, enforced: false }, transactions: [] }),
  reportAuthError: vi.fn(),
}));

vi.mock("@/lib/brand", () => ({
  fetchBrandSubmissions: h.fetchBrandSubmissions,
  fetchBrandApplications: h.fetchBrandApplications,
  fetchBrandEngaged: h.fetchBrandEngaged,
  approveBrandSubmission: h.approveBrandSubmission,
  rejectBrandSubmission: h.rejectBrandSubmission,
  acceptBrandApplication: h.acceptBrandApplication,
  declineBrandApplication: h.declineBrandApplication,
  fetchBrandBudget: h.fetchBrandBudget,
  brandKeys: {
    submissions: (s: string) => ["brand-submissions", s],
    applications: () => ["brand-applications"],
    engaged: () => ["brand-engaged"],
    budget: () => ["brand-budget"],
  },
  BrandAuthError: class extends Error {},
}));
vi.mock("@/lib/admin", () => ({ AdminRequestError: class extends Error {} }));
vi.mock("@/components/brand/BrandAuthContext", () => ({
  useBrandAuth: () => ({
    brand: { email: "b@x", workspaceId: "w1", workspaceName: "Acme", role: "owner" },
    reportAuthError: h.reportAuthError,
  }),
}));
vi.mock("@/lib/supabase", () => ({ supabase: { auth: { signOut: vi.fn() } } }));

import { Route } from "./brand.review";

function r() {
  const C = Route.options.component as React.ComponentType;
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <C />
    </QueryClientProvider>,
  );
}

describe("brand review page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem("lang", "zh");
    h.fetchBrandSubmissions.mockResolvedValue({ submissions: [] });
    h.fetchBrandApplications.mockResolvedValue({ applications: [] });
    h.fetchBrandEngaged.mockResolvedValue({ creators: [] });
  });

  it("renders a submission with an approve action on the default tab", async () => {
    h.fetchBrandSubmissions.mockResolvedValue({
      submissions: [
        {
          id: "s1",
          status: "submitted",
          content_urls: ["https://x.test/post"],
          submitted_at: null,
          creators: { display_name: "Alice" },
          missions: { slug: "m", title: "Mission One", points_reward: 100 },
        },
      ],
    });
    r();
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());
    expect(screen.getByText("Mission One")).toBeInTheDocument();
    expect(screen.getByLabelText("批准")).toBeInTheDocument(); // approve
  });

  it("shows applications with accept/decline after switching tabs", async () => {
    h.fetchBrandApplications.mockResolvedValue({
      applications: [
        { id: "a1", creators: { display_name: "Bob" }, missions: { slug: "m", title: "Mission Two", points_reward: 0 } },
      ],
    });
    r();
    fireEvent.click(screen.getByText("申請")); // tabApplications
    await waitFor(() => expect(screen.getByText("Bob")).toBeInTheDocument());
    expect(screen.getByLabelText("接受")).toBeInTheDocument(); // accept
    expect(screen.getByLabelText("婉拒")).toBeInTheDocument(); // decline
  });
});
