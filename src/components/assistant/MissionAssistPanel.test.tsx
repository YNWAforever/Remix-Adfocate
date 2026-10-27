import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { DraftEditor } from "../active-mission/DraftEditor";
import type { MissionWorkItemView } from "@/lib/activeMission";
import MissionAssistPanel from "./MissionAssistPanel";
import { ApiError } from "@/lib/api";
import type { MissionAssistReply } from "@/lib/missionAssist";

const http = vi.hoisted(() => ({ api: vi.fn(), admin: vi.fn() }));
vi.mock("@/lib/api", async original => ({ ...await original<typeof import("@/lib/api")>(), apiFetch: http.api }));
vi.mock("@/lib/admin", async original => ({ ...await original<typeof import("@/lib/admin")>(), adminFetch: http.admin }));
vi.mock("@/lib/i18n", () => ({ useI18n: () => ({ lang: "en", t: (k: string) => k }) }));
beforeEach(() => { vi.clearAllMocks(); });
const context = { missionId: "mission", workflowId: "workflow", workItemId: "item", versionId: "v1", mode: "explain_brief" as const };
const response = { answer: "Include #ad. Human review required.", citations: [{ title: "v1", sourceType: "mission_assist", sourceRef: "version:v1" }],
  basisVersion: { missionId: "mission", missionUpdatedAt: null, workflowId: "workflow", workflowRevision: 1, workItemId: "item", versionId: "v1", versionNumber: 1, previousVersionId: null, currentVersionId: "v2", stale: true, sourceHash: "hash" },
  limitations: ["human_review_required"], request_id: "request", persistence: "not_saved", generation: "completed", provider: "mock" } satisfies MissionAssistReply;
function open() { return render(<MissionAssistPanel context={context} checklist={[{ id: "ad", text: "Include #ad" }]} enabled onClose={vi.fn()} />); }
function send() { fireEvent.change(screen.getByLabelText("Question about this brief or version"), { target: { value: "Keep my original question" } }); fireEvent.click(screen.getByRole("button", { name: "Explain with AI" })); }

it("D20 opens deterministic brief help on demand and keeps the real provider disabled", async () => {
  const item = { id: "item", title: "Reel", platform: "instagram", requirements: [{ id: "ad", text: "Include #ad", required: true }], state: "drafting", draft: null } as unknown as MissionWorkItemView;
  const save = vi.fn(), submit = vi.fn();
  render(<DraftEditor item={item} onSave={save} onSubmit={submit} assistContext={{ missionId: "mission", workflowId: "workflow", workItemId: "item", mode: "explain_brief" }} />);
  expect(screen.queryByRole("region", { name: /brief coach|任務解說/i })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /brief help|任務解說/i }));
  const panel = await screen.findByRole("region", { name: /brief coach|任務解說/i });
  expect(panel).toHaveTextContent("Include #ad");
  expect(screen.getByRole("button", { name: /explain with AI|AI 解說/i })).toBeDisabled();
  expect(save).not.toHaveBeenCalled(); expect(submit).not.toHaveBeenCalled();
});

it("marks stale mock output, cites its basis and never claims it saved or changes the input", async () => {
  http.api.mockResolvedValue(response); open(); send();
  expect(await screen.findByText("Mock output · not saved · human review required")).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("old version");
  expect(screen.getByLabelText("Sources")).toHaveTextContent("version:v1");
  expect(screen.getByLabelText("Question about this brief or version")).toHaveValue("Keep my original question");
  expect(http.api).toHaveBeenCalledTimes(1); expect(http.admin).not.toHaveBeenCalled();
});
it("distinguishes the current approved comparison snapshot from the selected draft", async () => {
  http.api.mockResolvedValue({ ...response, basisVersion: { ...response.basisVersion, previousVersionId: "v0", previousVersionApproved: true, versionApproved: false } });
  open(); send();
  expect(await screen.findByText("Previous comparison version: current approved snapshot.")).toBeInTheDocument();
  expect(screen.getByText("Selected version: not the current approved snapshot.")).toBeInTheDocument();
});
it.each([403, 404, 409, 429, 503])("retains the question on HTTP %s without automatic retry", async status => {
  http.api.mockRejectedValue(new ApiError(status, "bounded_error", "untrusted raw error")); open(); send();
  await screen.findByRole("alert");
  expect(screen.getByLabelText("Question about this brief or version")).toHaveValue("Keep my original question");
  expect(screen.getByRole("alert")).not.toHaveTextContent("untrusted raw error");
  expect(http.api).toHaveBeenCalledTimes(1);
  if (status === 503 || status === 409) expect(screen.getByRole("button", { name: "Explain with AI" })).toBeDisabled();
  if (status === 429) {
    fireEvent.click(screen.getByRole("button", { name: "Explain with AI" }));
    await waitFor(() => expect(http.api).toHaveBeenCalledTimes(2));
    const requests = http.api.mock.calls.map(call => JSON.parse(call[1].body));
    expect(requests[1].client_request_id).toBe(requests[0].client_request_id);
  }
});
it("does not display a slow previous-context answer after switching versions", async () => {
  let resolve!: (v: MissionAssistReply) => void;
  http.api.mockReturnValue(new Promise<MissionAssistReply>(done => { resolve = done; }));
  const view = open(); send();
  view.rerender(<MissionAssistPanel context={{ ...context, versionId: "v2" }} checklist={[]} enabled onClose={vi.fn()} />);
  await act(async () => { resolve(response); });
  expect(screen.queryByText("Mock output · not saved · human review required")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Question about this brief or version")).toHaveValue("Keep my original question");
});
