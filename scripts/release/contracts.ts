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

export type CapabilityStatus = "present" | "absent" | "divergent" | "unverifiable";

export interface PreflightCapability {
  readonly name: string;
  readonly status: CapabilityStatus;
}

export interface PreflightReport {
  readonly schemaVersion: 1;
  readonly targetProjectRef: string;
  readonly manifestDigest: string;
  readonly migrationListHash: string;
  readonly dryRunHash: string;
  readonly schemaFingerprint: string;
  readonly capabilities: readonly PreflightCapability[];
  readonly warnings: readonly string[];
  readonly createdAt: string;
}
