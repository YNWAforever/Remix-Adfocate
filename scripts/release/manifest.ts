import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ReleaseManifest,
  ReleaseMigration,
  ReleasePhase,
} from "./contracts";

const PHASE_START: Array<[string, ReleasePhase]> = [
  ["20260715163350", "active_mission"],
  ["20260723090000", "publication_proof"],
  ["20260731100000", "reward_handoff"],
];

const CLASSIFIED_UPPER_BOUND = "20260731140000";

const CAPABILITIES_BY_VERSION: Record<string, string[]> = {
  "20260715163350": [
    "table:public.mission_workflows",
    "column:public.missions.creator_workflow_mode",
    "function:public.create_mission_workflow",
    "policy:public.mission_workflows.mission_workflows_creator_read",
    "trigger:public.mission_draft_versions_immutable",
    "grant:authenticated.public.create_mission_workflow(uuid)",
    "storage-policy:storage.objects.mission_draft_assets_storage_read",
  ],
  "20260723090000": [
    "table:public.mission_publication_proof_attempts",
    "policy:public.mission_publication_proof_attempts.mission_publication_proof_attempts_creator_read",
    "trigger:public.mission_publication_proof_attempts_immutable",
  ],
  "20260731100000": [
    "table:public.mission_reward_contracts",
    "table:public.mission_completion_decisions",
    "table:public.mission_pending_rewards",
    "rls:public.mission_reward_contracts",
    "trigger:public.mission_reward_contracts_immutable",
    "trigger:public.mission_completion_decisions_immutable",
    "trigger:public.mission_pending_rewards_guarded_update",
  ],
  "20260731110000": [
    "function:public.join_active_mission",
    "grant:authenticated.public.join_active_mission(uuid)",
  ],
  "20260731120000": [
    "function:public.approve_mission_completion",
    "function:public.cancel_mission_reward_handoff",
  ],
  "20260731130000": [
    "trigger:public.reward_handoff_workflow_event_notifications",
  ],
  "20260731140000": [
    "function:public.retry_reward_handoff_notification",
    "grant:service_role.public.retry_reward_handoff_notification(uuid,uuid,uuid,text)",
  ],
};

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function phaseFor(version: string): ReleasePhase | null {
  let phase: ReleasePhase | null = null;
  for (const [start, candidate] of PHASE_START) {
    if (version >= start) phase = candidate;
  }
  return phase;
}

function stableManifest(manifest: ReleaseManifest) {
  return JSON.stringify({
    schemaVersion: manifest.schemaVersion,
    cliVersion: manifest.cliVersion,
    generatedFrom: manifest.generatedFrom,
    migrations: manifest.migrations.map((migration) => ({
      version: migration.version,
      name: migration.name,
      path: migration.path.replaceAll("\\", "/"),
      sha256: migration.sha256,
      phase: migration.phase,
      dependsOn: migration.dependsOn,
      capabilities: migration.capabilities,
      transactionExpectation: migration.transactionExpectation,
      replayExpectation: migration.replayExpectation,
    })),
  });
}

export async function buildManifest(rootDir: string): Promise<ReleaseManifest> {
  const migrationDir = join(rootDir, "supabase", "migrations");
  const names = (await readdir(migrationDir))
    .filter((name) => /^\d{14}_.+\.sql$/.test(name))
    .sort();
  const migrations: ReleaseMigration[] = [];

  for (const name of names) {
    const version = name.slice(0, 14);
    const phase = phaseFor(version);
    if (!phase) continue;
    if (version > CLASSIFIED_UPPER_BOUND) {
      throw new Error(`unclassified migration: ${name}`);
    }
    migrations.push({
      version,
      name: name.slice(15, -4),
      path: `supabase/migrations/${name}`,
      sha256: sha256(await readFile(join(migrationDir, name))),
      phase,
      dependsOn: migrations.length ? [migrations.at(-1)!.version] : [],
      capabilities: CAPABILITIES_BY_VERSION[version] ?? [],
      transactionExpectation: "transactional",
      replayExpectation: "migration_history_noop",
    });
  }

  return {
    schemaVersion: 1,
    cliVersion: "2.110.0",
    generatedFrom: "supabase/migrations",
    migrations,
  };
}

export async function validateManifest(
  manifest: ReleaseManifest,
  rootDir: string,
): Promise<string[]> {
  const current = await buildManifest(rootDir);
  const errors: string[] = [];
  const versions = manifest.migrations.map((migration) => migration.version);
  const currentByVersion = new Map(
    current.migrations.map((migration) => [migration.version, migration]),
  );

  if (new Set(versions).size !== versions.length) {
    errors.push("duplicate migration version");
  }
  if (versions.join() !== [...versions].sort().join()) {
    errors.push("migration order mismatch");
  }

  manifest.migrations.forEach((migration, index) => {
    const actual = currentByVersion.get(migration.version);
    if (!actual) {
      errors.push(`missing migration file: ${migration.version}`);
    } else if (actual.sha256 !== migration.sha256) {
      errors.push(`checksum drift: ${migration.version}`);
    }
    for (const dependency of migration.dependsOn) {
      const dependencyIndex = versions.indexOf(dependency);
      if (dependencyIndex === -1) {
        errors.push(`unknown dependency: ${dependency}`);
      } else if (dependencyIndex >= index) {
        errors.push(`dependency order mismatch: ${dependency}`);
      }
    }
  });

  if (stableManifest(manifest) !== stableManifest(current)) {
    errors.push("manifest content drift");
  }
  return errors;
}

export function digestManifest(manifest: ReleaseManifest) {
  return sha256(stableManifest(manifest));
}
