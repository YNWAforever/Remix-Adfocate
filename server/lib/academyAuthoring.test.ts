import { describe, it, expect } from "vitest";
import {
  validateAcademyInput, validateAcademyEdit, ACADEMY_KINDS, LEVEL_IDS,
} from "./academyAuthoring.js";

describe("validateAcademyInput", () => {
  it("accepts a minimal valid guide_doc", () => {
    const { errors } = validateAcademyInput({ kind: "guide_doc", title_zh: "帳戶" });
    expect(errors).toEqual({});
  });
  it("requires title_zh", () => {
    const { errors } = validateAcademyInput({ kind: "guide_doc", title_zh: "  " });
    expect(errors.title_zh).toBeTruthy();
  });
  it("rejects an unknown kind", () => {
    const { errors } = validateAcademyInput({ kind: "webinar" as never, title_zh: "x" });
    expect(errors.kind).toBeTruthy();
  });
  it("rejects a non-canonical required_level (levelIndex fails OPEN)", () => {
    const { errors } = validateAcademyInput({ kind: "track", title_zh: "x", required_level: "L2+" });
    expect(errors.required_level).toBeTruthy();
  });
  it("accepts a canonical required_level", () => {
    const { errors } = validateAcademyInput({ kind: "track", title_zh: "x", required_level: "L2" });
    expect(errors.required_level).toBeUndefined();
  });
  it("exposes the canonical level id set", () => {
    expect(LEVEL_IDS).toEqual(["L0", "L1", "L2", "L3", "L4", "L5", "L6"]);
    expect(ACADEMY_KINDS).toContain("guide_doc");
  });
});

describe("validateAcademyEdit", () => {
  it("only validates fields present in the patch", () => {
    expect(validateAcademyEdit({}).errors).toEqual({});
    expect(validateAcademyEdit({ required_level: "L9" }).errors.required_level).toBeTruthy();
    expect(validateAcademyEdit({ title_zh: "" }).errors.title_zh).toBeTruthy();
  });
});
