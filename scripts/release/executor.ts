import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { PreflightReport, ReleaseEvidence } from "./contracts";
import { parseEvidence, verifyEvidence } from "./evidence";
import { digestManifest, parseReleaseManifest, validateManifest } from "./manifest";
import { runPreflight, type PreflightDeps } from "./preflight";
import { runCommand, type CommandResult, type CommandRunner } from "./process";

export interface ExecuteInput {
  readonly databaseUrl: string;
  readonly projectRef: string;
  readonly evidence: ReleaseEvidence;
  readonly evidenceDigest: string;
  readonly currentSchemaFingerprint: string;
  readonly currentManifestDigest: string;
  readonly currentApplicationCommit: string;
  readonly expectedCapabilities: readonly string[];
  readonly expectedMigrationRange?: ReleaseEvidence["migrationRange"];
  readonly expectedMigrationChecksums?: ReleaseEvidence["migrationChecksums"];
  readonly now: Date;
  readonly apply: boolean;
  readonly approval: string;
}

export interface ExecuteDeps {
  readonly run: CommandRunner;
  readonly postflight: () => Promise<Pick<PreflightReport, "schemaFingerprint" | "manifestDigest" | "capabilities">>;
}

export interface ExecuteCommandReport {
  readonly label: "dry-run" | "apply";
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface ExecuteReport {
  readonly status: "dry-run" | "applied";
  readonly projectRef: string;
  readonly evidenceDigest: string;
  readonly commands: readonly ExecuteCommandReport[];
  readonly postflight?: Pick<PreflightReport, "schemaFingerprint" | "manifestDigest" | "capabilities">;
}

function redact(value: string, databaseUrl: string) {
  return value
    .replaceAll(databaseUrl, "[REDACTED]")
    .replace(/postgres(?:ql)?:\/\/[^\s'"`]+/gi, "[REDACTED]");
}

function commandErrorDetail(error: unknown) {
  if (typeof error === "object" && error !== null) {
    const candidate = error as { message?: unknown; spawnargs?: unknown };
    const parts = [
      typeof candidate.message === "string" ? candidate.message : undefined,
      Array.isArray(candidate.spawnargs)
        ? candidate.spawnargs.map((argument) => String(argument)).join(" ")
        : undefined,
    ].filter((part): part is string => Boolean(part));
    if (parts.length) return parts.join(" ");
  }
  return String(error);
}

async function runPush(
  deps: ExecuteDeps,
  databaseUrl: string,
  dryRun: boolean,
): Promise<ExecuteCommandReport> {
  const args = ["supabase", "db", "push"];
  if (dryRun) args.push("--dry-run");
  args.push("--db-url", databaseUrl);
  let result: CommandResult;
  try {
    result = await deps.run("npx", args);
  } catch (error) {
    throw new Error(`release command failed: ${redact(commandErrorDetail(error), databaseUrl)}`);
  }
  const report = {
    label: dryRun ? ("dry-run" as const) : ("apply" as const),
    code: result.code,
    stdout: redact(result.stdout, databaseUrl),
    stderr: redact(result.stderr, databaseUrl),
  };
  if (result.code !== 0) {
    throw new Error(`${report.label} failed: ${report.stderr || report.stdout || "unknown command error"}`);
  }
  return report;
}

export async function executeRelease(input: ExecuteInput, deps: ExecuteDeps): Promise<ExecuteReport> {
  const verificationErrors = verifyEvidence(
    input.evidence,
    {
      projectRef: input.projectRef,
      schemaFingerprint: input.currentSchemaFingerprint,
      manifestDigest: input.currentManifestDigest,
      applicationCommit: input.currentApplicationCommit,
      migrationRange: input.expectedMigrationRange,
      migrationChecksums: input.expectedMigrationChecksums,
      bundleDigest: input.evidenceDigest,
    },
    input.now,
  );
  if (verificationErrors.length) throw new Error(`release evidence rejected: ${verificationErrors.join("; ")}`);
  if (new Set(input.expectedCapabilities).size === 0) {
    throw new Error("expected postflight capabilities are required");
  }

  const dryRun = await runPush(deps, input.databaseUrl, true);
  if (!input.apply) {
    return {
      status: "dry-run",
      projectRef: input.projectRef,
      evidenceDigest: input.evidenceDigest,
      commands: [dryRun],
    };
  }

  const exactApproval = `APPROVE ${input.projectRef} ${input.evidenceDigest}`;
  if (input.approval !== exactApproval) throw new Error("exact production approval phrase is required");

  const apply = await runPush(deps, input.databaseUrl, false);
  let postflight: Pick<PreflightReport, "schemaFingerprint" | "manifestDigest" | "capabilities">;
  try {
    postflight = await deps.postflight();
  } catch (error) {
    throw new Error(`postflight failed: ${redact(commandErrorDetail(error), input.databaseUrl)}`);
  }
  if (postflight.manifestDigest !== input.currentManifestDigest) {
    throw new Error("postflight manifest digest mismatch");
  }
  const expectedCapabilities = new Set(input.expectedCapabilities);
  const reportedCapabilities = new Map<string, PreflightReport["capabilities"][number]>();
  for (const capability of postflight.capabilities) {
    if (reportedCapabilities.has(capability.name)) {
      throw new Error("postflight capability coverage mismatch");
    }
    reportedCapabilities.set(capability.name, capability);
  }
  if (
    reportedCapabilities.size !== expectedCapabilities.size ||
    [...expectedCapabilities].some((name) => !reportedCapabilities.has(name)) ||
    [...reportedCapabilities.keys()].some((name) => !expectedCapabilities.has(name))
  ) {
    throw new Error("postflight capability coverage mismatch");
  }
  const missingCapabilities = [...reportedCapabilities.values()].filter(({ status }) => status !== "present");
  if (missingCapabilities.length) {
    throw new Error(`postflight capabilities are not present: ${missingCapabilities.map(({ name }) => name).join(", ")}`);
  }
  return {
    status: "applied",
    projectRef: input.projectRef,
    evidenceDigest: input.evidenceDigest,
    commands: [dryRun, apply],
    postflight,
  };
}

interface ExecutorCliDeps extends PreflightDeps {
  readonly readFile: (path: string, encoding: "utf8") => Promise<string>;
  readonly validateManifest?: typeof validateManifest;
}

interface ExecutorCliOptions {
  readonly bundlePath: string;
  readonly bundleDigest: string;
  readonly projectRef: string;
  readonly approval: string;
  readonly apply: boolean;
}

function parseCliArgs(args: readonly string[]): ExecutorCliOptions {
  let bundlePath: string | undefined;
  let bundleDigest: string | undefined;
  let projectRef: string | undefined;
  let approval: string | undefined;
  let apply = false;
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--apply") {
      apply = true;
      continue;
    }
    const next = args[index + 1];
    if (!next) throw new Error(`missing value for ${value}`);
    if (value === "--bundle") bundlePath = next;
    else if (value === "--bundle-digest") bundleDigest = next;
    else if (value === "--project-ref") projectRef = next;
    else if (value === "--approval") approval = next;
    else throw new Error(`unknown argument: ${value}`);
    index += 1;
  }
  if (!bundlePath || !bundleDigest || !projectRef || approval === undefined) {
    throw new Error("usage: executor.ts --bundle <path> --bundle-digest <sha256> --project-ref <ref> --approval <phrase> [--apply]");
  }
  return { bundlePath, bundleDigest, projectRef, approval, apply };
}

function approvedBundlePath(rootDir: string, inputPath: string) {
  const evidenceRoot = resolve(rootDir, "docs/verification/releases");
  const bundlePath = resolve(rootDir, inputPath);
  const pathFromEvidenceRoot = relative(evidenceRoot, bundlePath);
  if (
    pathFromEvidenceRoot === "" ||
    pathFromEvidenceRoot === ".." ||
    pathFromEvidenceRoot.startsWith(`..${sep}`) ||
    isAbsolute(pathFromEvidenceRoot)
  ) {
    throw new Error("bundle must be inside docs/verification/releases");
  }
  return bundlePath;
}

export async function runExecutorCli(
  args: readonly string[],
  rootDir: string,
  env: NodeJS.ProcessEnv,
  deps: ExecutorCliDeps,
) {
  const options = parseCliArgs(args);
  const databaseUrl = env.RELEASE_DATABASE_URL;
  const environmentProjectRef = env.RELEASE_PROJECT_REF;
  const applicationCommit = env.RELEASE_APPLICATION_COMMIT ?? env.GITHUB_SHA;
  if (!databaseUrl) throw new Error("RELEASE_DATABASE_URL is required");
  if (!environmentProjectRef) throw new Error("RELEASE_PROJECT_REF is required");
  if (!applicationCommit) throw new Error("RELEASE_APPLICATION_COMMIT is required");
  if (!/^[a-f0-9]{40}$/i.test(applicationCommit)) {
    throw new Error("RELEASE_APPLICATION_COMMIT must be a full commit SHA");
  }
  if (options.projectRef !== environmentProjectRef) throw new Error("project reference does not match RELEASE_PROJECT_REF");

  const bundlePath = approvedBundlePath(rootDir, options.bundlePath);
  const manifest = parseReleaseManifest(
    JSON.parse(await deps.readFile(resolve(rootDir, "supabase/release-manifest.json"), "utf8")),
  );
  const manifestErrors = await (deps.validateManifest ?? validateManifest)(manifest, rootDir);
  if (manifestErrors.length) throw new Error(`release manifest rejected: ${manifestErrors.join("; ")}`);
  const manifestDigest = digestManifest(manifest);
  const expectedMigrationRange = {
    from: manifest.migrations[0]?.version ?? "",
    to: manifest.migrations.at(-1)?.version ?? "",
  };
  const expectedMigrationChecksums = manifest.migrations.map(({ version, sha256 }) => ({ version, sha256 }));
  const parsedEvidence = parseEvidence(JSON.parse(await deps.readFile(bundlePath, "utf8")));
  if (!parsedEvidence.evidence) {
    throw new Error(`release evidence rejected: ${parsedEvidence.errors.join("; ")}`);
  }
  const evidence = parsedEvidence.evidence;
  const expectedCapabilities = [...new Set(manifest.migrations.flatMap((migration) => migration.capabilities))];
  const freshPreflight = () =>
    runPreflight(
      {
        databaseUrl,
        projectRef: environmentProjectRef,
        manifestDigest,
        expectedCapabilities,
        now: new Date(),
      },
      deps,
    );
  const currentPreflight = await freshPreflight();
  return executeRelease(
    {
      databaseUrl,
      projectRef: environmentProjectRef,
      evidence,
      evidenceDigest: options.bundleDigest,
      currentSchemaFingerprint: currentPreflight.schemaFingerprint,
      currentManifestDigest: currentPreflight.manifestDigest,
      currentApplicationCommit: applicationCommit.toLowerCase(),
      expectedCapabilities,
      expectedMigrationRange,
      expectedMigrationChecksums,
      now: new Date(),
      apply: options.apply,
      approval: options.approval,
    },
    { run: deps.run, postflight: freshPreflight },
  );
}

const defaultDeps: ExecutorCliDeps = {
  run: runCommand,
  readFile,
  rm,
  tempFile: () => resolve(tmpdir(), `adfocate-executor-preflight-${randomUUID()}.sql`),
};

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runExecutorCli(process.argv.slice(2), process.cwd(), process.env, defaultDeps);
}
