import { createHash, randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import type { CapabilityStatus, PreflightReport } from "./contracts";
import { digestManifest, parseReleaseManifest } from "./manifest";
import { runCommand, type CommandRunner } from "./process";

const CAPABILITY_VALIDATORS: Record<
  string,
  { readonly present: RegExp; readonly divergent?: RegExp }
> = {
  "table:public.mission_workflows": { present: /CREATE TABLE public\.mission_workflows\b/i },
  "column:public.missions.creator_workflow_mode": { present: /creator_workflow_mode/i },
  "function:public.create_mission_workflow": {
    present: /CREATE(?: OR REPLACE)? FUNCTION public\.create_mission_workflow\(p_submission uuid\)/i,
    divergent: /FUNCTION public\.create_mission_workflow\b/i,
  },
  "policy:public.mission_workflows.mission_workflows_creator_read": {
    present: /CREATE POLICY mission_workflows_creator_read ON public\.mission_workflows\b/i,
  },
  "trigger:public.mission_draft_versions_immutable": {
    present: /CREATE TRIGGER mission_draft_versions_immutable\b[\s\S]*? ON public\.mission_draft_versions\b/i,
  },
  "grant:authenticated.public.create_mission_workflow(uuid)": {
    present: /GRANT EXECUTE ON FUNCTION public\.create_mission_workflow\(uuid\) TO authenticated\b/i,
  },
  "storage-policy:storage.objects.mission_draft_assets_storage_read": {
    present: /CREATE POLICY mission_draft_assets_storage_read ON storage\.objects\b/i,
  },
  "table:public.mission_publication_proof_attempts": {
    present: /CREATE TABLE public\.mission_publication_proof_attempts\b/i,
  },
  "policy:public.mission_publication_proof_attempts.mission_publication_proof_attempts_creator_read": {
    present: /CREATE POLICY mission_publication_proof_attempts_creator_read ON public\.mission_publication_proof_attempts\b/i,
  },
  "trigger:public.mission_publication_proof_attempts_immutable": {
    present: /CREATE TRIGGER mission_publication_proof_attempts_immutable\b[\s\S]*? ON public\.mission_publication_proof_attempts\b/i,
  },
  "table:public.mission_reward_contracts": {
    present: /CREATE TABLE public\.mission_reward_contracts\b/i,
  },
  "table:public.mission_completion_decisions": {
    present: /CREATE TABLE public\.mission_completion_decisions\b/i,
  },
  "table:public.mission_pending_rewards": {
    present: /CREATE TABLE public\.mission_pending_rewards\b/i,
  },
  "rls:public.mission_reward_contracts": {
    present: /ALTER TABLE(?: ONLY)? public\.mission_reward_contracts ENABLE ROW LEVEL SECURITY/i,
  },
  "trigger:public.mission_reward_contracts_immutable": {
    present: /CREATE TRIGGER mission_reward_contracts_immutable\b[\s\S]*? ON public\.mission_reward_contracts\b/i,
  },
  "trigger:public.mission_completion_decisions_immutable": {
    present: /CREATE TRIGGER mission_completion_decisions_immutable\b[\s\S]*? ON public\.mission_completion_decisions\b/i,
  },
  "trigger:public.mission_pending_rewards_guarded_update": {
    present: /CREATE TRIGGER mission_pending_rewards_guarded_update\b[\s\S]*? ON public\.mission_pending_rewards\b/i,
  },
  "function:public.join_active_mission": {
    present: /CREATE(?: OR REPLACE)? FUNCTION public\.join_active_mission\(p_mission uuid\)/i,
    divergent: /FUNCTION public\.join_active_mission\b/i,
  },
  "grant:authenticated.public.join_active_mission(uuid)": {
    present: /GRANT EXECUTE ON FUNCTION public\.join_active_mission\(uuid\) TO authenticated\b/i,
  },
  "function:public.approve_mission_completion": {
    present: /CREATE(?: OR REPLACE)? FUNCTION public\.approve_mission_completion\b/i,
  },
  "function:public.cancel_mission_reward_handoff": {
    present: /CREATE(?: OR REPLACE)? FUNCTION public\.cancel_mission_reward_handoff\b/i,
  },
  "trigger:public.reward_handoff_workflow_event_notifications": {
    present: /CREATE TRIGGER reward_handoff_workflow_event_notifications\b/i,
  },
  "function:public.retry_reward_handoff_notification": {
    present: /CREATE(?: OR REPLACE)? FUNCTION public\.retry_reward_handoff_notification\b/i,
  },
  "grant:service_role.public.retry_reward_handoff_notification(uuid,uuid,uuid,text)": {
    present: /GRANT EXECUTE ON FUNCTION public\.retry_reward_handoff_notification\(uuid, uuid, uuid, text\) TO service_role\b/i,
  },
};

export interface PreflightInput {
  readonly databaseUrl: string;
  readonly projectRef: string;
  readonly manifestDigest: string;
  readonly expectedCapabilities: readonly string[];
  readonly now: Date;
}

export interface PreflightDeps {
  readonly run: CommandRunner;
  readonly readFile: (path: string, encoding: "utf8") => Promise<string>;
  readonly rm: (path: string, options: { force: true }) => Promise<void>;
  readonly tempFile: () => string;
}

function capabilityStatus(name: string, schema: string): CapabilityStatus {
  const validator = CAPABILITY_VALIDATORS[name];
  if (!validator) return "unverifiable";
  if (validator.present.test(schema)) return "present";
  if (validator.divergent?.test(schema)) return "divergent";
  return "absent";
}

function hash(value: string) {
  return createHash("sha256").update(value.replaceAll("\r\n", "\n")).digest("hex");
}

function redact(value: string, databaseUrl: string) {
  return value
    .replaceAll(databaseUrl, "[REDACTED]")
    .replace(/postgres(?:ql)?:\/\/[^\s'"`]+/gi, "[REDACTED]");
}

export async function runPreflight(
  input: PreflightInput,
  deps: PreflightDeps,
): Promise<PreflightReport> {
  const dumpPath = deps.tempFile();
  const commands: ReadonlyArray<readonly [string, string[]]> = [
    ["migration list", ["supabase", "migration", "list", "--db-url", input.databaseUrl]],
    ["db push dry-run", ["supabase", "db", "push", "--dry-run", "--db-url", input.databaseUrl]],
    ["db dump", ["supabase", "db", "dump", "--db-url", input.databaseUrl, "--file", dumpPath, "--keep-comments"]],
  ];
  const outputs: string[] = [];
  let schema: string;

  try {
    for (const [label, args] of commands) {
      const result = await deps.run("npx", [...args]);
      if (result.code !== 0) {
        throw new Error(`${label} failed: ${redact(result.stderr.trim(), input.databaseUrl)}`);
      }
      outputs.push(result.stdout);
    }
    schema = await deps.readFile(dumpPath, "utf8");
  } finally {
    await deps.rm(dumpPath, { force: true });
  }

  const capabilities = input.expectedCapabilities.map((name) => ({
    name,
    status: capabilityStatus(name, schema),
  }));
  return {
    schemaVersion: 1,
    targetProjectRef: input.projectRef,
    manifestDigest: input.manifestDigest,
    migrationListHash: hash(outputs[0] ?? ""),
    dryRunHash: hash(outputs[1] ?? ""),
    schemaFingerprint: hash(schema),
    capabilities,
    warnings: capabilities
      .filter(({ status }) => status !== "present")
      .map(({ name, status }) => `${status} capability: ${name}`),
    createdAt: input.now.toISOString(),
  };
}

interface PreflightCliDeps extends PreflightDeps {
  readonly writeFile: (path: string, data: string, encoding: "utf8") => Promise<void>;
}

function outputPath(args: readonly string[], rootDir: string) {
  if (args.length !== 2 || args[0] !== "--output" || !args[1]) {
    throw new Error("usage: preflight.ts --output <path>");
  }
  const output = resolve(rootDir, args[1]);
  const migrations = resolve(rootDir, "supabase/migrations");
  const pathFromMigrations = relative(migrations, output);
  if (
    pathFromMigrations === "" ||
    (!pathFromMigrations.startsWith("..") && !isAbsolute(pathFromMigrations))
  ) {
    throw new Error("preflight output must not be inside supabase/migrations");
  }
  return output;
}

export async function runPreflightCli(
  args: readonly string[],
  rootDir: string,
  env: NodeJS.ProcessEnv,
  deps: PreflightCliDeps,
) {
  const output = outputPath(args, rootDir);
  const databaseUrl = env.PREFLIGHT_DATABASE_URL;
  const projectRef = env.RELEASE_PROJECT_REF;
  if (!databaseUrl) throw new Error("PREFLIGHT_DATABASE_URL is required");
  if (!projectRef) throw new Error("RELEASE_PROJECT_REF is required");

  const manifest = parseReleaseManifest(
    JSON.parse(await deps.readFile(resolve(rootDir, "supabase/release-manifest.json"), "utf8")),
  );
  const report = await runPreflight(
    {
      databaseUrl,
      projectRef,
      manifestDigest: digestManifest(manifest),
      expectedCapabilities: [
        ...new Set(manifest.migrations.flatMap((migration) => migration.capabilities)),
      ],
      now: new Date(),
    },
    deps,
  );
  await deps.writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

const defaultDeps: PreflightCliDeps = {
  run: runCommand,
  readFile,
  rm,
  tempFile: () => resolve(tmpdir(), `adfocate-preflight-${randomUUID()}.sql`),
  writeFile,
};

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runPreflightCli(process.argv.slice(2), process.cwd(), process.env, defaultDeps);
}
