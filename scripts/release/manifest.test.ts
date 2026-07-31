import { mkdtemp, mkdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildManifest, digestManifest, validateManifest } from "./manifest";

async function fixture(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), "adfocate-manifest-"));
  const dir = join(root, "supabase", "migrations");
  await mkdir(dir, { recursive: true });
  await Promise.all(
    Object.entries(files).map(([name, sql]) =>
      writeFile(join(dir, name), sql, "utf8"),
    ),
  );
  return root;
}

describe("release migration manifest", () => {
  it("orders, classifies, hashes, and digests known phase files", async () => {
    const root = await fixture({
      "20260715163350_active_mission_workspace.sql": "select 1;\n",
      "20260723090000_publication_proof_validation.sql": "select 2;\n",
      "20260731100000_reward_handoff_schema.sql": "select 3;\n",
    });
    const manifest = await buildManifest(root);
    expect(manifest.migrations.map((migration) => migration.phase)).toEqual([
      "active_mission",
      "publication_proof",
      "reward_handoff",
    ]);
    expect(manifest.migrations.map((migration) => migration.dependsOn)).toEqual([
      [],
      ["20260715163350"],
      ["20260723090000"],
    ]);
    expect(manifest.migrations[0].capabilities).toContain(
      "table:public.mission_workflows",
    );
    expect(manifest.migrations[1].capabilities).toContain(
      "table:public.mission_publication_proof_attempts",
    );
    expect(manifest.migrations[2].capabilities).toContain(
      "table:public.mission_reward_contracts",
    );
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

  it("rejects an unclassified migration", async () => {
    const root = await fixture({
      "20260715163350_active_mission_workspace.sql": "select 1;\n",
      "20260801000000_unknown.sql": "select 2;\n",
    });
    await expect(buildManifest(root)).rejects.toThrow("unclassified migration");
  });

  it("detects checksum drift, missing files, duplicates, and bad dependencies", async () => {
    const root = await fixture({
      "20260715163350_active_mission_workspace.sql": "select 1;\n",
      "20260723090000_publication_proof_validation.sql": "select 2;\n",
      "20260731100000_reward_handoff_schema.sql": "select 3;\n",
    });
    const manifest = await buildManifest(root);
    await writeFile(
      join(root, manifest.migrations[0].path),
      "select 99;\n",
      "utf8",
    );
    await unlink(join(root, manifest.migrations[2].path));
    manifest.migrations[1].dependsOn = ["19990101000000"];
    manifest.migrations.push(structuredClone(manifest.migrations[1]));
    expect(await validateManifest(manifest, root)).toEqual(
      expect.arrayContaining([
        "checksum drift: 20260715163350",
        "missing migration file: 20260731100000",
        "duplicate migration version",
        "unknown dependency: 19990101000000",
      ]),
    );
  });

  it("detects migration order mismatches", async () => {
    const root = await fixture({
      "20260715163350_active_mission_workspace.sql": "select 1;\n",
      "20260723090000_publication_proof_validation.sql": "select 2;\n",
    });
    const manifest = await buildManifest(root);
    manifest.migrations.reverse();
    expect(await validateManifest(manifest, root)).toContain(
      "migration order mismatch",
    );
  });
});
