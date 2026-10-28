import {
  appendFile,
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import type { ReleaseManifest, ReleaseMigration } from "./contracts";
import {
  buildManifest,
  digestManifest,
  parseReleaseManifest,
  validateManifest,
} from "./manifest";

const REVIEWED_FILES = [
  "20260715163350_active_mission_workspace.sql",
  "20260717190420_receive_mission_fulfillment.sql",
  "20260718134500_active_mission_operator_lifecycle.sql",
  "20260718193000_harden_active_mission_operator_lifecycle.sql",
  "20260718210000_author_active_mission_workflow_policies.sql",
  "20260718213000_guard_mission_authoring_snapshot_race.sql",
  "20260719133000_submit_active_mission_draft.sql",
  "20260719160000_abandon_active_mission_asset.sql",
  "20260719200000_active_mission_workflow_notifications.sql",
  "20260719220000_migrate_pristine_joined_active_mission.sql",
  "20260720033542_final_review_active_mission_contracts.sql",
  "20260720175319_grant_service_role_budget_read.sql",
  "20260720193637_resolve_mission_submission_relationships.sql",
  "20260723090000_publication_proof_validation.sql",
  "20260723170000_publication_proof_rollout.sql",
  "20260725090000_publication_proof_rollout_compat.sql",
  "20260725110000_publication_proof_asset_policy.sql",
  "20260725130000_publication_proof_asset_mutation_guards.sql",
  "20260725140000_publication_proof_asset_guards.sql",
  "20260725143000_publication_proof_public_guards.sql",
  "20260725150000_publication_proof_public_rpc_final.sql",
  "20260727120000_publication_proof_instrumentation.sql",
  "20260727130000_publication_proof_existing_setup.sql",
  "20260728135000_fix_publication_proof_asset_path_regex.sql",
  "20260729010000_align_publication_proof_asset_mime_contract.sql",
  "20260731100000_reward_handoff_schema.sql",
  "20260731110000_reward_contract_capture.sql",
  "20260731120000_reward_handoff_transitions.sql",
  "20260731130000_reward_handoff_notifications.sql",
  "20260731140000_reward_handoff_release_hardening.sql",
  "20260731150000_enable_pilot_if_empty.sql",
  "20260805120000_review_hardening.sql",
  "20261022170454_audit_legacy_evidence.sql",
  "20261022170751_audit_crm_commands.sql",
  "20261022171111_audit_creator_queue.sql",
  "20261022171843_audit_assistant_requests.sql",
  "20261022182544_audit_legacy_review_notes.sql",
  "20261023091050_academy_learning.sql",
  "20261023093445_academy_learning_conflicts.sql",
  "20261023095521_academy_approval_index.sql",
  "20261023124149_staff_access_capabilities.sql",
  "20261023192141_pilot_legacy_access_hardening.sql",
  "20261025120934_application_decisions.sql",
  "20261025194402_redemption_intents.sql",
  "20261028140231_legacy_submission_xp_once.sql",
  "20261028140709_legacy_evidence_url_authority.sql",
] as const;

// Pinned by checksum in manifest.ts, so the fixture copies the repository's real bytes instead of
// synthesising content — that is what makes an edit to one of them detectable here.
const BASELINE_FILES = [
  "0001_init.sql",
  "0002_harden_rls.sql",
  "0003_onboarding.sql",
  "0004_grants.sql",
  "0005_mission_submissions.sql",
  "0006_redemption.sql",
  "0007_earnings.sql",
  "0008_leveling.sql",
  "0009_passport_scores.sql",
  "0010_applications.sql",
  "0011_mission_brief.sql",
  "0012_trust_profile_bundle.sql",
  "0013_operator_creator_selection_crm.sql",
  "0014_operator_crm_workspace_guard.sql",
  "0015_creator_profile_media.sql",
  "0016_assistant.sql",
  "0017_social_verification.sql",
  "0018_mission_authoring.sql",
  "0019_mission_brief_rich.sql",
  "0020_staff_auth.sql",
  "0021_content_hub.sql",
  "0022_notifications.sql",
  "0023_brand_access.sql",
  "0024_brand_budget.sql",
  "0025_campaigns.sql",
  "0026_campaigns_s2.sql",
  "0027_brand_resources.sql",
  "0028_academy_content.sql",
] as const;

const execFileAsync = promisify(execFile);

type MutableMigration = {
  -readonly [Key in keyof ReleaseMigration]: ReleaseMigration[Key] extends readonly string[]
    ? string[]
    : ReleaseMigration[Key];
};

type MutableManifest = Omit<ReleaseManifest, "migrations"> & {
  migrations: MutableMigration[];
};

async function fixture(
  files: readonly string[] = REVIEWED_FILES,
  overrides: Record<string, string> = {},
) {
  const root = await mkdtemp(join(tmpdir(), "adfocate-manifest-"));
  const dir = join(root, "supabase", "migrations");
  await mkdir(dir, { recursive: true });
  await Promise.all([
    ...files.map((name) =>
      writeFile(
        join(dir, name),
        overrides[name] ?? `select '${name}';\n`,
        "utf8",
      ),
    ),
    ...BASELINE_FILES.map((name) =>
      copyFile(resolve("supabase/migrations", name), join(dir, name)),
    ),
  ]);
  return root;
}

describe("release migration manifest", () => {
  it("classifies the redemption receipt contract without dropping ACL or uniqueness checks", async () => {
    const manifest = await buildManifest(resolve("."));
    const migration = manifest.migrations.find((item) => item.version === "20261025194402");
    expect(migration).toMatchObject({
      name: "redemption_intents",
      phase: "redemption",
      dependsOn: [], // Existing redemption tables/RPC are in the checksum-pinned baseline.
      transactionExpectation: "transactional",
      replayExpectation: "migration_history_noop",
    });
    expect(migration?.capabilities).toEqual(expect.arrayContaining([
      "column:public.redemptions.client_request_id",
      "index:public.redemptions.redemptions_creator_request_uniq",
      "function:public.redeem_gift_with_request",
      "grant:authenticated.public.redeem_gift_with_request(uuid,uuid)",
      "grant:service_role.public.redeem_gift_with_request(uuid,uuid)",
      "grant-removed:anon.public.redeem_gift_with_request(uuid,uuid)",
      "grant-removed:public.public.redeem_gift_with_request(uuid,uuid)",
    ]));
    expect(await validateManifest(manifest, resolve("."))).toEqual([]);
  });

  it("orders, classifies, hashes, and digests the complete reviewed range", async () => {
    const root = await fixture();
    const manifest = await buildManifest(root);
    expect(manifest.migrations).toHaveLength(REVIEWED_FILES.length);
    expect(manifest.migrations.map((migration) => migration.version)).toEqual(
      REVIEWED_FILES.map((name) => name.slice(0, 14)),
    );
    expect(manifest.migrations[0].phase).toBe("active_mission");
    expect(manifest.migrations[13].phase).toBe("publication_proof");
    expect(manifest.migrations[25].phase).toBe("reward_handoff");
    expect(manifest.migrations.find((migration) => migration.version === "20261023192141")?.phase).toBe("staff_access");
    expect(manifest.migrations.find((migration) => migration.version === "20261025120934")?.phase).toBe("operator_crm");
    expect(manifest.migrations.find((migration) => migration.version === "20261025194402")?.phase).toBe("redemption");
    expect(manifest.migrations.at(-1)?.phase).toBe("legacy_evidence");
    expect(manifest.migrations[0].dependsOn).toEqual([]);
    expect(manifest.migrations[1].dependsOn).toEqual(["20260715163350"]);
    expect(
      manifest.migrations.every(
        (migration) =>
          migration.transactionExpectation === "transactional" &&
          migration.replayExpectation === "migration_history_noop",
      ),
    ).toBe(true);
    expect(
      manifest.migrations.every((migration) =>
        /^[a-f0-9]{64}$/.test(migration.sha256),
      ),
    ).toBe(true);
    expect(digestManifest(manifest)).toMatch(/^[a-f0-9]{64}$/);
    expect(await validateManifest(manifest, root)).toEqual([]);
  });

  it("normalizes LF, CRLF, and lone CR migration checkouts before hashing", async () => {
    const first = REVIEWED_FILES[0]!;
    const logical = "select 'line-ending-proof';\nselect 'same-bytes';\n";
    const roots = await Promise.all([
      fixture(REVIEWED_FILES, { [first]: logical }),
      fixture(REVIEWED_FILES, {
        [first]: logical.replaceAll("\n", "\r\n"),
      }),
      fixture(REVIEWED_FILES, {
        [first]: logical.replaceAll("\n", "\r"),
      }),
    ]);
    const manifests = await Promise.all(roots.map(buildManifest));
    const hashes = manifests.map((manifest) => manifest.migrations[0]!.sha256);
    const digests = manifests.map(digestManifest);

    expect(hashes).toEqual([hashes[0], hashes[0], hashes[0]]);
    expect(digests).toEqual([digests[0], digests[0], digests[0]]);
    for (const [root, manifest] of roots.map((root, index) => [
      root,
      manifests[index]!,
    ] as const)) {
      expect(await validateManifest(manifest, root)).toEqual([]);
    }
  });

  it("declares capabilities for migrations previously emitted as empty", async () => {
    const manifest = await buildManifest(await fixture());
    expect(
      manifest.migrations.every((migration) => migration.capabilities.length > 0),
    ).toBe(true);
    const byVersion = new Map(
      manifest.migrations.map((migration) => [migration.version, migration]),
    );
    expect(byVersion.get("20260717190420")?.capabilities).toEqual(
      expect.arrayContaining([
        "function:public.receive_mission_fulfillment",
        "grant:service_role.public.receive_mission_fulfillment(uuid,uuid,uuid)",
      ]),
    );
    expect(byVersion.get("20260723170000")?.capabilities).toEqual(
      expect.arrayContaining([
        "policy:public.mission_publication_proof_assets.mission_publication_proof_assets_creator_read",
        "storage-policy:storage.objects.mission_publication_proof_assets_storage_read",
        "trigger:public.mission_publication_proof_assets_immutable",
        "function:public.create_publication_proof_asset",
        "grant:service_role.public.create_publication_proof_asset(uuid,uuid,uuid,uuid,text,text,bigint,text,integer)",
      ]),
    );
    expect(byVersion.get("20260723090000")?.capabilities).toEqual(
      expect.arrayContaining([
        "column:public.mission_publication_instructions.publication_due_at",
        "constraint:public.mission_publication_instructions.mission_publication_instructions_work_item_workspace_fk",
        "constraint:public.mission_publication_proof_attempts.mission_publication_proof_attempts_workspace_fk",
        "constraint:public.mission_publication_proof_attempts.mission_publication_proof_attempts_work_item_workspace_fk",
        "constraint:public.mission_publication_proof_attempts.mission_publication_proof_attempts_submitter_workspace_fk",
        "constraint:public.mission_publication_proof_assets.mission_publication_proof_assets_workspace_fk",
        "constraint:public.mission_publication_proof_assets.mission_publication_proof_assets_attempt_workspace_fk",
        "constraint:public.mission_publication_proof_reviews.mission_publication_proof_reviews_workspace_fk",
        "constraint:public.mission_publication_proof_reviews.mission_publication_proof_reviews_attempt_workspace_fk",
        "constraint:public.mission_publication_proof_reviews.mission_publication_proof_reviews_reviewer_workspace_fk",
        "constraint:public.mission_publication_proof_review_items.mission_publication_proof_review_items_workspace_fk",
        "constraint:public.mission_publication_proof_review_items.mission_publication_proof_review_items_review_workspace_fk",
      ]),
    );
  });

  it("rejects unreviewed migrations before, inside, or after the reviewed range", async () => {
    for (const name of [
      "20260701000000_backdated.sql",
      "20260722120000_unreviewed_interior.sql",
      "20260801000000_future.sql",
    ]) {
      const root = await fixture();
      await writeFile(
        join(root, "supabase", "migrations", name),
        "select 1;\n",
        "utf8",
      );
      await expect(buildManifest(root)).rejects.toThrow(
        `unclassified migration: ${name}`,
      );
    }
  });

  it("rejects empty, truncated, and interior-incomplete reviewed ranges", async () => {
    for (const missing of [
      REVIEWED_FILES[0],
      REVIEWED_FILES[10],
      REVIEWED_FILES.at(-1)!,
    ]) {
      const root = await fixture(
        REVIEWED_FILES.filter((name) => name !== missing),
      );
      await expect(buildManifest(root)).rejects.toThrow(
        `missing reviewed migration: ${missing}`,
      );
    }
    await expect(buildManifest(await fixture([]))).rejects.toThrow(
      "missing reviewed migration",
    );
  });

  it("rejects unknown JSON fields, missing fields, bad types, and invalid enums", async () => {
    const manifest = await buildManifest(await fixture());
    const first = structuredClone(manifest.migrations[0]) as unknown as Record<
      string,
      unknown
    >;
    const withoutVersion = { ...first };
    delete withoutVersion.version;
    const candidates: unknown[] = [
      { ...manifest, unexpected: true },
      { ...manifest, cliVersion: "2.111.0" },
      { ...manifest, generatedFrom: "supabase/seed.sql" },
      {
        ...manifest,
        migrations: [{ ...first, unexpected: true }, ...manifest.migrations.slice(1)],
      },
      { ...manifest, schemaVersion: "1" },
      { ...manifest, migrations: "invalid" },
      { ...manifest, migrations: [withoutVersion, ...manifest.migrations.slice(1)] },
      {
        ...manifest,
        migrations: [{ ...first, version: "20260723" }, ...manifest.migrations.slice(1)],
      },
      {
        ...manifest,
        migrations: [{ ...first, name: "Invalid Name" }, ...manifest.migrations.slice(1)],
      },
      {
        ...manifest,
        migrations: [{ ...first, phase: "invalid" }, ...manifest.migrations.slice(1)],
      },
      {
        ...manifest,
        migrations: [{ ...first, sha256: "invalid" }, ...manifest.migrations.slice(1)],
      },
      {
        ...manifest,
        migrations: [
          { ...first, path: "../outside.sql" },
          ...manifest.migrations.slice(1),
        ],
      },
      {
        ...manifest,
        migrations: [
          { ...first, dependsOn: "20260715163350" },
          ...manifest.migrations.slice(1),
        ],
      },
      {
        ...manifest,
        migrations: [
          { ...first, dependsOn: ["not-a-version"] },
          ...manifest.migrations.slice(1),
        ],
      },
      {
        ...manifest,
        migrations: [
          { ...first, capabilities: ["not-a-capability"] },
          ...manifest.migrations.slice(1),
        ],
      },
      {
        ...manifest,
        migrations: [
          { ...first, capabilities: ["table:public.example", "table:public.example"] },
          ...manifest.migrations.slice(1),
        ],
      },
      {
        ...manifest,
        migrations: [
          { ...first, capabilities: ["valid", 1] },
          ...manifest.migrations.slice(1),
        ],
      },
      {
        ...manifest,
        migrations: [
          { ...first, transactionExpectation: "nontransactional" },
          ...manifest.migrations.slice(1),
        ],
      },
      {
        ...manifest,
        migrations: [
          { ...first, replayExpectation: "idempotent" },
          ...manifest.migrations.slice(1),
        ],
      },
    ];
    for (const candidate of candidates) {
      expect(() => parseReleaseManifest(candidate)).toThrow(
        "invalid release manifest",
      );
    }
  });

  it("rejects a shape-valid migration path that does not match version and name", async () => {
    const manifest = await buildManifest(await fixture());
    const first = structuredClone(manifest.migrations[0]);
    const mismatched = {
      ...manifest,
      migrations: [
        {
          ...first,
          path: `supabase/migrations/${first.version}_wrong_name.sql`,
        },
        ...manifest.migrations.slice(1),
      ],
    } as ReleaseManifest;

    expect(() => parseReleaseManifest(mismatched)).toThrow(
      "$manifest.migrations[0].path must match version and name",
    );
    expect(() => digestManifest(mismatched)).toThrow(
      "$manifest.migrations[0].path must match version and name",
    );
  });

  it("does not alias mutable capability metadata between builds", async () => {
    const root = await fixture();
    const first = await buildManifest(root);
    expect(() =>
      (first.migrations[0].capabilities as string[]).push("forged:capability"),
    ).toThrow(TypeError);
    const second = await buildManifest(root);
    expect(second.migrations[0].capabilities).not.toContain("forged:capability");
  });

  it("does not replace an existing artifact on invalid write and leaves no temp file", async () => {
    const root = await fixture();
    const target = join(root, "supabase", "release-manifest.json");
    await writeFile(target, "existing-artifact\n", "utf8");
    const backdated = join(
      root,
      "supabase",
      "migrations",
      "20260701000000_backdated.sql",
    );
    await writeFile(backdated, "select 1;\n", "utf8");
    const { writeManifest } = await import("./manifest-cli");
    await expect(writeManifest(root)).rejects.toThrow("unclassified migration");
    await expect(readFile(target, "utf8")).resolves.toBe("existing-artifact\n");

    await unlink(backdated);
    await writeManifest(root);
    const written = parseReleaseManifest(JSON.parse(await readFile(target, "utf8")));
    expect(await validateManifest(written, root)).toEqual([]);
    expect(
      (await readdir(join(root, "supabase"))).filter((name) =>
        name.includes("release-manifest.json.tmp"),
      ),
    ).toEqual([]);
  });

  it("runs write as a direct vite-node CLI and prints its digest", async () => {
    const root = await fixture();
    const viteNode = resolve("node_modules/vite-node/vite-node.mjs");
    const script = resolve("scripts/release/manifest-cli.ts");
    const { stdout } = await execFileAsync(
      process.execPath,
      [viteNode, "--script", script, "write"],
      { cwd: root },
    );
    expect(stdout.trim()).toMatch(/^[a-f0-9]{64}$/);
    await expect(
      readFile(join(root, "supabase", "release-manifest.json"), "utf8"),
    ).resolves.toContain('"schemaVersion": 1');
  });

  it.each([
    ["missing", []],
    ["unsupported", ["typo"]],
  ])("returns a nonzero usage error for a %s direct CLI command", async (_case, args) => {
    const root = await fixture();
    const viteNode = resolve("node_modules/vite-node/vite-node.mjs");
    const script = resolve("scripts/release/manifest-cli.ts");
    await expect(
      execFileAsync(process.execPath, [viteNode, "--script", script, ...args], {
        cwd: root,
      }),
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("usage: manifest-cli.ts <write|check>"),
    });
  });

  it("detects checksum drift, missing files, duplicates, and bad dependencies", async () => {
    const root = await fixture();
    const manifest = structuredClone(
      await buildManifest(root),
    ) as unknown as MutableManifest;
    await writeFile(
      join(root, manifest.migrations[0].path),
      "select 99;\n",
      "utf8",
    );
    await unlink(join(root, manifest.migrations.at(-1)!.path));
    manifest.migrations[1].dependsOn = ["19990101000000"];
    manifest.migrations.push(structuredClone(manifest.migrations[1]));
    expect(
      await validateManifest(manifest as unknown as ReleaseManifest, root),
    ).toEqual(
      expect.arrayContaining([
        "checksum drift: 20260715163350",
        `missing migration file: ${REVIEWED_FILES.at(-1)!.slice(0, 14)}`,
        "duplicate migration version",
        "unknown dependency: 19990101000000",
      ]),
    );
  });

  it("detects an edited, deleted, or newly added baseline migration", async () => {
    const edited = await fixture();
    await appendFile(
      join(edited, "supabase", "migrations", "0004_grants.sql"),
      "grant all on all tables in schema public to anon;\n",
      "utf8",
    );
    await expect(buildManifest(edited)).rejects.toThrow(
      "baseline checksum drift: 0004_grants.sql",
    );

    const deleted = await fixture();
    await unlink(join(deleted, "supabase", "migrations", "0004_grants.sql"));
    await expect(buildManifest(deleted)).rejects.toThrow(
      "missing baseline migration: 0004_grants.sql",
    );

    const added = await fixture();
    await writeFile(
      join(added, "supabase", "migrations", "0029_extra.sql"),
      "select 1;\n",
      "utf8",
    );
    await expect(buildManifest(added)).rejects.toThrow(
      "unclassified migration: 0029_extra.sql",
    );
  });

  it("rejects migrations the timestamp filter used to drop", async () => {
    for (const [name, error] of [
      ["202608011200000_backdoor.sql", "unclassified migration"],
      ["1_backdoor.sql", "unclassified migration"],
      ["backdoor.sql", "unpushable migration"],
    ] as const) {
      const root = await fixture();
      await writeFile(
        join(root, "supabase", "migrations", name),
        "grant all on all tables in schema public to anon;\n",
        "utf8",
      );
      await expect(buildManifest(root)).rejects.toThrow(`${error}: ${name}`);
    }
  });

  it("detects migration order mismatches", async () => {
    const root = await fixture();
    const manifest = structuredClone(
      await buildManifest(root),
    ) as unknown as MutableManifest;
    manifest.migrations.reverse();
    expect(
      await validateManifest(manifest as unknown as ReleaseManifest, root),
    ).toContain("migration order mismatch");
  });
});
