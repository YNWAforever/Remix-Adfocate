// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { buildPilotArtifactManifest, inspectPilotPackage } from "./pilot-package.js";
import { checkManifest } from "../release/manifest-cli.js";

// An index-only local Git fixture: no commits. Compare the working files to its
// staged baseline for status; all file selection/pathspecs still run through Git.
vi.mock("node:child_process", async importOriginal => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execFileSync: vi.fn((file, args, options) => {
    const localOptions = { ...options, env: { ...process.env, GIT_DIR: join(String(options.cwd), ".index-fixture"), GIT_WORK_TREE: String(options.cwd), GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "core.autocrlf", GIT_CONFIG_VALUE_0: "false" } };
    if (file === "git" && args[0] === "rev-parse" && args[1] === "HEAD") return "a".repeat(40);
    if (file === "git" && args[0] === "status") {
      return actual.execFileSync(file, ["diff", "--name-only", "--", ...args.slice(args.indexOf("--") + 1)], localOptions);
    }
    return actual.execFileSync(file, args, localOptions);
  }) };
});

const candidate = () => ({
  target: "preview", sourceSha: "a".repeat(40), expectedSourceSha: "a".repeat(40),
  schemaDigest: "b".repeat(64), expectedSchemaDigest: "b".repeat(64), dirtySource: false,
  nodeVersion: "24.18.0", pdfVersion: "6.4.299", lockedPdfVersion: "6.4.299",
  projectRef: "isolatedpilotproject", origin: "https://pilot.invalid",
  packageScripts: { build: "npm run check:esm && tsr generate && tsc --noEmit && vite build", "check:esm": "node scripts/check-esm-extensions.mjs" },
  config: { buildCommand: "npm run build", crons: [], git: { deploymentEnabled: false }, env: { INTEGRATIONS_PILOT_STAGE: "D1" },
    functions: { "api/pilot.ts": { includeFiles: "{server/lib/integrations/providers/pdfTextWorker.mjs,node_modules/pdfjs-dist/legacy/build/*.mjs}", maxDuration: 30 } },
    rewrites: [{ source: "/api", destination: "/api/pilot" }, { source: "/api/(.*)", destination: "/api/pilot" }, { source: "/((?!api/).*)", destination: "/index.html" }] },
  environment: { INTEGRATIONS_PILOT_STAGE: "D1", SUPABASE_URL: "https://isolatedpilotproject.supabase.co", VITE_SUPABASE_URL: "https://isolatedpilotproject.supabase.co" },
  files: ["api/pilot.ts", "server/pilotApp.ts", "scripts/check-esm-extensions.mjs", "package.json", "vite.config.ts", "vitest.config.ts", "tsconfig.json", "index.html", "server/lib/integrations/providers/pdfTextWorker.mjs", "node_modules/pdfjs-dist/legacy/build/pdf.mjs", "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs", "package-lock.json"].map(path => ({ path, sha256: "d".repeat(64) })),
});

describe("D1 artifact package boundaries", () => {
  it("requires the executed build script and compiler configuration in the captured files", () => {
    for (const path of ["scripts/check-esm-extensions.mjs", "vitest.config.ts", "package.json"]) {
      const input = candidate(); input.files = input.files.filter(file => file.path !== path);
      expect(inspectPilotPackage(input).reasons).toContain("PILOT_BUILD_INPUT_MISSING");
    }
  });
  it("rejects arbitrary build commands and npm lifecycle hooks without executing them", () => {
    const config = candidate(); config.config.buildCommand = "node unreviewed.mjs";
    expect(inspectPilotPackage(config).reasons).toContain("PILOT_BUILD_COMMAND_UNREVIEWED");
    for (const [key, value] of [
      ["build", "npm run check:esm && node unreviewed.mjs"], ["check:esm", "node other.mjs"],
      ["prebuild", "node before.mjs"], ["postbuild", "node after.mjs"],
      ["precheck:esm", "node before.mjs"], ["postcheck:esm", "node after.mjs"],
    ]) {
      const input = candidate(); Object.assign(input.packageScripts, { [key]: value });
      expect(inspectPilotPackage(input).reasons).toContain("PILOT_BUILD_COMMAND_UNREVIEWED");
    }
  });
  it("accepts a source-bound preview package with no provider activation or inherited cron", () => {
    expect(inspectPilotPackage(candidate())).toEqual({ ready: true, reasons: [] });
  });
  it.each(["production", "staging", null])("denies non-preview target %s", target => {
    expect(inspectPilotPackage({ ...candidate(), target }).reasons).toContain("PILOT_PREVIEW_REQUIRED");
  });
  it("rejects unreviewed source or schema without treating a base SHA as the current artifact", () => {
    expect(inspectPilotPackage({ ...candidate(), sourceSha: "c".repeat(40) }).reasons).toContain("PILOT_SOURCE_MISMATCH");
    expect(inspectPilotPackage({ ...candidate(), dirtySource: true }).reasons).toContain("PILOT_SOURCE_DIRTY");
    expect(inspectPilotPackage({ ...candidate(), schemaDigest: "c".repeat(64) }).reasons).toContain("PILOT_SCHEMA_MISMATCH");
  });
  it("rejects cron, git auto deployment, inline foreign environment and provider activation", () => {
    const cron = candidate(); cron.config.crons = [{ path: "/api/cron/daily", schedule: "0 0 * * *" }] as never[];
    expect(inspectPilotPackage(cron).reasons).toContain("PILOT_CRON_FORBIDDEN");
    const git = candidate(); git.config.git.deploymentEnabled = true;
    expect(inspectPilotPackage(git).reasons).toContain("PILOT_GIT_DEPLOY_FORBIDDEN");
    const config = candidate(); Object.assign(config.config.env, { OPENAI_API_KEY: "never-print-this" });
    expect(inspectPilotPackage(config).reasons).toContain("PILOT_CONFIG_ENV_FORBIDDEN");
    const env = candidate(); Object.assign(env.environment, { INSTAGRAM_CONNECTIONS_ENABLED: "true" });
    expect(inspectPilotPackage(env).reasons).toContain("PILOT_PROVIDER_ENABLED");
  });
  it.each(["OPENAI_API_KEY", "RAPIDAPI_KEY", "CRON_SECRET", "RESEND_API_KEY", "VITE_SUPABASE_SERVICE_KEY", "GOOGLE_APPLICATION_CREDENTIALS", "UNKNOWN_PROVIDER_KEY"])("rejects inherited %s without reporting its value", key => {
    const input = candidate(); Object.assign(input.environment, { [key]: "private-marker-value" });
    const result = inspectPilotPackage(input);
    expect(result.ready).toBe(false); expect(JSON.stringify(result)).not.toContain("private-marker-value");
  });
  it("rejects production or different DBs and unsafe origins", () => {
    for (const url of ["https://mhkoayftiuojxlrkollf.supabase.co", "https://other.supabase.co", "https://isolatedpilotproject.supabase.co.evil.invalid"]) {
      const input = candidate(); input.environment.SUPABASE_URL = url;
      expect(inspectPilotPackage(input).reasons).toContain("PILOT_DATABASE_MISMATCH");
    }
    expect(inspectPilotPackage({ ...candidate(), projectRef: "mhkoayftiuojxlrkollf" }).ready).toBe(false);
    expect(inspectPilotPackage({ ...candidate(), origin: "http://pilot.invalid" }).ready).toBe(false);
  });
  it("rejects absent or substituted worker/parser files and insufficient runtime", () => {
    const input = candidate(); input.files = input.files.filter(file => !file.path.endsWith("pdfTextWorker.mjs"));
    expect(inspectPilotPackage(input).reasons).toContain("PILOT_WORKER_MISSING");
    expect(inspectPilotPackage({ ...candidate(), pdfVersion: "6.5.0" }).reasons).toContain("PILOT_PDF_VERSION_MISMATCH");
    expect(inspectPilotPackage({ ...candidate(), nodeVersion: "22.12.0" }).reasons).toContain("PILOT_NODE_UNSUPPORTED");
    expect(inspectPilotPackage({ ...candidate(), nodeVersion: "23.0.0" }).reasons).toContain("PILOT_NODE_UNSUPPORTED");
    expect(inspectPilotPackage({ ...candidate(), nodeVersion: "26.13.0" }).reasons).toContain("PILOT_NODE_UNSUPPORTED");
    const config = candidate(); config.config.functions["api/pilot.ts"].includeFiles = "server/**";
    expect(inspectPilotPackage(config).reasons).toContain("PILOT_WORKER_PACKAGING_INVALID");
  });
  it("cannot route the pilot back to an ordinary application entry", () => {
    const input = candidate(); input.config.rewrites[1].destination = "/api";
    expect(inspectPilotPackage(input).reasons).toContain("PILOT_ROUTING_INVALID");
  });
  it("rejects traversal, duplicate paths, secret files and malformed input", () => {
    for (const path of ["../outside", "/absolute", ".env", "server/.env.local", "server\\secret.ts"]) {
      const input = candidate(); input.files.push({ path, sha256: "d".repeat(64) });
      expect(inspectPilotPackage(input).ready).toBe(false);
    }
    const duplicate = candidate(); duplicate.files.push(duplicate.files[0]);
    expect(inspectPilotPackage(duplicate).ready).toBe(false);
    for (const bad of [null, [], {}, { ...candidate(), files: [null] }, { ...candidate(), environment: null }]) {
      expect(() => inspectPilotPackage(bad)).not.toThrow(); expect(inspectPilotPackage(bad).ready).toBe(false);
    }
  });
});

it("captures edited build scripts and all repository-local inputs in hashes and dirty-source rejection", async () => {
  await mkdir(resolve(".codex-tmp"), { recursive: true });
  const root = await mkdtemp(join(resolve(".codex-tmp"), "pilot-package-review-"));
  const nodeVersionDescriptor = Object.getOwnPropertyDescriptor(process.versions, "node")!;
  try {
    const input = candidate();
    // Exercise a reviewed runtime deterministically without widening the real policy
    // to match whichever Node happens to run this local fixture.
    Object.defineProperty(process.versions, "node", { ...nodeVersionDescriptor, value: input.nodeVersion });
    const put = async (path: string, content: string) => {
      await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), content);
    };
    for (const file of input.files) await put(file.path, "// local fixture\n");
    await put("package.json", JSON.stringify({ scripts: input.packageScripts, dependencies: { "pdfjs-dist": "6.4.299" } }));
    await put("package-lock.json", JSON.stringify({ packages: { "node_modules/pdfjs-dist": { version: "6.4.299" } } }));
    await put("vercel.pilot.json", JSON.stringify(input.config));
    await put("build-support/local-input.txt", "reviewed\n");
    await put(".gitignore", ".index-fixture/\n");
    await cp(resolve("supabase/migrations"), join(root, "supabase/migrations"), { recursive: true });
    await cp(resolve("supabase/release-manifest.json"), join(root, "supabase/release-manifest.json"));
    execFileSync("git", ["init", "--quiet"], { cwd: root });
    execFileSync("git", ["add", "."], { cwd: root });
    const approval = { sourceSha: input.sourceSha, schemaDigest: await checkManifest(root), projectRef: input.projectRef, origin: input.origin };
    const before = await buildPilotArtifactManifest(root, approval, input.environment);
    expect(before.ready).toBe(true);
    expect(before.reasons).not.toContain("PILOT_SOURCE_DIRTY");
    Object.defineProperty(process.versions, "node", { ...nodeVersionDescriptor, value: "26.13.0" });
    const unsupported = await buildPilotArtifactManifest(root, approval, input.environment);
    expect(unsupported.ready).toBe(false);
    expect(unsupported.reasons).toEqual(["PILOT_NODE_UNSUPPORTED"]);
    Object.defineProperty(process.versions, "node", { ...nodeVersionDescriptor, value: input.nodeVersion });
    for (const path of ["scripts/check-esm-extensions.mjs", "vitest.config.ts", "build-support/local-input.txt"]) {
      const previous = before.files.find(file => file.path === path);
      expect(previous, path).toBeDefined();
      const original = await readFile(join(root, path), "utf8");
      await put(path, `${original}// edited after review\n`);
      const after = await buildPilotArtifactManifest(root, approval, input.environment);
      expect(after.sourceSha).toBe(before.sourceSha);
      expect(after.reasons).toContain("PILOT_SOURCE_DIRTY");
      expect(after.files.find(file => file.path === path)?.sha256).not.toBe(previous?.sha256);
      expect(after.artifactDigest).not.toBe(before.artifactDigest);
      await put(path, original);
    }
  } finally {
    Object.defineProperty(process.versions, "node", nodeVersionDescriptor);
    await rm(root, { recursive: true, force: true });
  }
}, 15000);
