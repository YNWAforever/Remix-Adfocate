import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { I18nProvider } from "@/lib/i18n";
import { IntegrationDeletionStatus, type DeletionStatus } from "./IntegrationDeletionStatus";

afterEach(cleanup);
function mount(status: DeletionStatus, lang = "en") {
  localStorage.setItem("lang", lang);
  return render(<I18nProvider><IntegrationDeletionStatus status={status}/></I18nProvider>);
}
describe("minimal public deletion receipt view", () => {
  it.each([
    ["loading", "Checking receipt"], ["pending", "Pending"], ["completed", "Processing completed"],
    ["unknown", "Receipt not found"], ["unavailable", "Status unavailable"],
  ] as const)("renders %s without private data or connection controls", async (status, label) => {
    const view = mount(status);
    expect(await screen.findByRole("heading", { level: 1, name: "Data deletion status" })).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(label);
    expect(view.container).not.toHaveTextContent(/account|workspace|filename|accessToken|refreshToken/i);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    if (status !== "completed") expect(screen.queryByText("Processing completed", { exact: true })).not.toBeInTheDocument();
  });
  it("describes completed as recorded processing without asserting platform revocation", async () => {
    mount("completed");
    expect(await screen.findByText(/does not verify platform revocation/i)).toBeVisible();
  });
  it("shows an unresolved receipt in Traditional Chinese", async () => {
    mount("unknown", "zh");
    expect(await screen.findByRole("heading", { name: "資料刪除狀態" })).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("找不到回執");
    expect(screen.getByText(/未能確認處理結果/)).toBeVisible();
  });
});
