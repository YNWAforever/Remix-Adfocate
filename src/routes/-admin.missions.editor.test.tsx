// src/routes/-admin.missions.editor.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MissionEditor } from "@/components/admin/MissionEditor";
import { AdminRequestError } from "@/lib/admin";
import type { AdminMission } from "@/lib/admin";

vi.mock("@/lib/missionCategories", () => ({ MISSION_CATEGORIES: ["美容", "餐飲"], ALL_CATEGORY: "全部" }));

const active: AdminMission = {
  id: "m1", workspace_id: "w1", slug: "test-x", title: "任務", description: "d", category: "美容",
  mission_type: "ugc", access_type: "open", required_level: "L0", points_reward: 100, cash_reward: null,
  cpm_rate: null, cpm_budget_pool: null, deadline: "2030-01-01", quota: 10, filled: 3, status: "active",
  deliverables: [], requirements: [], platforms: [], effort: null,
  target_audience: null, dos: [], donts: [], key_messages: [], reference_links: [],
  updated_at: "", published_at: "", closed_at: null,
};

describe("MissionEditor", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows CPM fields only for performance_cpm", () => {
    render(<MissionEditor mode="create" workspaces={[{ id: "w1", name: "Demo" }]} onSave={vi.fn()} />);
    expect(screen.queryByLabelText("CPM 單價")).toBeNull();
    fireEvent.change(screen.getByLabelText("任務類型"), { target: { value: "performance_cpm" } });
    expect(screen.getByLabelText("CPM 單價")).toBeInTheDocument();
    expect(screen.queryByLabelText("積分獎勵")).toBeNull();
  });

  it("disables slug & mission_type on a published mission, and economic fields when engaged", () => {
    render(<MissionEditor mode="edit" initial={active} engaged onSave={vi.fn()} />);
    expect(screen.getByLabelText("Slug")).toBeDisabled();
    expect(screen.getByLabelText("任務類型")).toBeDisabled();
    expect(screen.getByLabelText("積分獎勵")).toBeDisabled();
    expect(screen.getByLabelText("標題")).not.toBeDisabled(); // brief always editable
  });

  it("renders per-field server errors from AdminRequestError.fields", async () => {
    const onSave = vi.fn().mockRejectedValue(
      new AdminRequestError("bad", "VALIDATION_ERROR", { title: "請輸入任務標題" })
    );
    render(<MissionEditor mode="create" workspaces={[{ id: "w1", name: "Demo" }]} onSave={onSave} />);
    fireEvent.click(screen.getByText("儲存草稿"));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText("請輸入任務標題")).toBeInTheDocument());
  });
});
