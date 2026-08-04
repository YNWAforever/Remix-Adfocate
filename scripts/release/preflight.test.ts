import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runPreflight, runPreflightCli } from "./preflight";

describe("release preflight", () => {
  it("uses only migration list, dry-run, and schema dump without reporting the URL", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({ code: 0, stdout: "Local | Remote\n1 | 1", stderr: "" })
      .mockResolvedValueOnce({ code: 0, stdout: "Would push 20260715163350", stderr: "" })
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });
    const schema = [
      "CREATE TABLE public.mission_workflows ();",
      "ALTER TABLE public.missions ADD COLUMN creator_workflow_mode text;",
      "CREATE FUNCTION public.create_mission_workflow(p_submission uuid) RETURNS void;",
      "CREATE TABLE public.mission_publication_proof_attempts ();",
      "CREATE TABLE public.mission_reward_contracts ();",
      "CREATE TABLE public.mission_completion_decisions ();",
      "CREATE TABLE public.mission_pending_rewards ();",
    ].join("\n");
    const readFile = vi.fn().mockResolvedValue(schema);
    const rm = vi.fn().mockResolvedValue(undefined);

    const report = await runPreflight(
      {
        databaseUrl: "postgresql://secret",
        projectRef: "project-ref",
        manifestDigest: "a".repeat(64),
        expectedCapabilities: [
          "table:public.mission_workflows",
          "column:public.missions.creator_workflow_mode",
          "function:public.create_mission_workflow",
          "table:public.mission_publication_proof_attempts",
          "table:public.mission_reward_contracts",
          "table:public.mission_completion_decisions",
          "table:public.mission_pending_rewards",
        ],
        now: new Date("2026-08-01T00:00:00Z"),
      },
      { run, readFile, rm, tempFile: () => "C:/temp/schema.sql" },
    );

    expect(run.mock.calls.map((call) => call[1])).toEqual([
      ["supabase", "migration", "list", "--db-url", "postgresql://secret"],
      ["supabase", "db", "push", "--dry-run", "--db-url", "postgresql://secret"],
      [
        "supabase",
        "db",
        "dump",
        "--db-url",
        "postgresql://secret",
        "--file",
        "C:/temp/schema.sql",
        "--keep-comments",
      ],
    ]);
    expect(readFile).toHaveBeenCalledWith("C:/temp/schema.sql", "utf8");
    expect(rm).toHaveBeenCalledWith("C:/temp/schema.sql", { force: true });
    expect(JSON.stringify(report)).not.toContain("postgresql://secret");
    expect(report.capabilities.every((item) => item.status === "present")).toBe(true);
  });

  it("fails before reporting a result when any read-only command fails", async () => {
    const run = vi.fn().mockResolvedValue({
      code: 1,
      stdout: "",
      stderr: "denied for postgresql://secret",
    });

    await expect(
      runPreflight(
        {
          databaseUrl: "postgresql://secret",
          projectRef: "project-ref",
          manifestDigest: "a".repeat(64),
          expectedCapabilities: [],
          now: new Date(),
        },
        {
          run,
          readFile: vi.fn(),
          rm: vi.fn().mockResolvedValue(undefined),
          tempFile: () => "C:/temp/schema.sql",
        },
      ),
    ).rejects.toThrow("migration list failed: denied for [REDACTED]");
  });

  it("normalizes schema fingerprints and fail-closes unknown capabilities", async () => {
    const run = vi.fn().mockResolvedValue({ code: 0, stdout: "output\r\n", stderr: "" });
    const report = await runPreflight(
      {
        databaseUrl: "postgresql://secret",
        projectRef: "project-ref",
        manifestDigest: "a".repeat(64),
        expectedCapabilities: ["table:public.mission_workflows", "future:capability"],
        now: new Date("2026-08-01T00:00:00Z"),
      },
      {
        run,
        readFile: vi.fn().mockResolvedValue("CREATE TABLE public.mission_workflows ();\r\n"),
        rm: vi.fn().mockResolvedValue(undefined),
        tempFile: () => "C:/temp/schema.sql",
      },
    );

    expect(report.schemaFingerprint).toBe(
      "6c7e2503e6ae1077291c4d5e4a947d8fc65b56cf52912fbf35a9bdbd10440652",
    );
    expect(report.capabilities).toEqual([
      { name: "table:public.mission_workflows", status: "present" },
      { name: "future:capability", status: "unverifiable" },
    ]);
    expect(report.warnings).toEqual(["unverifiable capability: future:capability"]);
  });

  it("writes a deduplicated manifest preflight only to the requested non-migration output", async () => {
    const readFile = vi
      .fn()
      .mockResolvedValueOnce(
        JSON.stringify({
          schemaVersion: 1,
          cliVersion: "2.110.0",
          generatedFrom: "supabase/migrations",
          migrations: [
            {
              version: "20260715163350",
              name: "active_mission_workspace",
              path: "supabase/migrations/20260715163350_active_mission_workspace.sql",
              sha256: "a".repeat(64),
              phase: "active_mission",
              dependsOn: [],
              capabilities: ["table:public.mission_workflows"],
              transactionExpectation: "transactional",
              replayExpectation: "migration_history_noop",
            },
            {
              version: "20260715163351",
              name: "next",
              path: "supabase/migrations/20260715163351_next.sql",
              sha256: "b".repeat(64),
              phase: "active_mission",
              dependsOn: ["20260715163350"],
              capabilities: ["table:public.mission_workflows"],
              transactionExpectation: "transactional",
              replayExpectation: "migration_history_noop",
            },
          ],
        }),
      )
      .mockResolvedValueOnce("CREATE TABLE public.mission_workflows ();");
    const writeFile = vi.fn().mockResolvedValue(undefined);
    const run = vi.fn().mockResolvedValue({ code: 0, stdout: "", stderr: "" });

    await runPreflightCli(
      ["--output", "docs/verification/releases/preflight.json"],
      "C:/repo",
      {
        PREFLIGHT_DATABASE_URL: "postgresql://secret",
        RELEASE_PROJECT_REF: "project-ref",
      },
      {
        run,
        readFile,
        rm: vi.fn().mockResolvedValue(undefined),
        tempFile: () => "C:/temp/schema.sql",
        writeFile,
      },
    );

    expect(writeFile).toHaveBeenCalledWith(
      resolve("C:/repo", "docs/verification/releases/preflight.json"),
      expect.stringContaining('"targetProjectRef": "project-ref"'),
      "utf8",
    );
    expect(JSON.stringify(writeFile.mock.calls)).not.toContain("postgresql://secret");
    expect(JSON.parse(writeFile.mock.calls[0]?.[1] as string).capabilities).toEqual([
      { name: "table:public.mission_workflows", status: "present" },
    ]);
    await expect(
      runPreflightCli(
        ["--output", "supabase/migrations/preflight.json"],
        "C:/repo",
        { PREFLIGHT_DATABASE_URL: "postgresql://secret", RELEASE_PROJECT_REF: "project-ref" },
        { run, readFile, rm: vi.fn(), tempFile: () => "C:/temp/schema.sql", writeFile },
      ),
    ).rejects.toThrow("preflight output must not be inside supabase/migrations");
  });
});
