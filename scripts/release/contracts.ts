export type ReleasePhase =
  | "active_mission"
  | "publication_proof"
  | "reward_handoff";

export interface ReleaseMigration {
  readonly version: string;
  readonly name: string;
  readonly path: string;
  readonly sha256: string;
  readonly phase: ReleasePhase;
  readonly dependsOn: readonly string[];
  readonly capabilities: readonly string[];
  readonly transactionExpectation: "transactional";
  readonly replayExpectation: "migration_history_noop";
}

export interface ReleaseManifest {
  readonly schemaVersion: 1;
  readonly cliVersion: "2.110.0";
  readonly generatedFrom: "supabase/migrations";
  readonly migrations: readonly ReleaseMigration[];
}
