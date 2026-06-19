import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const mutate = vi.fn();
type MockChat = {
  mutate: typeof mutate;
  isPending: boolean;
  data?: { conversation_id: string; answer: string; citations: { title: string; sourceType: string; sourceRef: string }[] };
};
let state: MockChat = { mutate, isPending: false, data: undefined };
vi.mock("@/lib/queries/kocmax", () => ({ useAssistantChat: () => state }));

import { AssistantPanel } from "./AssistantPanel";

describe("AssistantPanel", () => {
  beforeEach(() => { mutate.mockReset(); state = { mutate, isPending: false, data: undefined }; });

  it("sends a typed message", () => {
    render(<AssistantPanel onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/輸入/), { target: { value: "點樣賺分？" } });
    fireEvent.click(screen.getByRole("button", { name: /傳送|送出|發送/ }));
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ message: "點樣賺分？" }), expect.anything());
  });

  it("renders the assistant answer", () => {
    state = { mutate, isPending: false, data: { conversation_id: "c1", answer: "完成任務獲分。", citations: [] } };
    render(<AssistantPanel onClose={() => {}} />);
    expect(screen.getByText(/完成任務獲分/)).toBeInTheDocument();
  });
});
