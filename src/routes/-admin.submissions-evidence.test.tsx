import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
const h = vi.hoisted(() => ({ correct: vi.fn(), urls: ["wwww"] }));
vi.mock("@/lib/admin", () => ({ AdminAuthError: class extends Error {}, adminKeys: { submissions: () => ["synthetic-submissions"] },
  fetchSubmissions: async () => ({ submissions: [{ id: "submission", content_urls: h.urls, evidence_revision: 0, creators: { display_name: "Synthetic Creator" }, missions: { title: "Synthetic Mission" } }] }),
  approveSubmission: vi.fn(), rejectSubmission: vi.fn(), requestLegacyEvidenceCorrection: h.correct,
}));
vi.mock("@/components/admin/AdminAuthContext", () => ({ useAdminAuth: () => ({ authed: true, reportAuthError: vi.fn() }) }));
vi.mock("@/components/admin/AdminWorkspaceContext", () => ({ useAdminWorkspace: () => ({ workspace: "workspace" }) }));
vi.mock("@/lib/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (options: unknown) => ({ options }) }));
import { Route } from "./admin.submissions";
beforeEach(() => { vi.clearAllMocks(); h.urls = ["wwww"]; window.history.replaceState(null, "", "/admin/submissions"); });
it("requires a reason before returning invalid legacy evidence for correction", async () => {
  const C = Route.options.component as React.ComponentType;
  render(<QueryClientProvider client={new QueryClient()}><C /></QueryClientProvider>);
  await screen.findByText("Synthetic Creator");
  const correction = screen.getByRole("button", { name: /correction|修正/i });
  expect(correction).toBeDisabled();
  fireEvent.change(screen.getByLabelText("app.admin.submissionsNotesLabel"), { target: { value: "Please replace the invalid work URL" } });
  fireEvent.click(correction);
  await waitFor(() => expect(h.correct).toHaveBeenCalledWith("submission", {
    note: "Please replace the invalid work URL", requestId: expect.any(String), expectedRevision: 0,
  }));
});
it.each(["https://example.test:/work", "https://example.test:000080/work", "https://@example.test/work"])("offers correction for historical URLs rejected by the SQL authority guard: %s", async url => {
  h.urls = [url];
  expect(() => new URL(url)).not.toThrow();
  const C = Route.options.component as React.ComponentType;
  render(<QueryClientProvider client={new QueryClient()}><C /></QueryClientProvider>);
  await screen.findByText("Synthetic Creator");
  expect(screen.getByRole("button", { name: "app.admin.submissionsApprove" })).toBeDisabled();
  const correction = screen.getByRole("button", { name: /correction|修正/i });
  fireEvent.change(screen.getByLabelText("app.admin.submissionsNotesLabel"), { target: { value: "Replace this unsupported authority" } });
  fireEvent.click(correction);
  await waitFor(() => expect(h.correct).toHaveBeenCalledWith("submission", {
    note: "Replace this unsupported authority", requestId: expect.any(String), expectedRevision: 0,
  }));
});
