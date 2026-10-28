import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  fetchMissionActivity: vi.fn(),
  acceptApplication: vi.fn(),
  declineApplication: vi.fn(),
  approveSubmission: vi.fn(),
  rejectSubmission: vi.fn(),
}));
vi.mock("@/lib/admin", () => ({
  fetchMissionActivity: h.fetchMissionActivity,
  acceptApplication: h.acceptApplication,
  declineApplication: h.declineApplication,
  approveSubmission: h.approveSubmission,
  rejectSubmission: h.rejectSubmission,
  adminMissionKeys: { activity: (id: string) => ["admin-mission-activity", id], detail: (id: string) => ["admin-mission", id] },
  adminKeys: { applications: (w: string) => ["admin-applications", w], submissions: (s: string, w: string) => ["admin-submissions", s, w], engaged: (w: string) => ["admin-engaged", w] },
  AdminAuthError: class AdminAuthError extends Error {},
  AdminRequestError: class AdminRequestError extends Error {},
}));
vi.mock("@/components/admin/AdminAuthContext", () => ({ useAdminAuth: () => ({ authed: true, staff: { userId: "u1", email: "a@x" }, reportAuthError: vi.fn() }) }));
vi.mock("@/components/admin/AdminWorkspaceContext", () => ({ useAdminWorkspace: () => ({ workspace: "", setWorkspace: vi.fn() }) }));

import { MissionManage } from "@/components/admin/MissionManage";
import { MissionEditor } from "@/components/admin/MissionEditor";

function r() {
  return render(<QueryClientProvider client={new QueryClient()}><MissionManage missionId="m1" /></QueryClientProvider>);
}

describe("MissionManage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.fetchMissionActivity.mockResolvedValue({
      mission: { id: "m1", slug: "ugc-1", title: "M1", status: "active" },
      applicants: [{ id: "a1", status: "applied", creators: { display_name: "Amy" }, missions: { slug: "ugc-1", title: "M1", points_reward: 100 } }],
      submissions: [{ id: "s1", status: "submitted", content_urls: ["https://x"], submitted_at: null, creators: { display_name: "Bob" }, missions: { slug: "ugc-1", title: "M1", points_reward: 100 } }],
      engaged: [],
      fill: { filled: 1, quota: 5 },
    });
    h.acceptApplication.mockResolvedValue({});
    h.approveSubmission.mockResolvedValue({});
  });

  it("accepts an applicant in place", async () => {
    r();
    await screen.findByText("Amy");
    fireEvent.click(screen.getByRole("button", { name: /接受/ }));
    await waitFor(() => expect(h.acceptApplication).toHaveBeenCalledWith("a1"));
  });

  it("approves a submission in place", async () => {
    r();
    await screen.findByText("Bob");
    fireEvent.click(screen.getByRole("button", { name: /批准/ }));
    await waitFor(() => expect(h.approveSubmission).toHaveBeenCalledWith("s1", expect.any(Object)));
  });
});

describe("MissionEditor active workflow authoring", () => {
  it("starts legacy and reveals active deliverable controls after workflow selection", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <MissionEditor
        mode="create"
        workspaces={[{ id: "ws-1", name: "Demo" }]}
        onSave={onSave}
      />,
    );

    const workflow = screen.getByLabelText("交付流程");
    expect(workflow).toHaveValue("legacy");
    expect(screen.queryByRole("button", { name: "新增交付項目" })).not.toBeInTheDocument();

    fireEvent.change(workflow, { target: { value: "active_workspace" } });

    expect(screen.getByRole("button", { name: "新增交付項目" })).toBeEnabled();
    expect(screen.getByLabelText("交稿前須確認收貨")).toBeInTheDocument();
    expect(screen.getByLabelText("修稿次數上限")).toBeInTheDocument();
    expect(screen.getByLabelText("審稿時限（小時）")).toBeInTheDocument();
    expect(screen.getByLabelText("修稿回覆時限（小時）")).toBeInTheDocument();
  });

  it("adds, edits, and removes deliverables and checklist items in the exact save payload", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <MissionEditor
        mode="create"
        workspaces={[{ id: "ws-1", name: "Demo" }]}
        onSave={onSave}
      />,
    );

    fireEvent.change(screen.getByLabelText("交付流程"), { target: { value: "active_workspace" } });
    fireEvent.click(screen.getByLabelText("交稿前須確認收貨"));
    fireEvent.change(screen.getByLabelText("修稿次數上限"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("審稿時限（小時）"), { target: { value: "36" } });
    fireEvent.change(screen.getByLabelText("修稿回覆時限（小時）"), { target: { value: "18" } });

    fireEvent.click(screen.getByRole("button", { name: "新增交付項目" }));
    fireEvent.change(screen.getByLabelText("交付標題 1"), { target: { value: "Reel" } });
    fireEvent.change(screen.getByLabelText("交付平台 1"), { target: { value: "instagram" } });
    fireEvent.click(screen.getByRole("button", { name: "新增交付 1 檢查要求" }));
    fireEvent.change(screen.getByLabelText("交付 1 檢查 1 要求內容"), { target: { value: "Use #ad" } });

    fireEvent.click(screen.getByRole("button", { name: "新增交付項目" }));
    fireEvent.change(screen.getByLabelText("交付標題 2"), { target: { value: "Story" } });
    fireEvent.click(screen.getByRole("button", { name: "移除交付項目 1" }));

    expect(screen.queryByDisplayValue("Reel")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("交付標題 1"), { target: { value: "Story post" } });
    fireEvent.change(screen.getByLabelText("交付平台 1"), { target: { value: "instagram" } });
    fireEvent.change(screen.getByLabelText("發佈指示 1"), { target: { value: "Publish the approved story" } });
    fireEvent.change(screen.getByLabelText("發佈時限小時 1"), { target: { value: "24" } });
    fireEvent.change(screen.getByLabelText("必須披露字句 1"), { target: { value: "#ad" } });
    fireEvent.change(screen.getByLabelText("預期帳戶 1"), { target: { value: "@creator" } });
    fireEvent.change(screen.getByLabelText("發佈證明要求 1"), { target: { value: '{"screenshots":1}' } });
    fireEvent.click(screen.getByRole("button", { name: "新增交付 1 檢查要求" }));
    fireEvent.change(screen.getByLabelText("交付 1 檢查 1 要求內容"), { target: { value: "Use #ad" } });
    fireEvent.change(screen.getByLabelText("交付 1 檢查 1 要求類別"), { target: { value: "compliance" } });
    fireEvent.click(screen.getByRole("button", { name: "新增交付 1 檢查要求" }));
    fireEvent.change(screen.getByLabelText("交付 1 檢查 2 要求內容"), { target: { value: "Show product" } });
    fireEvent.change(screen.getByLabelText("交付 1 檢查 2 要求類別"), { target: { value: "quality" } });
    fireEvent.click(screen.getByRole("button", { name: "移除交付 1 檢查 1" }));

    fireEvent.click(screen.getByRole("button", { name: "儲存草稿" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      creator_workflow_mode: "active_workspace",
      fulfillment_required: true,
      revision_limit: 3,
      review_sla_hours: 36,
      revision_response_hours: 18,
      deliverable_templates: [{
        title: "Story post",
        platform: "instagram",
        position: 0,
        required: true,
        draft_due_offset_hours: 0,
        publication_instructions: "Publish the approved story",
        publication_window_hours: 24,
        required_disclosures: ["#ad"],
        expected_account: "@creator",
        proof_evidence_policy: { screenshots: 1 },
        requirements: [{
          category: "quality",
          text: "Show product",
          required: true,
          position: 0,
        }],
      }],
    }));
  });

  it("preserves legacy deliverables and requirements in the legacy save payload", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <MissionEditor
        mode="edit"
        initial={{
          id: "mission-1",
          workspace_id: "ws-1",
          slug: "legacy-mission",
          title: "Legacy mission",
          mission_type: "ugc",
          description: null,
          category: null,
          access_type: "open",
          required_level: "L0",
          points_reward: 100,
          cash_reward: null,
          cpm_rate: null,
          cpm_budget_pool: null,
          deadline: null,
          quota: 10,
          filled: 0,
          status: "draft",
          deliverables: ["One photo"],
          requirements: ["No competitor logos"],
          platforms: ["instagram"],
          effort: null,
          target_audience: null,
          dos: [],
          donts: [],
          key_messages: [],
          reference_links: [],
          updated_at: "",
          published_at: null,
          closed_at: null,
          creator_workflow_mode: "legacy",
          fulfillment_required: false,
          revision_limit: 2,
          review_sla_hours: 48,
          revision_response_hours: 48,
          deliverable_templates: [],
        }}
        onSave={onSave}
      />,
    );

    expect(screen.queryByRole("button", { name: "新增交付項目" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "儲存變更" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      creator_workflow_mode: "legacy",
      deliverables: ["One photo"],
      requirements: ["No competitor logos"],
      deliverable_templates: [],
    }));
  });
});
