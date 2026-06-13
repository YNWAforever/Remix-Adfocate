import { describe, it, expect } from "vitest";
import { applyBalancePayload } from "./useRealtimeBalance";

describe("applyBalancePayload", () => {
  it("maps a postgres_changes row to the Balance shape", () => {
    const next = applyBalancePayload({ new: { balance: 1300, available_to: "2027-01-01T00:00:00Z" } });
    expect(next).toEqual({ balance: 1300, available_to: "2027-01-01T00:00:00Z" });
  });
});
