import { describe, expect, it } from "vitest";
import { calendarDay, dueLabel } from "./workspaceCalendar";
describe("Hong Kong workspace deadlines", () => {
  it("keeps later today across UTC midnight", () => expect(dueLabel("2026-10-23T03:00:00Z", new Date("2026-10-22T23:30:00Z"))).toBe("today"));
  it("separates tomorrow across Hong Kong midnight", () => expect(dueLabel("2026-10-22T17:00:00Z", new Date("2026-10-22T15:30:00Z"))).toBe("future"));
  it("prioritizes an overdue instant over the same calendar day", () => expect(dueLabel("2026-10-23T02:00:00Z", new Date("2026-10-23T03:00:00Z"))).toBe("overdue"));
  it.each([null, "invalid"])("keeps unknown deadlines unknown: %s", (due) => expect(dueLabel(due, new Date("2026-10-23T03:00:00Z"))).toBe("unknown"));
  it("uses the specified timezone without host timezone dependence", () => {
    expect(calendarDay("2026-10-22T16:00:00Z")).toBe("2026-10-23");
    expect(calendarDay("2026-10-22T16:00:00Z", "UTC")).toBe("2026-10-22");
  });
});
