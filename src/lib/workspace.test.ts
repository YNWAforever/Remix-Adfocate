import { describe, it, expect } from "vitest";
import { resolveWorkspace } from "./workspace";

describe("resolveWorkspace", () => {
  it("returns the default workspace slug", () => {
    expect(resolveWorkspace()).toBe("demo");
  });
});
