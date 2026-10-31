import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiError, apiFetch } from "@/lib/api";
import { I18nProvider } from "@/lib/i18n";
import type { IntegrationConnection, IntegrationResource } from "@/lib/integrations/types";
import { IntegrationSourcePanel } from "./IntegrationSourcePanel";
import { integrationKeys } from "@/lib/integrations/queries";

vi.mock("@/lib/api", async original => ({ ...await original<object>(), apiFetch: vi.fn() }));
const fetchMock = vi.mocked(apiFetch);
const clients: QueryClient[] = [];
const connection: IntegrationConnection = { id: "drive-1", provider: "google_drive", label: "Mock Drive", status: "connected", scopes: ["https://www.googleapis.com/auth/drive.file"], generation: 1, lastSyncAt: null, expiresAt: "2099-01-01T00:00:00Z", lastError: null, sampleOnly: true, providerRevocation: "not_requested" };
const source: IntegrationResource = { id: "r1", connectionId: "drive-1", externalId: "doc1", title: "Sample brief", mimeType: "text/plain", version: "v1", selected: true, canDownload: true, rights: "owned", availability: "available", excerpt: "Mock creative brief", metrics: {}, observedAt: "2026-10-30T00:00:00Z", fetchedAt: "2026-10-31T00:00:00Z", coverage: { region: null, language: null, partial: true }, sampleOnly: true };
function mount(resource = source) {
  localStorage.setItem("lang", "en");
  fetchMock.mockImplementation(async path => {
    if (path === "/me/integrations") return { mode: "mock", connections: [connection] };
    if (path.endsWith("/resources")) return { resources: [resource] };
    if (path.endsWith("/import")) return { sources: [] };
    if (path.endsWith("/picker")) return { sampleOnly: true, files: [
      ...Array.from({ length: 6 }, (_, i) => ({ id: `doc${i + 1}`, title: `Mock file ${i + 1}`, mimeType: "text/plain", rights: "owned", canDownload: true })),
      { id: "sheet", title: "Unsupported spreadsheet", mimeType: "application/vnd.google-apps.spreadsheet", rights: "owned", canDownload: true },
      { id: "locked", title: "Download blocked", mimeType: "application/pdf", rights: "unknown", canDownload: false },
    ] };
    throw new Error(`Unexpected request ${path}`);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client);
  const imported = vi.fn();
  const wrap = (threadId: string, revision = 3) => <QueryClientProvider client={client}><I18nProvider><IntegrationSourcePanel threadId={threadId} revision={revision} onImported={imported} /></I18nProvider></QueryClientProvider>;
  return { imported, client, wrap, ...render(wrap("thread-1")) };
}
beforeEach(() => { fetchMock.mockReset(); });
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); });

it("imports privately with three independent unchecked rights choices and accurate unknown coverage", async () => {
  const { imported } = mount();
  fireEvent.click(await screen.findByRole("checkbox", { name: /Sample brief/ }));
  fireEvent.click(screen.getByText("Source, excerpt & rights"));
  expect(screen.getByText(/Region unknown/)).toBeVisible();
  expect(screen.getByText(/Language unknown/)).toBeVisible();
  const model = screen.getByRole("checkbox", { name: /Allow AI processing/ });
  const processing = screen.getByRole("checkbox", { name: /I have permission to send/ });
  const sharing = screen.getByRole("checkbox", { name: /I have rights to share/ });
  for (const checkbox of [model, processing, sharing]) expect(checkbox).not.toBeChecked();
  const submit = screen.getByRole("button", { name: "Import mock sources privately" });
  expect(submit).toBeDisabled();
  fireEvent.change(screen.getByRole("textbox", { name: /Question for these sources/ }), { target: { value: "Which hook?" } });
  fireEvent.click(model); expect(processing).not.toBeChecked(); expect(sharing).not.toBeChecked();
  expect(submit).toBeDisabled();
  fireEvent.click(model); expect(submit).toBeEnabled();
  fireEvent.click(submit);
  await waitFor(() => expect(imported).toHaveBeenCalledOnce());
  const [, init] = fetchMock.mock.calls.find(([path]) => path.endsWith("/import"))!;
  expect(JSON.parse(init!.body as string)).toMatchObject({ threadId: "thread-1", revision: 3, resourceIds: ["r1"], question: "Which hook?", modelConsent: false, processingRights: false, shareRights: false });
});

it("does not let download permission stand in for rights to share", async () => {
  mount({ ...source, rights: "unknown" });
  fireEvent.click(await screen.findByRole("checkbox", { name: /Sample brief/ }));
  expect(screen.getByRole("checkbox", { name: /I have rights to share/ })).toBeDisabled();
  expect(screen.getByText(/Reading access does not grant sharing rights/)).toBeVisible();
});

it("limits the mock picker to five supported downloadable files and cancel preserves the question", async () => {
  mount();
  const question = await screen.findByRole("textbox", { name: /Question for these sources/ });
  fireEvent.change(question, { target: { value: "Keep my draft question" } });
  const trigger = screen.getByRole("button", { name: "Choose mock Drive files" });
  trigger.focus(); fireEvent.click(trigger);
  const dialog = await screen.findByRole("dialog", { name: /Mock Drive file picker/ });
  expect(await within(dialog).findByRole("checkbox", { name: /Unsupported spreadsheet/ })).toBeDisabled();
  expect(within(dialog).getByRole("checkbox", { name: /Download blocked/ })).toBeDisabled();
  for (let i = 1; i <= 5; i++) fireEvent.click(within(dialog).getByRole("checkbox", { name: new RegExp(`Mock file ${i}`) }));
  expect(within(dialog).getByRole("checkbox", { name: /Mock file 6/ })).toBeDisabled();
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(question).toHaveValue("Keep my draft question"); expect(trigger).toHaveFocus();
  expect(fetchMock.mock.calls.filter(([path, init]) => path.endsWith("/resources") && init?.method === "POST")).toHaveLength(0);
});

it("only registers selected IDs from the mock picker catalogue", async () => {
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Choose mock Drive files" }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(await within(dialog).findByRole("checkbox", { name: /Mock file 2/ }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Use selected mock files" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  const [, init] = fetchMock.mock.calls.find(([path, init]) => path.endsWith("/resources") && init?.method === "POST")!;
  expect(JSON.parse(init!.body as string)).toEqual({ requestId: expect.any(String), fileIds: ["doc2"] });
  expect(fetchMock.mock.calls.some(([path]) => path.endsWith("/import"))).toBe(false);
});

it("clears consent on thread/revision changes and never carries the previous thread question across threads", async () => {
  const view = mount();
  fireEvent.click(await screen.findByRole("checkbox", { name: /Sample brief/ }));
  fireEvent.change(screen.getByRole("textbox", { name: /Question for these sources/ }), { target: { value: "Thread one" } });
  fireEvent.click(screen.getByRole("checkbox", { name: /Allow AI processing/ }));
  view.rerender(view.wrap("thread-1", 4));
  expect(screen.getByRole("textbox", { name: /Question for these sources/ })).toHaveValue("Thread one");
  expect(screen.getByRole("checkbox", { name: /Allow AI processing/ })).not.toBeChecked();
  view.rerender(view.wrap("thread-2"));
  expect(screen.getByRole("textbox", { name: /Question for these sources/ })).toHaveValue("");
  expect(screen.getByRole("button", { name: "Import mock sources privately" })).toBeDisabled();
});

it("keeps the draft after an import denial but hides private previews and prevents reuse", async () => {
  mount();
  fireEvent.click(await screen.findByRole("checkbox", { name: /Sample brief/ }));
  const question = screen.getByRole("textbox", { name: /Question for these sources/ });
  fireEvent.change(question, { target: { value: "Keep this question" } });
  fetchMock.mockRejectedValue(new ApiError(403, "SOURCE_UNAVAILABLE", "private detail"));
  fireEvent.click(screen.getByRole("button", { name: "Import mock sources privately" }));
  expect(await screen.findByRole("alert")).toBeVisible();
  expect(question).toHaveValue("Keep this question");
  expect(screen.queryByText("Mock creative brief")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Import mock sources privately" })).toBeDisabled();
});

it("does not restore old consent when the same source returns after access was lost", async () => {
  const { client } = mount();
  fireEvent.click(await screen.findByRole("checkbox", { name: /Sample brief/ }));
  fireEvent.click(screen.getByRole("checkbox", { name: /Allow AI processing/ }));
  fireEvent.click(screen.getByRole("checkbox", { name: /I have rights to share/ }));
  act(() => { client.setQueryData(integrationKeys.resources(connection), { resources: [] }); });
  await waitFor(() => expect(screen.queryByRole("checkbox", { name: /Sample brief/ })).not.toBeInTheDocument());
  act(() => { client.setQueryData(integrationKeys.resources(connection), { resources: [source] }); });
  const returned = await screen.findByRole("checkbox", { name: /Sample brief/ });
  expect(returned).not.toBeChecked();
  fireEvent.click(returned);
  expect(screen.getByRole("checkbox", { name: /Allow AI processing/ })).not.toBeChecked();
  expect(screen.getByRole("checkbox", { name: /I have rights to share/ })).not.toBeChecked();
});

it("shows a missing metric separately from a real zero without inventing coverage", async () => {
  mount({ ...source, metrics: { views: { value: 0, availability: "available", reason: null }, reach: { value: null, availability: "missing", reason: "Insufficient sample" } } });
  await screen.findByRole("checkbox", { name: /Sample brief/ });
  fireEvent.click(screen.getByText("Source, excerpt & rights"));
  expect(screen.getByText("0")).toBeVisible();
  expect(screen.getByText("—")).toBeVisible();
  expect(screen.getByText(/Missing · Insufficient sample/)).toBeVisible();
});

it("removes the previous creator's question, selection and open Picker on actor change", async () => {
  const { client } = mount();
  fireEvent.click(await screen.findByRole("checkbox", { name: /Sample brief/ }));
  fireEvent.change(screen.getByRole("textbox", { name: /Question for these sources/ }), { target: { value: "synthetic private draft" } });
  fireEvent.click(screen.getByRole("checkbox", { name: /Allow AI processing/ }));
  fireEvent.click(screen.getByRole("button", { name: "Choose mock Drive files" }));
  await screen.findByRole("dialog");
  fetchMock.mockResolvedValue({ mode: "mock", connections: [] });
  await act(async () => { client.setQueryData(["me"], { id: "creator-b" }); });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: /Question for these sources/ })).toHaveValue("");
  expect(screen.getByRole("checkbox", { name: /Allow AI processing/ })).not.toBeChecked();
  expect(screen.queryByText("Mock creative brief")).not.toBeInTheDocument();
});

it("shows API measurement and media selection periods separately from sample-only provenance", async () => {
  mount({ ...source, evidence: { apiVersion: "fixture-v1", endpoint: "sample-media/insights", measurementPeriod: "lifetime", selectionPeriod: { start: "2026-10-01", end: "2026-10-31" } } });
  await screen.findByRole("checkbox", { name: /Sample brief/ });
  fireEvent.click(screen.getByText("Source, excerpt & rights"));
  expect(screen.getByText("fixture-v1")).toBeVisible();
  expect(screen.getByText("lifetime")).toBeVisible();
  expect(screen.getByText("2026-10-01 — 2026-10-31")).toBeVisible();
  expect(screen.getByText(/Lifetime is not the last 30 days/)).toBeVisible();
  expect(screen.getByText(/Mock private data/)).toBeVisible();
});

it("keeps the creator's question during a D0 stop but cannot reuse cached source contents", async () => {
  const { client } = mount();
  fireEvent.click(await screen.findByRole("checkbox", { name: /Sample brief/ }));
  fireEvent.change(screen.getByRole("textbox", { name: /Question for these sources/ }), { target: { value: "Keep my own question" } });
  act(() => { client.setQueryData(integrationKeys.list(), { mode: "live_pilot", pilot: { stage: "D0", externalAccess: false }, connections: [connection] }); });
  expect(screen.getByRole("note", { name: "D0 offline verification" })).toBeVisible();
  expect(screen.getByRole("textbox", { name: /Question for these sources/ })).toHaveValue("Keep my own question");
  expect(screen.queryByRole("checkbox", { name: /Sample brief/ })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Import mock sources privately" })).toBeDisabled();
});
