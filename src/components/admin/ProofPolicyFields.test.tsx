import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MissionEditor } from "./MissionEditor";
import { AdminRequestError, type AdminMission } from "@/lib/admin";

const template = {
  title: "寵物短片交付", platform: "instagram", position: 0, required: true,
  draft_due_offset_hours: 24, publication_instructions: "發布已批准的短片及清楚披露合作",
  publication_window_hours: 48, required_disclosures: ["#廣告", "品牌合作"], expected_account: "@synthetic_creator",
  proof_evidence_policy: {}, requirements: [{ category: "compliance" as const, text: "短片須清楚披露合作", required: true, position: 0 }],
};
const mission: AdminMission = {
  id: "mission", workspace_id: "workspace", slug: "synthetic-authoring", title: "合成作者任務", description: "測試交付要求",
  category: "寵物", mission_type: "ugc", access_type: "open", required_level: "L0", points_reward: 500, cash_reward: 125,
  cpm_rate: null, cpm_budget_pool: null, deadline: "2030-11-30", quota: 10, filled: 0, status: "draft",
  deliverables: [], requirements: [], platforms: ["instagram"], effort: "medium", target_audience: null,
  dos: [], donts: [], key_messages: [], reference_links: [], updated_at: "", published_at: null, closed_at: null,
  creator_workflow_mode: "active_workspace", fulfillment_required: false, revision_limit: 2, review_sla_hours: 48,
  revision_response_hours: 48, deliverable_templates: [template],
};
const props = { mode: "edit" as const, initial: mission, workspaces: [{ id: "workspace", name: "合成品牌" }] };
const save = () => fireEvent.click(screen.getByRole("button", { name: "儲存變更" }));

describe("D12 policy fields through the real authoring form", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("authors required evidence without opening JSON and submits the actual required deliverable", async () => {
    const onSave = vi.fn().mockResolvedValue({});
    render(<MissionEditor {...props} onSave={onSave} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "需要佐證檔案 1" }));
    save();
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].deliverable_templates[0]).toMatchObject({
      title: "寵物短片交付", required: true, proof_evidence_policy: { required: true },
      required_disclosures: ["#廣告", "品牌合作"], expected_account: "@synthetic_creator", publication_window_hours: 48,
      requirements: [{ text: "短片須清楚披露合作", required: true }],
    });
  });

  it("preserves nested unknown policy keys and makes their evidence requirement explicit", async () => {
    const onSave = vi.fn().mockResolvedValue({});
    const policy = { legacy_review: { owner: "synthetic", modes: ["manual", 2] }, screenshots: 1 };
    render(<MissionEditor {...props} initial={{ ...mission, deliverable_templates: [{ ...template, proof_evidence_policy: policy }] }} onSave={onSave} />);
    expect(screen.getByText(/已有進階設定會原樣保留/)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "需要佐證檔案 1" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "需要佐證檔案 1" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("標題"), { target: { value: "保留舊規則" } });
    save();
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0].deliverable_templates[0].proof_evidence_policy).toEqual(policy);
  });

  it("previews the actual deliverable, checklist and publication guidance without inventing an approval date", () => {
    render(<MissionEditor {...props} onSave={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "預覽" }));
    const preview = screen.getByRole("region", { name: "Creator 預覽" });
    expect(preview).toHaveTextContent("寵物短片交付");
    expect(preview).toHaveTextContent("短片須清楚披露合作");
    expect(preview).toHaveTextContent("發布已批准的短片及清楚披露合作");
    expect(preview).toHaveTextContent("#廣告");
    expect(preview).toHaveTextContent("@synthetic_creator");
    expect(preview).toHaveTextContent("批准後 48 小時內");
    expect(preview).not.toHaveTextContent("Approved version");
    expect(within(preview).queryByRole("time")).toBeNull();
  });

  it("blocks a negative deadline locally and locates the second deliverable without discarding input", async () => {
    const onSave = vi.fn().mockResolvedValue({});
    render(<MissionEditor {...props} initial={{ ...mission, deliverable_templates: [template, { ...template, position: 1, title: "第二項交付", publication_window_hours: -3 }] }} onSave={onSave} />);
    save();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("交付項目 2");
    expect(alert).toHaveTextContent("發佈時限必須是正整數");
    const group = screen.getByRole("group", { name: "交付項目 2" });
    expect(group).toHaveTextContent("發佈時限必須是正整數");
    await waitFor(() => expect(document.activeElement).toBe(group));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("第二項交付")).toBeInTheDocument();
  });

  it("keeps malformed advanced JSON after another edit and refuses to save its last valid value", async () => {
    const onSave = vi.fn().mockResolvedValue({});
    render(<MissionEditor {...props} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText("發佈證明要求 1"), { target: { value: '{"legacy":' } });
    fireEvent.change(screen.getByLabelText("標題"), { target: { value: "不能偷存舊 JSON" } });
    save();
    expect(await screen.findByText("發佈證明要求必須是有效的 JSON 物件。")).toBeInTheDocument();
    expect(screen.getByLabelText("發佈證明要求 1")).toHaveValue('{"legacy":');
    expect(onSave).not.toHaveBeenCalled();
  });

  it("reports malformed retained policy after switching to legacy and preserves it for repair", async () => {
    const onSave = vi.fn().mockResolvedValue({});
    render(<MissionEditor {...props} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText("發佈證明要求 1"), { target: { value: '{"legacy":' } });
    fireEvent.change(screen.getByLabelText("交付流程"), { target: { value: "legacy" } });
    save();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("發佈證明要求必須是有效的 JSON 物件");
    await waitFor(() => expect(alert).toHaveFocus());
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("交付流程"), { target: { value: "active_workspace" } });
    expect(screen.getByLabelText("發佈證明要求 1")).toHaveValue('{"legacy":');
    fireEvent.change(screen.getByLabelText("發佈證明要求 1"), { target: { value: '{"legacy":{"keep":true}}' } });
    fireEvent.change(screen.getByLabelText("交付流程"), { target: { value: "legacy" } });
    save();
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toMatchObject({ creator_workflow_mode: "legacy", deliverable_templates: [{ proof_evidence_policy: { legacy: { keep: true } } }] });
  });

  it("shows a recoverable save failure inline and keeps all entered values", async () => {
    vi.spyOn(window, "alert").mockImplementation(() => {});
    const onSave = vi.fn().mockRejectedValue(new Error("Synthetic save outage"));
    render(<MissionEditor {...props} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText("標題"), { target: { value: "失敗後保留的標題" } });
    save();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("儲存失敗");
    await waitFor(() => expect(alert).toHaveFocus());
    expect(screen.getByLabelText("標題")).toHaveValue("失敗後保留的標題");
    expect(screen.getByRole("button", { name: "儲存變更" })).toBeEnabled();
  });

  it("keeps server validation authoritative and places checklist errors on the matching deliverable", async () => {
    const onSave = vi.fn().mockRejectedValue(new AdminRequestError("validation", "validation", {
      "deliverable_templates.1.requirements.0.text": "Requirement text is required",
    }));
    render(<MissionEditor {...props} initial={{ ...mission, deliverable_templates: [template, { ...template, position: 1, title: "第二項交付" }] }} onSave={onSave} />);
    save();
    expect(await screen.findByRole("alert")).toHaveTextContent("交付項目 2");
    expect(screen.getByRole("group", { name: "交付項目 2" })).toHaveTextContent("請輸入檢查要求");
  });

  it("tracks unsaved changes through a failed save and clears them only after successful persistence", async () => {
    const onDirtyChange = vi.fn();
    const onSave = vi.fn().mockRejectedValueOnce(new Error("Synthetic save outage")).mockResolvedValue({});
    vi.spyOn(window, "alert").mockImplementation(() => {});
    render(<MissionEditor {...props} onSave={onSave} onDirtyChange={onDirtyChange} />);
    fireEvent.change(screen.getByLabelText("標題"), { target: { value: "未保存變更" } });
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));
    save();
    await screen.findByRole("alert");
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    save();
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
  });

  it("retains edited values on a 409 conflict and can retry without clearing the draft", async () => {
    const onSave = vi.fn().mockRejectedValueOnce(new AdminRequestError("Synthetic conflict", "MISSION_TEMPLATE_SNAPSHOTTED", undefined, 409)).mockResolvedValue({});
    render(<MissionEditor {...props} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText("標題"), { target: { value: "衝突後仍保留的標題" } });
    save();
    expect(await screen.findByRole("alert")).toHaveTextContent("請先核對已儲存任務再重試");
    expect(screen.getByLabelText("標題")).toHaveValue("衝突後仍保留的標題");
    save();
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    expect(onSave.mock.calls[1][0].title).toBe("衝突後仍保留的標題");
    expect(onSave.mock.calls[1][0].deliverable_templates[0].requirements[0].text).toBe("短片須清楚披露合作");
  });

  it("prevents duplicate saves while persistence is pending", async () => {
    let finish!: () => void;
    const onSave = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    render(<MissionEditor {...props} onSave={onSave} />);
    save(); save();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("標題")).toBeDisabled();
    finish();
    await waitFor(() => expect(screen.getByRole("button", { name: "儲存變更" })).toBeEnabled());
  });

  it("does not preview stale fixed rewards after switching to CPM", () => {
    render(<MissionEditor {...props} initial={{ ...mission, mission_type: "performance_cpm", cpm_rate: 10, cpm_budget_pool: 100 }} onSave={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "預覽" }));
    expect(screen.queryByText(/HK\$125/)).not.toBeInTheDocument();
  });
});
