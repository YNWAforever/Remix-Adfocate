import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts?: Record<string, string>;
};
const ci = readFileSync(".github/workflows/ci.yml", "utf8");
const runbook = readFileSync(
  "docs/operations/production-release-foundation.md",
  "utf8",
);

describe("production release foundation acceptance", () => {
  it("exposes complete non-mutating checks and disposable rehearsal", () => {
    expect(pkg.scripts?.["release:check"]).toContain("release:manifest:check");
    expect(pkg.scripts?.["release:check"]).toContain("test:release-foundation");
    expect(pkg.scripts?.["release:rehearse"]).toContain("rehearsal.ts");
    expect(ci).toContain("npm run release:check");
    expect(ci).not.toContain("release:execute");
    expect(ci).not.toContain("release:pilot:enable");
  });

  it("documents exact approval and containment boundaries", () => {
    expect(runbook).toContain("APPROVE <projectRef> <evidenceDigest>");
    expect(runbook).toContain("ENABLE PILOT <workspaceId> <missionId> <evidenceDigest>");
    expect(runbook).toContain("Do not run production execution in this phase");
    expect(runbook).toContain("close new entry");
    expect(runbook).toContain("preserve workflow and audit records");
    expect(runbook).not.toMatch(/db reset --linked|migration down|--include-seed/);
  });

  it("keeps the runbook sections in the approved operator order", () => {
    const sections = [
      "## 1. Authorization boundary",
      "## 2. Pinned toolchain installation",
      "## 3. GitHub Actions availability and billing",
      "## 4. Reward stack integration evidence",
      "## 5. Manifest write and check",
      "## 6. Read-only production preflight",
      "## 7. Disposable rehearsal targets",
      "## 8. Rehearsal commands and artifacts",
      "## 9. Evidence generation and expiry",
      "## 10. No production execution in this phase",
      "## 11. Later go-live approval",
      "## 12. Deployment verification",
      "## 13. Pilot inspection and enablement",
      "## 14. Seven-day observation and exit",
      "## 15. Containment",
      "## 16. Forbidden commands and data handling",
    ];
    let previous = -1;
    for (const section of sections) {
      const position = runbook.indexOf(section);
      expect(position, section).toBeGreaterThan(previous);
      previous = position;
    }
  });
});
