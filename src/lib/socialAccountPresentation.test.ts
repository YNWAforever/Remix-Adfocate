import { describe, expect, it } from "vitest";
import { projectSocialAccounts } from "./socialAccountPresentation";

describe("social presentation compatibility", () => {
  it("keeps unknown legacy platforms and ignores malformed old entries", () => {
    const legacy = [{ platform: "YouTube", handle: "@old", verified: true }, null, { handle: "missing platform" }, { platform: "TikTok", handle: null }];
    const result = projectSocialAccounts([], legacy as never);
    expect(result).toEqual([expect.objectContaining({ platform: "youtube", handle: "@old", source: "legacy", ownershipVerified: false, syncStatus: "not_connected" })]);
  });
});
