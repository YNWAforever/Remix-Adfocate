import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ReleaseEvidence,
  ReleaseMigrationChecksum,
  ReleaseMigrationRange,
  ReleaseRoleAssignments,
  ReleaseTestResult,
} from "./contracts";

const SENSITIVE_KEY = /(secret|token|password|jwt|email|signed.?url|database.?url)/i;
const SENSITIVE_VALUE = /(postgres(?:ql)?:\/\/|eyJ[A-Za-z0-9_-]+\.|@[^\s]+\.[^\s]+)/i;

export interface EvidenceInput {
  readonly targetProjectRef: string;
  readonly schemaFingerprint: string;
  readonly manifestDigest: string;
  readonly preflightHash: string;
  readonly rehearsalHash: string;
  readonly applicationCommit: string;
  readonly migrationRange: ReleaseMigrationRange;
  readonly migrationChecksums: readonly ReleaseMigrationChecksum[];
  readonly recoveryReference: string;
  readonly roles: ReleaseRoleAssignments;
  readonly testResults: readonly ReleaseTestResult[];
  readonly proposedProductionCommands: readonly string[];
  readonly containmentCommands: readonly string[];
  readonly warnings: readonly string[];
  readonly skippedChecks: readonly string[];
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface ExpectedEvidence {
  readonly projectRef?: string;
  readonly schemaFingerprint?: string;
  readonly manifestDigest?: string;
  readonly applicationCommit?: string;
  readonly migrationRange?: ReleaseMigrationRange;
  readonly migrationChecksums?: readonly ReleaseMigrationChecksum[];
  readonly recoveryReference?: string;
  readonly roles?: Partial<ReleaseRoleAssignments>;
  readonly bundleDigest?: string;
}

export interface EvidenceFilesystem {
  readonly mkdir: (path: string, options: { recursive: true }) => Promise<void>;
  readonly writeFile: (
    path: string,
    data: string,
    options: { encoding: "utf8"; flag: "wx" },
  ) => Promise<void>;
}

const defaultFilesystem: EvidenceFilesystem = {
  mkdir: async (path, options) => {
    await mkdir(path, options);
  },
  writeFile,
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

function canonicalJson(value: unknown) {
  return JSON.stringify(canonicalize(value));
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function sameCanonical(left: unknown, right: unknown) {
  return canonicalJson(left) === canonicalJson(right);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function nonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

function contentForDigest(evidence: Omit<ReleaseEvidence, "contentDigest">) {
  return canonicalJson(evidence);
}

export function assertSanitized(value: unknown, path = "evidence"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSanitized(item, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (SENSITIVE_KEY.test(key)) throw new Error(`sensitive evidence key: ${path}.${key}`);
      assertSanitized(item, `${path}.${key}`);
    }
    return;
  }
  if (typeof value === "string" && SENSITIVE_VALUE.test(value)) {
    throw new Error(`sensitive evidence value: ${path}`);
  }
}

export function buildEvidence(input: EvidenceInput): ReleaseEvidence {
  assertSanitized(input);
  const evidence = {
    schemaVersion: 1 as const,
    targetProjectRef: input.targetProjectRef,
    schemaFingerprint: input.schemaFingerprint,
    manifestDigest: input.manifestDigest,
    preflightHash: input.preflightHash,
    rehearsalHash: input.rehearsalHash,
    applicationCommit: input.applicationCommit,
    migrationRange: { ...input.migrationRange },
    migrationChecksums: [...input.migrationChecksums].sort((left, right) =>
      left.version.localeCompare(right.version),
    ),
    recoveryReference: input.recoveryReference,
    roles: { ...input.roles },
    testResults: [...input.testResults].sort((left, right) => left.gate.localeCompare(right.gate)),
    proposedProductionCommands: [...input.proposedProductionCommands],
    containmentCommands: [...input.containmentCommands],
    warnings: [...input.warnings],
    skippedChecks: [...input.skippedChecks],
    createdAt: input.createdAt,
    expiresAt: input.expiresAt,
  };
  return { ...evidence, contentDigest: sha256(contentForDigest(evidence)) };
}

export function digestEvidence(evidence: ReleaseEvidence): string {
  assertSanitized(evidence);
  return sha256(canonicalJson(evidence));
}

function contentDigestFor(evidence: ReleaseEvidence) {
  const { contentDigest: _ignored, ...content } = evidence;
  return sha256(contentForDigest(content));
}

export function verifyEvidence(
  evidence: ReleaseEvidence,
  expected: ExpectedEvidence,
  now: Date,
): string[] {
  const errors: string[] = [];
  try {
    assertSanitized(evidence);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "evidence contains sensitive value");
  }

  const candidate = asRecord(evidence);
  if (!candidate || candidate.schemaVersion !== 1) errors.push("evidence schema version mismatch");
  if (!nonEmptyString(candidate?.recoveryReference)) errors.push("recovery reference is missing");
  if (!nonEmptyString(candidate?.contentDigest) || contentDigestFor(evidence) !== evidence.contentDigest) {
    errors.push("evidence content digest mismatch");
  }
  if (!Number.isFinite(Date.parse(evidence.expiresAt)) || new Date(evidence.expiresAt) <= now) {
    errors.push("evidence has expired");
  }
  if (expected.projectRef !== undefined && evidence.targetProjectRef !== expected.projectRef) {
    errors.push("target project reference mismatch");
  }
  if (expected.schemaFingerprint !== undefined && evidence.schemaFingerprint !== expected.schemaFingerprint) {
    errors.push("schema fingerprint mismatch");
  }
  if (expected.manifestDigest !== undefined && evidence.manifestDigest !== expected.manifestDigest) {
    errors.push("manifest digest mismatch");
  }
  if (expected.applicationCommit !== undefined && evidence.applicationCommit !== expected.applicationCommit) {
    errors.push("application commit mismatch");
  }
  if (expected.migrationRange !== undefined && !sameCanonical(evidence.migrationRange, expected.migrationRange)) {
    errors.push("migration range mismatch");
  }
  if (
    expected.migrationChecksums !== undefined &&
    !sameCanonical(evidence.migrationChecksums, expected.migrationChecksums)
  ) {
    errors.push("migration checksums mismatch");
  }
  if (expected.recoveryReference !== undefined && evidence.recoveryReference !== expected.recoveryReference) {
    errors.push("recovery reference mismatch");
  }
  for (const [role, value] of Object.entries(expected.roles ?? {})) {
    if (evidence.roles[role as keyof ReleaseRoleAssignments] !== value) {
      errors.push(`role mismatch: ${role}`);
    }
  }
  if (expected.bundleDigest !== undefined && digestEvidence(evidence) !== expected.bundleDigest) {
    errors.push("evidence bundle digest mismatch");
  }
  return errors;
}

export async function persistEvidence(
  evidence: ReleaseEvidence,
  directory: string,
  filesystem: EvidenceFilesystem = defaultFilesystem,
) {
  assertSanitized(evidence);
  const createdAt = new Date(evidence.createdAt);
  if (!Number.isFinite(createdAt.valueOf())) throw new Error("invalid evidence creation time");
  const digest = digestEvidence(evidence);
  const timestamp = createdAt.toISOString().replaceAll(":", "-").replace(".000Z", "Z");
  const filename = `${timestamp}-${digest}.json`;
  if (basename(filename) !== filename) throw new Error("invalid evidence filename");
  const path = join(directory, filename);
  await filesystem.mkdir(directory, { recursive: true });
  await filesystem.writeFile(path, `${JSON.stringify(canonicalize(evidence), null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  return { path, digest };
}

interface EvidenceCliDeps extends EvidenceFilesystem {
  readonly readFile: (path: string, encoding: "utf8") => Promise<string>;
}

function evidenceInputPath(args: readonly string[], rootDir: string) {
  if (args.length !== 2 || args[0] !== "--input" || !args[1]) {
    throw new Error("usage: evidence.ts --input <sanitized-evidence-input.json>");
  }
  return resolve(rootDir, args[1]);
}

export async function runEvidenceCli(
  args: readonly string[],
  rootDir: string,
  deps: EvidenceCliDeps,
) {
  const inputPath = evidenceInputPath(args, rootDir);
  const input = JSON.parse(await deps.readFile(inputPath, "utf8")) as EvidenceInput;
  const evidence = buildEvidence(input);
  return persistEvidence(evidence, resolve(rootDir, "docs/verification/releases"), deps);
}

const defaultCliDeps: EvidenceCliDeps = { ...defaultFilesystem, readFile };

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(await runEvidenceCli(process.argv.slice(2), process.cwd(), defaultCliDeps))}\n`);
}
