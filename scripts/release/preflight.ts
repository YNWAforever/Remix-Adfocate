import { createHash, randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import type { CapabilityStatus, PreflightReport } from "./contracts";
import { digestManifest, parseReleaseManifest } from "./manifest";
import { runCommand, type CommandRunner } from "./process";

type CapabilityValidator = (schema: string) => CapabilityStatus;
type CapabilityValidatorFactory = (parts: readonly string[]) => CapabilityValidator | undefined;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function identifier(value: string) {
  const escaped = escapeRegExp(value);
  return `(?:${escaped}(?![a-z0-9_])|"${escaped}")`;
}

function qualified(schema: string, object: string) {
  return `${identifier(schema)}\\s*\\.\\s*${identifier(object)}`;
}

function statementMatches(schema: string, expression: string) {
  return new RegExp(expression, "i").test(schema);
}

function tableDefinition(schema: string, table: string) {
  const match = new RegExp(
    `CREATE TABLE(?: IF NOT EXISTS)?\\s+${table}\\s*\\(([\\s\\S]*?)\\)\\s*;`,
    "i",
  ).exec(schema);
  return match?.[1] ?? "";
}

function presentIf(matches: boolean): CapabilityStatus {
  return matches ? "present" : "absent";
}

function functionValidator(schemaName: string, name: string): CapabilityValidator {
  const target = qualified(schemaName, name);
  const anyFunction = `CREATE(?: OR REPLACE)? FUNCTION\\s+${target}`;
  const requiredParameter =
    schemaName === "public" && name === "create_mission_workflow"
      ? "p_submission uuid"
      : schemaName === "public" && name === "join_active_mission"
        ? "p_mission uuid"
        : undefined;
  if (!requiredParameter) return (schema) => presentIf(statementMatches(schema, anyFunction));

  return (schema) => {
    if (statementMatches(schema, `${anyFunction}\\s*\\(${requiredParameter}\\)`)) {
      return "present";
    }
    return statementMatches(schema, anyFunction) ? "divergent" : "absent";
  };
}

function grantValidator(role: string, schemaName: string, object: string, privilege: string) {
  const target = qualified(schemaName, object);
  const grantee = identifier(role);
  if (privilege === "select" || privilege === "all") {
    const action = privilege === "all" ? "ALL(?: PRIVILEGES)?" : "SELECT";
    return (schema: string) =>
      presentIf(
        statementMatches(
          schema,
          `GRANT\\s+${action}\\s+ON TABLE\\s+${target}\\s+TO\\s+${grantee}`,
        ),
      );
  }

  const argumentsPattern = privilege
    .split(",")
    .map((argument) => {
      const escapedArgument = escapeRegExp(argument);
      const optionalArgumentName =
        '(?:(?:[a-z][a-z0-9_]*|"[a-z][a-z0-9_]*")\\s+)?';
      const qualifiedType = '(?:(?:pg_catalog|"pg_catalog")\\s*\\.\\s*)?';
      if (argument === "timestamptz") {
        return `${optionalArgumentName}${qualifiedType}(?:timestamptz|"timestamptz"|timestamp\\s+with\\s+time\\s+zone|"timestamp with time zone")`;
      }
      return `${optionalArgumentName}${qualifiedType}(?:${escapedArgument}|"${escapedArgument}")`;
    })
    .join("\\s*,\\s*");
  return (schema: string) =>
    presentIf(
      statementMatches(
        schema,
        `GRANT\\s+(?:EXECUTE|ALL(?:\\s+PRIVILEGES)?)\\s+ON FUNCTION\\s+${target}\\s*\\(${argumentsPattern}\\)\\s+TO\\s+${grantee}`,
      ),
    );
}

const CAPABILITY_VALIDATOR_REGISTRY: Record<string, CapabilityValidatorFactory> = {
  table: ([schemaName, tableName]) => {
    if (!schemaName || !tableName) return undefined;
    const target = qualified(schemaName, tableName);
    return (schema) => presentIf(statementMatches(schema, `CREATE TABLE(?: IF NOT EXISTS)?\\s+${target}`));
  },
  column: ([schemaName, tableName, columnName]) => {
    if (!schemaName || !tableName || !columnName) return undefined;
    const target = qualified(schemaName, tableName);
    const column = identifier(columnName);
    return (schema) =>
      presentIf(
        new RegExp(`(?:^|\\n)\\s*${column}\\s+`, "im").test(tableDefinition(schema, target)) ||
          statementMatches(
            schema,
            `ALTER TABLE(?: ONLY)?\\s+${target}\\s+ADD COLUMN(?: IF NOT EXISTS)?\\s+${column}`,
          ),
      );
  },
  constraint: ([schemaName, tableName, constraintName]) => {
    if (!schemaName || !tableName || !constraintName) return undefined;
    const target = qualified(schemaName, tableName);
    const constraint = identifier(constraintName);
    return (schema) =>
      presentIf(
        new RegExp(`CONSTRAINT\\s+${constraint}`, "i").test(tableDefinition(schema, target)) ||
          statementMatches(
            schema,
            `ALTER TABLE(?: ONLY)?\\s+${target}\\s+ADD CONSTRAINT\\s+${constraint}`,
          ),
      );
  },
  "constraint-removed": ([schemaName, tableName, constraintName]) => {
    if (!schemaName || !tableName || !constraintName) return undefined;
    const validator = CAPABILITY_VALIDATOR_REGISTRY.constraint?.([
      schemaName,
      tableName,
      constraintName,
    ]);
    if (!validator) return undefined;
    return (schema) => (validator(schema) === "absent" ? "present" : "divergent");
  },
  function: ([schemaName, functionName]) => {
    if (!schemaName || !functionName) return undefined;
    return functionValidator(schemaName, functionName);
  },
  grant: ([role, schemaName, objectAndPrivilege]) => {
    const openingParenthesis = objectAndPrivilege?.indexOf("(") ?? -1;
    if (
      !role ||
      !schemaName ||
      openingParenthesis <= 0 ||
      !objectAndPrivilege?.endsWith(")")
    ) {
      return undefined;
    }
    const object = objectAndPrivilege.slice(0, openingParenthesis);
    const privilege = objectAndPrivilege.slice(openingParenthesis + 1, -1);
    if (
      !/^[a-z][a-z0-9_]*$/.test(object) ||
      !privilege ||
      [...privilege].some((character) => !"abcdefghijklmnopqrstuvwxyz0123456789_,[]".includes(character))
    ) {
      return undefined;
    }
    return grantValidator(role, schemaName, object, privilege);
  },
  index: ([schemaName, tableName, indexName]) => {
    if (!schemaName || !tableName || !indexName) return undefined;
    const target = qualified(schemaName, tableName);
    const index = identifier(indexName);
    return (schema) =>
      presentIf(
        statementMatches(
          schema,
          `CREATE(?: UNIQUE)? INDEX\\s+${index}\\s+ON\\s+${target}`,
        ),
      );
  },
  policy: ([schemaName, tableName, policyName]) => {
    if (!schemaName || !tableName || !policyName) return undefined;
    const target = qualified(schemaName, tableName);
    const policy = identifier(policyName);
    return (schema) =>
      presentIf(statementMatches(schema, `CREATE POLICY\\s+${policy}\\s+ON\\s+${target}`));
  },
  rls: ([schemaName, tableName]) => {
    if (!schemaName || !tableName) return undefined;
    const target = qualified(schemaName, tableName);
    return (schema) =>
      presentIf(
        statementMatches(
          schema,
          `ALTER TABLE(?: ONLY)?\\s+${target}\\s+ENABLE ROW LEVEL SECURITY\\b`,
        ),
      );
  },
  "storage-bucket": ([schemaName, tableName, bucketName]) => {
    if (schemaName !== "storage" || tableName !== "buckets" || !bucketName) return undefined;
    return () => "unverifiable";
  },
  "storage-policy": ([schemaName, tableName, policyName]) => {
    if (schemaName !== "storage" || tableName !== "objects" || !policyName) return undefined;
    return () => "unverifiable";
  },
  trigger: ([schemaName, tableOrTriggerName, tableSpecificTriggerName]) => {
    if (!schemaName || !tableOrTriggerName) return undefined;
    const trigger = identifier(tableSpecificTriggerName ?? tableOrTriggerName);
    const target = tableSpecificTriggerName
      ? qualified(schemaName, tableOrTriggerName)
      : `${identifier(schemaName)}\\s*\\.\\s*(?:[a-z][a-z0-9_]*|"[a-z][a-z0-9_]*")`;
    return (schema) =>
      presentIf(
        statementMatches(schema, `CREATE TRIGGER\\s+${trigger}[^;]*?\\sON\\s+${target}`),
      );
  },
};

function validatorFor(name: string) {
  const separator = name.indexOf(":");
  if (separator === -1) return undefined;
  const kind = name.slice(0, separator);
  const parts = name.slice(separator + 1).split(".");
  const factory = CAPABILITY_VALIDATOR_REGISTRY[kind ?? ""];
  return factory?.(parts);
}

export function hasCapabilityValidator(name: string) {
  return validatorFor(name) !== undefined;
}

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
  const validator = validatorFor(name);
  if (!validator) return "unverifiable";
  return validator(schema);
}

function hash(value: string) {
  return createHash("sha256").update(value.replaceAll("\r\n", "\n")).digest("hex");
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
      let result: Awaited<ReturnType<CommandRunner>>;
      try {
        result = await deps.run("npx", [...args]);
      } catch (error) {
        throw new Error(
          `command execution failed: ${redact(commandErrorDetail(error), input.databaseUrl)}`,
        );
      }
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
    (!pathFromMigrations.startsWith(`..${sep}`) &&
      pathFromMigrations !== ".." &&
      !isAbsolute(pathFromMigrations))
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
