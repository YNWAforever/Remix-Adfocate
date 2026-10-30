import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(".github/workflows/ci.yml", "utf8")
  .replace(/\r\n?/g, "\n");

function integrationJob() {
  const lines = workflow.split("\n");
  const start = lines.indexOf("  integration:");
  expect(start).toBeGreaterThanOrEqual(0);
  const end = lines.findIndex(
    (line, index) => index > start && /^ {2}[A-Za-z0-9_-]+:/.test(line),
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

  it("provides a verified target identity on a loopback-bound network before integration runs", () => {
    const integration = integrationJob();
    expect(integration).toContain("com.docker.network.bridge.host_binding_ipv4=127.0.0.1");
    expect(integration).toContain('supabase start --network-id "adfocate-ci-${{ github.run_id }}-${{ github.run_attempt }}"');
    const capture = 'node scripts/ci-integration-target.mjs >> "$GITHUB_ENV"';
    expect(integration).toContain(capture);
    expect(integration.indexOf(capture)).toBeGreaterThan(integration.indexOf('echo "SUPABASE_SERVICE_KEY='));
    expect(integration.indexOf(capture)).toBeLessThan(integration.indexOf("npm run test:integration"));
  });
});
