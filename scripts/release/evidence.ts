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
const SHA256 = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const MIGRATION_VERSION = /^\d{14}$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T/;
const ROLE_KEYS = ["executor", "observer", "containmentOwner", "productOwner", "approver"] as const;
const EVIDENCE_INPUT_KEYS = [
  "targetProjectRef",
  "schemaFingerprint",
  "manifestDigest",
  "preflightHash",
  "rehearsalHash",
  "applicationCommit",
  "migrationRange",
  "migrationChecksums",
  "recoveryReference",
  "roles",
  "testResults",
  "proposedProductionCommands",
  "containmentCommands",
  "warnings",
  "skippedChecks",
  "createdAt",
  "expiresAt",
] as const;
const EVIDENCE_KEYS = ["schemaVersion", ...EVIDENCE_INPUT_KEYS, "contentDigest"] as const;

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

function exactKeys(source: Record<string, unknown>, keys: readonly string[], path: string, errors: string[]) {
  const expected = new Set(keys);
  for (const key of keys) {
    if (!Object.hasOwn(source, key)) errors.push(`${path}.${key} is missing`);
  }
  for (const key of Object.keys(source)) {
    if (!expected.has(key)) errors.push(`${path}.${key} is unknown`);
  }
}

function validString(value: unknown, path: string, errors: string[], pattern?: RegExp) {
  if (!nonEmptyString(value)) errors.push(`${path} is missing`);
  else if (pattern && !pattern.test(value)) errors.push(`${path} is invalid`);
}

function stringArray(value: unknown, path: string, errors: string[]) {
  if (!Array.isArray(value)) {
    errors.push(`${path} is invalid`);
    return;
  }
  value.forEach((item, index) => validString(item, `${path}[${index}]`, errors));
}

function evidenceShapeErrors(value: unknown, requireContentDigest: boolean): string[] {
  const errors: string[] = [];
  const source = asRecord(value);
  if (!source) return ["evidence is invalid"];
  exactKeys(source, requireContentDigest ? EVIDENCE_KEYS : EVIDENCE_INPUT_KEYS, "evidence", errors);
  if (requireContentDigest && source.schemaVersion !== 1) errors.push("evidence.schemaVersion is invalid");
  validString(source.targetProjectRef, "evidence.targetProjectRef", errors);
  validString(source.schemaFingerprint, "evidence.schemaFingerprint", errors, SHA256);
  validString(source.manifestDigest, "evidence.manifestDigest", errors, SHA256);
  validString(source.preflightHash, "evidence.preflightHash", errors, SHA256);
  validString(source.rehearsalHash, "evidence.rehearsalHash", errors, SHA256);
  validString(source.applicationCommit, "evidence.applicationCommit", errors, COMMIT);
  validString(source.recoveryReference, "evidence.recoveryReference", errors);
  if (requireContentDigest) validString(source.contentDigest, "evidence.contentDigest", errors, SHA256);

  const range = asRecord(source.migrationRange);
  if (!range) errors.push("evidence.migrationRange is invalid");
  else {
    exactKeys(range, ["from", "to"], "evidence.migrationRange", errors);
    validString(range.from, "evidence.migrationRange.from", errors, MIGRATION_VERSION);
    validString(range.to, "evidence.migrationRange.to", errors, MIGRATION_VERSION);
  }

  if (!Array.isArray(source.migrationChecksums) || source.migrationChecksums.length === 0) {
    errors.push("evidence.migrationChecksums is invalid");
  } else {
    source.migrationChecksums.forEach((checksum, index) => {
      const item = asRecord(checksum);
      if (!item) {
        errors.push(`evidence.migrationChecksums[${index}] is invalid`);
        return;
      }
      exactKeys(item, ["version", "sha256"], `evidence.migrationChecksums[${index}]`, errors);
      validString(item.version, `evidence.migrationChecksums[${index}].version`, errors, MIGRATION_VERSION);
      validString(item.sha256, `evidence.migrationChecksums[${index}].sha256`, errors, SHA256);
    });
  }

  const roles = asRecord(source.roles);
  if (!roles) errors.push("evidence.roles is missing");
  else {
    exactKeys(roles, ROLE_KEYS, "evidence.roles", errors);
    ROLE_KEYS.forEach((role) => validString(roles[role], `evidence.roles.${role}`, errors));
  }

  if (!Array.isArray(source.testResults)) errors.push("evidence.testResults is invalid");
  else {
    source.testResults.forEach((result, index) => {
      const item = asRecord(result);
      if (!item) {
        errors.push(`evidence.testResults[${index}] is invalid`);
        return;
      }
      exactKeys(item, ["gate", "status", "evidenceHash"], `evidence.testResults[${index}]`, errors);
      validString(item.gate, `evidence.testResults[${index}].gate`, errors);
      if (item.status !== "passed" && item.status !== "failed" && item.status !== "skipped") {
        errors.push(`evidence.testResults[${index}].status is invalid`);
      }
      validString(item.evidenceHash, `evidence.testResults[${index}].evidenceHash`, errors, SHA256);
    });
  }
  stringArray(source.proposedProductionCommands, "evidence.proposedProductionCommands", errors);
  stringArray(source.containmentCommands, "evidence.containmentCommands", errors);
  stringArray(source.warnings, "evidence.warnings", errors);
  stringArray(source.skippedChecks, "evidence.skippedChecks", errors);
  validString(source.createdAt, "evidence.createdAt", errors, ISO_TIMESTAMP);
  validString(source.expiresAt, "evidence.expiresAt", errors, ISO_TIMESTAMP);
  if (typeof source.createdAt === "string" && !Number.isFinite(Date.parse(source.createdAt))) {
    errors.push("evidence.createdAt is invalid");
  }
  if (typeof source.expiresAt === "string" && !Number.isFinite(Date.parse(source.expiresAt))) {
    errors.push("evidence.expiresAt is invalid");
  }
  return errors;
}

export function parseEvidence(value: unknown): { evidence?: ReleaseEvidence; errors: string[] } {
  const errors = evidenceShapeErrors(value, true);
  try {
    assertSanitized(value);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "evidence contains sensitive value");
  }
  return errors.length ? { errors } : { evidence: value as ReleaseEvidence, errors: [] };
}

function parseEvidenceInput(value: unknown): { input?: EvidenceInput; errors: string[] } {
  const errors = evidenceShapeErrors(value, false);
  try {
    assertSanitized(value);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "evidence contains sensitive value");
  }
  return errors.length ? { errors } : { input: value as EvidenceInput, errors: [] };
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
  const parsed = parseEvidenceInput(input);
  if (!parsed.input) throw new Error(`invalid evidence input: ${parsed.errors.join("; ")}`);
  input = parsed.input;
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
  const parsed = parseEvidence(evidence);
  const candidate = parsed.evidence ?? (asRecord(evidence) as Partial<ReleaseEvidence> | undefined);
  if (!candidate) return parsed.errors;
  const errors = [...parsed.errors];
  if (!nonEmptyString(candidate.recoveryReference)) errors.push("recovery reference is missing");
  if (contentDigestFor(candidate as ReleaseEvidence) !== candidate.contentDigest) {
    errors.push("evidence content digest mismatch");
  }
  if (!Number.isFinite(Date.parse(candidate.expiresAt ?? "")) || new Date(candidate.expiresAt ?? "").valueOf() <= now.valueOf()) {
    errors.push("evidence has expired");
  }
  if (expected.projectRef !== undefined && candidate.targetProjectRef !== expected.projectRef) {
    errors.push("target project reference mismatch");
  }
  if (expected.schemaFingerprint !== undefined && candidate.schemaFingerprint !== expected.schemaFingerprint) {
    errors.push("schema fingerprint mismatch");
  }
  if (expected.manifestDigest !== undefined && candidate.manifestDigest !== expected.manifestDigest) {
    errors.push("manifest digest mismatch");
  }
  if (expected.applicationCommit !== undefined && candidate.applicationCommit !== expected.applicationCommit) {
    errors.push("application commit mismatch");
  }
  if (expected.migrationRange !== undefined && !sameCanonical(candidate.migrationRange, expected.migrationRange)) {
    errors.push("migration range mismatch");
  }
  if (
    expected.migrationChecksums !== undefined &&
    !sameCanonical(candidate.migrationChecksums, expected.migrationChecksums)
  ) {
    errors.push("migration checksums mismatch");
  }
  if (expected.recoveryReference !== undefined && candidate.recoveryReference !== expected.recoveryReference) {
    errors.push("recovery reference mismatch");
  }
  const roles = asRecord(candidate.roles);
  for (const [role, value] of Object.entries(expected.roles ?? {})) {
    if (roles?.[role as keyof ReleaseRoleAssignments] !== value) {
      errors.push(`role mismatch: ${role}`);
    }
  }
  if (expected.bundleDigest !== undefined) {
    try {
      if (digestEvidence(candidate as ReleaseEvidence) !== expected.bundleDigest) {
        errors.push("evidence bundle digest mismatch");
      }
    } catch {
      errors.push("evidence bundle digest mismatch");
    }
  }
  return errors;
}

export async function persistEvidence(
  evidence: ReleaseEvidence,
  directory: string,
  filesystem: EvidenceFilesystem = defaultFilesystem,
) {
  const parsed = parseEvidence(evidence);
  if (!parsed.evidence) throw new Error(`invalid release evidence: ${parsed.errors.join("; ")}`);
  evidence = parsed.evidence;
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
  const input = JSON.parse(await deps.readFile(inputPath, "utf8"));
  const parsed = parseEvidenceInput(input);
  if (!parsed.input) throw new Error(`invalid evidence input: ${parsed.errors.join("; ")}`);
  const evidence = buildEvidence(parsed.input);
  return persistEvidence(evidence, resolve(rootDir, "docs/verification/releases"), deps);
}

const defaultCliDeps: EvidenceCliDeps = { ...defaultFilesystem, readFile };

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(await runEvidenceCli(process.argv.slice(2), process.cwd(), defaultCliDeps))}\n`);
}
