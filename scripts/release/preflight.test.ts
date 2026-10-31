import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { hasCapabilityValidator, runPreflight, runPreflightCli } from "./preflight";

// Contracts added by the 2026-10-29 end-to-end review remediation (docs/review/).
const REMEDIATION_CAPABILITIES = [
  "grant-removed:authenticated.public.missions(insert)",
  "grant-removed:authenticated.public.missions(delete)",
  "grant-removed:authenticated.public.campaigns(insert)",
  "grant-removed:authenticated.public.campaigns(delete)",
  "grant-removed:authenticated.public.campaign_missions(insert)",
  "grant-removed:authenticated.public.campaign_missions(update)",
  "grant-removed:authenticated.public.campaign_missions(delete)",
  "constraint:public.missions.missions_points_reward_nonneg",
  "constraint:public.missions.missions_cash_reward_nonneg",
  "constraint:public.missions.missions_cpm_nonneg",
  "constraint:public.missions.missions_quota_filled_nonneg",
  "constraint:public.campaigns.campaigns_bonus_nonneg",
  "constraint:public.campaigns.campaigns_goal_target_positive",
  "function:public.decide_legacy_submission",
  "grant:service_role.public.decide_legacy_submission(uuid,uuid,uuid,text,text,smallint)",
  "grant-removed:authenticated.public.decide_legacy_submission(uuid,uuid,uuid,text,text,smallint)",
  "grant-removed:anon.public.decide_legacy_submission(uuid,uuid,uuid,text,text,smallint)",
  "grant-removed:public.public.decide_legacy_submission(uuid,uuid,uuid,text,text,smallint)",
  "column:public.mission_pending_rewards.settled_at",
  "column:public.mission_pending_rewards.settled_by",
  "column:public.mission_pending_rewards.settlement_idempotency_key",
  "constraint:public.mission_pending_rewards.mission_pending_rewards_settlement_check",
  "index:public.point_transactions.point_transactions_mission_reward_uniq",
  "index:public.earnings_transactions.earnings_transactions_mission_reward_uniq",
  "function:public.settle_mission_reward_handoff",
  "grant:service_role.public.settle_mission_reward_handoff(uuid,uuid,uuid,uuid)",
  "grant-removed:authenticated.public.settle_mission_reward_handoff(uuid,uuid,uuid,uuid)",
  "grant-removed:anon.public.settle_mission_reward_handoff(uuid,uuid,uuid,uuid)",
  "grant-removed:public.public.settle_mission_reward_handoff(uuid,uuid,uuid,uuid)",
  "policy:public.kb_documents.kb_documents_read",
  "policy:public.kb_chunks.kb_chunks_read",
  "grant-removed:authenticated.public.assistant_conversations(insert)",
  "grant-removed:authenticated.public.assistant_conversations(update)",
  "grant-removed:authenticated.public.assistant_conversations(delete)",
  "grant-removed:authenticated.public.assistant_messages(insert)",
  "grant-removed:authenticated.public.assistant_messages(update)",
  "grant-removed:authenticated.public.assistant_messages(delete)",
  "policy:public.assistant_conversations.conv_self",
  "policy:public.assistant_messages.msg_self",
  "table:public.creator_consents",
  "rls:public.creator_consents",
  "index:public.creator_consents.creator_consents_creator_document_idx",
  "policy:public.creator_consents.creator_consents_self_read",
  "trigger:public.creator_consents.creator_consents_append_only",
  "function:private.creator_consents_append_only",
  "grant:authenticated.public.creator_consents(select)",
  "grant-removed:authenticated.public.creator_consents(insert)",
  "grant-removed:anon.public.creator_consents(select)",
  "grant:service_role.public.creator_consents(insert)",
  "column:public.creators.deleted_at",
  "constraint:public.creators.creators_status_chk",
  "function:public.anonymize_creator_account",
  "grant:service_role.public.anonymize_creator_account(uuid)",
  "grant-removed:authenticated.public.anonymize_creator_account(uuid)",
  "grant-removed:anon.public.anonymize_creator_account(uuid)",
  "grant-removed:public.public.anonymize_creator_account(uuid)",
];

const STUDIO_CAPABILITIES = [
  "column:public.missions.public_preview_enabled",
  ...["studio_threads","studio_sources","studio_briefs","studio_shares","studio_commands","studio_badges"].flatMap(table=>[
    `table:public.${table}`,`rls:public.${table}`,`policy:public.${table}.studio_owner_read`,
    `grant:authenticated.public.${table}(select)`,...(["insert","update","delete"].map(action=>`grant-removed:authenticated.public.${table}(${action})`)),
  ]),
  "function:public.studio_command","grant:service_role.public.studio_command(uuid,uuid,uuid,text,jsonb)",
  ...["authenticated","anon","public"].map(role=>`grant-removed:${role}.public.studio_command(uuid,uuid,uuid,text,jsonb)`),
  "function:public.resolve_studio_request_context","grant:service_role.public.resolve_studio_request_context(uuid,uuid,uuid,text,text,uuid,text)",
  ...["authenticated","anon","public"].map(role=>`grant-removed:${role}.public.resolve_studio_request_context(uuid,uuid,uuid,text,text,uuid,text)`),
  "trigger:public.mission_pending_rewards.studio_settlement_badge","trigger:public.mission_submissions.studio_legacy_badge","trigger:public.creators.studio_account_cleanup",
];

// New contracts from the three reviewed Stage 4 migrations. Existing Studio/assistant
// RPC redeclarations remain in their original baseline rather than being excluded twice.
const INTEGRATION_CAPABILITIES = [
  ...["integration_connections", "integration_resources", "integration_snapshots", "integration_events", "integration_sync_runs"].flatMap(table => [
    `table:public.${table}`, `rls:public.${table}`, `policy:public.${table}.integration_owner_read`,
    `grant:authenticated.public.${table}(select)`,
    ...["insert", "update", "delete"].map(action => `grant-removed:authenticated.public.${table}(${action})`),
  ]),
  ...["integration_credentials", "integration_oauth_states", "integration_commands", "integration_use_permits"].map(table => `table:private.${table}`),
  ...["integration_hash", "integration_keys", "integration_envelope", "integration_cached_resources", "integration_immutable_snapshot", "integration_connection", "integration_foundation_command",
    "integration_source", "integration_evidence_command", "studio_command_stage3", "integration_invalidate", "integration_purge", "integration_privacy_command", "integration_account_cleanup", "save_assistant_turn_stage3", "get_assistant_request_stage3"].map(name => `function:private.${name}`),
  "trigger:public.integration_snapshots.integration_immutable_snapshot",
  ...["integration", "integration_connection_id", "integration_resource_id", "integration_snapshot_id"].map(column => `column:public.studio_sources.${column}`),
  "constraint:public.studio_sources.studio_source_coverage",
  "constraint:public.studio_sources.studio_source_integration_fk",
  "column:public.studio_shares.integration_receipt",
  "trigger:public.creators.integration_account_cleanup",
  "function:public.integration_command",
  "grant:service_role.public.integration_command(uuid,uuid,uuid,text,jsonb)",
  ...["authenticated", "anon", "public"].map(role => `grant-removed:${role}.public.integration_command(uuid,uuid,uuid,text,jsonb)`),
];

// D0 additions are counted independently; none replaces an earlier release contract.
const PILOT_CAPABILITIES = [
  ...["integration_pilot_grants", "integration_pilot_bindings", "integration_pilot_oauth", "integration_refresh_leases", "integration_pilot_evidence", "integration_pilot_tombstones", "integration_pilot_maintenance", "integration_pilot_notices"].flatMap(table => [`table:private.${table}`, `rls:private.${table}`]),
  "column:private.integration_credentials.credential_version", "column:private.integration_pilot_bindings.notice_invalidated_at",
  "constraint:private.integration_oauth_states.integration_oauth_states_return_path_check",
  ...["integration_pilot_return_path", "integration_pilot_metadata", "integration_pilot_provenance", "integration_pilot_tombstone", "integration_command_stage4abc", "integration_pilot_restore_candidates", "integration_pilot_maintenance_command", "integration_notice_binding_guard"].map(name => `function:private.${name}`),
  ...[["integration_connections", "integration_pilot_connection_provenance"], ["integration_resources", "integration_pilot_resource_provenance"], ["integration_snapshots", "integration_pilot_snapshot_provenance"], ["studio_sources", "integration_pilot_source_provenance"], ["integration_connections", "integration_pilot_tombstone"], ["creators", "integration_pilot_account_tombstone"]].map(([table, name]) => `trigger:public.${table}.${name}`),
  "trigger:private.integration_pilot_bindings.integration_notice_binding_guard",
  ...[["integration_oauth_lookup", "text,text"], ["integration_oauth_callback", "text,text,text,jsonb,timestamptz"], ["integration_provider_notice", "text,text,text,text"]].flatMap(([name, signature]) => [
    `function:public.${name}`, `grant:service_role.public.${name}(${signature})`,
    ...["authenticated", "anon", "public"].map(role => `grant-removed:${role}.public.${name}(${signature})`),
  ]),
];

describe("release preflight", () => {
  it("does not claim a removed grant is safe from dump text alone", async () => {
    async function check(schema: string) {
      return runPreflight({ databaseUrl: "postgresql://synthetic", projectRef: "disposable", manifestDigest: "a".repeat(64),
        expectedCapabilities: ["grant-removed:service_role.public.old_rpc(uuid)"], now: new Date("2026-10-23") }, {
        run: vi.fn().mockResolvedValue({ code: 0, stdout: "", stderr: "" }), readFile: vi.fn().mockResolvedValue(schema),
        rm: vi.fn(), tempFile: () => "synthetic.sql",
      });
    }
    expect((await check("GRANT EXECUTE ON FUNCTION public.old_rpc(uuid) TO service_role;")).capabilities[0].status).toBe("divergent");
    expect((await check("")).capabilities[0].status).toBe("unverifiable");
  });
  it("retires obsolete constraint and RPC grant requirements in the CLI's final capability set", async () => {
    const manifest = readFileSync("supabase/release-manifest.json", "utf8");
    const report = await runPreflightCli(["--output", "docs/verification/preflight.json"], process.cwd(),
      { PREFLIGHT_DATABASE_URL: "postgresql://synthetic", RELEASE_PROJECT_REF: "disposable" }, {
        run: vi.fn().mockResolvedValue({ code: 0, stdout: "", stderr: "" }),
        readFile: vi.fn(async (path) => path.endsWith("release-manifest.json") ? manifest : ""),
        rm: vi.fn(), tempFile: () => "synthetic.sql", writeFile: vi.fn(),
      });
    const names = report.capabilities.map((capability) => capability.name);
    expect(names).not.toContain("constraint:public.mission_submissions.mission_submissions_creator_workspace_fk");
    expect(names).toContain("constraint-removed:public.mission_submissions.mission_submissions_creator_workspace_fk");
    expect(names).not.toContain("grant:service_role.public.create_publication_proof_asset(uuid,uuid,uuid,uuid,text,text,bigint,text,integer)");
    expect(names).toContain("grant-removed:service_role.public.create_publication_proof_asset(uuid,uuid,uuid,uuid,text,text,bigint,text,integer)");
    expect(names).toContain("grant:service_role.public.create_publication_proof_asset(uuid,uuid,uuid,uuid,text,text,bigint,text,integer,text,integer,text)");
  });
  it("has a validator for every capability declared by the committed release manifest", () => {
    const manifest = JSON.parse(
      readFileSync("supabase/release-manifest.json", "utf8"),
    ) as { migrations: Array<{ capabilities: string[] }> };
    const capabilities = [
      ...new Set(manifest.migrations.flatMap((migration) => migration.capabilities)),
    ];

    // Preserve the prior baseline independently of the explicit review, Studio and
    // integration additions; a missing old contract must still fail these counts.
    expect(capabilities).toEqual(expect.arrayContaining(REMEDIATION_CAPABILITIES));
    expect(capabilities).toEqual(expect.arrayContaining(STUDIO_CAPABILITIES));
    expect(capabilities).toEqual(expect.arrayContaining(INTEGRATION_CAPABILITIES));
    expect(capabilities).toEqual(expect.arrayContaining(PILOT_CAPABILITIES));
    expect(PILOT_CAPABILITIES).toHaveLength(49);
    expect(new Set(PILOT_CAPABILITIES).size).toBe(49);
    expect(STUDIO_CAPABILITIES).toHaveLength(56);
    expect(INTEGRATION_CAPABILITIES).toHaveLength(69);
    expect(new Set(INTEGRATION_CAPABILITIES).size).toBe(69);
    expect(capabilities.filter((capability) => ![...REMEDIATION_CAPABILITIES, ...STUDIO_CAPABILITIES, ...INTEGRATION_CAPABILITIES, ...PILOT_CAPABILITIES].includes(capability))).toHaveLength(620);
    const claimDenials = ["authenticated", "anon", "public"].map(role => `grant-removed:${role}.public.claim_assistant_request(uuid,uuid,uuid)`);
    expect(capabilities).toEqual(expect.arrayContaining(claimDenials));
    const reviewValidityCapabilities = [
      "function:public.legacy_evidence_sql_valid",
      "grant:service_role.public.legacy_evidence_sql_valid(public.mission_submissions)",
      "grant-removed:authenticated.public.legacy_evidence_sql_valid(public.mission_submissions)",
      "grant-removed:anon.public.legacy_evidence_sql_valid(public.mission_submissions)",
      "grant-removed:public.public.legacy_evidence_sql_valid(public.mission_submissions)",
    ];
    expect(capabilities).toEqual(expect.arrayContaining(reviewValidityCapabilities));
    const applicationCapabilities = ["function:public.decide_mission_application",
      "grant:service_role.public.decide_mission_application(uuid,uuid,uuid,uuid,bigint,text,text)",
      "grant-removed:anon.public.decide_mission_application(uuid,uuid,uuid,uuid,bigint,text,text)",
      "grant-removed:authenticated.public.decide_mission_application(uuid,uuid,uuid,uuid,bigint,text,text)"];
    expect(capabilities).toEqual(expect.arrayContaining(applicationCapabilities));
    const redemptionCapabilities = [
      "column:public.redemptions.client_request_id",
      "index:public.redemptions.redemptions_creator_request_uniq",
      "function:public.redeem_gift_with_request",
      "grant:authenticated.public.redeem_gift_with_request(uuid,uuid)",
      "grant:service_role.public.redeem_gift_with_request(uuid,uuid)",
      "grant-removed:anon.public.redeem_gift_with_request(uuid,uuid)",
      "grant-removed:public.public.redeem_gift_with_request(uuid,uuid)",
    ];
    expect(capabilities).toEqual(expect.arrayContaining(redemptionCapabilities));
    const repairCapabilities = [
      "grant-removed:anon.public.submit_mission(uuid,text[],jsonb)",
      "grant-removed:public.public.submit_mission(uuid,text[],jsonb)",
      "function:public.get_legacy_correction_evidence",
      "grant:service_role.private.valid_legacy_evidence(text[])",
      "grant:service_role.public.get_legacy_correction_evidence(uuid,uuid)",
      "grant-removed:authenticated.private.valid_legacy_evidence(text[])",
      "grant-removed:anon.private.valid_legacy_evidence(text[])",
      "grant-removed:public.private.valid_legacy_evidence(text[])",
      "grant-removed:authenticated.public.request_legacy_evidence_correction(uuid,uuid,uuid,uuid,bigint,text)",
      "grant-removed:anon.public.request_legacy_evidence_correction(uuid,uuid,uuid,uuid,bigint,text)",
      "grant-removed:public.public.request_legacy_evidence_correction(uuid,uuid,uuid,uuid,bigint,text)",
      "grant-removed:authenticated.public.get_legacy_correction_evidence(uuid,uuid)",
      "grant-removed:anon.public.get_legacy_correction_evidence(uuid,uuid)",
      "grant-removed:public.public.get_legacy_correction_evidence(uuid,uuid)",
    ];
    expect(capabilities).toEqual(expect.arrayContaining(repairCapabilities));
    expect(capabilities.filter((capability) => ![...repairCapabilities, ...reviewValidityCapabilities, ...claimDenials, ...REMEDIATION_CAPABILITIES, ...STUDIO_CAPABILITIES, ...INTEGRATION_CAPABILITIES, ...PILOT_CAPABILITIES].includes(capability))).toHaveLength(598);
    expect(capabilities.filter((capability) => ![...applicationCapabilities, ...redemptionCapabilities, ...repairCapabilities, ...reviewValidityCapabilities, ...claimDenials, ...REMEDIATION_CAPABILITIES, ...STUDIO_CAPABILITIES, ...INTEGRATION_CAPABILITIES, ...PILOT_CAPABILITIES].includes(capability))).toHaveLength(587);
    expect(capabilities.filter((capability) => !hasCapabilityValidator(capability))).toEqual([]);
  });

  it("pins every D0 capability independently of the unchanged 4A-C catalogue",()=>{
    const manifest=JSON.parse(readFileSync("supabase/release-manifest.json","utf8")) as {migrations:Array<{version:string;capabilities:string[]}>};
    const pilot=manifest.migrations.find(m=>m.version==="20261031123000");
    expect(pilot?.capabilities.slice().sort()).toEqual(PILOT_CAPABILITIES.slice().sort());
    const previous=new Set(manifest.migrations.filter(m=>m.version!=="20261031123000").flatMap(m=>m.capabilities));
    expect(PILOT_CAPABILITIES.filter(capability=>previous.has(capability))).toEqual([]);
  });

  it("pins the integration migration catalogue and keeps its command RPCs unavailable to browser roles", () => {
    const manifest = JSON.parse(readFileSync("supabase/release-manifest.json", "utf8")) as {
      migrations: Array<{ version: string; name: string; capabilities: string[] }>;
    };
    const versions = ["20261031120000", "20261031121000", "20261031122000"];
    const migrations = manifest.migrations.filter(migration => versions.includes(migration.version));
    expect(migrations.map(({ version, name }) => ({ version, name }))).toEqual([
      { version: "20261031120000", name: "creator_integrations" },
      { version: "20261031121000", name: "studio_integration_evidence" },
      { version: "20261031122000", name: "integration_privacy_cleanup" },
    ]);
    const prior = new Set(manifest.migrations.filter(migration => !versions.includes(migration.version)).flatMap(migration => migration.capabilities));
    const declared = [...new Set(migrations.flatMap(migration => migration.capabilities))];
    expect(INTEGRATION_CAPABILITIES.filter(capability => prior.has(capability))).toEqual([]);
    expect(declared.filter(capability => !prior.has(capability)).sort()).toEqual([...INTEGRATION_CAPABILITIES].sort());
    const redeclared = [
      "function:public.studio_command", "function:public.save_assistant_turn", "function:public.get_assistant_request",
      "grant:service_role.public.studio_command(uuid,uuid,uuid,text,jsonb)",
      ...["authenticated", "anon", "public"].map(role => `grant-removed:${role}.public.studio_command(uuid,uuid,uuid,text,jsonb)`),
    ];
    expect([...declared].sort()).toEqual([...INTEGRATION_CAPABILITIES, ...redeclared].sort());
    for (const rpc of ["integration_command", "studio_command"]) {
      const signature = `public.${rpc}(uuid,uuid,uuid,text,jsonb)`;
      expect(declared).toContain(`grant:service_role.${signature}`);
      for (const role of ["authenticated", "anon", "public"]) {
        expect(declared).toContain(`grant-removed:${role}.${signature}`);
        expect(declared).not.toContain(`grant:${role}.${signature}`);
      }
    }
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
          "grant:service_role.public.legacy_evidence_sql_valid(public.mission_submissions)",
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
          "GRANT EXECUTE ON FUNCTION public.legacy_evidence_sql_valid(\"public\".\"mission_submissions\") TO service_role;",
          "GRANT ALL ON TABLE public.example TO authenticated;",
          "GRANT SELECT ON TABLE public.example TO authenticated;",
        ].join("\n")),
        rm: vi.fn().mockResolvedValue(undefined),
        tempFile: () => "C:/temp/schema.sql",
      },
    );

    expect(report.capabilities.every((capability) => capability.status === "present")).toBe(true);
  });

  it("keeps composite function argument schemas distinct", async () => {
    const report = await runPreflight({
      databaseUrl: "postgresql://secret", projectRef: "project-ref", manifestDigest: "a".repeat(64),
      expectedCapabilities: [
        "grant:service_role.public.legacy_evidence_sql_valid(public.mission_submissions)",
        "grant:service_role.public.legacy_evidence_sql_valid(private.mission_submissions)",
      ], now: new Date(),
    }, {
      run: vi.fn().mockResolvedValue({ code: 0, stdout: "", stderr: "" }),
      readFile: vi.fn().mockResolvedValue("GRANT EXECUTE ON FUNCTION public.legacy_evidence_sql_valid(public.mission_submissions) TO service_role;"),
      rm: vi.fn().mockResolvedValue(undefined), tempFile: () => "C:/temp/schema.sql",
    });
    expect(report.capabilities.map(capability => capability.status)).toEqual(["present", "absent"]);
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

it.each(['INSERT','UPDATE','DELETE','TRUNCATE'])('D19 detects stale %s table grants without treating them as RPCs', async privilege => {
 const capability=`grant-removed:authenticated.public.example(${privilege.toLowerCase()})`;
 const check=async (schema:string)=>runPreflight({databaseUrl:'postgresql://synthetic',projectRef:'disposable',manifestDigest:'a'.repeat(64),expectedCapabilities:[capability],now:new Date('2026-10-24')},{run:vi.fn().mockResolvedValue({code:0,stdout:'',stderr:''}),readFile:vi.fn().mockResolvedValue(schema),rm:vi.fn(),tempFile:()=> 'synthetic.sql'});
 expect((await check(`GRANT ${privilege} ON TABLE public.example TO authenticated;`)).capabilities[0].status).toBe('divergent');
 expect((await check('GRANT ALL ON TABLE public.example TO authenticated;')).capabilities[0].status).toBe('divergent');
 expect((await check('')).capabilities[0].status).toBe('unverifiable');
});
