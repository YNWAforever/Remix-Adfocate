import { describe, expect, it, vi } from "vitest";
import {
  buildEvidence,
  digestEvidence,
  persistEvidence,
  runEvidenceCli,
  verifyEvidence,
} from "./evidence";
import { validEvidenceInput as validInput } from "./evidence.fixture";

describe("release evidence", () => {
  it("is deterministic and rejects secret-bearing values", () => {
    const evidence = buildEvidence(validInput);
    const bundleDigest = digestEvidence(evidence);

    expect(bundleDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(
      verifyEvidence(
        evidence,
        {
          projectRef: validInput.targetProjectRef,
          schemaFingerprint: validInput.schemaFingerprint,
          manifestDigest: validInput.manifestDigest,
          applicationCommit: validInput.applicationCommit,
          bundleDigest,
        },
        new Date("2026-08-01T12:00:00Z"),
      ),
    ).toEqual([]);
    expect(() =>
      buildEvidence({
        ...validInput,
        recoveryReference: "postgresql://user:password@host/db",
      }),
    ).toThrow("sensitive evidence value");
  });

  it("reports every fail-closed verification mismatch", () => {
    const evidence = buildEvidence(validInput);

    expect(
      verifyEvidence(
        { ...evidence, recoveryReference: "" },
        {
          projectRef: "wrong-project",
          schemaFingerprint: "0".repeat(64),
          manifestDigest: "2".repeat(64),
          applicationCommit: "3".repeat(40),
          bundleDigest: "4".repeat(64),
          migrationRange: { from: "1", to: "2" },
          migrationChecksums: [],
          recoveryReference: "expected-recovery",
          roles: { executor: "someone-else" },
        },
        new Date("2026-08-03T00:00:00Z"),
      ),
    ).toEqual(
      expect.arrayContaining([
        "target project reference mismatch",
        "schema fingerprint mismatch",
        "manifest digest mismatch",
        "application commit mismatch",
        "migration range mismatch",
        "migration checksums mismatch",
        "recovery reference is missing",
        "recovery reference mismatch",
        "role mismatch: executor",
        "evidence has expired",
        "evidence content digest mismatch",
        "evidence bundle digest mismatch",
      ]),
    );
  });

  it("writes timestamped evidence exclusively and does not overwrite an existing artifact", async () => {
    const evidence = buildEvidence(validInput);
    const writeFile = async () => {
      const error = Object.assign(new Error("already exists"), { code: "EEXIST" });
      throw error;
    };

    await expect(
      persistEvidence(evidence, "C:/repo/docs/verification/releases", {
        mkdir: async () => undefined,
        writeFile,
      }),
    ).rejects.toThrow("already exists");
  });

  it("generates a sanitized append-only artifact from an explicit input file", async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined);
    const report = await runEvidenceCli(["--input", "release-input.json"], process.cwd(), {
      readFile: async () => JSON.stringify(validInput),
      mkdir: async () => undefined,
      writeFile,
    });

    expect(report.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(report.path).toContain("docs");
    expect(writeFile).toHaveBeenCalledWith(
      expect.stringContaining("docs"),
      expect.stringContaining('"contentDigest"'),
      { encoding: "utf8", flag: "wx" },
    );
  });
});
