import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PublishStatus, type PublishStatusModel } from "./PublishStatus";

const base: PublishStatusModel = {
  mode: "native", state: "outcome_unknown",
  account: { username: "creator.hk", subject: "178414000001" },
};
describe("PublishStatus", () => {
  it.each([
    ["preparing", "準備中"], ["processing", "處理中"],
    ["publish_requested", "已要求發佈，結果待確認"], ["failed", "發佈失敗"],
    ["outcome_unknown", "結果待確認"], ["cancelled", "已取消"], ["invalidated", "確認已失效"],
  ] as const)("renders %s honestly with no automatic status check", (state, heading) => {
    const onCheckStatus = vi.fn();
    render(<PublishStatus model={{ ...base, state }} onCheckStatus={onCheckStatus} onManualProof={vi.fn()} />);
    expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    expect(screen.getByText("@creator.hk")).toBeVisible();
    const accountDetails = screen.getByText("帳號與授權詳情");
    expect(accountDetails.closest("details")).not.toHaveAttribute("open");
    expect(screen.getByText("178414000001")).not.toBeVisible();
    fireEvent.click(accountDetails);
    expect(screen.getByText("178414000001")).toBeVisible();
    expect(onCheckStatus).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /重新發佈|再發佈|重試/ })).not.toBeInTheDocument();
  });

  it("offers only a read-only check and manual guidance for unknown outcomes; locks double clicks", async () => {
    let finish!: () => void;
    const onCheckStatus = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const onManualProof = vi.fn();
    render(<PublishStatus model={base} onCheckStatus={onCheckStatus} onManualProof={onManualProof} />);
    expect(screen.getByText(/只查詢狀態，不會再次發佈/)).toBeInTheDocument();
    expect(screen.getByText(/請先到 Instagram 核對目標帳號/)).toBeInTheDocument();
    const check = screen.getByRole("button", { name: "檢查發佈狀態（唯讀）" });
    fireEvent.click(check); fireEvent.click(check);
    expect(check).toBeDisabled();
    expect(onCheckStatus).toHaveBeenCalledTimes(1);
    await act(async () => { finish(); });
    expect(check).toBeEnabled();
    expect(screen.getByRole("heading", { name: "結果待確認" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "回到原任務核對" }));
    expect(onManualProof).toHaveBeenCalledTimes(1);
  });

  it.each(["preparing", "processing", "publish_requested", "outcome_unknown"] as const)("offers review instead of manual re-publication while %s", state => {
    const onManualProof = vi.fn();
    render(<PublishStatus model={{ ...base, state }} onManualProof={onManualProof} />);
    expect(screen.queryByRole("button", { name: /手動發佈|再發佈|重試/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "回到原任務核對" }));
    expect(onManualProof).toHaveBeenCalledTimes(1);
  });

  it("restores read-only controls after failure without exposing the error or automatically retrying", async () => {
    const onCheckStatus = vi.fn().mockRejectedValue(new Error("access_token=private-secret"));
    render(<PublishStatus model={base} onCheckStatus={onCheckStatus} onManualProof={vi.fn()} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /檢查發佈狀態/ })); });
    expect(screen.getByRole("alert")).toHaveTextContent("未能讀取最新狀態");
    expect(screen.getByRole("button", { name: /檢查發佈狀態/ })).toBeEnabled();
    expect(onCheckStatus).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toContain("private-secret");
  });

  const receipt = { mediaId: "180000001", accountSubject: "178414000001", publishedAt: "2026-11-04T13:00:00Z", permalink: "https://www.instagram.com/p/ExactPost/" };
  it("shows a supplied official receipt and leaves rewards to the original mission", () => {
    render(<PublishStatus model={{ ...base, state: "published", receipt }} onManualProof={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "已發佈" })).toBeInTheDocument();
    expect(screen.getByText("180000001")).not.toBeVisible();
    expect(screen.getByText("2026-11-04T13:00:00Z")).toBeVisible();
    fireEvent.click(screen.getByText("發佈回執詳情"));
    expect(screen.getByText("180000001")).toBeVisible();
    expect(screen.getByRole("link", { name: "查看 Instagram 貼文" })).toHaveAttribute("href", "https://www.instagram.com/p/ExactPost/");
    expect(screen.getByText(/不代表任務證明獲批或獎勵入帳/)).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it.each([undefined, { ...receipt, accountSubject: "different" }, { ...receipt, mediaId: "" }, { ...receipt, publishedAt: "invalid" }])("falls back to unknown for an incomplete or mismatched receipt", value => {
    render(<PublishStatus model={{ ...base, state: "published", receipt: value }} onManualProof={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "結果待確認" })).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it.each(["javascript:alert(1)", "data:text/html,secret", "//instagram.com/p/a", "https://user:secret@instagram.com/p/a", "https://instagram.com/p/a?access_token=secret", "https://instagram.com.evil.test/p/a"])("does not render an untrusted receipt link %s", permalink => {
    render(<PublishStatus model={{ ...base, state: "published", receipt: { ...receipt, permalink } }} onManualProof={vi.fn()} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain("secret");
  });

  it("calls mock published an example receipt and never exposes a fabricated external receipt", () => {
    render(<PublishStatus model={{ ...base, mode: "synthetic", state: "published", receipt }} onManualProof={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "示例回執 · 沒有發佈" })).toBeInTheDocument();
    expect(screen.getByText(/沒有連接 Instagram、沒有發佈或保存/)).toBeInTheDocument();
    expect(screen.queryByText("180000001")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "已發佈" })).not.toBeInTheDocument();
  });

  it("describes an unknown synthetic result as an example, without suggesting a real post exists", () => {
    render(<PublishStatus model={{ ...base, mode: "synthetic" }} onManualProof={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("此示例沒有發佈");
    expect(screen.getByRole("status")).not.toHaveTextContent("可能已發佈");
  });
});
