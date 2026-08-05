import { createHash, randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PreflightInput, PreflightReport } from "./preflight";
import { runPreflight, type PreflightDeps } from "./preflight";
import type {
  RehearsalCommandReport,
  RehearsalInput,
  RehearsalReport,
  RehearsalTarget,
} from "./contracts";
import { runCommand, type CommandRunner } from "./process";
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
  const inherited = { ...process.env };
  delete inherited.LEGACY_ONLY;
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

function envValue(env: NodeJS.ProcessEnv, key: string) {
  const value = env[key]?.trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function jsonEnv<T>(env: NodeJS.ProcessEnv, key: string): T {
  const value = envValue(env, key);
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(`${key} must contain valid JSON`);
  }
}

function rehearsalInputFromEnv(env: NodeJS.ProcessEnv): RehearsalInput {
  const rawNow = env.RELEASE_REHEARSAL_NOW;
  const now = rawNow ? new Date(rawNow) : new Date();
  if (Number.isNaN(now.getTime())) throw new Error("RELEASE_REHEARSAL_NOW must be a valid timestamp");
  return {
    emptyTarget: jsonEnv<RehearsalTarget>(env, "RELEASE_REHEARSAL_EMPTY_TARGET_JSON"),
    shapedTarget: jsonEnv<RehearsalInput["shapedTarget"]>(env, "RELEASE_REHEARSAL_SHAPED_TARGET_JSON"),
    production: jsonEnv<RehearsalInput["production"]>(env, "RELEASE_REHEARSAL_PRODUCTION_JSON"),
    manifestDigest: envValue(env, "RELEASE_MANIFEST_DIGEST"),
    expectedCapabilities: jsonEnv<readonly string[]>(env, "RELEASE_EXPECTED_CAPABILITIES_JSON"),
    now,
  };
}

const defaultPreflightDeps: PreflightDeps = {
  run: runCommand,
  readFile,
  rm,
  tempFile: () => resolve(tmpdir(), `adfocate-rehearsal-${randomUUID()}.sql`),
};

export async function executeRehearsalCli(env: NodeJS.ProcessEnv = process.env) {
  const input = rehearsalInputFromEnv(env);
  return runRehearsal(input, {
    run: runCommand,
    preflight: async (preflightInput) => runPreflight(preflightInput, defaultPreflightDeps),
  });
}

function sanitizedError(error: unknown) {
  const message = error instanceof Error ? error.message : "rehearsal failed";
  return message.replace(/(?:postgres(?:ql)?:\/\/|eyJ)[^\s"']+/gi, "[REDACTED]");
}

const isViteNodeCli = /(?:^|[\\/])vite-node(?:\.mjs)?$/i.test(process.argv[1] ?? "");
const isDirectNodeCli = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isViteNodeCli || isDirectNodeCli) {
  try {
    const result = await executeRehearsalCli(process.env);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ status: "failed", error: sanitizedError(error) })}\n`);
    process.exitCode = 1;
  }
}
