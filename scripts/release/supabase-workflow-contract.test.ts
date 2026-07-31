import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(".github/workflows/supabase.yml", "utf8");

describe("Supabase production workflow", () => {
  it("cannot run from push and delegates the only write to the guarded executor", () => {
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toMatch(/\n\s*push:/);
    expect(workflow).toContain("environment: production");
    expect(workflow).toContain("bundle_path:");
    expect(workflow).toContain("bundle_digest:");
    expect(workflow).toContain("project_ref:");
    expect(workflow).toContain("approval:");
    expect(workflow).toContain("npm run release:execute --");
    expect(workflow).not.toContain("supabase db push");
    expect(workflow).not.toMatch(/supabase db (reset|down)/);
    expect(workflow).not.toContain("--include-seed");
  });
});
