import { describe, expect, it } from "vitest";
import { profileInputError } from "./profileInput";

describe("profileInputError", () => {
  it("accepts normal Chinese/English profiles and partial patches", () => {
    expect(profileInputError({ display_name: "陳大文 Tai Man 🌸" })).toBeNull();
    expect(profileInputError({ categories: ["beauty", "food"], social_handles: [{ platform: "instagram", handle: "taiman" }] })).toBeNull();
    expect(profileInputError({ display_name: "長".repeat(60) })).toBeNull();
    expect(profileInputError({})).toBeNull();
  });

  it("rejects oversized or wrongly typed fields", () => {
    expect(profileInputError({ display_name: "長".repeat(61) })).toBe("display_name");
    expect(profileInputError({ display_name: 42 })).toBe("display_name");
    expect(profileInputError({ categories: "beauty" })).toBe("categories");
    expect(profileInputError({ categories: new Array(21).fill("x") })).toBe("categories");
    expect(profileInputError({ social_handles: [{ handle: "x".repeat(1000) }] })).toBe("social_handles");
    expect(profileInputError({ avatar_url: "javascript:alert(1)" })).toBe("avatar_url");
  });
});
