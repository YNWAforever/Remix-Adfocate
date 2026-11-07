import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { StudioDetail } from "@/lib/studio/types";

const h = vi.hoisted(() => ({ detail: null as StudioDetail | null }));
vi.mock("@tanstack/react-router", () => ({ useBlocker: () => {}, Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a> }));
vi.mock("@/lib/i18n", () => ({ useI18n: () => ({ lang: "en" }) }));
vi.mock("@/lib/queries/kocmax", () => ({ useAssistantChat: () => ({ isPending: false }), useMe: () => ({ data: { id: "creator-test" } }), useMyMissions: () => ({ data: [] }) }));
vi.mock("@/lib/studio/queries", () => ({ studioKeys: {}, useStudioThreads: () => ({ data: { threads: [] } }), useStudioThread: () => ({ data: h.detail }), useStudioCommand: () => ({ isPending: false }) }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({}), useQuery: () => ({}) }));
vi.mock("@/components/integrations/IntegrationSourcePanel", () => ({ IntegrationSourcePanel: () => null }));
import { StudioWorkspace } from "@/components/studio/StudioWorkspace";

afterEach(cleanup);
beforeEach(() => {
  h.detail = { thread: { id: "thread", title: "Sample brief", topic: "creation", mission_id: null, conversation_id: "conversation", revision: 1, created_at: "2026-10-31" },
    sources: [{ id: "source", thread_id: "thread", title: "Sample provider evidence", content: "Sample text only", kind: "private", shareable: false, question: "Which opening?", platform: "Instagram", region: null, language: null, observed_at: "2026-10-31T00:00:00Z", url: null, revoked_at: null, status: "unverified", integration: { connection_id: "sample", snapshot_id: "sample", resource_id: "sample", generation: 1, source_version: "sample-v1", content_hash: "sample-hash", model_allowed: false, provenance: "instagram", availability: "available", sample_only: true, coverage: { region: null, language: null, partial: true }, evidence: { apiVersion: "offline-fixture-version", endpoint: "sample-media/insights", measurementPeriod: "lifetime" } } }],
    briefs: [], shares: [], messages: [] };
});
it.each([true, false])("labels source provenance from sample_only=%s without changing its verification or privacy", sampleOnly => {
  h.detail!.sources[0].integration!.sample_only = sampleOnly;
  render(<StudioWorkspace threadId="thread" />);
  fireEvent.change(screen.getByRole("textbox", { name: "Continue the conversation" }), { target: { value: "My own draft" } });
  fireEvent.click(screen.getByRole("tab", { name: "Evidence" }));
  const card = screen.getByText("Sample provider evidence").closest("article")!;
  expect(card).toHaveTextContent(sampleOnly ? "Mock" : "Provider source");
  if (!sampleOnly) expect(card).not.toHaveTextContent("Mock");
  expect(card).toHaveTextContent("offline-fixture-version");
  expect(card).toHaveTextContent("lifetime");
  expect(within(card).getByText("Unverified")).toBeVisible();
  expect(within(card).getByText("Private use only")).toBeVisible();
  fireEvent.click(screen.getByRole("tab", { name: "Chat" }));
  expect(screen.getByRole("textbox", { name: "Continue the conversation" })).toHaveValue("My own draft");
});
