import { createHash } from "node:crypto";
import { readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { ReleaseManifest } from "./contracts";
import { digestManifest, parseReleaseManifest } from "./manifest";

const VERSION = /^\d{4}(?:\d{10})?$/;
const NAME = /^[a-z0-9][a-z0-9_]{0,159}$/;
const PROJECT = /^[a-z0-9][a-z0-9-]{2,79}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const OBJECT = /^(?:table|rls|column|constraint|index|policy|function|trigger|type):(?:public|private)\.[a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)?$/;
const INVENTORIED_KINDS = new Set(["table", "rls", "column", "constraint", "index", "policy", "function", "trigger", "type"]);

export interface MigrationHistoryRow {
  readonly version: string;
  readonly name: string | null;
  readonly statementCount: number;
  readonly statementsSha256: string | null;
}
export interface MigrationHistorySnapshot {
  readonly schemaVersion: 1;
  readonly targetProjectRef: string;
  readonly observedAt: string;
  readonly transactionReadOnly: true;
  readonly history: readonly MigrationHistoryRow[];
  /** Catalog object names only. Presence is not a semantic/schema verification. */
  readonly catalogObjects: readonly string[];
}
export interface MigrationSource {
  readonly version: string;
  readonly name: string;
  readonly path: string;
  readonly sha256: string;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

/** Reject raw statements/extra fields instead of copying them to a release ticket. */
export function parseHistorySnapshot(value: unknown, expectedProjectRef: string): MigrationHistorySnapshot {
  const raw = record(value);
  const fail = () => { throw new Error("invalid or unsanitized migration history snapshot"); };
  if (!raw || !exactKeys(raw, ["schemaVersion", "targetProjectRef", "observedAt", "transactionReadOnly", "history", "catalogObjects"])) return fail();
  if (!PROJECT.test(expectedProjectRef) || raw.targetProjectRef !== expectedProjectRef) throw new Error("migration history target project mismatch");
  if (raw.schemaVersion !== 1 || raw.transactionReadOnly !== true || typeof raw.observedAt !== "string"
    || !/^\d{4}-\d\d-\d\dT/.test(raw.observedAt) || !Number.isFinite(Date.parse(raw.observedAt))) return fail();
  if (!Array.isArray(raw.history) || raw.history.length > 10000 || !Array.isArray(raw.catalogObjects) || raw.catalogObjects.length > 50000) return fail();
  const seen = new Set<string>();
  const history = raw.history.map((item): MigrationHistoryRow => {
    const row = record(item);
    if (!row || !exactKeys(row, ["version", "name", "statementCount", "statementsSha256"]) || typeof row.version !== "string" || !VERSION.test(row.version)) return fail();
    if (seen.has(row.version)) throw new Error("duplicate migration history version");
    seen.add(row.version);
    if (row.name !== null && (typeof row.name !== "string" || !NAME.test(row.name))) return fail();
    if (typeof row.statementCount !== "number" || !Number.isSafeInteger(row.statementCount) || row.statementCount < 0) return fail();
    if (row.statementsSha256 !== null && (typeof row.statementsSha256 !== "string" || !SHA256.test(row.statementsSha256))) return fail();
    return { version: row.version, name: row.name, statementCount: row.statementCount, statementsSha256: row.statementsSha256 } as MigrationHistoryRow;
  });
  if (raw.catalogObjects.some(item => typeof item !== "string" || !OBJECT.test(item))) return fail();
  return {
    schemaVersion: 1, targetProjectRef: expectedProjectRef, observedAt: raw.observedAt,
    transactionReadOnly: true, history: history.sort((a, b) => a.version.localeCompare(b.version)),
    catalogObjects: [...new Set(raw.catalogObjects as string[])].sort(),
  };
}

export async function readMigrationSources(rootDir: string): Promise<MigrationSource[]> {
  const migrationsDir = resolve(rootDir, "supabase/migrations");
  const files = (await readdir(migrationsDir)).filter(name => /^(\d{4}|\d{14})_[a-z0-9_]+\.sql$/.test(name)).sort();
  return Promise.all(files.map(async file => {
    const match = /^(\d{4}|\d{14})_([a-z0-9_]+)\.sql$/.exec(file)!;
    const content = (await readFile(resolve(migrationsDir, file), "utf8")).replace(/\r\n?/g, "\n");
    return { version: match[1], name: match[2], path: `supabase/migrations/${file}`, sha256: sha256(content) };
  }));
}

/** This report deliberately has no approval digest or write/repair command. */
export function auditMigrationHistory(manifest: ReleaseManifest, snapshot: MigrationHistorySnapshot, sources: readonly MigrationSource[]) {
  snapshot = parseHistorySnapshot(snapshot, snapshot.targetProjectRef);
  const byVersion = new Map(sources.map(source => [source.version, source]));
  if (byVersion.size !== sources.length) throw new Error("duplicate source migration version");
  const history = new Map(snapshot.history.map(row => [row.version, row]));
  const manifestVersions = new Set(manifest.migrations.map(migration => migration.version));
  const objects = new Set(snapshot.catalogObjects);
  const reviewed = manifest.migrations.map(migration => {
    const source = byVersion.get(migration.version);
    if (!source || source.name !== migration.name || source.sha256 !== migration.sha256) throw new Error("reviewed source does not match the manifest");
    const row = history.get(migration.version);
    const capabilities = migration.capabilities.map(name => {
      const kind = name.slice(0, name.indexOf(":"));
      const supported = INVENTORIED_KINDS.has(kind) && OBJECT.test(name);
      // Older manifest entries identify a trigger by schema/name, while catalog
      // capture always records its table too. Match that schema-wide form exactly.
      const trigger = /^trigger:((?:public|private))\.([a-z_][a-z0-9_]*)$/.exec(name);
      const present = objects.has(name) || Boolean(trigger && snapshot.catalogObjects.some(object =>
        object.startsWith(`trigger:${trigger[1]}.`) && object.endsWith(`.${trigger[2]}`)));
      return { name, objectExistence: supported ? (present ? "present" as const : "absent" as const) : "unchecked" as const };
    });
    return {
      version: migration.version, name: migration.name, sourceSha256: migration.sha256,
      history: row ? "recorded" as const : "missing" as const,
      recordedNameMatches: row ? row.name === migration.name : null,
      // Supabase history stores split statements; their joined hash is not the source-file hash.
      recordedStatementCount: row?.statementCount ?? null,
      objectExistence: {
        present: capabilities.filter(item => item.objectExistence === "present").length,
        absent: capabilities.filter(item => item.objectExistence === "absent").length,
        unchecked: capabilities.filter(item => item.objectExistence === "unchecked").length,
      }, capabilities,
    };
  });
  const outsideManifestHistory = snapshot.history.filter(row => !manifestVersions.has(row.version)).map(row => {
    const exactSource = byVersion.get(row.version);
    return {
      version: row.version, name: row.name, statementCount: row.statementCount,
      statementsSha256: row.statementsSha256,
      exactSourcePath: exactSource?.path ?? null,
      // A filename/name similarity is only a recovery lead, never proof of execution.
      nameCandidateSourcePaths: row.name ? sources.filter(source => source.name === row.name || `${source.version}_${source.name}` === row.name).map(source => source.path).sort() : [],
    };
  });
  const missing = reviewed.filter(row => row.history === "missing");
  return {
    reportType: "migration-history-review" as const, schemaVersion: 1,
    decision: "HOLD" as const, validReleaseEvidence: false as const,
    targetProjectRef: snapshot.targetProjectRef, observedAt: snapshot.observedAt,
    manifestDigest: digestManifest(manifest),
    // This digest identifies an object-name inventory, not function bodies, ACLs, or a schema dump.
    catalogObjectInventoryDigest: sha256(JSON.stringify(snapshot.catalogObjects)),
    counts: {
      recordedHistory: snapshot.history.length, sourceFiles: sources.length, reviewedMigrations: reviewed.length,
      reviewedHistoryRecorded: reviewed.length - missing.length, reviewedHistoryMissing: missing.length,
      outsideManifestHistory: outsideManifestHistory.length,
      missingHistoryWithSomeObjectsPresent: missing.filter(row => row.objectExistence.present > 0).length,
      missingHistoryWithSomeObjectsAbsent: missing.filter(row => row.objectExistence.absent > 0).length,
    },
    reviewedMigrations: reviewed, outsideManifestHistory,
    scopeLimits: [
      "Absent migration history does not prove absent schema or justify replaying old SQL.",
      "Object existence does not verify function bodies, policy expressions, ACLs, constraints, indexes, or migration execution.",
      "Statements hashes identify archived split statements; they are not comparable to migration file hashes.",
      "History outside this feature manifest may belong to earlier baseline releases; it is not automatically unreviewed.",
      "Name candidates are leads for manual comparison only; never mark a migration applied from a name match.",
      "This report is always HOLD and never replaces full preflight, rehearsal, recovery review, or scoped approval.",
    ],
    automaticWrites: [] as string[],
  };
}

export async function runHistoryAuditCli(args: readonly string[], rootDir = process.cwd()) {
  if (args.length !== 6 || args[0] !== "--snapshot" || args[2] !== "--project-ref" || args[4] !== "--output") {
    throw new Error("usage: history-audit.ts --snapshot <sanitized-json> --project-ref <ref> --output <new-report.json>");
  }
  const input = resolve(rootDir, args[1]);
  const output = resolve(rootDir, args[5]);
  // Canonicalize existing parents before creating a new file. A junction/symlink
  // outside migrations must not turn an apparently safe path into a source write.
  const [migrationsDirectory, outputParent, inputFile] = await Promise.all([
    realpath(resolve(rootDir, "supabase/migrations")), realpath(dirname(output)), realpath(input),
  ]);
  const canonicalOutput = resolve(outputParent, basename(output));
  const withinMigrations = relative(migrationsDirectory, canonicalOutput);
  if (canonicalOutput === inputFile || withinMigrations === "" || (!withinMigrations.startsWith(`..${sep}`) && !isAbsolute(withinMigrations))) {
    throw new Error("history audit output must be a new file outside migrations");
  }
  const snapshot = parseHistorySnapshot(JSON.parse(await readFile(input, "utf8")), args[3]);
  const manifest = parseReleaseManifest(JSON.parse(await readFile(resolve(rootDir, "supabase/release-manifest.json"), "utf8")));
  const sources = await readMigrationSources(rootDir);
  const report = auditMigrationHistory(manifest, snapshot, sources);
  await writeFile(canonicalOutput, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = await runHistoryAuditCli(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify({ decision: report.decision, counts: report.counts })}\n`);
  } catch {
    // Input errors can contain authored text or credentials; never echo them.
    process.stderr.write("Migration history audit failed; check sanitized input, project scope, manifest, and output path.\n");
    process.exitCode = 1;
  }
}
