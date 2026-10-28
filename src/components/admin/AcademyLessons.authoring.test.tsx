import { beforeEach, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
const h = vi.hoisted(() => ({ admin: vi.fn(), get: vi.fn() }));
vi.mock("@tanstack/react-router", async original => ({ ...(await original<object>()), useNavigate: () => vi.fn() }));
vi.mock("@/lib/admin", async original => ({ ...(await original<object>()), adminFetch: h.admin }));
vi.mock("@/lib/academy", async original => ({ ...(await original<object>()), getAdminAcademy: h.get }));
import { AcademyEditor } from "./AcademyEditor";
import { AdminRequestError } from "@/lib/admin";
beforeEach(() => {
  vi.clearAllMocks();
  h.get.mockResolvedValue({ item: { id: "track", kind: "track", title_zh: "Track draft", title_en: "", slug: "track", body_zh: "Overview", status: "draft", metadata: {}, updated_at: "2026-10-23T09:00:00Z" } });
  h.admin.mockResolvedValue({ items: [] });
});
it("D15 a stale author revision retains the local body and explicitly rebases only edited fields", async () => {
  const original = { id: "one", track_id: "track", content_version: 1, revision: 1, status: "draft", title_zh: "Original title", title_en: "", body_zh: "Original body", body_en: "", position: 0, approval_ref: null };
  const latest = { ...original, revision: 2, title_zh: "Remote title", body_zh: "Remote body" };
  let remote = original;
  h.admin.mockImplementation(async (_path: string, options?: { method?: string; body?: string }) => {
    if (options?.method === "PATCH") {
      const input = JSON.parse(options.body!);
      if (input.revision === 1) { remote = latest; throw new AdminRequestError("Reload before retrying", "version_changed", undefined, 409); }
      expect(input).toMatchObject({ revision: 2, title_zh: "Remote title", body_zh: "My unsaved body" });
      return { item: { ...latest, ...input, revision: 3 } };
    }
    return { items: [remote] };
  });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AcademyEditor id="track" /></QueryClientProvider>);
  fireEvent.click(await screen.findByRole("button", { name: /Original title · v1 · draft/ }));
  fireEvent.change(screen.getByRole("textbox", { name: "Lesson body (中文)" }), { target: { value: "My unsaved body" } });
  fireEvent.click(screen.getByRole("button", { name: "Save lesson" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Another revision exists");
  expect(screen.getByRole("textbox", { name: "Lesson body (中文)" })).toHaveValue("My unsaved body");
  fireEvent.click(screen.getByRole("button", { name: "Compare latest lesson" }));
  await screen.findByText("Latest lesson revision 2");
  expect(screen.getByRole("textbox", { name: "Lesson body (中文)" })).toHaveValue("My unsaved body");
  fireEvent.click(screen.getByRole("button", { name: "Keep draft on latest revision" }));
  expect(screen.getByRole("textbox", { name: "Lesson title (中文)" })).toHaveValue("Remote title");
  fireEvent.click(screen.getByRole("button", { name: "Save lesson" }));
  await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  expect(screen.getByRole("textbox", { name: "Lesson body (中文)" })).toHaveValue("My unsaved body");
});
it("D15 author creates a labelled lesson draft with preview; publishing requires an approval reference", async () => {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AcademyEditor id="track" /></QueryClientProvider>);
  fireEvent.click(await screen.findByRole("button", { name: "New lesson" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Lesson title (中文)" }), { target: { value: "實際單元草稿" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Lesson body (中文)" }), { target: { value: "## 尚未核准的草稿正文" } });
  expect(screen.getByRole("heading", { name: "尚未核准的草稿正文" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Publish lesson" })).not.toBeInTheDocument();
  h.admin.mockImplementation(async (_path: string, options?: { method?: string; body?: string }) => options?.method === "POST" ? { item: { id: "one", content_version: 1, revision: 1, status: "draft", ...JSON.parse(options.body!) } } : { items: [] });
  fireEvent.click(screen.getByRole("button", { name: "Save lesson" }));
  expect(await screen.findByRole("button", { name: "Publish lesson" })).toBeDisabled();
  expect(screen.getByRole("textbox", { name: "Approval reference" })).toHaveValue("");
});
