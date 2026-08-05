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

  it("rejects literal credentials pasted into free-form command and note fields", () => {
    const literals = [
      "supabase login --token sbp_0102030405060708090a0b0c0d0e0f1011121314",
      "curl -H 'apikey: sb_secret_9aB3xQ7zLmNpQrStUvWxYz' https://api",
      "PGPASSWORD=SuperSecret123 psql -h db.internal -U postgres",
      "supabase link --project-ref abc --password Hunter2Prod!",
    ];

    for (const command of literals) {
      expect(() => buildEvidence({ ...validInput, containmentCommands: [command] })).toThrow("sensitive evidence value");
      expect(() => buildEvidence({ ...validInput, proposedProductionCommands: [command] })).toThrow("sensitive evidence value");
      expect(() => buildEvidence({ ...validInput, warnings: [command] })).toThrow("sensitive evidence value");
      expect(() => buildEvidence({ ...validInput, skippedChecks: [command] })).toThrow("sensitive evidence value");
      expect(() => buildEvidence({ ...validInput, recoveryReference: command })).toThrow("sensitive evidence value");
    }
  });

  it("accepts placeholder-templated runbook commands", () => {
    const placeholders = [
      "supabase login --token $SUPABASE_ACCESS_TOKEN",
      'supabase link --project-ref abc --password "$PGPASSWORD"',
      "PGPASSWORD=$PGPASSWORD psql -h db.internal -U postgres",
      'PGPASSWORD="${PGPASSWORD}" psql -f supabase/rollback.sql',
      "supabase link --project-ref abc --password <PRODUCTION_DB_PASSWORD>",
    ];

    expect(() =>
      buildEvidence({
        ...validInput,
        proposedProductionCommands: placeholders,
        containmentCommands: placeholders,
      }),
    ).not.toThrow();
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

  it("fails closed for malformed external evidence instead of crashing or persisting it", () => {
    const malformed = { ...buildEvidence(validInput) } as Record<string, unknown>;
    delete malformed.applicationCommit;
    delete malformed.preflightHash;
    delete malformed.roles;

    expect(
      verifyEvidence(malformed as never, {}, new Date("2026-08-01T12:00:00Z")),
    ).toEqual(
      expect.arrayContaining([
        "evidence.applicationCommit is missing",
        "evidence.preflightHash is missing",
        "evidence.roles is missing",
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
