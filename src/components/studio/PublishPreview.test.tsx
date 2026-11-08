import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n";
import { PublishPreview, type PublishPreviewModel } from "./PublishPreview";

const caption = "  第一行：確切文案 🌱\n\n第二行 #合作\n";
function model(overrides: Partial<PublishPreviewModel> = {}): PublishPreviewModel {
  return {
    mode: "native", identityKey: "session-a:workspace-a:creator-a",
    fingerprint: "a".repeat(64), nonce: "confirmation-1",
    expiresAt: "2026-11-04T13:05:00.000Z",
    account: { username: "creator.hk", subject: "178414000001", appId: "12345", grantGeneration: 3 },
    image: { src: "/preview.jpg", alt: "完整直幅圖片", sha256: "b".repeat(64) },
    caption,
    disclosure: { sponsored: false, captionText: "", platformLabel: "not_required", brandTag: "not_required" },
    mission: null, eligible: true,
    ...overrides,
  };
}
function setup(value = model(), disabled = false) {
  const onConfirm = vi.fn<(confirmation: Readonly<{ fingerprint: string; nonce: string }>) => void | Promise<void>>();
  const onEdit = vi.fn(), onCancel = vi.fn(), onManualProof = vi.fn();
  const props = { model: value, onConfirm, onEdit, onCancel, onManualProof, disabled };
  const view = render(<PublishPreview {...props} />);
  return { ...props, view };
}
function acknowledge() {
  fireEvent.load(screen.getByAltText("完整直幅圖片"));
  fireEvent.click(screen.getByRole("checkbox"));
}
const confirmButton = () => screen.getByRole("button", { name: "立即發佈到 @creator.hk" });

describe("PublishPreview", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-04T13:00:00Z")); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("renders the complete exact content, identity, expiry and immediate-post warning without submitting", () => {
    const { onConfirm } = setup();
    expect(screen.getByLabelText("完整文案").textContent).toBe(caption);
    expect(screen.getByAltText("完整直幅圖片")).toHaveAttribute("src", "/preview.jpg");
    expect(screen.getByText("@creator.hk")).toBeInTheDocument();
    const accountDetails = screen.getByText("帳號與授權詳情");
    expect(accountDetails.closest("details")).not.toHaveAttribute("open");
    expect(screen.getByText("178414000001")).not.toBeVisible();
    expect(screen.getByText("12345")).not.toBeVisible();
    expect(screen.getByText("3")).not.toBeVisible();
    fireEvent.click(accountDetails);
    expect(screen.getByText("178414000001")).toBeVisible();
    expect(screen.getByText("12345")).toBeVisible();
    expect(screen.getByText("3")).toBeVisible();
    expect(screen.getByText("2026-11-04T13:05:00.000Z")).toBeInTheDocument();
    expect(screen.getByText(/立即公開發佈單張圖片/)).toBeInTheDocument();
    expect(screen.getByText(/伺服器仍須重新核對/)).toBeInTheDocument();
    expect(confirmButton()).toBeDisabled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("requires a loaded image and explicit acknowledgement, then sends only a frozen fingerprint and nonce once", async () => {
    let resolve!: () => void;
    const { onConfirm } = setup();
    onConfirm.mockImplementation(() => new Promise<void>(done => { resolve = done; }));
    fireEvent.click(screen.getByRole("checkbox"));
    expect(confirmButton()).toBeDisabled();
    fireEvent.load(screen.getByAltText("完整直幅圖片"));
    expect(confirmButton()).toBeEnabled();
    fireEvent.click(confirmButton());
    fireEvent.click(confirmButton());
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith({ fingerprint: "a".repeat(64), nonce: "confirmation-1" });
    expect(Object.isFrozen(onConfirm.mock.calls[0][0])).toBe(true);
    expect(confirmButton()).toBeDisabled();
    await act(async () => { resolve(); });
    expect(screen.getByText(/確認已交出，發佈結果仍待核實/)).toBeInTheDocument();
    expect(confirmButton()).toBeDisabled();
  });

  it("restores navigation after ambiguous async failure, hides raw errors and never resends the nonce", async () => {
    const { onConfirm, onEdit, onCancel, onManualProof } = setup();
    onConfirm.mockRejectedValue(new Error("https://secret:token@private.invalid/?access_token=raw-secret"));
    acknowledge();
    await act(async () => { fireEvent.click(confirmButton()); });
    expect(screen.getByRole("alert")).toHaveTextContent("未能確認是否已接收");
    expect(document.body.textContent).not.toContain("raw-secret");
    expect(confirmButton()).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "核對草稿與狀態" }));
    fireEvent.click(screen.getByRole("button", { name: "離開預覽" }));
    fireEvent.click(screen.getByRole("button", { name: "回到原任務核對" }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onManualProof).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("does not reuse an attempted nonce when the same preview is disabled and re-enabled", async () => {
    const props = setup();
    acknowledge();
    await act(async () => { fireEvent.click(confirmButton()); });
    props.view.rerender(<PublishPreview {...props} disabled />);
    props.view.rerender(<PublishPreview {...props} disabled={false} />);
    acknowledge();
    expect(confirmButton()).toBeDisabled();
    fireEvent.click(confirmButton());
    expect(props.onConfirm).toHaveBeenCalledTimes(1);
  });

  it("does not apply a late result to the replacement account's preview", async () => {
    let finish!: () => void;
    const props = setup();
    props.onConfirm.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    acknowledge();
    fireEvent.click(confirmButton());
    props.view.rerender(<PublishPreview {...props} model={model({ identityKey: "another-owner", nonce: "new-nonce" })} />);
    await act(async () => { finish(); });
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.queryByText(/確認已交出，發佈結果仍待核實/)).not.toBeInTheDocument();
    expect(props.onConfirm).toHaveBeenCalledTimes(1);
  });

  it("keeps safe navigation available for a stalled confirmation after expiry and identity replacement", async () => {
    let finish!: () => void;
    const props = setup();
    props.onConfirm.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    acknowledge();
    fireEvent.click(confirmButton());
    act(() => { vi.advanceTimersByTime(300_000); });
    expect(confirmButton()).toBeDisabled();
    expect(screen.getByText(/離開預覽不代表取消發佈要求/)).toBeVisible();
    const review = screen.getByRole("button", { name: "核對草稿與狀態" });
    const leave = screen.getByRole("button", { name: "離開預覽" });
    const mission = screen.getByRole("button", { name: "回到原任務核對" });
    expect(review).toBeEnabled(); expect(leave).toBeEnabled(); expect(mission).toBeEnabled();
    fireEvent.click(review); fireEvent.click(leave); fireEvent.click(mission);
    expect(props.onEdit).toHaveBeenCalledTimes(1);
    expect(props.onCancel).toHaveBeenCalledTimes(1);
    expect(props.onManualProof).toHaveBeenCalledTimes(1);

    props.view.rerender(<PublishPreview {...props} model={model({ identityKey: "new-owner", nonce: "new-owner-preview", expiresAt: "2026-11-04T13:10:00Z" })} />);
    expect(screen.getByRole("button", { name: "核對草稿與狀態" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "離開預覽" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "回到原任務核對" })).toBeEnabled();
    expect(confirmButton()).toBeDisabled();
    await act(async () => { finish(); });
    expect(screen.queryByText(/確認已交出，發佈結果仍待核實/)).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(props.onConfirm).toHaveBeenCalledTimes(1);
  });

  it.each([
    { caption: "edited caption" },
    { image: { src: "/other.jpg", alt: "完整直幅圖片", sha256: "c".repeat(64) } },
    { identityKey: "new-session" },
    { account: { username: "other", subject: "178414000002", appId: "12345", grantGeneration: 4 } },
    { nonce: "confirmation-2" },
    { fingerprint: "d".repeat(64) },
    { expiresAt: "2026-11-04T13:04:00.000Z" },
    { disclosure: { sponsored: false, captionText: "new disclosure", platformLabel: "not_required", brandTag: "not_required" } },
    { mission: { kind: "active", state: "approved_to_publish", approvedVersionId: "version-9", instructionRevision: 13, summary: "New approved instructions" } },
  ] satisfies Partial<PublishPreviewModel>[])('clears old acknowledgement when the model changes: %j', patch => {
    const props = setup();
    acknowledge();
    expect(screen.getByRole("checkbox")).toBeChecked();
    props.view.rerender(<PublishPreview {...props} model={model(patch)} />);
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByRole("button", { name: /立即發佈到/ })).toBeDisabled();
    expect(props.onConfirm).not.toHaveBeenCalled();
  });

  it.each(["2026-11-04T13:00:00Z", "not-a-date"])("blocks an expired or malformed deadline %s", expiresAt => {
    const { onConfirm } = setup(model({ expiresAt }));
    expect(screen.getByText(/預覽已過期/)).toBeInTheDocument();
    expect(confirmButton()).toBeDisabled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("expires while open without submitting or preserving a checked confirmation", () => {
    const { onConfirm } = setup();
    acknowledge();
    act(() => { vi.advanceTimersByTime(300_000); });
    expect(confirmButton()).toBeDisabled();
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it.each([
    ["PUBLISH_GRANT_INVALID", "官方發佈授權未確認"],
    ["PUBLISH_PROTOCOL_UNVERIFIED", "官方發佈協定尚未核實"],
    ["DRAFT_CHANGED", "草稿已變更"],
    ["ACCOUNT_CHANGED", "帳號已變更"],
  ] as const)("keeps manual proof available for %s", (reason, copy) => {
    const { onManualProof, onConfirm } = setup(model({ eligible: false, reason }));
    expect(screen.getByText(new RegExp(copy))).toBeInTheDocument();
    expect(confirmButton()).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "原有手動發佈／提交證明" }));
    expect(onManualProof).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("shows approval details and blocks a required unsupported label even with an eligible snapshot", () => {
    setup(model({
      mission: { kind: "active", state: "approved_to_publish", approvedVersionId: "version-7", instructionRevision: 12, summary: "使用 #合作；保留完整圖片。" },
      disclosure: { sponsored: true, captionText: "#合作", platformLabel: "unsupported", brandTag: "unverified" },
    }));
    const reviewDetails = screen.getByText("審核版本詳情");
    expect(reviewDetails.closest("details")).not.toHaveAttribute("open");
    expect(screen.getByText("version-7")).not.toBeVisible();
    expect(screen.getByText("12")).not.toBeVisible();
    expect(screen.getByText("使用 #合作；保留完整圖片。")).toBeVisible();
    expect(screen.getByText("披露文字")).toBeVisible();
    expect(screen.getByText("#合作")).toBeVisible();
    fireEvent.click(reviewDetails);
    expect(screen.getByText("version-7")).toBeVisible();
    expect(screen.getByText("12")).toBeVisible();
    expect(screen.getByText(/必要的合作標籤或品牌標記/)).toBeInTheDocument();
    expect(confirmButton()).toBeDisabled();
  });

  it("separates editing from the single leave-preview action without triggering confirmation", () => {
    const { onEdit, onCancel, onConfirm } = setup();
    fireEvent.click(screen.getByRole("button", { name: "修改草稿" }));
    fireEvent.click(screen.getByRole("button", { name: "離開預覽" }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it.each(["legacy", "active"] as const)("blocks a mission without exact approval: %s", kind => {
    setup(model({ mission: { kind, state: "review_required", approvedVersionId: null, instructionRevision: 1, summary: "重新提交原任務審核" } }));
    acknowledge();
    expect(confirmButton()).toBeDisabled();
    expect(screen.getByRole("button", { name: "原有手動發佈／提交證明" })).toBeEnabled();
  });

  it("honours external disabling and a failed image", () => {
    const props = setup(model(), true);
    acknowledge();
    expect(confirmButton()).toBeDisabled();
    props.view.rerender(<PublishPreview {...props} disabled={false} />);
    fireEvent.error(screen.getByAltText("完整直幅圖片"));
    expect(screen.getByText(/圖片未能完整載入/)).toBeInTheDocument();
    expect(confirmButton()).toBeDisabled();
  });

  it.each(["javascript:alert(1)", "https://user:secret@example.com/a.jpg", "https://example.com/a.jpg?token=secret", "//untrusted.test/a.jpg"])("does not render credential-bearing or unsafe image src %s", src => {
    setup(model({ image: { src, alt: "unsafe", sha256: "b".repeat(64) } }));
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(confirmButton()).toBeDisabled();
    expect(document.body.innerHTML).not.toContain("secret");
  });

  it("uses Studio English copy and makes synthetic confirmation explicitly non-publishing", async () => {
    localStorage.setItem("lang", "en");
    const onConfirm = vi.fn();
    render(<I18nProvider><PublishPreview model={model({ mode: "synthetic" })} onConfirm={onConfirm} onEdit={vi.fn()} onCancel={vi.fn()} onManualProof={vi.fn()} /></I18nProvider>);
    expect(screen.getByText(/No Instagram connection, post, save, points or badge/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Post now/ })).not.toBeInTheDocument();
    fireEvent.load(screen.getByAltText("完整直幅圖片"));
    fireEvent.click(screen.getByRole("checkbox"));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Simulate confirmation · no Instagram post" })); });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
