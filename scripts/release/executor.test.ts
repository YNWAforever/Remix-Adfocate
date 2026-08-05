import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { digestEvidence, buildEvidence } from "./evidence";
import { executeRelease, runExecutorCli } from "./executor";
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
      currentApplicationCommit: validEvidence.applicationCommit,
      expectedCapabilities: ["table:public.mission_workflows"],
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
      currentApplicationCommit: validEvidence.applicationCommit,
      expectedCapabilities: ["table:public.mission_workflows"],
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

  it("rejects a trusted checkout commit mismatch before the dry-run", async () => {
    const run = vi.fn();

    await expect(
      executeRelease(
        {
          databaseUrl: "postgresql://secret",
          projectRef: validEvidence.targetProjectRef,
          evidence: validEvidence,
          evidenceDigest: digestEvidence(validEvidence),
          currentSchemaFingerprint: validEvidence.schemaFingerprint,
          currentManifestDigest: validEvidence.manifestDigest,
          currentApplicationCommit: "0".repeat(40),
          expectedCapabilities: [],
          now: new Date("2026-08-01T12:00:00Z"),
          apply: false,
          approval: "",
        },
        { run, postflight: vi.fn() },
      ),
    ).rejects.toThrow("application commit mismatch");
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects an empty or incomplete postflight capability report", async () => {
    const run = vi.fn().mockResolvedValue({ code: 0, stdout: "ok", stderr: "" });
    const input = {
      databaseUrl: "postgresql://secret",
      projectRef: validEvidence.targetProjectRef,
      evidence: validEvidence,
      evidenceDigest: digestEvidence(validEvidence),
      currentSchemaFingerprint: validEvidence.schemaFingerprint,
      currentManifestDigest: validEvidence.manifestDigest,
      currentApplicationCommit: validEvidence.applicationCommit,
      expectedCapabilities: ["table:public.mission_workflows", "table:public.mission_pending_rewards"],
      now: new Date("2026-08-01T12:00:00Z"),
      apply: true,
      approval: `APPROVE ${validEvidence.targetProjectRef} ${digestEvidence(validEvidence)}`,
    };

    await expect(
      executeRelease(input, {
        run,
        postflight: vi.fn().mockResolvedValue({
          schemaFingerprint: "expanded-fingerprint",
          manifestDigest: validEvidence.manifestDigest,
          capabilities: [{ name: "table:public.mission_workflows", status: "present" }],
        }),
      }),
    ).rejects.toThrow("postflight capability coverage mismatch");
  });

  it("rejects a manifest validation failure before the first preflight", async () => {
    const manifest = readFileSync("supabase/release-manifest.json", "utf8");
    const run = vi.fn();
    const validateManifest = vi.fn().mockResolvedValue(["checksum drift: 20260731140000"]);

    await expect(
      runExecutorCli(
        [
          "--bundle",
          "docs/verification/releases/evidence.json",
          "--bundle-digest",
          "a".repeat(64),
          "--project-ref",
          validEvidence.targetProjectRef,
          "--approval",
          "not-approved",
        ],
        process.cwd(),
        {
          RELEASE_DATABASE_URL: "postgresql://secret",
          RELEASE_PROJECT_REF: validEvidence.targetProjectRef,
          RELEASE_APPLICATION_COMMIT: validEvidence.applicationCommit,
        },
        {
          run,
          readFile: async () => manifest,
          rm: async () => undefined,
          tempFile: () => "C:/temp/schema.sql",
          validateManifest,
        } as never,
      ),
    ).rejects.toThrow("release manifest rejected: checksum drift: 20260731140000");
    expect(run).not.toHaveBeenCalled();
  });
});
