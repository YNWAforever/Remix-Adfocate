import { describe, expect, it, vi } from "vitest";
import { digestEvidence, buildEvidence } from "./evidence";
import { executeRelease } from "./executor";
import { validEvidenceInput } from "./evidence.fixture";

const validEvidence = buildEvidence(validEvidenceInput);

describe("production release executor", () => {
  it("dry-runs first, writes only with exact approval, and proves postflight", async () => {
    const run = vi.fn().mockResolvedValue({ code: 0, stdout: "ok", stderr: "" });
    const postflight = vi.fn().mockResolvedValue({
      schemaFingerprint: "expanded-fingerprint",
      manifestDigest: "a".repeat(64),
      capabilities: [{ name: "table:public.mission_workflows", status: "present" }],
    });
    const base = {
      databaseUrl: "postgresql://secret",
      projectRef: "mhkoayftiuojxlrkollf",
      evidence: validEvidence,
      evidenceDigest: digestEvidence(validEvidence),
      currentSchemaFingerprint: validEvidence.schemaFingerprint,
      currentManifestDigest: validEvidence.manifestDigest,
      now: new Date("2026-08-01T12:00:00Z"),
    };

    await executeRelease({ ...base, apply: false, approval: "" }, { run, postflight });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[1]).toContain("--dry-run");
    expect(postflight).not.toHaveBeenCalled();

    run.mockClear();
    await executeRelease(
      {
        ...base,
        apply: true,
        approval: `APPROVE ${base.projectRef} ${base.evidenceDigest}`,
      },
      { run, postflight },
    );
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1]?.[1]).not.toContain("--dry-run");
    expect(postflight).toHaveBeenCalledTimes(1);
  });

  it("does not write when evidence or approval fails and redacts database URLs", async () => {
    const run = vi.fn().mockResolvedValue({
      code: 1,
      stdout: "",
      stderr: "cannot connect postgresql://user:password@host/db",
    });
    const input = {
      databaseUrl: "postgresql://user:password@host/db",
      projectRef: validEvidence.targetProjectRef,
      evidence: validEvidence,
      evidenceDigest: digestEvidence(validEvidence),
      currentSchemaFingerprint: validEvidence.schemaFingerprint,
      currentManifestDigest: validEvidence.manifestDigest,
      now: new Date("2026-08-01T12:00:00Z"),
      apply: true,
      approval: "APPROVE wrong digest",
    };

    await expect(executeRelease(input, { run, postflight: vi.fn() })).rejects.toThrow("[REDACTED]");
    await expect(executeRelease(input, { run, postflight: vi.fn() })).rejects.not.toThrow(
      "postgresql://user:password@host/db",
    );
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls.every((call) => !call[1].includes("--include-seed"))).toBe(true);
  });
});
