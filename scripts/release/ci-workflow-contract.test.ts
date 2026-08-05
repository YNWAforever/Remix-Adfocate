import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(".github/workflows/ci.yml", "utf8")
  .replace(/\r\n?/g, "\n");

function integrationJob() {
  const lines = workflow.split("\n");
  const start = lines.indexOf("  integration:");
  expect(start).toBeGreaterThanOrEqual(0);
  const end = lines.findIndex(
    (line, index) => index > start && /^  [A-Za-z0-9_-]+:/.test(line),
  );
  return lines.slice(start, end === -1 ? lines.length : end).join("\n");
}

describe("CI integration toolchain", () => {
  it("pins Supabase CLI to the release toolchain version", () => {
    const integration = integrationJob();
    expect(integration).toContain("uses: supabase/setup-cli@v1");
    expect(integration).toContain('with: { version: "2.110.0" }');
    expect(integration).not.toContain("version: latest");
  });
});
