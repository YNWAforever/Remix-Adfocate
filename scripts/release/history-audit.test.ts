import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ReleaseManifest } from "./contracts";
import { auditMigrationHistory, parseHistorySnapshot, readMigrationSources, runHistoryAuditCli, type MigrationHistorySnapshot, type MigrationSource } from "./history-audit";

const project = "readiness-test-project";
const version = "20261113090000";
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const sql = "select 1;\n";
const source: MigrationSource = { version, name: "example", path: `supabase/migrations/${version}_example.sql`, sha256: sha256(sql) };
const manifest: ReleaseManifest = {
  schemaVersion: 1, cliVersion: "2.110.0", generatedFrom: "supabase/migrations",
  migrations: [{ version, name: "example", path: source.path, sha256: source.sha256, phase: "active_mission", dependsOn: [],
    capabilities: ["table:public.example", "function:public.join_example", "grant:authenticated.public.example(select)"],
    transactionExpectation: "transactional", replayExpectation: "migration_history_noop" }],
};
function snapshot(overrides: Partial<MigrationHistorySnapshot> = {}): MigrationHistorySnapshot {
  return { schemaVersion: 1, targetProjectRef: project, observedAt: "2026-11-13T08:00:00Z", transactionReadOnly: true,
    history: [], catalogObjects: ["table:public.example", "function:public.join_example"], ...overrides };
}
function row(rowVersion = version, name: string | null = "example") {
  return { version: rowVersion, name, statementCount: 1, statementsSha256: "a".repeat(64) };
}

describe("migration history audit", () => {
  it("distinguishes missing history from present objects and never produces release approval", () => {
    const report = auditMigrationHistory(manifest, snapshot(), [source]);
    expect(report).toMatchObject({ decision: "HOLD", validReleaseEvidence: false, automaticWrites: [], counts: {
      reviewedHistoryMissing: 1, missingHistoryWithSomeObjectsPresent: 1, missingHistoryWithSomeObjectsAbsent: 0,
    } });
    expect(report.reviewedMigrations[0]).toMatchObject({ history: "missing", objectExistence: { present: 2, absent: 0, unchecked: 1 } });
    expect(report).not.toHaveProperty("schemaFingerprint");
    expect(report).not.toHaveProperty("releaseEvidenceDigest");
  });

  it("shows absent objects separately without declaring an entire migration unapplied", () => {
    const report = auditMigrationHistory(manifest, snapshot({ catalogObjects: ["table:public.example"] }), [source]);
    expect(report.reviewedMigrations[0].capabilities).toContainEqual({ name: "function:public.join_example", objectExistence: "absent" });
    expect(report.counts.missingHistoryWithSomeObjectsAbsent).toBe(1);
    expect(report.decision).toBe("HOLD");
  });

  it("matches legacy schema-wide trigger inventory against its actual table without crossing schemas", () => {
    const triggerManifest: ReleaseManifest = { ...manifest, migrations: [{ ...manifest.migrations[0], capabilities: ["trigger:public.example_immutable"] }] };
    const present = auditMigrationHistory(triggerManifest, snapshot({ catalogObjects: ["trigger:public.example.example_immutable"] }), [source]);
    expect(present.reviewedMigrations[0].objectExistence).toEqual({ present: 1, absent: 0, unchecked: 0 });
    const foreign = auditMigrationHistory(triggerManifest, snapshot({ catalogObjects: ["trigger:private.example.example_immutable"] }), [source]);
    expect(foreign.reviewedMigrations[0].objectExistence.absent).toBe(1);
  });

  it("keeps the audit on hold even when every version is recorded", () => {
    const report = auditMigrationHistory(manifest, snapshot({ history: [row()] }), [source]);
    expect(report.counts.reviewedHistoryMissing).toBe(0);
    expect(report.reviewedMigrations[0]).toMatchObject({ history: "recorded", recordedNameMatches: true });
    expect(report.decision).toBe("HOLD");
  });

  it("treats names from baseline history as manual comparison candidates only", () => {
    const baseline = { version: "0001", name: "init", path: "supabase/migrations/0001_init.sql", sha256: "b".repeat(64) };
    const report = auditMigrationHistory(manifest, snapshot({ history: [row("20260613123947", "init")] }), [source, baseline]);
    expect(report.outsideManifestHistory[0]).toMatchObject({ exactSourcePath: null, nameCandidateSourcePaths: [baseline.path] });
    expect(report.counts.reviewedHistoryRecorded).toBe(0);
    expect(report.automaticWrites).toEqual([]);
  });

  it("recognizes prefixed baseline names without treating them as recorded source versions", () => {
    const baseline = { version: "0012", name: "trust_profile_bundle", path: "supabase/migrations/0012_trust_profile_bundle.sql", sha256: "b".repeat(64) };
    const report = auditMigrationHistory(manifest, snapshot({ history: [row("20260618181926", "0012_trust_profile_bundle")] }), [source, baseline]);
    expect(report.outsideManifestHistory[0].nameCandidateSourcePaths).toEqual([baseline.path]);
    expect(report.counts.reviewedHistoryRecorded).toBe(0);
  });

  it("flags a recorded name mismatch without comparing split statements to a file checksum", () => {
    const report = auditMigrationHistory(manifest, snapshot({ history: [row(version, "different_name")] }), [source]);
    expect(report.reviewedMigrations[0]).toMatchObject({ history: "recorded", recordedNameMatches: false });
    expect(report.reviewedMigrations[0]).not.toHaveProperty("checksumMatches");
  });

  it("refuses changed source files instead of trusting a stale manifest", () => {
    expect(() => auditMigrationHistory(manifest, snapshot(), [{ ...source, sha256: "b".repeat(64) }])).toThrow("source does not match");
  });

  it.each([
    { transactionReadOnly: false },
    { history: [{ ...row(), statements: ["private authored data"] }] },
    { history: [{ ...row(), name: "person@example.invalid" }] },
    { catalogObjects: ["table:auth.users"] },
    { catalogObjects: ["raw proof URL"] },
    { observedAt: "not a date" },
  ])("rejects unsafe or unverified snapshot fields (%j)", (override) => {
    expect(() => parseHistorySnapshot({ ...snapshot(), ...override }, project)).toThrow("invalid or unsanitized");
  });

  it("rejects project substitution and duplicated versions", () => {
    expect(() => parseHistorySnapshot(snapshot(), "different-project")).toThrow("target project mismatch");
    expect(() => parseHistorySnapshot(snapshot({ history: [row(), row()] }), project)).toThrow("duplicate migration history version");
  });

  it("canonicalizes history and catalog ordering for repeatable review", () => {
    const first = parseHistorySnapshot(snapshot({ history: [row(), row("0001", "init")], catalogObjects: ["table:public.example", "function:public.join_example", "table:public.example"] }), project);
    const second = parseHistorySnapshot(snapshot({ history: [row("0001", "init"), row()], catalogObjects: ["function:public.join_example", "table:public.example"] }), project);
    expect(first).toEqual(second);
  });

  it("writes a new report from sanitized local data and refuses overwrite, apply, and migration paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "history-audit-"));
    try {
      await mkdir(join(root, "supabase/migrations"), { recursive: true });
      await writeFile(join(root, source.path), sql.replaceAll("\n", "\r\n"));
      await writeFile(join(root, "supabase/release-manifest.json"), JSON.stringify(manifest));
      await writeFile(join(root, "snapshot.json"), JSON.stringify(snapshot()));
      const args = ["--snapshot", "snapshot.json", "--project-ref", project, "--output", "report.json"];
      const report = await runHistoryAuditCli(args, root);
      expect(JSON.parse(await readFile(join(root, "report.json"), "utf8"))).toEqual(report);
      await expect(runHistoryAuditCli(args, root)).rejects.toThrow();
      await expect(runHistoryAuditCli([...args, "--apply"], root)).rejects.toThrow("usage:");
      await expect(runHistoryAuditCli([...args.slice(0, 5), "supabase/migrations/report.json"], root)).rejects.toThrow("outside migrations");
      await symlink(join(root, "supabase/migrations"), join(root, "alias"), process.platform === "win32" ? "junction" : "dir");
      await expect(runHistoryAuditCli([...args.slice(0, 5), "alias/report.json"], root)).rejects.toThrow("outside migrations");
      await expect(readFile(join(root, "supabase/migrations/report.json"))).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readFile(join(root, source.path), "utf8")).toBe(sql.replaceAll("\n", "\r\n"));
    } finally {
      if (!root.startsWith(join(tmpdir(), "history-audit-"))) throw new Error("unexpected test cleanup path");
      await rm(root, { recursive: true, force: true });
    }
  });

  it("matches manifest hashing for a lone-CR source checkout", async () => {
    const root = await mkdtemp(join(tmpdir(), "history-audit-"));
    try {
      await mkdir(join(root, "supabase/migrations"), { recursive: true });
      await writeFile(join(root, source.path), sql.replaceAll("\n", "\r"));
      expect(await readMigrationSources(root)).toEqual([source]);
    } finally {
      if (!root.startsWith(join(tmpdir(), "history-audit-"))) throw new Error("unexpected test cleanup path");
      await rm(root, { recursive: true, force: true });
    }
  });
});
