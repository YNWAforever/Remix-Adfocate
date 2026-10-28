import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";

const { status } = vi.hoisted(() => ({ status: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiFetch: status }));

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
  beforeEach(() => { mutate.mockReset(); status.mockReset(); state = { mutate, isPending: false, data: undefined }; });

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
  it("retains input and request identity after a failed response", () => {
    mutate.mockImplementation((_body, callbacks) => callbacks.onError(new Error("unavailable")));
    render(<AssistantPanel onClose={() => {}} />);
    const input = screen.getByPlaceholderText(/輸入/);
    fireEvent.change(input, { target: { value: "保留這份輸入" } });
    fireEvent.click(screen.getByRole("button", { name: /傳送|送出|發送/ }));
    expect(input).toHaveValue("保留這份輸入");
    fireEvent.click(screen.getByRole("button", { name: /傳送|送出|發送/ }));
    expect(mutate).toHaveBeenCalledTimes(2);
    expect(mutate.mock.calls[0][0].client_request_id).toBeTruthy();
    expect(mutate.mock.calls[1][0].client_request_id).toBe(mutate.mock.calls[0][0].client_request_id);
  });
  it("shows generated but unsaved text as an actionable persistence error", () => {
    mutate.mockImplementation((body, callbacks) => callbacks.onSuccess({ answer: "未保存答案", citations: [], persistence: "failed", request_id: body.client_request_id }));
    render(<AssistantPanel onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/輸入/), { target: { value: "保存測試" } });
    fireEvent.click(screen.getByRole("button", { name: /傳送|送出|發送/ }));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/輸入/)).toHaveValue("保存測試");
  });

  it("does not let an old status response erase a newer question or claim it was saved", async () => {
    mutate.mockImplementation((_body, callbacks) => callbacks.onError(new Error("outcome unknown")));
    let resolveStatus!: (value: unknown) => void;
    status.mockReturnValue(new Promise(resolve => { resolveStatus = resolve; }));
    render(<AssistantPanel onClose={() => {}} />);
    const input = screen.getByPlaceholderText(/輸入/);
    const send = screen.getByRole("button", { name: /傳送|送出|發送/ });
    fireEvent.change(input, { target: { value: "First question" } });
    fireEvent.click(send);
    const firstRequestId = mutate.mock.calls[0][0].client_request_id;
    fireEvent.click(screen.getByRole("button", { name: /Check request/ }));
    fireEvent.click(screen.getByRole("button", { name: /New question/ }));
    fireEvent.change(input, { target: { value: "Keep this newer question" } });
    fireEvent.click(send);

    await act(async () => { resolveStatus({ request_id: firstRequestId, persistence: "saved", answer: "Old answer", conversation_id: "old-conversation", citations: [] }); });

    expect(input).toHaveValue("Keep this newer question");
    expect(screen.queryByText("Old answer")).not.toBeInTheDocument();
    expect(screen.queryByText("已保存 / Saved")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Check request/ })).toBeInTheDocument();
  });

  it("accepts a saved result for the current request", () => {
    mutate.mockImplementation((body, callbacks) => callbacks.onSuccess({ request_id: body.client_request_id,
      persistence: "saved", answer: "Current answer", conversation_id: "current-conversation", citations: [] }));
    render(<AssistantPanel onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/輸入/), { target: { value: "Current question" } });
    fireEvent.click(screen.getByRole("button", { name: /傳送|送出|發送/ }));
    expect(screen.getByText("Current answer")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/輸入/)).toHaveValue("");
    expect(screen.getByRole("status")).toHaveTextContent("已保存 / Saved");
  });
});
