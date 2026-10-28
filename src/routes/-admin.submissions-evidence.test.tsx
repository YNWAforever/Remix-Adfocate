import { beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
const h = vi.hoisted(() => ({ correct: vi.fn(), urls: ["wwww"], sqlValid: true, revision: 0 }));
vi.mock("@/lib/admin", () => ({ AdminAuthError: class extends Error {}, adminKeys: { submissions: () => ["synthetic-submissions"] },
  fetchSubmissions: async () => ({ submissions: [{ id: "submission", content_urls: h.urls, evidence_revision: h.revision, legacy_evidence_sql_valid: h.sqlValid, creators: { display_name: "Synthetic Creator" }, missions: { title: `Synthetic Mission ${h.revision}` } }] }),
  approveSubmission: vi.fn(), rejectSubmission: vi.fn(), requestLegacyEvidenceCorrection: h.correct,
}));
vi.mock("@/components/admin/AdminAuthContext", () => ({ useAdminAuth: () => ({ authed: true, reportAuthError: vi.fn() }) }));
vi.mock("@/components/admin/AdminWorkspaceContext", () => ({ useAdminWorkspace: () => ({ workspace: "workspace" }) }));
vi.mock("@/lib/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (options: unknown) => ({ options }) }));
import { Route } from "./admin.submissions";
beforeEach(() => { vi.clearAllMocks(); h.correct.mockReset(); h.urls = ["wwww"]; h.sqlValid = true; h.revision = 0; window.history.replaceState(null, "", "/admin/submissions"); });
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
it.each(["https://example.test:/work", "https://example.test:000080/work", "https://@example.test/work", "\thttps://example.test/work\r\n", "https://example.test/work\n", "https://example.test/wo\u0085rk", "https://1\u00ad27.1/work"])("offers correction for historical URLs rejected by the SQL authority guard: %s", async url => {
  h.urls = [url]; h.sqlValid = false;
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
it("allows ordinary valid evidence to be approved", async () => {
  h.urls = ["https://example.test/work"];
  const C = Route.options.component as React.ComponentType;
  render(<QueryClientProvider client={new QueryClient()}><C /></QueryClientProvider>);
  await screen.findByText("Synthetic Creator");
  expect(screen.getByRole("button", { name: "app.admin.submissionsApprove" })).toBeEnabled();
  expect(screen.queryByRole("button", { name: /correction|修正/i })).not.toBeInTheDocument();
});
it("can correct a refreshed evidence revision after a stale command without losing the reason", async () => {
  const C = Route.options.component as React.ComponentType;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  h.correct.mockRejectedValueOnce(Object.assign(new Error("Record changed"), { code: "EVIDENCE_STALE", status: 409 }))
    .mockResolvedValue({ status: "joined" });
  render(<QueryClientProvider client={client}><C /></QueryClientProvider>);
  await screen.findByText("Synthetic Creator");
  const note = screen.getByLabelText("app.admin.submissionsNotesLabel");
  fireEvent.change(note, { target: { value: "Replace the invalid URL" } });
  const button = screen.getByRole("button", { name: /correction|修正/i });
  fireEvent.click(button);
  await screen.findByText(/This record changed/);
  await waitFor(() => expect(h.correct).toHaveBeenCalledTimes(1));
  h.revision = 1;
  fireEvent.click(screen.getByRole("button", { name: "重試 / Retry" }));
  await screen.findByText("Synthetic Mission 1");
  fireEvent.click(button);
  await waitFor(() => expect(h.correct).toHaveBeenLastCalledWith("submission", {
    note: "Replace the invalid URL", requestId: expect.any(String), expectedRevision: 1,
  }));
  expect(note).toHaveValue("Replace the invalid URL");
  expect(h.correct.mock.calls[1][1].requestId).not.toBe(h.correct.mock.calls[0][1].requestId);
});
it("retains the correction receipt key and revision when the first outcome is unknown", async () => {
  const C = Route.options.component as React.ComponentType;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  h.correct.mockRejectedValueOnce(new TypeError("Connection lost")).mockResolvedValue({ status: "joined" });
  render(<QueryClientProvider client={client}><C /></QueryClientProvider>);
  await screen.findByText("Synthetic Creator");
  fireEvent.change(screen.getByLabelText("app.admin.submissionsNotesLabel"), { target: { value: "Replace the invalid URL" } });
  const button = screen.getByRole("button", { name: /correction|修正/i });
  fireEvent.click(button);
  await screen.findByText(/The request could not be completed/);
  h.revision = 1;
  await act(async () => { await client.invalidateQueries({ queryKey: ["synthetic-submissions"] }); });
  await screen.findByText("Synthetic Mission 1");
  fireEvent.click(button);
  await waitFor(() => expect(h.correct).toHaveBeenCalledTimes(2));
  expect(h.correct.mock.calls[1]).toEqual(h.correct.mock.calls[0]);
});
