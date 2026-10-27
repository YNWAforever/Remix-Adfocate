import { afterEach, describe, expect, it, vi } from "vitest";
import { validateAssistantRequest, withProviderDeadline } from "./requestPolicy";
const id = "00000000-0000-4000-8000-000000000001";
afterEach(() => vi.useRealTimers());
describe("bounded assistant request policy", () => {
  it("counts astral characters as Unicode code points", () => {
    expect(validateAssistantRequest({ message: "😀".repeat(4000), client_request_id: id }).message).toHaveLength(8000);
    expect(() => validateAssistantRequest({ message: "😀".repeat(4001), client_request_id: id })).toThrow("bad_request");
  });
  it.each([{}, { message: " " }, { message: "x", client_request_id: "bad" }, { message: "x", client_request_id: id, conversation_id: "bad" }])("rejects malformed identity before provider work", (body) => expect(() => validateAssistantRequest(body)).toThrow("bad_request"));
  it("aborts a stalled provider at the deadline with an unknown outcome", async () => {
    vi.useFakeTimers(); let signal: AbortSignal | undefined;
    const pending = withProviderDeadline((value) => { signal = value; return new Promise(() => {}); }, 30);
    const result = expect(pending).rejects.toThrow("provider_outcome_unknown");
    await vi.advanceTimersByTimeAsync(31); await result;
    expect(signal?.aborted).toBe(true);
  });
});
