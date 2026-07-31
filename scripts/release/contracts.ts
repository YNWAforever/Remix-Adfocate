export type ReleasePhase =
  | "active_mission"
  | "publication_proof"
  | "reward_handoff";

export interface ReleaseMigration {
  version: string;
  name: string;
  path: string;
  sha256: string;
  phase: ReleasePhase;
  dependsOn: string[];
  capabilities: string[];
  transactionExpectation: "transactional";
  replayExpectation: "migration_history_noop";
}

export interface ReleaseManifest {
  schemaVersion: 1;
  cliVersion: "2.110.0";
  generatedFrom: "supabase/migrations";
  migrations: ReleaseMigration[];
}
