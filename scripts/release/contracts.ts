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

export interface RehearsalTarget {
  readonly ref: string;
  readonly databaseUrl: string;
}

export interface RehearsalShapedTarget extends RehearsalTarget {
  readonly apiUrl: string;
  readonly anonKey: string;
  readonly serviceKey: string;
}

export interface RehearsalProductionTarget extends RehearsalTarget {
  readonly schemaFingerprint: string;
}

export interface RehearsalInput {
  readonly emptyTarget: RehearsalTarget;
  readonly shapedTarget: RehearsalShapedTarget;
  readonly production: RehearsalProductionTarget;
  readonly manifestDigest: string;
  readonly expectedCapabilities?: readonly string[];
  readonly now: Date;
}

export interface RehearsalCommandReport {
  readonly label: string;
  readonly code: 0;
  readonly stdoutHash: string;
  readonly stderrHash: string;
}

export interface RehearsalReport {
  readonly schemaVersion: 1;
  readonly status: "passed";
  readonly manifestDigest: string;
  readonly productionSchemaFingerprint: string;
  readonly emptySchemaFingerprint: string;
  readonly shapedSchemaFingerprint: string;
  readonly commands: readonly RehearsalCommandReport[];
  readonly createdAt: string;
}
