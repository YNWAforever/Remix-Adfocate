import { describe, expect, it } from "vitest";
import { firstStaffPage } from "./admin.index";

const access = (workspace: string[], platform: string[] = []) => ({
  access: undefined, loading: false, error: null, refresh: async () => undefined,
  can: (cap: string) => (cap === "content.manage" ? platform.includes(cap) : workspace.includes(cap)),
}) as unknown as Parameters<typeof firstStaffPage>[0];

describe("/admin landing", () => {
  it("sends reviewers and operators to Insights", () => {
    expect(firstStaffPage(access(["creator.read", "submission.review", "proof.review"]))).toBe("/admin/insights");
  });

  it("sends a finance viewer to reward hand-offs instead of a capability error", () => {
    expect(firstStaffPage(access(["reward.read"]))).toBe("/admin/reward-handoffs");
  });

  it("sends a platform content editor without a workspace role to content", () => {
    expect(firstStaffPage(access([], ["content.manage"]))).toBe("/admin/content");
  });
});
