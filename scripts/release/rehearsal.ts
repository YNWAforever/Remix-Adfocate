import { createHash } from "node:crypto";
import type { PreflightInput, PreflightReport } from "./preflight";
import type {
  RehearsalCommandReport,
  RehearsalInput,
  RehearsalReport,
  RehearsalTarget,
} from "./contracts";
import type { CommandRunner } from "./process";
import { assertDisposableTarget } from "./target-guard";

type RehearsalPreflight = (
  input: PreflightInput,
) => Promise<Pick<PreflightReport, "schemaFingerprint" | "capabilities">>;

export interface RehearsalDeps {
  readonly run: CommandRunner;
  readonly preflight: RehearsalPreflight;
}

function hash(value: string) {
  return createHash("sha256").update(value.replaceAll("\r\n", "\n")).digest("hex");
}

function assertLoopbackApiTarget(input: RehearsalInput) {
  if (!input.shapedTarget.anonKey || !input.shapedTarget.serviceKey) {
    throw new Error("rehearsal requires disposable Supabase API credentials");
  }

  let apiUrl: URL;
  try {
    apiUrl = new URL(input.shapedTarget.apiUrl);
  } catch {
    throw new Error("SUPABASE_URL must be a valid loopback HTTP(S) URL");
  }
  const hostname = apiUrl.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    !["http:", "https:"].includes(apiUrl.protocol)
    || !["localhost", "127.0.0.1"].includes(hostname)
  ) {
    throw new Error("SUPABASE_URL must be a loopback HTTP(S) URL");
  }
}

function expectedCapabilities(input: RehearsalInput) {
  if (!Array.isArray(input.expectedCapabilities) || input.expectedCapabilities.length === 0) {
    throw new Error("rehearsal requires declared capabilities");
  }
  return input.expectedCapabilities;
}

function preflightInput(
  target: RehearsalTarget,
  input: RehearsalInput,
  capabilities: readonly string[],
): PreflightInput {
  return {
    databaseUrl: target.databaseUrl,
    projectRef: target.ref,
    manifestDigest: input.manifestDigest,
    expectedCapabilities: capabilities,
    now: input.now,
  };
}

function assertPresentCapabilities(
  report: Pick<PreflightReport, "capabilities">,
  label: string,
  required: readonly string[],
) {
  if (
    !Array.isArray(report.capabilities)
    || report.capabilities.some((capability) => capability.status !== "present")
    || required.some((name) => !report.capabilities.some(
      (capability) => capability.name === name && capability.status === "present",
    ))
  ) {
    throw new Error(`${label} missing required capabilities`);
  }
}

function replayProvesNoPendingMigrations(stdout: string, stderr: string) {
  const output = `${stdout}\n${stderr}`;
  const cleanPattern = "\\b(?:no[-\\s]+pending(?:[-\\s]+migrations?)?|up[-\\s]+to[-\\s]+date|no[-\\s]+changes?[-\\s]+to[-\\s]+apply)\\b";
  const clean = new RegExp(cleanPattern, "i");
  if (!clean.test(output)) return false;
  const withoutCleanMarkers = output.replaceAll(new RegExp(cleanPattern, "gi"), "");
  const pending = /\b(?:pending migrations?|(?:would|will)(?:[-\s]+be)?[-\s]+(?:apply|applied|push|pushed))\b/i;
  return !pending.test(withoutCleanMarkers);
}

function integrationEnv(input: RehearsalInput, legacyOnly = false): NodeJS.ProcessEnv {
  const { LEGACY_ONLY: _legacyOnly, ...inherited } = process.env;
  return {
    ...inherited,
    RUN_INTEGRATION: "1",
    SUPABASE_URL: input.shapedTarget.apiUrl,
    SUPABASE_ANON_KEY: input.shapedTarget.anonKey,
    SUPABASE_SERVICE_KEY: input.shapedTarget.serviceKey,
    ...(legacyOnly ? { LEGACY_ONLY: "1" } : {}),
  };
}

async function runGate(
  deps: RehearsalDeps,
  reports: RehearsalCommandReport[],
  label: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
) {
  let result: Awaited<ReturnType<CommandRunner>>;
  try {
    result = await deps.run("npx", args, env ? { env } : undefined);
  } catch {
    throw new Error(`${label} command execution failed`);
  }
  if (result.code !== 0) {
    throw new Error(`${label} failed with exit code ${result.code}`);
  }
  reports.push({
    label,
    code: 0,
    stdoutHash: hash(result.stdout),
    stderrHash: hash(result.stderr),
  });
  return result;
}

export async function runRehearsal(
  input: RehearsalInput,
  deps: RehearsalDeps,
): Promise<RehearsalReport> {
  assertDisposableTarget({
    targetRef: input.emptyTarget.ref,
    targetDatabaseUrl: input.emptyTarget.databaseUrl,
    productionRef: input.production.ref,
    productionDatabaseUrl: input.production.databaseUrl,
  });
  assertDisposableTarget({
    targetRef: input.shapedTarget.ref,
    targetDatabaseUrl: input.shapedTarget.databaseUrl,
    productionRef: input.production.ref,
    productionDatabaseUrl: input.production.databaseUrl,
  });
  assertLoopbackApiTarget(input);

  const requiredCapabilities = expectedCapabilities(input);
  const shapedBefore = await deps.preflight(preflightInput(input.shapedTarget, input, []));
  if (shapedBefore.schemaFingerprint !== input.production.schemaFingerprint) {
    throw new Error("production-shaped schema fingerprint mismatch");
  }

  const reports: RehearsalCommandReport[] = [];
  const legacyEnv = integrationEnv(input, true);
  const env = integrationEnv(input);
  await runGate(deps, reports, "legacy integration gate", ["run", "test:legacy-integration"], legacyEnv);
  await runGate(deps, reports, "empty database reset", [
    "supabase", "db", "reset", "--db-url", input.emptyTarget.databaseUrl, "--no-seed",
  ]);

  const emptyAfter = await deps.preflight(
    preflightInput(input.emptyTarget, input, requiredCapabilities),
  );
  assertPresentCapabilities(emptyAfter, "empty target", requiredCapabilities);

  await runGate(deps, reports, "shaped database dry-run", [
    "supabase", "db", "push", "--dry-run", "--db-url", input.shapedTarget.databaseUrl,
  ]);
  await runGate(deps, reports, "shaped database push", [
    "supabase", "db", "push", "--db-url", input.shapedTarget.databaseUrl,
  ]);
  const replay = await runGate(deps, reports, "shaped database replay dry-run", [
    "supabase", "db", "push", "--dry-run", "--db-url", input.shapedTarget.databaseUrl,
  ]);
  if (!replayProvesNoPendingMigrations(replay.stdout, replay.stderr)) {
    throw new Error("shaped target replay dry-run did not prove no pending migrations");
  }

  await runGate(deps, reports, "reward handoff acceptance seed", [
    "run", "seed:reward-handoff-acceptance",
  ], env);
  await runGate(deps, reports, "integration gate", ["run", "test:integration"], env);
  await runGate(deps, reports, "legacy integration post-expansion gate", [
    "run", "test:legacy-integration",
  ], env);
  await runGate(deps, reports, "active mission gate", ["run", "test:active-missions"], env);

  const shapedAfter = await deps.preflight(
    preflightInput(input.shapedTarget, input, requiredCapabilities),
  );
  assertPresentCapabilities(shapedAfter, "shaped target", requiredCapabilities);

  return {
    schemaVersion: 1,
    status: "passed",
    manifestDigest: input.manifestDigest,
    productionSchemaFingerprint: input.production.schemaFingerprint,
    emptySchemaFingerprint: emptyAfter.schemaFingerprint,
    shapedSchemaFingerprint: shapedAfter.schemaFingerprint,
    commands: reports,
    createdAt: input.now.toISOString(),
  };
}
