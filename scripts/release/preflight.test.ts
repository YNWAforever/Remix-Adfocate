import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { hasCapabilityValidator, runPreflight, runPreflightCli } from "./preflight";

describe("release preflight", () => {
  it("has a validator for every capability declared by the committed release manifest", () => {
    const manifest = JSON.parse(
      readFileSync("supabase/release-manifest.json", "utf8"),
    ) as { migrations: Array<{ capabilities: string[] }> };
    const capabilities = [
      ...new Set(manifest.migrations.flatMap((migration) => migration.capabilities)),
    ];

    expect(capabilities).toHaveLength(418);
    expect(capabilities.filter((capability) => !hasCapabilityValidator(capability))).toEqual([]);
  });

  it("matches every declared capability kind against its bound schema object", async () => {
    const schema = [
      "CREATE TABLE public.example (example_column text, CONSTRAINT example_constraint CHECK (true));",
      "ALTER TABLE ONLY public.example ADD CONSTRAINT added_constraint CHECK (true);",
      "ALTER TABLE ONLY public.example ENABLE ROW LEVEL SECURITY;",
      "CREATE OR REPLACE FUNCTION public.example_function(p_input uuid) RETURNS void;",
      "GRANT EXECUTE ON FUNCTION public.example_function(uuid) TO authenticated;",
      "GRANT SELECT ON TABLE public.example TO authenticated;",
      "CREATE INDEX example_index ON public.example (example_column);",
      "CREATE POLICY example_policy ON public.example FOR SELECT USING (true);",
      "CREATE POLICY example_storage_policy ON storage.objects FOR SELECT USING (true);",
      "CREATE TRIGGER example_trigger BEFORE INSERT ON public.example FOR EACH ROW EXECUTE FUNCTION public.example_function();",
      "INSERT INTO storage.buckets (id, name) VALUES ('example-bucket', 'example-bucket');",
    ].join("\n");
    const report = await runPreflight(
      {
        databaseUrl: "postgresql://secret",
        projectRef: "project-ref",
        manifestDigest: "a".repeat(64),
        expectedCapabilities: [
          "table:public.example",
          "column:public.example.example_column",
          "constraint:public.example.example_constraint",
          "constraint:public.example.added_constraint",
          "constraint-removed:public.example.no_longer_present",
          "function:public.example_function",
          "grant:authenticated.public.example_function(uuid)",
          "grant:authenticated.public.example(select)",
          "index:public.example.example_index",
          "policy:public.example.example_policy",
          "rls:public.example",
          "storage-bucket:storage.buckets.example-bucket",
          "storage-policy:storage.objects.example_storage_policy",
          "trigger:public.example_trigger",
          "trigger:public.example.example_trigger",
        ],
        now: new Date("2026-08-01T00:00:00Z"),
      },
      {
        run: vi.fn().mockResolvedValue({ code: 0, stdout: "", stderr: "" }),
        readFile: vi.fn().mockResolvedValue(schema),
        rm: vi.fn().mockResolvedValue(undefined),
        tempFile: () => "C:/temp/schema.sql",
      },
    );

    expect(report.capabilities).toEqual([
      { name: "table:public.example", status: "present" },
      { name: "column:public.example.example_column", status: "present" },
      { name: "constraint:public.example.example_constraint", status: "present" },
      { name: "constraint:public.example.added_constraint", status: "present" },
      { name: "constraint-removed:public.example.no_longer_present", status: "present" },
      { name: "function:public.example_function", status: "present" },
      { name: "grant:authenticated.public.example_function(uuid)", status: "present" },
      { name: "grant:authenticated.public.example(select)", status: "present" },
      { name: "index:public.example.example_index", status: "present" },
      { name: "policy:public.example.example_policy", status: "present" },
      { name: "rls:public.example", status: "present" },
      { name: "storage-bucket:storage.buckets.example-bucket", status: "unverifiable" },
      {
        name: "storage-policy:storage.objects.example_storage_policy",
        status: "unverifiable",
      },
      { name: "trigger:public.example_trigger", status: "present" },
      { name: "trigger:public.example.example_trigger", status: "present" },
    ]);
  });

  it("does not accept an unrelated column name as evidence for the target table", async () => {
    const report = await runPreflight(
      {
        databaseUrl: "postgresql://secret",
        projectRef: "project-ref",
        manifestDigest: "a".repeat(64),
        expectedCapabilities: ["column:public.example.example_column"],
        now: new Date("2026-08-01T00:00:00Z"),
      },
      {
        run: vi.fn().mockResolvedValue({ code: 0, stdout: "", stderr: "" }),
        readFile: vi.fn().mockResolvedValue("CREATE TABLE public.other (example_column text);"),
        rm: vi.fn().mockResolvedValue(undefined),
        tempFile: () => "C:/temp/schema.sql",
      },
    );

    expect(report.capabilities).toEqual([
      { name: "column:public.example.example_column", status: "absent" },
    ]);
  });

  it("does not let a trigger match across statements to a later target relation", async () => {
    const report = await runPreflight(
      {
        databaseUrl: "postgresql://secret",
        projectRef: "project-ref",
        manifestDigest: "a".repeat(64),
        expectedCapabilities: ["trigger:public.example.example_trigger"],
        now: new Date(),
      },
      {
        run: vi.fn().mockResolvedValue({ code: 0, stdout: "", stderr: "" }),
        readFile: vi.fn().mockResolvedValue([
          "CREATE TRIGGER example_trigger BEFORE INSERT ON public.other FOR EACH ROW EXECUTE FUNCTION public.example_function();",
          "CREATE INDEX later_example_index ON public.example (id);",
        ].join("\n")),
        rm: vi.fn().mockResolvedValue(undefined),
        tempFile: () => "C:/temp/schema.sql",
      },
    );

    expect(report.capabilities).toEqual([
      { name: "trigger:public.example.example_trigger", status: "absent" },
    ]);
  });

  it("redacts a rejected command runner error before rethrowing it", async () => {
    const rejected = Object.assign(new Error("spawn npx postgresql://secret failed"), {
      spawnargs: ["supabase", "migration", "list", "--db-url", "postgresql://secret"],
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
          run: vi.fn().mockRejectedValue(rejected),
          readFile: vi.fn(),
          rm: vi.fn().mockResolvedValue(undefined),
          tempFile: () => "C:/temp/schema.sql",
        },
      ),
    ).rejects.toThrow("command execution failed: spawn npx [REDACTED] failed");
  });

  it("accepts pg_dump function grant formatting without broadening table grants", async () => {
    const report = await runPreflight(
      {
        databaseUrl: "postgresql://secret",
        projectRef: "project-ref",
        manifestDigest: "a".repeat(64),
        expectedCapabilities: [
          "grant:authenticated.public.example_function(uuid,timestamptz)",
          "grant:authenticated.public.named_function(uuid,timestamptz)",
          "grant:service_role.public.submit_mission_publication_proof(uuid,uuid,uuid,uuid,text,integer,uuid,jsonb,uuid[])",
          "grant:authenticated.public.example(all)",
          "grant:authenticated.public.example(select)",
        ],
        now: new Date(),
      },
      {
        run: vi.fn().mockResolvedValue({ code: 0, stdout: "", stderr: "" }),
        readFile: vi.fn().mockResolvedValue([
          "GRANT ALL PRIVILEGES ON FUNCTION public.example_function(pg_catalog.uuid, timestamp with time zone) TO authenticated;",
          "GRANT ALL ON FUNCTION \"public\".\"named_function\"(\"p_id\" \"uuid\", \"p_at\" \"timestamp with time zone\") TO \"authenticated\";",
          "GRANT ALL ON FUNCTION \"public\".\"submit_mission_publication_proof\"(\"p_mission\" \"uuid\", \"p_workspace\" \"uuid\", \"p_creator\" \"uuid\", \"p_submission\" \"uuid\", \"p_url\" \"text\", \"p_revision\" \"integer\", \"p_actor\" \"uuid\", \"p_evidence\" \"jsonb\", \"p_asset_ids\" \"uuid\"[]) TO \"service_role\";",
          "GRANT ALL ON TABLE public.example TO authenticated;",
          "GRANT SELECT ON TABLE public.example TO authenticated;",
        ].join("\n")),
        rm: vi.fn().mockResolvedValue(undefined),
        tempFile: () => "C:/temp/schema.sql",
      },
    );

    expect(report.capabilities.every((capability) => capability.status === "present")).toBe(true);
  });

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
