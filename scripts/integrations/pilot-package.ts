import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { checkManifest } from "../release/manifest-cli.js";
import type { PilotApprovalRecord } from "../../server/lib/integrations/pilotRuntime.js";

const PDF_VERSION = "6.4.299";
const WORKER_FILES = ["server/lib/integrations/providers/pdfTextWorker.mjs", "node_modules/pdfjs-dist/legacy/build/pdf.mjs", "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"];
const INCLUDE_FILES = "{server/lib/integrations/providers/pdfTextWorker.mjs,node_modules/pdfjs-dist/legacy/build/*.mjs}";
// Pin the reviewed command graph instead of attempting to parse arbitrary shell.
const BUILD_SCRIPTS = { build: "npm run check:esm && tsr generate && tsc --noEmit && vite build", "check:esm": "node scripts/check-esm-extensions.mjs" };
const BUILD_INPUTS = ["scripts/check-esm-extensions.mjs", "package.json", "package-lock.json", "vite.config.ts", "vitest.config.ts", "tsconfig.json", "index.html"];
const ALLOWED_ENV = new Set([
  "INTEGRATIONS_PILOT_STAGE", "SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_KEY",
  "VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY", "VITE_STUDIO_SHELL", "VITE_STUDIO_THREADS", "VITE_PUBLIC_MISSION_PREVIEW",
  "STUDIO_THREADS", "INSTAGRAM_CONNECTIONS_ENABLED", "DRIVE_CONNECTIONS_ENABLED", "INTEGRATIONS_MODE",
  "INTEGRATIONS_KEYRING", "PILOT_APPROVAL_REFERENCE", "PILOT_MAINTENANCE_SECRET",
]);
type Row = Record<string, unknown>;
type FileHash = { path: string; sha256: string };
const object = (value: unknown): value is Row => Boolean(value && typeof value === "object" && !Array.isArray(value));
const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const safePath = (path: string) => !isAbsolute(path) && !path.includes("\\") && !path.includes(":") && path.split("/").every(part => part && part !== "." && part !== ".." && !part.startsWith(".env"));

/** Pure artifact inspection. Passing this is not runtime admission, authorization or deployment. */
export function inspectPilotPackage(input: unknown): { ready: boolean; reasons: string[] } {
  const reasons: string[] = [];
  try {
    if (!object(input) || !object(input.config) || !object(input.environment) || !Array.isArray(input.files)) throw new Error();
    const config = input.config;
    if (config.buildCommand !== "npm run build" || !object(input.packageScripts)
      || Object.entries(BUILD_SCRIPTS).some(([key, value]) => input.packageScripts![key] !== value)
      || ["prebuild", "postbuild", "precheck:esm", "postcheck:esm"].some(key => Object.hasOwn(input.packageScripts!, key))) reasons.push("PILOT_BUILD_COMMAND_UNREVIEWED");
    if (input.target !== "preview") reasons.push("PILOT_PREVIEW_REQUIRED");
    if (typeof input.sourceSha !== "string" || !/^[a-f0-9]{40}$/.test(input.sourceSha) || input.sourceSha !== input.expectedSourceSha) reasons.push("PILOT_SOURCE_MISMATCH");
    if (input.dirtySource !== false) reasons.push("PILOT_SOURCE_DIRTY");
    if (typeof input.schemaDigest !== "string" || !/^[a-f0-9]{64}$/.test(input.schemaDigest) || input.schemaDigest !== input.expectedSchemaDigest) reasons.push("PILOT_SCHEMA_MISMATCH");
    if (!Array.isArray(config.crons) || config.crons.length) reasons.push("PILOT_CRON_FORBIDDEN");
    if (!object(config.git) || config.git.deploymentEnabled !== false) reasons.push("PILOT_GIT_DEPLOY_FORBIDDEN");
    if (!object(config.env) || Object.keys(config.env).length !== 1 || config.env.INTEGRATIONS_PILOT_STAGE !== "D1" || config.build !== undefined) reasons.push("PILOT_CONFIG_ENV_FORBIDDEN");
    if (input.environment.INTEGRATIONS_PILOT_STAGE !== "D1") reasons.push("PILOT_STAGE_REQUIRED");
    for (const [key, value] of Object.entries(input.environment)) {
      if (value === undefined) continue;
      if (typeof value !== "string" || !ALLOWED_ENV.has(key)) reasons.push("PILOT_ENV_FORBIDDEN");
      if (["INSTAGRAM_CONNECTIONS_ENABLED", "DRIVE_CONNECTIONS_ENABLED"].includes(key) && value !== "false") reasons.push("PILOT_PROVIDER_ENABLED");
      if (key === "INTEGRATIONS_MODE" && value !== "disabled") reasons.push("PILOT_PROVIDER_ENABLED");
    }
    const projectRef = input.projectRef;
    if (typeof projectRef !== "string" || !/^[a-z0-9]{3,63}$/.test(projectRef) || projectRef === "mhkoayftiuojxlrkollf") reasons.push("PILOT_DATABASE_MISMATCH");
    for (const key of ["SUPABASE_URL", "VITE_SUPABASE_URL"]) {
      if (input.environment[key] !== `https://${projectRef}.supabase.co`) reasons.push("PILOT_DATABASE_MISMATCH");
    }
    try {
      const origin = new URL(String(input.origin));
      if (origin.protocol !== "https:" || origin.origin !== input.origin || origin.username || origin.password) reasons.push("PILOT_ORIGIN_INVALID");
    } catch { reasons.push("PILOT_ORIGIN_INVALID"); }
    const version = typeof input.nodeVersion === "string" ? /^(22|24)\.(\d+)\.(\d+)$/.exec(input.nodeVersion) : null;
    if (!version || (version[1] === "22" && Number(version[2]) < 13)) reasons.push("PILOT_NODE_UNSUPPORTED");
    if (input.pdfVersion !== PDF_VERSION || input.lockedPdfVersion !== PDF_VERSION) reasons.push("PILOT_PDF_VERSION_MISMATCH");
    const files = input.files as unknown[];
    if (files.some(file => !object(file) || typeof file.path !== "string" || !safePath(file.path) || typeof file.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(file.sha256))) throw new Error();
    const names = (files as FileHash[]).map(file => file.path);
    if (new Set(names).size !== names.length) throw new Error();
    if (WORKER_FILES.some(path => !names.includes(path))) reasons.push("PILOT_WORKER_MISSING");
    if (BUILD_INPUTS.some(path => !names.includes(path))) reasons.push("PILOT_BUILD_INPUT_MISSING");
    if (!["api/pilot.ts", "server/pilotApp.ts", "package-lock.json"].every(path => names.includes(path))) reasons.push("PILOT_ENTRY_MISSING");
    const expectedRewrites = [{ source: "/api", destination: "/api/pilot" }, { source: "/api/(.*)", destination: "/api/pilot" }, { source: "/((?!api/).*)", destination: "/index.html" }];
    if (JSON.stringify(config.rewrites) !== JSON.stringify(expectedRewrites) || config.routes !== undefined) reasons.push("PILOT_ROUTING_INVALID");
    const fn = object(config.functions) ? config.functions["api/pilot.ts"] : null;
    if (!object(fn) || fn.includeFiles !== INCLUDE_FILES || typeof fn.maxDuration !== "number" || fn.maxDuration < 5 || fn.maxDuration > 30) reasons.push("PILOT_WORKER_PACKAGING_INVALID");
  } catch { reasons.push("PILOT_PACKAGE_INVALID"); }
  return { ready: reasons.length === 0, reasons: [...new Set(reasons)] };
}

// Conservatively capture all Git-visible repository inputs, including scripts,
// imported config/helpers and future local build inputs outside today's folders.
// The example environment is documentation; real secret files remain forbidden.
const SOURCE_PATHS = [".", ":(exclude).env.example"];
const git = (root: string, args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).trim();

/** Reads local files only. Does not copy secret files, create clients, deploy or mint admission. */
export async function buildPilotArtifactManifest(root: string, approval: Pick<PilotApprovalRecord, "sourceSha" | "schemaDigest" | "projectRef" | "origin">, environment: Record<string, string | undefined>) {
  const base = await realpath(root);
  const sourceSha = git(base, ["rev-parse", "HEAD"]);
  const dirtySource = git(base, ["status", "--porcelain", "--untracked-files=all", "--", ...SOURCE_PATHS]).length > 0;
  const paths = git(base, ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...SOURCE_PATHS]).split("\0").filter(Boolean);
  const files: FileHash[] = [];
  for (const path of [...new Set([...paths, ...WORKER_FILES])].sort()) {
    if (!safePath(path)) throw new Error("PILOT_PACKAGE_PATH_INVALID");
    const target = resolve(base, path), actual = await realpath(target), within = relative(base, actual);
    if (within.startsWith("..") || isAbsolute(within) || (await lstat(target)).isSymbolicLink()) throw new Error("PILOT_PACKAGE_PATH_INVALID");
    files.push({ path, sha256: digest(await readFile(actual)) });
  }
  const config = JSON.parse(await readFile(resolve(base, "vercel.pilot.json"), "utf8"));
  const pkg = JSON.parse(await readFile(resolve(base, "package.json"), "utf8"));
  const lock = JSON.parse(await readFile(resolve(base, "package-lock.json"), "utf8"));
  const schemaDigest = await checkManifest(base);
  const inspection = inspectPilotPackage({ target: "preview", sourceSha, expectedSourceSha: approval.sourceSha, schemaDigest, expectedSchemaDigest: approval.schemaDigest,
    projectRef: approval.projectRef, origin: approval.origin, dirtySource, nodeVersion: process.versions.node,
    pdfVersion: pkg.dependencies?.["pdfjs-dist"], lockedPdfVersion: lock.packages?.["node_modules/pdfjs-dist"]?.version, packageScripts: pkg.scripts, config, environment, files });
  const manifest = { format: "kocmax-d1-artifact-v1", sourceSha, schemaDigest, configHash: digest(JSON.stringify(config)), files,
    runtime: { node: ">=22.13.0 (22.x or 24.x)", pdf: `pdfjs-dist@${PDF_VERSION}`, workerThreads: true, workerDeadlineMs: 4000, workerOldHeapMb: 64 },
    target: "preview", externalAccess: false, providerStates: { google_drive: "disabled", instagram: "disabled" }, ...inspection };
  return { ...manifest, artifactDigest: digest(JSON.stringify(manifest)) };
}
