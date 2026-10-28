// src/routes/-admin.missions.editor.test.tsx
import type React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MissionEditor } from "@/components/admin/MissionEditor";
import { AdminRequestError } from "@/lib/admin";
import type { AdminMission } from "@/lib/admin";
import { dict } from "@/lib/i18n.dict";
import { I18nProvider } from "@/lib/i18n";

vi.mock("@/lib/missionCategories", () => ({ MISSION_CATEGORIES: ["美容", "餐飲"], ALL_CATEGORY: "全部" }));

const active: AdminMission = {
  id: "m1", workspace_id: "w1", slug: "test-x", title: "任務", description: "d", category: "美容",
  mission_type: "ugc", access_type: "open", required_level: "L0", points_reward: 100, cash_reward: null,
  cpm_rate: null, cpm_budget_pool: null, deadline: "2030-01-01", quota: 10, filled: 3, status: "active",
  deliverables: [], requirements: [], platforms: [], effort: null,
  target_audience: null, dos: [], donts: [], key_messages: [], reference_links: [],
  updated_at: "", published_at: "", closed_at: null,
  creator_workflow_mode: "legacy", fulfillment_required: false,
  revision_limit: 2, review_sla_hours: 48, revision_response_hours: 48,
  deliverable_templates: [],
};

type EditorProps = React.ComponentProps<typeof MissionEditor>;
const renderEditor = (props: EditorProps) => render(<MissionEditor {...props} />);
const renderLocalizedEditor = (locale: "en" | "zh", props: EditorProps) => {
  window.localStorage.setItem("lang", locale);
  return render(<I18nProvider><MissionEditor {...props} /></I18nProvider>);
};

function addDeliverable(locale: "en" | "zh" = "zh") {
  fireEvent.change(screen.getByLabelText(dict[locale]["app.admin.missionEditor.workflow"]), { target: { value: "active_workspace" } });
  fireEvent.click(screen.getByRole("button", { name: dict[locale]["app.admin.missionEditor.addDeliverable"] }));
}
function completeFixture(locale: "en" | "zh") {
  fireEvent.change(screen.getByLabelText(locale === "en" ? "Deliverable title 1" : "交付標題 1"), { target: { value: "Synthetic deliverable" } });
  fireEvent.change(screen.getByLabelText(locale === "en" ? "Publication instructions 1" : "發佈指示 1"), { target: { value: "Synthetic publication instructions" } });
}

describe("MissionEditor", () => {
  it.each(["travel", "原有未知長中文分類"])("retains the existing %s category visibly and on an unrelated edit", async (category) => {
    const onSave = vi.fn().mockResolvedValue({});
    renderEditor({mode:"edit",initial:{...active,status:"draft",category},workspaces:[{id:"w1",name:"W"}],onSave});
    expect(screen.getByRole("combobox",{name:"分類"})).toHaveValue(category);
    fireEvent.change(screen.getByLabelText("標題"),{target:{value:"Updated title"}});
    fireEvent.click(screen.getByRole("button",{name:/儲存/}));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0].category).toBe(category);
  });
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("shows CPM fields only for performance_cpm", () => {
    render(<MissionEditor mode="create" workspaces={[{ id: "w1", name: "Demo" }]} onSave={vi.fn()} />);
    expect(screen.queryByLabelText("CPM 單價")).toBeNull();
    fireEvent.change(screen.getByLabelText("任務類型"), { target: { value: "performance_cpm" } });
    expect(screen.getByLabelText("CPM 單價")).toBeInTheDocument();
    expect(screen.queryByLabelText("積分獎勵")).toBeNull();
  });

  it("disables slug & mission_type on a published mission, and economic fields when engaged", () => {
    render(<MissionEditor mode="edit" initial={active} engaged onSave={vi.fn()} />);
    expect(screen.getByLabelText("任務網址代號")).toBeDisabled();
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

  it("submits brief fields as arrays and audience as text", async () => {
    const onSave = vi.fn().mockResolvedValue({});
    renderEditor({ mode: "create", workspaces: [{ id: "w1", name: "W" }], onSave });

    fireEvent.change(screen.getByLabelText(/標題/), { target: { value: "T" } });
    fireEvent.change(screen.getByLabelText("任務網址代號"), { target: { value: "ugc-1" } });

    fireEvent.change(screen.getByLabelText(/目標受眾/), { target: { value: "20-30" } });
    const km = screen.getByPlaceholderText(/重點訊息/);
    fireEvent.change(km, { target: { value: "新精華" } });
    fireEvent.keyDown(km, { key: "Enter" });

    fireEvent.click(screen.getByRole("button", { name: /儲存草稿/ }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const body = onSave.mock.calls[0][0];
    expect(body.target_audience).toBe("20-30");
    expect(body.key_messages).toEqual(["新精華"]);
  });

  it("renders a preview of the brief from form state", () => {
    renderEditor({ mode: "create", workspaces: [{ id: "w1", name: "W" }], onSave: vi.fn() });
    fireEvent.change(screen.getByLabelText(/目標受眾/), { target: { value: "受眾甲" } });
    fireEvent.click(screen.getByRole("button", { name: /預覽/ }));
    // The audience value renders both in the textarea (controlled value) and in the preview brief.
    const matches = screen.getAllByText("受眾甲");
    expect(matches.some((el) => el.tagName !== "TEXTAREA")).toBe(true);
  });
  it("authors complete publication defaults on active-workspace deliverables", async () => {
    const onSave = vi.fn().mockResolvedValue({});
    renderEditor({ mode: "create", workspaces: [{ id: "w1", name: "W" }], onSave });

    addDeliverable();
    fireEvent.change(screen.getByLabelText("交付標題 1"), { target: { value: "Reel" } });
    fireEvent.change(screen.getByLabelText("發佈指示 1"), { target: { value: "Publish the approved reel" } });
    fireEvent.change(screen.getByLabelText("發佈時限小時 1"), { target: { value: "48" } });
    fireEvent.change(screen.getByLabelText("必須披露字句 1"), { target: { value: "#ad\nPaid partnership" } });
    fireEvent.change(screen.getByLabelText("預期帳戶 1"), { target: { value: "@creator" } });
    fireEvent.change(screen.getByLabelText("發佈證明要求 1"), { target: { value: '{"screenshots":1}' } });
    fireEvent.click(screen.getAllByRole("button").at(-1)!);

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0].deliverable_templates[0]).toMatchObject({
      publication_instructions: "Publish the approved reel",
      publication_window_hours: 48,
      required_disclosures: ["#ad", "Paid partnership"],
      expected_account: "@creator",
      proof_evidence_policy: { screenshots: 1 },
    });
  });

  it.each([
    ["en", "Publication instructions 1", "Proof evidence policy 1"],
    ["zh", "發佈指示 1", "發佈證明要求 1"],
  ] as const)("renders publication policy authoring copy in %s", async (locale, instructionsName, evidenceName) => {
    renderLocalizedEditor(locale, {
      mode: "create",
      workspaces: [{ id: "w1", name: "W" }],
      onSave: vi.fn(),
    });
    await waitFor(() => expect(document.documentElement.lang).toBe(locale === "en" ? "en" : "zh-Hant-HK"));

    addDeliverable(locale);

    expect(screen.getByLabelText(instructionsName)).toBeInTheDocument();
    expect(screen.getByLabelText(evidenceName)).toBeInTheDocument();
  });

  it("blocks save and shows localized validation when proof evidence policy JSON is malformed", async () => {
    const onSave = vi.fn().mockResolvedValue({});
    renderLocalizedEditor("en", {
      mode: "create",
      workspaces: [{ id: "w1", name: "W" }],
      onSave,
    });
    await waitFor(() => expect(document.documentElement.lang).toBe("en"));

    addDeliverable("en");
    fireEvent.change(screen.getByLabelText("Proof evidence policy 1"), { target: { value: '{"screenshots":' } });
    fireEvent.click(screen.getByRole("button", { name: "儲存草稿" }));

    expect(await screen.findByText("Proof evidence policy must be a valid JSON object.")).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it.each([
    ["en", [
      "Publication instructions are required.",
      "Publication window must be a positive whole number.",
      "Required disclosures cannot contain blank entries.",
      "Expected account must be blank or a non-empty value.",
      "Proof evidence policy must be a valid JSON object.",
    ]],
    ["zh", [
      "請輸入發佈指示。",
      "發佈時限必須是正整數。",
      "必須披露字句不可包含空白項目。",
      "預期帳戶必須留空或輸入非空白內容。",
      "發佈證明要求必須是有效的 JSON 物件。",
    ]],
  ] as const)("localizes every publication-policy server error in %s", async (locale, messages) => {
    const onSave = vi.fn().mockRejectedValue(new AdminRequestError("bad", "VALIDATION_ERROR", {
      "deliverable_templates.0.publication_instructions": "PUBLICATION_INSTRUCTIONS_REQUIRED",
      "deliverable_templates.0.publication_window_hours": "PUBLICATION_WINDOW_HOURS_INVALID",
      "deliverable_templates.0.required_disclosures.0": "REQUIRED_DISCLOSURE_REQUIRED",
      "deliverable_templates.0.expected_account": "EXPECTED_ACCOUNT_INVALID",
      "deliverable_templates.0.proof_evidence_policy": "PROOF_EVIDENCE_POLICY_INVALID",
    }));
    renderLocalizedEditor(locale, { mode: "create", workspaces: [{ id: "w1", name: "W" }], onSave });
    await waitFor(() => expect(document.documentElement.lang).toBe(locale === "en" ? "en" : "zh-Hant-HK"));
    addDeliverable(locale);
    completeFixture(locale);
    fireEvent.click(screen.getAllByRole("button").at(-1)!);

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    for (const message of messages) expect(await screen.findByText(message)).toBeInTheDocument();
  });

  it("preserves unknown Task 3 and legacy server field messages", async () => {
    const onSave = vi.fn().mockRejectedValue(new AdminRequestError("bad", "VALIDATION_ERROR", {
      title: "Legacy title detail",
      "deliverable_templates.0.publication_instructions": "Unrecognized publication detail",
    }));
    renderLocalizedEditor("zh", { mode: "create", workspaces: [{ id: "w1", name: "W" }], onSave });
    await waitFor(() => expect(document.documentElement.lang).toBe("zh-Hant-HK"));
    addDeliverable();
    completeFixture("zh");
    fireEvent.click(screen.getAllByRole("button").at(-1)!);

    expect(await screen.findByText("Legacy title detail")).toBeInTheDocument();
    expect(screen.getByText("Unrecognized publication detail")).toBeInTheDocument();
  });
});
