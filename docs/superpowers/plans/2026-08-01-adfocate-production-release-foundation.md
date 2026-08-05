# Adfocate Production Release Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fail-closed, repository-controlled release train that proves Adfocate Phase 2-4 migrations in disposable environments and produces an approval-ready production go-live bundle without modifying production.

**Architecture:** Integrate the completed reward-handoff stack, then place all release behavior behind small TypeScript command modules with injected process, clock, filesystem, fetch, and Supabase dependencies. A pinned Supabase CLI performs migration list, schema dump, reset, dry-run, and push operations; pure modules validate manifests, targets, evidence, pilot scope, and exit gates. GitHub Actions may validate artifacts but cannot write production except through the separately approved executor and protected production environment.

**Tech Stack:** TypeScript 5.8, Node.js 22, Vitest 2, Supabase CLI 2.110.0, Supabase JS 2.x, GitHub Actions, Vercel REST API, PostgreSQL/Supabase migrations.

## Global Constraints

- No production schema mutation or real pilot enablement is authorized by this plan.
- The intended future pilot is exactly one allow-listed workspace and one new mission.
- The rollout is expand-contract: additive schema, compatible application, then pilot.
- The workflow stops at `reward_pending`; no ledger, budget deduction, issuance, payout, withdrawal, or mark-paid action is allowed.
- No destructive down migration, remote reset, historical state rewrite, or active-workspace-to-legacy downgrade is allowed.
- Rehearsal must reject the production project reference and production database URL.
- Production execution must reject a wrong target, stale evidence, schema drift, manifest drift, missing recovery reference, or missing exact approval phrase.
- Evidence must not contain secrets, connection strings, JWTs, emails, proof URLs, signed URLs, content assets, creator PII, or operator notes.
- Existing legacy mission listing, detail, join, submit, and my-missions behavior must remain compatible before and after schema expansion.
- Every task uses TDD where code changes are introduced and ends with a focused verification plus commit.

---

## File Structure

### Existing files to integrate or modify

- `.github/workflows/ci.yml` — add non-mutating release-foundation checks.
- `.github/workflows/supabase.yml` — replace push-triggered production mutation with protected manual dispatch.
- `package.json` and `package-lock.json` — pin Supabase CLI and expose release commands.
- `scripts/run-integration-tests.mjs` — retain the reward-handoff integration list from the completed stack.
- `vitest.config.ts` — include `scripts/**/*.test.ts` from the reward-handoff stack.
- `docs/operations/active-mission-workspace.md` — link the new release runbook.
- `docs/operations/publication-proof-release-runbook.md` — link the new release runbook.
- `docs/operations/reward-handoff.md` — retain financial-neutrality and ordered local gates.
- `supabase/migrations/*.sql` — inputs only; no existing migration is edited.

### New release modules

- `scripts/release/contracts.ts` — shared manifest, preflight, rehearsal, evidence, deployment, pilot, and observation types.
- `scripts/release/process.ts` — injected child-process runner with redacted command reporting.
- `scripts/release/manifest.ts` — manifest construction, validation, and digest.
- `scripts/release/manifest-cli.ts` — `write` and `check` commands.
- `scripts/release/preflight.ts` — read-only migration list, dry-run, schema dump, capability report, and fingerprint.
- `scripts/release/target-guard.ts` — production/disposable target comparison.
- `scripts/release/rehearsal.ts` — empty and production-shaped disposable database gates.
- `scripts/release/evidence.ts` — redaction, bundle generation, digest, persistence, and verification.
- `scripts/release/executor.ts` — guarded dry-run and production migration execution.
- `scripts/release/deployment.ts` — Vercel deployment identity/readiness and HTTP health verification.
- `scripts/release/pilot.ts` — candidate validation and separately guarded pilot enablement.
- `scripts/release/observer.ts` — pilot invariants, financial neutrality, and exit decision.
- `supabase/release-manifest.json` — generated ordered Phase 2-4 migration inventory with SHA-256 checksums.
- `docs/operations/production-release-foundation.md` — exact preparation, containment, approval, and later go-live procedure.
- `docs/verification/releases/.gitkeep` — location for sanitized generated evidence.

### New tests

- `scripts/release/supabase-workflow-contract.test.ts`
- `scripts/release/manifest.test.ts`
- `scripts/release/preflight.test.ts`
- `scripts/release/target-guard.test.ts`
- `scripts/release/rehearsal.test.ts`
- `scripts/release/evidence.test.ts`
- `scripts/release/executor.test.ts`
- `scripts/release/deployment.test.ts`
- `scripts/release/pilot.test.ts`
- `scripts/release/observer.test.ts`
- `scripts/release/release-acceptance.test.ts`

---

### Task 1: Integrate the completed reward-handoff stack

**Files:**
- Merge from: `origin/codex/publication-proof-validation-design`
- Verify: `supabase/migrations/20260731100000_reward_handoff_schema.sql`
- Verify: `supabase/migrations/20260731110000_reward_contract_capture.sql`
- Verify: `supabase/migrations/20260731120000_reward_handoff_transitions.sql`
- Verify: `supabase/migrations/20260731130000_reward_handoff_notifications.sql`
- Verify: `supabase/migrations/20260731140000_reward_handoff_release_hardening.sql`
- Verify: `server/test/reward-contracts.test.ts`
- Verify: `server/test/reward-handoffs.test.ts`
- Verify: `server/test/admin-reward-handoffs.test.ts`

**Interfaces:**
- Consumes: the reviewed reward-handoff commit series ending at `3166417`.
- Produces: Phase 4 schema, server, client, operations, acceptance seed, and focused test scripts on the main-based release-foundation branch.

- [ ] **Step 1: Prove the source branch contains the reviewed reward stack**

Run:

```powershell
git fetch origin main codex/publication-proof-validation-design
git log --oneline --reverse origin/main..origin/codex/publication-proof-validation-design
git diff --name-status origin/main...origin/codex/publication-proof-validation-design
```

Expected: the log ends with `3166417 test: make powershell payload check portable`; the diff includes exactly five `202607311*.sql` reward migrations and the reward contract/handoff tests.

- [ ] **Step 2: Merge the reviewed stack without rewriting it**

Run:

```powershell
git merge --no-ff origin/codex/publication-proof-validation-design -m "feat: integrate reward handoff release train"
```

Expected: merge succeeds; the production join-schema hotfix already present on `main` remains in `server/routes/missions.ts`.

- [ ] **Step 3: Run focused reward and compatibility verification**

Run:

```powershell
npm.cmd run test:active-missions
npx.cmd vitest run server/test/missions.test.ts server/test/reward-contracts.test.ts server/test/reward-handoffs.test.ts server/test/admin-reward-handoffs.test.ts --reporter=dot
```

Expected: PASS; legacy mission compatibility tests and all reward-handoff static/unit tests pass. Live database tests may skip only when `RUN_INTEGRATION` is absent.

- [ ] **Step 4: Run repository gates**

Run:

```powershell
npm.cmd test -- --reporter=dot
npm.cmd run lint
npm.cmd run type-check
npm.cmd run build
git diff --check
```

Expected: every command exits 0. Record unrelated lint warnings separately; do not change unrelated files in this task.

- [ ] **Step 5: Record the merge boundary**

Run:

```powershell
git status --short
git log -1 --oneline
```

Expected: clean worktree; HEAD is the explicit integration merge commit.

---

### Task 2: Remove automatic production writes and pin the migration toolchain

**Files:**
- Create: `scripts/release/supabase-workflow-contract.test.ts`
- Modify: `.github/workflows/supabase.yml`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: GitHub protected environment named `production`, repository secret `SUPABASE_DB_URL`, and the later `release:execute` command.
- Produces: a manual-only workflow contract and project-local `supabase@2.110.0`.

- [ ] **Step 1: Write the failing workflow contract test**

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(".github/workflows/supabase.yml", "utf8");

describe("Supabase production workflow", () => {
  it("cannot run from push and delegates the only write to the guarded executor", () => {
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toMatch(/\n\s*push:/);
    expect(workflow).toContain("environment: production");
    expect(workflow).toContain("bundle_path:");
    expect(workflow).toContain("bundle_digest:");
    expect(workflow).toContain("project_ref:");
    expect(workflow).toContain("approval:");
    expect(workflow).toContain("npm run release:execute --");
    expect(workflow).not.toContain("supabase db push");
    expect(workflow).not.toMatch(/supabase db (reset|down)/);
    expect(workflow).not.toContain("--include-seed");
  });
});
```

- [ ] **Step 2: Run the test to verify the current workflow is unsafe**

Run:

```powershell
npx.cmd vitest run scripts/release/supabase-workflow-contract.test.ts --reporter=verbose
```

Expected: FAIL because the current workflow contains `push:` and a direct `supabase db push`.

- [ ] **Step 3: Replace the workflow with a protected manual dispatch**

```yaml
name: Supabase Production Release
on:
  workflow_dispatch:
    inputs:
      bundle_path:
        description: Committed sanitized evidence bundle path
        required: true
        type: string
      bundle_digest:
        description: Approved SHA-256 bundle digest
        required: true
        type: string
      project_ref:
        description: Exact approved Supabase project reference
        required: true
        type: string
      approval:
        description: Exact APPROVE phrase from the runbook
        required: true
        type: string

jobs:
  migrate:
    environment: production
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: npm
      - run: npm ci
      - name: Verify evidence and execute approved migration range
        run: >-
          npm run release:execute --
          --bundle "${{ inputs.bundle_path }}"
          --bundle-digest "${{ inputs.bundle_digest }}"
          --project-ref "${{ inputs.project_ref }}"
          --approval "${{ inputs.approval }}"
          --apply
        env:
          RELEASE_DATABASE_URL: "${{ secrets.SUPABASE_DB_URL }}"
```

Update `package.json`:

```json
{
  "scripts": {
    "test:release-workflow": "vitest run scripts/release/supabase-workflow-contract.test.ts"
  },
  "devDependencies": {
    "supabase": "2.110.0"
  }
}
```

Merge these keys into the existing objects; do not replace unrelated scripts or dependencies. Run `npm.cmd install --package-lock-only` to update the lockfile.

- [ ] **Step 4: Verify the safety contract**

Run:

```powershell
npm.cmd install
npm.cmd run test:release-workflow
npx.cmd supabase --version
```

Expected: test passes and CLI prints `2.110.0`.

- [ ] **Step 5: Commit**

```powershell
git add .github/workflows/supabase.yml package.json package-lock.json scripts/release/supabase-workflow-contract.test.ts
git commit -m "ci: require approved Supabase production release"
```

---

### Task 3: Build the deterministic Phase 2-4 migration manifest

**Files:**
- Create: `scripts/release/contracts.ts`
- Create: `scripts/release/manifest.ts`
- Create: `scripts/release/manifest-cli.ts`
- Create: `scripts/release/manifest.test.ts`
- Create: `supabase/release-manifest.json`
- Modify: `package.json`

**Interfaces:**
- Produces:
  - `buildManifest(rootDir: string): Promise<ReleaseManifest>`
  - `validateManifest(manifest: ReleaseManifest, rootDir: string): Promise<string[]>`
  - `digestManifest(manifest: ReleaseManifest): string`
  - `ReleaseManifest`, `ReleaseMigration`, and `ReleasePhase`.
- Consumed by: preflight, rehearsal, evidence, executor, and release acceptance.

- [ ] **Step 1: Define shared contracts and write failing manifest tests**

```ts
// scripts/release/contracts.ts
export type ReleasePhase =
  | "active_mission"
  | "publication_proof"
  | "reward_handoff";

export interface ReleaseMigration {
  version: string;
  name: string;
  path: string;
  sha256: string;
  phase: ReleasePhase;
  dependsOn: string[];
  capabilities: string[];
  transactionExpectation: "transactional";
  replayExpectation: "migration_history_noop";
}

export interface ReleaseManifest {
  schemaVersion: 1;
  cliVersion: "2.110.0";
  generatedFrom: "supabase/migrations";
  migrations: ReleaseMigration[];
}
```

```ts
// scripts/release/manifest.test.ts
import { mkdtemp, mkdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildManifest, digestManifest, validateManifest } from "./manifest";

async function fixture(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), "adfocate-manifest-"));
  const dir = join(root, "supabase", "migrations");
  await mkdir(dir, { recursive: true });
  await Promise.all(Object.entries(files).map(([name, sql]) =>
    writeFile(join(dir, name), sql, "utf8"),
  ));
  return root;
}

describe("release migration manifest", () => {
  it("orders, classifies, hashes, and digests known phase files", async () => {
    const root = await fixture({
      "20260715163350_active_mission_workspace.sql": "select 1;\n",
      "20260723090000_publication_proof_validation.sql": "select 2;\n",
      "20260731100000_reward_handoff_schema.sql": "select 3;\n",
    });
    const manifest = await buildManifest(root);
    expect(manifest.migrations.map((m) => m.phase)).toEqual([
      "active_mission", "publication_proof", "reward_handoff",
    ]);
    expect(manifest.migrations.map((m) => m.dependsOn)).toEqual([
      [], ["20260715163350"], ["20260723090000"],
    ]);
    expect(manifest.migrations[0].capabilities).toContain(
      "table:public.mission_workflows",
    );
    expect(manifest.migrations[1].capabilities).toContain(
      "table:public.mission_publication_proof_attempts",
    );
    expect(manifest.migrations[2].capabilities).toContain(
      "table:public.mission_reward_contracts",
    );
    expect(manifest.migrations.every((m) =>
      m.transactionExpectation === "transactional"
      && m.replayExpectation === "migration_history_noop"
    )).toBe(true);
    expect(manifest.migrations.every((m) => /^[a-f0-9]{64}$/.test(m.sha256))).toBe(true);
    expect(digestManifest(manifest)).toMatch(/^[a-f0-9]{64}$/);
    expect(await validateManifest(manifest, root)).toEqual([]);
  });

  it("rejects an unclassified migration", async () => {
    const root = await fixture({
      "20260715163350_active_mission_workspace.sql": "select 1;\n",
      "20260801000000_unknown.sql": "select 2;\n",
    });
    await expect(buildManifest(root)).rejects.toThrow("unclassified migration");
  });

  it("detects checksum drift, missing files, duplicates, and bad dependencies", async () => {
    const root = await fixture({
      "20260715163350_active_mission_workspace.sql": "select 1;\n",
      "20260723090000_publication_proof_validation.sql": "select 2;\n",
      "20260731100000_reward_handoff_schema.sql": "select 3;\n",
    });
    const manifest = await buildManifest(root);
    await writeFile(join(root, manifest.migrations[0].path), "select 99;\n", "utf8");
    await unlink(join(root, manifest.migrations[2].path));
    manifest.migrations[1].dependsOn = ["19990101000000"];
    manifest.migrations.push(structuredClone(manifest.migrations[1]));
    expect(await validateManifest(manifest, root)).toEqual(expect.arrayContaining([
      "checksum drift: 20260715163350",
      "missing migration file: 20260731100000",
      "duplicate migration version",
      "unknown dependency: 19990101000000",
    ]));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```powershell
npx.cmd vitest run scripts/release/manifest.test.ts --reporter=verbose
```

Expected: FAIL because `./manifest` does not exist.

- [ ] **Step 3: Implement classification, hashing, validation, and stable digest**

```ts
// scripts/release/manifest.ts
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ReleaseManifest, ReleaseMigration, ReleasePhase } from "./contracts";

const PHASE_START: Array<[string, ReleasePhase]> = [
  ["20260715163350", "active_mission"],
  ["20260723090000", "publication_proof"],
  ["20260731100000", "reward_handoff"],
];

const CAPABILITIES_BY_VERSION: Record<string, string[]> = {
  "20260715163350": [
    "table:public.mission_workflows",
    "column:public.missions.creator_workflow_mode",
    "function:public.create_mission_workflow",
    "policy:public.mission_workflows.mission_workflows_creator_read",
    "trigger:public.mission_draft_versions_immutable",
    "grant:authenticated.public.create_mission_workflow(uuid)",
    "storage-policy:storage.objects.mission_draft_assets_storage_read",
  ],
  "20260723090000": [
    "table:public.mission_publication_proof_attempts",
    "policy:public.mission_publication_proof_attempts.mission_publication_proof_attempts_creator_read",
    "trigger:public.mission_publication_proof_attempts_immutable",
  ],
  "20260731100000": [
    "table:public.mission_reward_contracts",
    "table:public.mission_completion_decisions",
    "table:public.mission_pending_rewards",
    "rls:public.mission_reward_contracts",
    "trigger:public.mission_reward_contracts_immutable",
    "trigger:public.mission_completion_decisions_immutable",
    "trigger:public.mission_pending_rewards_guarded_update",
  ],
  "20260731110000": [
    "function:public.join_active_mission",
    "grant:authenticated.public.join_active_mission(uuid)",
  ],
  "20260731120000": [
    "function:public.approve_mission_completion",
    "function:public.cancel_mission_reward_handoff",
  ],
  "20260731130000": [
    "trigger:public.reward_handoff_workflow_event_notifications",
  ],
  "20260731140000": [
    "function:public.retry_reward_handoff_notification",
    "grant:service_role.public.retry_reward_handoff_notification(uuid,uuid,uuid,text)",
  ],
};

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function phaseFor(version: string): ReleasePhase | null {
  let phase: ReleasePhase | null = null;
  for (const [start, candidate] of PHASE_START) {
    if (version >= start) phase = candidate;
  }
  return phase;
}

function stableManifest(manifest: ReleaseManifest) {
  return JSON.stringify({
    schemaVersion: manifest.schemaVersion,
    cliVersion: manifest.cliVersion,
    generatedFrom: manifest.generatedFrom,
    migrations: manifest.migrations.map((m) => ({
      version: m.version,
      name: m.name,
      path: m.path.replaceAll("\\", "/"),
      sha256: m.sha256,
      phase: m.phase,
      dependsOn: m.dependsOn,
      capabilities: m.capabilities,
      transactionExpectation: m.transactionExpectation,
      replayExpectation: m.replayExpectation,
    })),
  });
}

export async function buildManifest(rootDir: string): Promise<ReleaseManifest> {
  const migrationDir = join(rootDir, "supabase", "migrations");
  const names = (await readdir(migrationDir))
    .filter((name) => /^\d{14}_.+\.sql$/.test(name))
    .sort();
  const migrations: ReleaseMigration[] = [];
  for (const name of names) {
    const version = name.slice(0, 14);
    const phase = phaseFor(version);
    if (!phase) continue;
    if (version > "20260731140000") {
      throw new Error(`unclassified migration: ${name}`);
    }
    migrations.push({
      version,
      name: name.slice(15, -4),
      path: `supabase/migrations/${name}`,
      sha256: sha256(await readFile(join(migrationDir, name))),
      phase,
      dependsOn: migrations.length ? [migrations.at(-1)!.version] : [],
      capabilities: CAPABILITIES_BY_VERSION[version] ?? [],
      transactionExpectation: "transactional",
      replayExpectation: "migration_history_noop",
    });
  }
  return {
    schemaVersion: 1,
    cliVersion: "2.110.0",
    generatedFrom: "supabase/migrations",
    migrations,
  };
}

export async function validateManifest(
  manifest: ReleaseManifest,
  rootDir: string,
): Promise<string[]> {
  const current = await buildManifest(rootDir);
  const errors: string[] = [];
  const versions = manifest.migrations.map((m) => m.version);
  const currentByVersion = new Map(current.migrations.map((m) => [m.version, m]));
  if (new Set(versions).size !== versions.length) errors.push("duplicate migration version");
  if (versions.join() !== [...versions].sort().join()) errors.push("migration order mismatch");
  manifest.migrations.forEach((migration, index) => {
    const actual = currentByVersion.get(migration.version);
    if (!actual) errors.push(`missing migration file: ${migration.version}`);
    else if (actual.sha256 !== migration.sha256) {
      errors.push(`checksum drift: ${migration.version}`);
    }
    for (const dependency of migration.dependsOn) {
      const dependencyIndex = versions.indexOf(dependency);
      if (dependencyIndex === -1) errors.push(`unknown dependency: ${dependency}`);
      else if (dependencyIndex >= index) errors.push(`dependency order mismatch: ${dependency}`);
    }
  });
  if (stableManifest(manifest) !== stableManifest(current)) errors.push("manifest content drift");
  return errors;
}

export function digestManifest(manifest: ReleaseManifest) {
  return sha256(stableManifest(manifest));
}
```

Implement `manifest-cli.ts` with exact commands:

```ts
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildManifest, digestManifest, validateManifest } from "./manifest";
import type { ReleaseManifest } from "./contracts";

const root = process.cwd();
const path = resolve(root, "supabase/release-manifest.json");
const command = process.argv[2];

if (command === "write") {
  const manifest = await buildManifest(root);
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  process.stdout.write(`${digestManifest(manifest)}\n`);
} else if (command === "check") {
  const manifest = JSON.parse(await readFile(path, "utf8")) as ReleaseManifest;
  const errors = await validateManifest(manifest, root);
  if (errors.length) throw new Error(errors.join("\n"));
  process.stdout.write(`${digestManifest(manifest)}\n`);
} else {
  throw new Error("usage: manifest-cli.ts <write|check>");
}
```

Add scripts:

```json
"release:manifest:write": "vite-node scripts/release/manifest-cli.ts write",
"release:manifest:check": "vite-node scripts/release/manifest-cli.ts check"
```

- [ ] **Step 4: Generate the committed manifest and verify determinism**

Run:

```powershell
npm.cmd run release:manifest:write
npm.cmd run release:manifest:check
npx.cmd vitest run scripts/release/manifest.test.ts --reporter=verbose
git diff --check
```

Expected: both manifest commands print the same 64-character digest; tests pass; the manifest includes the Phase 2-4 range and ends at `20260731140000`.

The upper-bound rejection is intentionally fail-closed: every later migration
must first receive an explicit phase classification, dependency edge,
capability declaration (an explicitly reviewed empty array is allowed), and
reviewed transaction/replay expectation before the committed manifest can be
regenerated. `migration_history_noop` means a second `db push --dry-run` must
report no pending migrations; it does not claim the SQL body is safe to execute
twice outside Supabase migration history.

- [ ] **Step 5: Commit**

```powershell
git add package.json scripts/release/contracts.ts scripts/release/manifest.ts scripts/release/manifest-cli.ts scripts/release/manifest.test.ts supabase/release-manifest.json
git commit -m "feat: add deterministic release migration manifest"
```

---

### Task 4: Add read-only production preflight and schema fingerprinting

**Files:**
- Create: `scripts/release/process.ts`
- Create: `scripts/release/preflight.ts`
- Create: `scripts/release/preflight.test.ts`
- Modify: `scripts/release/contracts.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `ReleaseManifest`, `digestManifest`, `RELEASE_DATABASE_URL`, `RELEASE_PROJECT_REF`.
- Produces:
  - `runPreflight(input: PreflightInput, deps: PreflightDeps): Promise<PreflightReport>`
  - `PreflightReport` with target ref, manifest digest, normalized schema fingerprint, migration-list output hash, dry-run output hash, capability results, warnings, and timestamp.

- [ ] **Step 1: Write failing tests for read-only commands, redaction, and capabilities**

```ts
import { describe, expect, it, vi } from "vitest";
import { runPreflight } from "./preflight";

describe("release preflight", () => {
  it("uses only migration list, dry-run, and schema dump and never returns the URL", async () => {
    const run = vi.fn()
      .mockResolvedValueOnce({ code: 0, stdout: "Local | Remote\n1 | 1", stderr: "" })
      .mockResolvedValueOnce({ code: 0, stdout: "Would push 20260715163350", stderr: "" })
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });
    const schema = [
      "CREATE TABLE public.mission_workflows ();",
      "ALTER TABLE public.missions ADD COLUMN creator_workflow_mode text;",
      "CREATE FUNCTION public.create_mission_workflow(p_submission uuid) RETURNS void;",
      "CREATE TABLE public.mission_publication_proof_attempts ();",
      "CREATE TABLE public.mission_reward_contracts ();",
      "CREATE TABLE public.mission_completion_decisions ();",
      "CREATE TABLE public.mission_pending_rewards ();",
    ].join("\n");
    const readFile = vi.fn().mockResolvedValue(schema);
    const rm = vi.fn().mockResolvedValue(undefined);
    const report = await runPreflight({
      databaseUrl: "postgresql://secret",
      projectRef: "project-ref",
      manifestDigest: "a".repeat(64),
      expectedCapabilities: [
        "table:public.mission_workflows",
        "column:public.missions.creator_workflow_mode",
        "function:public.create_mission_workflow",
        "table:public.mission_publication_proof_attempts",
        "table:public.mission_reward_contracts",
        "table:public.mission_completion_decisions",
        "table:public.mission_pending_rewards",
      ],
      now: new Date("2026-08-01T00:00:00Z"),
    }, { run, readFile, rm, tempFile: () => "C:/temp/schema.sql" });
    expect(run.mock.calls.map((call) => call[1])).toEqual([
      ["supabase", "migration", "list", "--db-url", "postgresql://secret"],
      ["supabase", "db", "push", "--dry-run", "--db-url", "postgresql://secret"],
      ["supabase", "db", "dump", "--db-url", "postgresql://secret", "--file", "C:/temp/schema.sql", "--keep-comments"],
    ]);
    expect(readFile).toHaveBeenCalledWith("C:/temp/schema.sql", "utf8");
    expect(rm).toHaveBeenCalledWith("C:/temp/schema.sql", { force: true });
    expect(JSON.stringify(report)).not.toContain("postgresql://secret");
    expect(report.capabilities.every((item) => item.status === "present")).toBe(true);
  });

  it("fails before reporting success when any read-only command fails", async () => {
    const run = vi.fn().mockResolvedValue({ code: 1, stdout: "", stderr: "denied" });
    await expect(runPreflight({
      databaseUrl: "postgresql://secret",
      projectRef: "project-ref",
      manifestDigest: "a".repeat(64),
      expectedCapabilities: [],
      now: new Date(),
    }, {
      run,
      readFile: vi.fn(),
      rm: vi.fn(),
      tempFile: () => "C:/temp/schema.sql",
    })).rejects.toThrow("migration list failed");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
npx.cmd vitest run scripts/release/preflight.test.ts --reporter=verbose
```

Expected: FAIL because `runPreflight` does not exist.

- [ ] **Step 3: Implement the injected process runner and preflight**

```ts
// scripts/release/process.ts
import { spawn } from "node:child_process";

export interface CommandResult { code: number; stdout: string; stderr: string }
export type CommandRunner = (
  file: string,
  args: string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv },
) => Promise<CommandResult>;

export const runCommand: CommandRunner = (file, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
```

```ts
// scripts/release/preflight.ts
import { createHash } from "node:crypto";
import type { CommandRunner } from "./process";

const CAPABILITY_VALIDATORS: Record<string, { present: RegExp; divergent?: RegExp }> = {
  "table:public.mission_workflows": { present: /CREATE TABLE public\.mission_workflows\b/i },
  "column:public.missions.creator_workflow_mode": { present: /creator_workflow_mode/i },
  "function:public.create_mission_workflow": {
    present: /CREATE(?: OR REPLACE)? FUNCTION public\.create_mission_workflow\(p_submission uuid\)/i,
    divergent: /FUNCTION public\.create_mission_workflow\b/i,
  },
  "policy:public.mission_workflows.mission_workflows_creator_read": { present: /CREATE POLICY mission_workflows_creator_read ON public\.mission_workflows\b/i },
  "trigger:public.mission_draft_versions_immutable": { present: /CREATE TRIGGER mission_draft_versions_immutable\b[\s\S]*? ON public\.mission_draft_versions\b/i },
  "grant:authenticated.public.create_mission_workflow(uuid)": { present: /GRANT EXECUTE ON FUNCTION public\.create_mission_workflow\(uuid\) TO authenticated\b/i },
  "storage-policy:storage.objects.mission_draft_assets_storage_read": { present: /CREATE POLICY mission_draft_assets_storage_read ON storage\.objects\b/i },
  "table:public.mission_publication_proof_attempts": { present: /CREATE TABLE public\.mission_publication_proof_attempts\b/i },
  "policy:public.mission_publication_proof_attempts.mission_publication_proof_attempts_creator_read": { present: /CREATE POLICY mission_publication_proof_attempts_creator_read ON public\.mission_publication_proof_attempts\b/i },
  "trigger:public.mission_publication_proof_attempts_immutable": { present: /CREATE TRIGGER mission_publication_proof_attempts_immutable\b[\s\S]*? ON public\.mission_publication_proof_attempts\b/i },
  "table:public.mission_reward_contracts": { present: /CREATE TABLE public\.mission_reward_contracts\b/i },
  "table:public.mission_completion_decisions": { present: /CREATE TABLE public\.mission_completion_decisions\b/i },
  "table:public.mission_pending_rewards": { present: /CREATE TABLE public\.mission_pending_rewards\b/i },
  "rls:public.mission_reward_contracts": { present: /ALTER TABLE(?: ONLY)? public\.mission_reward_contracts ENABLE ROW LEVEL SECURITY/i },
  "trigger:public.mission_reward_contracts_immutable": { present: /CREATE TRIGGER mission_reward_contracts_immutable\b[\s\S]*? ON public\.mission_reward_contracts\b/i },
  "trigger:public.mission_completion_decisions_immutable": { present: /CREATE TRIGGER mission_completion_decisions_immutable\b[\s\S]*? ON public\.mission_completion_decisions\b/i },
  "trigger:public.mission_pending_rewards_guarded_update": { present: /CREATE TRIGGER mission_pending_rewards_guarded_update\b[\s\S]*? ON public\.mission_pending_rewards\b/i },
  "function:public.join_active_mission": { present: /CREATE(?: OR REPLACE)? FUNCTION public\.join_active_mission\(p_mission uuid\)/i, divergent: /FUNCTION public\.join_active_mission\b/i },
  "grant:authenticated.public.join_active_mission(uuid)": { present: /GRANT EXECUTE ON FUNCTION public\.join_active_mission\(uuid\) TO authenticated\b/i },
  "function:public.approve_mission_completion": { present: /CREATE(?: OR REPLACE)? FUNCTION public\.approve_mission_completion\b/i },
  "function:public.cancel_mission_reward_handoff": { present: /CREATE(?: OR REPLACE)? FUNCTION public\.cancel_mission_reward_handoff\b/i },
  "trigger:public.reward_handoff_workflow_event_notifications": { present: /CREATE TRIGGER reward_handoff_workflow_event_notifications\b/i },
  "function:public.retry_reward_handoff_notification": { present: /CREATE(?: OR REPLACE)? FUNCTION public\.retry_reward_handoff_notification\b/i },
  "grant:service_role.public.retry_reward_handoff_notification(uuid,uuid,uuid,text)": { present: /GRANT EXECUTE ON FUNCTION public\.retry_reward_handoff_notification\(uuid, uuid, uuid, text\) TO service_role\b/i },
};

type CapabilityStatus = "present" | "absent" | "divergent" | "unverifiable";

function capabilityStatus(name: string, schema: string): CapabilityStatus {
  const validator = CAPABILITY_VALIDATORS[name];
  if (!validator) return "unverifiable";
  if (validator.present.test(schema)) return "present";
  if (validator.divergent?.test(schema)) return "divergent";
  return "absent";
}

const hash = (value: string) =>
  createHash("sha256").update(value.replaceAll("\r\n", "\n")).digest("hex");

export interface PreflightInput {
  databaseUrl: string;
  projectRef: string;
  manifestDigest: string;
  expectedCapabilities: string[];
  now: Date;
}
export interface PreflightDeps {
  run: CommandRunner;
  readFile(path: string, encoding: "utf8"): Promise<string>;
  rm(path: string, options: { force: true }): Promise<void>;
  tempFile: () => string;
}

export async function runPreflight(input: PreflightInput, deps: PreflightDeps) {
  const dumpPath = deps.tempFile();
  const commands: Array<[string, string[]]> = [
    ["migration list", ["supabase", "migration", "list", "--db-url", input.databaseUrl]],
    ["db push dry-run", ["supabase", "db", "push", "--dry-run", "--db-url", input.databaseUrl]],
    ["db dump", ["supabase", "db", "dump", "--db-url", input.databaseUrl, "--file", dumpPath, "--keep-comments"]],
  ];
  const results: string[] = [];
  let schema: string;
  try {
    for (const [label, args] of commands) {
      const result = await deps.run("npx", args);
      if (result.code !== 0) throw new Error(`${label} failed: ${result.stderr.trim()}`);
      results.push(result.stdout);
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
    schemaVersion: 1 as const,
    targetProjectRef: input.projectRef,
    manifestDigest: input.manifestDigest,
    migrationListHash: hash(results[0]),
    dryRunHash: hash(results[1]),
    schemaFingerprint: hash(schema),
    capabilities,
    warnings: capabilities
      .filter(({ status }) => status !== "present")
      .map(({ name, status }) => `${status} capability: ${name}`),
    createdAt: input.now.toISOString(),
  };
}
```

Add `release:preflight` as a thin CLI wrapper that requires a database role
limited to catalog and migration-history reads through
`PREFLIGHT_DATABASE_URL`, plus `RELEASE_PROJECT_REF`, reads the committed
manifest, invokes `runPreflight`, and writes JSON only to a user-supplied
`--output` path. The wrapper must reject an output path inside
`supabase/migrations`.

The wrapper flattens and deduplicates `manifest.migrations[].capabilities` and
passes that exact set to `runPreflight`. Every declared capability must have a
validator; an unknown declaration is reported as `unverifiable`, never treated
as present. A preparation preflight may classify capabilities as `absent`
because production has not been expanded yet, but the evidence bundle must
record that baseline explicitly. Postflight and pilot gates require every
declared capability to be `present`; `absent`, `divergent`, and `unverifiable`
are fail-closed states. The schema dump lives only at a generated OS temp path
and is removed in `finally`; it is never persisted in release evidence.

- [ ] **Step 4: Verify focused behavior**

Run:

```powershell
npx.cmd vitest run scripts/release/preflight.test.ts scripts/release/manifest.test.ts --reporter=verbose
npm.cmd run type-check
```

Expected: PASS; no test output or report contains the database URL.

- [ ] **Step 5: Commit**

```powershell
git add package.json scripts/release/contracts.ts scripts/release/process.ts scripts/release/preflight.ts scripts/release/preflight.test.ts
git commit -m "feat: add read-only production schema preflight"
```

---

### Task 5: Add guarded empty and production-shaped rehearsal

**Files:**
- Create: `scripts/release/target-guard.ts`
- Create: `scripts/release/target-guard.test.ts`
- Create: `scripts/release/rehearsal.ts`
- Create: `scripts/release/rehearsal.test.ts`
- Modify: `scripts/release/contracts.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: preflight schema fingerprint, manifest digest, disposable empty DB
  URL, operator-provided production-shaped rehearsal DB URL plus loopback
  Supabase API credentials, and production target identifiers.
- Produces:
  - `assertDisposableTarget(input: TargetGuardInput): void`
  - `runRehearsal(input: RehearsalInput, deps: RehearsalDeps): Promise<RehearsalReport>`.

- [ ] **Step 1: Write failing target-guard tests**

```ts
import { describe, expect, it } from "vitest";
import { assertDisposableTarget } from "./target-guard";

describe("rehearsal target guard", () => {
  const base = {
    targetRef: "rehearsal-ref",
    targetDatabaseUrl: "postgresql://rehearsal/db",
    productionRef: "mhkoayftiuojxlrkollf",
    productionDatabaseUrl: "postgresql://production/db",
  };

  it("rejects the production ref or production URL", () => {
    expect(() => assertDisposableTarget({ ...base, targetRef: base.productionRef }))
      .toThrow("production project reference");
    expect(() => assertDisposableTarget({
      ...base,
      targetDatabaseUrl: base.productionDatabaseUrl,
    })).toThrow("production database URL");
  });

  it("requires explicit disposable naming", () => {
    expect(() => assertDisposableTarget({ ...base, targetRef: "customer-prod" }))
      .toThrow("disposable target");
    expect(() => assertDisposableTarget(base)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the guard test to verify it fails**

Run:

```powershell
npx.cmd vitest run scripts/release/target-guard.test.ts --reporter=verbose
```

Expected: FAIL because `assertDisposableTarget` does not exist.

- [ ] **Step 3: Implement fail-closed target comparison**

```ts
export interface TargetGuardInput {
  targetRef: string;
  targetDatabaseUrl: string;
  productionRef: string;
  productionDatabaseUrl: string;
}

function canonicalUrl(value: string) {
  const url = new URL(value);
  url.password = "";
  url.username = "";
  return url.toString();
}

export function assertDisposableTarget(input: TargetGuardInput) {
  if (input.targetRef === input.productionRef) {
    throw new Error("rehearsal refused production project reference");
  }
  if (canonicalUrl(input.targetDatabaseUrl) === canonicalUrl(input.productionDatabaseUrl)) {
    throw new Error("rehearsal refused production database URL");
  }
  if (!/(test|rehearsal|branch|local)/i.test(input.targetRef)) {
    throw new Error("target is not explicitly identified as a disposable target");
  }
}
```

- [ ] **Step 4: Write the failing rehearsal orchestration test**

```ts
import { describe, expect, it, vi } from "vitest";
import { runRehearsal } from "./rehearsal";

it("checks production shape before applying and runs the complete ordered gates", async () => {
  const preflight = vi.fn()
    .mockResolvedValueOnce({ schemaFingerprint: "prod-shape" })
    .mockResolvedValueOnce({
      schemaFingerprint: "empty-expanded-shape",
      capabilities: [{ status: "present" }],
    })
    .mockResolvedValueOnce({
      schemaFingerprint: "expanded-shape",
      capabilities: [{ status: "present" }],
    });
  const run = vi.fn().mockResolvedValue({ code: 0, stdout: "pass", stderr: "" });
  const report = await runRehearsal({
    emptyTarget: { ref: "local-empty", databaseUrl: "postgresql://empty/db" },
    shapedTarget: {
      ref: "local-rehearsal-shape",
      databaseUrl: "postgresql://shape/db",
      apiUrl: "http://127.0.0.1:54321",
      anonKey: "disposable-anon-key",
      serviceKey: "disposable-service-key",
    },
    production: {
      ref: "mhkoayftiuojxlrkollf",
      databaseUrl: "postgresql://production/db",
      schemaFingerprint: "prod-shape",
    },
    manifestDigest: "a".repeat(64),
    now: new Date("2026-08-01T00:00:00Z"),
  }, { run, preflight });
  expect(run.mock.calls.map((call) => call[1].join(" "))).toEqual([
    "run test:legacy-integration",
    "supabase db reset --db-url postgresql://empty/db --no-seed",
    "supabase db push --dry-run --db-url postgresql://shape/db",
    "supabase db push --db-url postgresql://shape/db",
    "supabase db push --dry-run --db-url postgresql://shape/db",
    "run seed:reward-handoff-acceptance",
    "run test:integration",
    "run test:legacy-integration",
    "run test:active-missions",
  ]);
  expect(report.status).toBe("passed");
  expect(JSON.stringify(report)).not.toContain("disposable-service-key");
});
```

- [ ] **Step 5: Implement rehearsal ordering**

Implement `runRehearsal` so it:

1. calls `assertDisposableTarget` for both databases;
2. preflights the shaped target before writes and requires an exact match with
   the approved production schema fingerprint;
3. runs the legacy integration gate against the unexpanded shaped target;
4. runs `npx supabase db reset --db-url <empty> --no-seed`, which recreates
   the disposable empty database and applies the complete local migration set;
5. preflights the empty target and requires every manifest capability present;
6. runs `npx supabase db push --dry-run --db-url <shaped>`;
7. runs `npx supabase db push --db-url <shaped>`;
8. immediately repeats the shaped-target dry-run and requires a no-pending
   result, proving the declared migration-history replay contract;
9. seeds the reward-handoff acceptance fixture, then runs full integration,
   legacy integration, and active-mission commands with the shaped target's
   local test environment;
10. preflights the shaped target again and requires every manifest capability
    present;
11. returns hashes, exit codes, fingerprints, timestamps, and `status:
   "passed"` only when every command exits 0.

Add `test:legacy-integration` as a focused `server/test/missions.test.ts` gate.
For database-backed runs, the rehearsal injects `RUN_INTEGRATION=1`, the
loopback `SUPABASE_URL`, and disposable anon/service keys from `shapedTarget`.
It rejects a non-loopback API URL and never serializes either key. The
production-shaped database is operator-supplied structural or sanitized data;
the runner does not create a paid Supabase branch or copy production data.

- [ ] **Step 6: Verify and commit**

Run:

```powershell
npx.cmd vitest run scripts/release/target-guard.test.ts scripts/release/rehearsal.test.ts --reporter=verbose
npm.cmd run type-check
git diff --check
```

Expected: PASS.

```powershell
git add package.json scripts/release/contracts.ts scripts/release/target-guard.ts scripts/release/target-guard.test.ts scripts/release/rehearsal.ts scripts/release/rehearsal.test.ts
git commit -m "feat: add guarded release rehearsal"
```

---

### Task 6: Generate immutable evidence and guard the production executor

**Files:**
- Create: `scripts/release/evidence.ts`
- Create: `scripts/release/evidence.test.ts`
- Create: `scripts/release/executor.ts`
- Create: `scripts/release/executor.test.ts`
- Modify: `scripts/release/contracts.ts`
- Modify: `package.json`
- Create: `docs/verification/releases/.gitkeep`

**Interfaces:**
- Consumes: manifest digest, preflight report, rehearsal report, target ref,
  recovery reference, named responsibilities, planned deployment commit, and
  proposed containment commands.
- Produces:
  - `buildEvidence(input: EvidenceInput): ReleaseEvidence`
  - `digestEvidence(evidence: ReleaseEvidence): string`
  - `verifyEvidence(evidence, expected, now): string[]`
  - `executeRelease(input: ExecuteInput, deps: ExecuteDeps): Promise<ExecuteReport>`.

- [ ] **Step 1: Write failing evidence tests**

```ts
import { describe, expect, it } from "vitest";
import { buildEvidence, digestEvidence, verifyEvidence } from "./evidence";

const validInput = {
  targetProjectRef: "mhkoayftiuojxlrkollf",
  schemaFingerprint: "b".repeat(64),
  manifestDigest: "a".repeat(64),
  preflightHash: "c".repeat(64),
  rehearsalHash: "d".repeat(64),
  applicationCommit: "e".repeat(40),
  migrationRange: { from: "20260715163350", to: "20260731140000" },
  migrationChecksums: [{ version: "20260715163350", sha256: "f".repeat(64) }],
  recoveryReference: "backup-2026-08-01T00:00Z",
  roles: {
    executor: "release-executor",
    observer: "release-observer",
    containmentOwner: "incident-owner",
    productOwner: "product-owner",
    approver: "production-approver",
  },
  testResults: [{ gate: "production-shape-rehearsal", status: "passed", evidenceHash: "1".repeat(64) }],
  proposedProductionCommands: ["npm run release:execute -- --apply"],
  containmentCommands: ["close pilot mission", "restore compatible deployment"],
  warnings: [],
  skippedChecks: [],
  createdAt: "2026-08-01T00:00:00.000Z",
  expiresAt: "2026-08-02T00:00:00.000Z",
};

describe("release evidence", () => {
  it("is deterministic and rejects secret-bearing values", () => {
    const evidence = buildEvidence(validInput);
    const bundleDigest = digestEvidence(evidence);
    expect(bundleDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(verifyEvidence(evidence, {
      projectRef: validInput.targetProjectRef,
      schemaFingerprint: validInput.schemaFingerprint,
      manifestDigest: validInput.manifestDigest,
      applicationCommit: validInput.applicationCommit,
      bundleDigest,
    }, new Date("2026-08-01T12:00:00Z"))).toEqual([]);
    expect(() => buildEvidence({
      ...validInput,
      recoveryReference: "postgresql://user:password@host/db",
    })).toThrow("sensitive evidence value");
  });
});
```

- [ ] **Step 2: Run to verify RED**

Run:

```powershell
npx.cmd vitest run scripts/release/evidence.test.ts --reporter=verbose
```

Expected: FAIL because evidence functions do not exist.

- [ ] **Step 3: Implement canonical evidence and strict redaction**

Implement:

```ts
const SENSITIVE_KEY = /(secret|token|password|jwt|email|signed.?url|database.?url)/i;
const SENSITIVE_VALUE = /(postgres(?:ql)?:\/\/|eyJ[A-Za-z0-9_-]+\.|@[^\s]+\.[^\s]+)/i;

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
```

`EvidenceInput` must explicitly define the target and schema fingerprint,
application commit, manifest digest, migration range and per-version
checksums, preflight/rehearsal hashes, named test results, recovery reference,
roles, proposed production and containment commands, warnings, skipped
checks, creation time, and expiry. `buildEvidence` must sort object keys before
hashing, set `schemaVersion: 1`, preserve only those fields, and call
`assertSanitized`. `verifyEvidence` must return errors for target, schema,
manifest, application commit, migration range/checksums, recovery reference,
role, expiry, content, or supplied bundle-digest mismatches. Evidence files
are created with exclusive-write semantics and never overwritten; a changed
input produces a new timestamped append-only artifact.

- [ ] **Step 4: Write failing executor tests**

```ts
import { describe, expect, it, vi } from "vitest";
import { executeRelease } from "./executor";

it("dry-runs first, writes only with exact approval, and proves postflight", async () => {
  const run = vi.fn().mockResolvedValue({ code: 0, stdout: "ok", stderr: "" });
  const postflight = vi.fn().mockResolvedValue({
    schemaFingerprint: "expanded-fingerprint",
    manifestDigest: "a".repeat(64),
    capabilities: [{ name: "table:public.mission_workflows", status: "present" }],
  });
  const base = {
    databaseUrl: "postgresql://secret",
    projectRef: "mhkoayftiuojxlrkollf",
    evidence: validEvidence,
    evidenceDigest: digestEvidence(validEvidence),
    currentSchemaFingerprint: validEvidence.schemaFingerprint,
    currentManifestDigest: validEvidence.manifestDigest,
    now: new Date("2026-08-01T12:00:00Z"),
  };
  await executeRelease({ ...base, apply: false, approval: "" }, { run, postflight });
  expect(run).toHaveBeenCalledTimes(1);
  expect(run.mock.calls[0][1]).toContain("--dry-run");
  expect(postflight).not.toHaveBeenCalled();

  run.mockClear();
  await executeRelease({
    ...base,
    apply: true,
    approval: `APPROVE ${base.projectRef} ${base.evidenceDigest}`,
  }, { run, postflight });
  expect(run).toHaveBeenCalledTimes(2);
  expect(run.mock.calls[1][1]).not.toContain("--dry-run");
  expect(postflight).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 5: Implement executor guards**

`executeRelease` must:

1. call `verifyEvidence` against the current target, schema, manifest, time,
   and supplied bundle digest;
2. always run `npx supabase db push --dry-run --db-url <url>` first;
3. return a dry-run report when `apply` is false;
4. require exact phrase
   `APPROVE <projectRef> <evidenceDigest>` when `apply` is true;
5. run only `npx supabase db push --db-url <url>` after every guard passes;
6. immediately run an injected fresh postflight and fail unless the manifest
   digest is unchanged and every declared capability is `present`;
7. never add `--include-seed`, `--include-all`, reset, down, repair, or SQL
   editor commands;
8. redact the database URL from returned reports and thrown command messages.

The `release:execute` CLI wrapper must derive current state rather than trust
operator-provided fingerprints: load and digest the committed manifest, load
and digest the bundle, run a fresh read-only preflight against
`RELEASE_DATABASE_URL` and `RELEASE_PROJECT_REF`, and pass those computed
values into `executeRelease`. After an approved write, it invokes the same
fresh preflight dependency for postflight. The workflow inputs cannot override
schema or manifest fingerprints. Before Task 6 lands, the Task 2 workflow is
intentionally non-runnable because `release:execute` does not yet exist; this
is a safe intermediate state, not a release path.

Add:

```json
"release:evidence": "vite-node scripts/release/evidence.ts",
"release:execute": "vite-node scripts/release/executor.ts"
```

- [ ] **Step 6: Verify and commit**

Run:

```powershell
npx.cmd vitest run scripts/release/evidence.test.ts scripts/release/executor.test.ts scripts/release/supabase-workflow-contract.test.ts --reporter=verbose
npm.cmd run type-check
git diff --check
```

Expected: PASS; tests prove write is unreachable without exact approval.

```powershell
git add package.json scripts/release/contracts.ts scripts/release/evidence.ts scripts/release/evidence.test.ts scripts/release/executor.ts scripts/release/executor.test.ts docs/verification/releases/.gitkeep
git commit -m "feat: guard production migration execution"
```

---

### Task 7: Verify Vercel deployment identity and application health

**Files:**
- Create: `scripts/release/deployment.ts`
- Create: `scripts/release/deployment.test.ts`
- Modify: `scripts/release/contracts.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: Vercel deployment ID, team ID, token, expected Git commit, production
  alias, and preflight report.
- Produces:
  - `verifyDeployment(input: DeploymentInput, deps: { fetch: typeof fetch }): Promise<DeploymentReport>`.

- [ ] **Step 1: Write failing deployment tests**

```ts
import { describe, expect, it, vi } from "vitest";
import { verifyDeployment } from "./deployment";

it("requires READY production deployment at the expected commit and healthy URLs", async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({
      id: "dpl_1",
      readyState: "READY",
      target: "production",
      meta: { githubCommitSha: "abc123", githubCommitRef: "main" },
      alias: ["adfocate-2.vercel.app"],
    }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    .mockResolvedValueOnce(new Response("<!doctype html>", { status: 200 }));
  const report = await verifyDeployment({
    deploymentId: "dpl_1",
    teamId: "team_1",
    token: "vercel-secret",
    expectedCommit: "abc123",
    productionAlias: "adfocate-2.vercel.app",
    appOrigin: "https://adfocate-2.vercel.app",
    expectedSchemaFingerprint: "a".repeat(64),
  }, { fetch });
  expect(report.status).toBe("passed");
  expect(JSON.stringify(report)).not.toContain("vercel-secret");
});
```

- [ ] **Step 2: Run to verify RED**

Run:

```powershell
npx.cmd vitest run scripts/release/deployment.test.ts --reporter=verbose
```

Expected: FAIL because `verifyDeployment` does not exist.

- [ ] **Step 3: Implement deployment verification**

`verifyDeployment` must:

- fetch `https://api.vercel.com/v13/deployments/<id>?teamId=<teamId>` with a
  bearer token;
- require `READY`, `target: "production"`, `githubCommitRef: "main"`,
  exact commit SHA, and the exact production alias;
- fetch `/api/health` and require HTTP 200 with `{ "ok": true }`;
- fetch `/home` and require HTTP 200;
- attach the already-generated schema fingerprint instead of exposing a new
  public schema endpoint;
- return deployment ID, commit, alias, status codes, schema fingerprint, and
  timestamps without returning the token or response headers.

Add:

```json
"release:verify-deployment": "vite-node scripts/release/deployment.ts"
```

- [ ] **Step 4: Verify and commit**

Run:

```powershell
npx.cmd vitest run scripts/release/deployment.test.ts --reporter=verbose
npm.cmd run type-check
```

Expected: PASS.

```powershell
git add package.json scripts/release/contracts.ts scripts/release/deployment.ts scripts/release/deployment.test.ts
git commit -m "feat: verify production deployment identity"
```

---

### Task 8: Guard pilot selection and evaluate seven-day exit evidence

**Files:**
- Create: `scripts/release/pilot.ts`
- Create: `scripts/release/pilot.test.ts`
- Create: `scripts/release/observer.ts`
- Create: `scripts/release/observer.test.ts`
- Modify: `scripts/release/contracts.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: Supabase service client, approved evidence digest, exact workspace
  and mission IDs, deployment report, workflow observations, and financial
  snapshots.
- Produces:
  - `inspectPilotCandidate(client, input): Promise<PilotCandidateReport>`
  - `enablePilot(client, input): Promise<PilotEnableReport>`
  - `observePilot(client, input): Promise<PilotObservation>`
  - `evaluatePilotExit(observations, containment): PilotExitDecision`.

- [ ] **Step 1: Write failing pilot-candidate tests**

```ts
import { describe, expect, it, vi } from "vitest";
import { inspectPilotCandidate, enablePilot } from "./pilot";

it("accepts exactly one new mission and defaults to inspection only", async () => {
  const client = fakeSupabase({
    mission: {
      id: "mission-1",
      workspace_id: "workspace-1",
      creator_workflow_mode: "legacy",
      status: "draft",
      points_reward: 100,
      cash_reward: 0,
    },
    submissions: [],
    workflows: [],
    activePilotCount: 0,
  });
  const report = await inspectPilotCandidate(client, {
    workspaceId: "workspace-1",
    missionId: "mission-1",
  });
  expect(report.eligible).toBe(true);
  await enablePilot(client, {
    ...report,
    apply: false,
    evidenceDigest: "a".repeat(64),
    approval: "",
  });
  expect(client.update).not.toHaveBeenCalled();
});

it("rejects existing submissions, cross-workspace missions, or a second pilot", async () => {
  await expect(inspectPilotCandidate(clientWithSubmission, {
    workspaceId: "workspace-1",
    missionId: "mission-1",
  })).resolves.toMatchObject({ eligible: false });
});
```

- [ ] **Step 2: Run to verify RED**

Run:

```powershell
npx.cmd vitest run scripts/release/pilot.test.ts --reporter=verbose
```

Expected: FAIL because pilot functions do not exist.

- [ ] **Step 3: Implement candidate and enablement guards**

`inspectPilotCandidate` must read:

- mission ID, workspace ID, status, workflow mode, and complete reward settings;
- submission count and workflow count for the mission;
- count of active-workspace pilot missions outside the candidate.
- the approved schema postflight, deployment report, and evidence digest.

Eligibility requires exact workspace match, draft status, legacy mode, zero
submissions, zero workflows, non-negative `points_reward` and `cash_reward`,
and zero other enabled pilots. The inspection report must show the exact join
contract that Phase 4 will snapshot: mission points, `cash_reward ?? 0`, fixed
currency `HKD`, and XP `0`; it must not invent mission currency or XP columns.
It also requires every schema capability present, a READY production
deployment at the approved commit, passing legacy compatibility evidence, and
zero prematurely enabled active-workspace missions. Missing or stale gate
evidence makes the candidate ineligible.

`enablePilot` defaults to `apply: false`. Apply mode requires exact phrase
`ENABLE PILOT <workspaceId> <missionId> <evidenceDigest>`, re-runs candidate
inspection immediately before update, performs one conditional update from
`legacy` to `active_workspace`, and verifies exactly one affected row. It
does not publish the mission and cannot update a mission after a submission
exists.

- [ ] **Step 4: Write failing observer and exit-gate tests**

```ts
import { describe, expect, it } from "vitest";
import { evaluatePilotExit } from "./observer";

it("expands only with end-to-end, seven stable days, containment, and neutrality", () => {
  const observations = Array.from({ length: 7 }, (_, day) => ({
    observedAt: new Date(Date.UTC(2026, 7, day + 1)).toISOString(),
    unexpected5xx: 0,
    integrityIncidents: 0,
    tenantIsolationIncidents: 0,
    notificationDeadLetters: 0,
    pendingRewards: day === 6 ? 1 : 0,
    completedWorkflows: day === 6 ? 1 : 0,
    financialMovement: { points: 0, cash: 0, xp: 0, ledgerRows: 0 },
  }));
  expect(evaluatePilotExit(observations, { passed: true })).toEqual({
    decision: "expand",
    reasons: [],
  });
  expect(evaluatePilotExit(observations.slice(0, 6), { passed: true }).decision)
    .toBe("hold");
});
```

- [ ] **Step 5: Implement observation and pure exit evaluation**

`observePilot` must collect workflow/submission/proof/completion/pending-handoff
counts, illegal transitions, duplicate decisions, missing contracts, notification
retry/dead-letter state, maximum queue age, review latency, overdue items,
request/database error clusters, and before/after creator reward snapshots. It
records one hashed creator identity plus opaque workflow IDs and structural
counts only, and verifies every observation belongs to the selected workspace
and mission.

`evaluatePilotExit` returns:

```ts
export type PilotExitDecision =
  | { decision: "expand"; reasons: [] }
  | { decision: "hold" | "contain"; reasons: string[] };
```

It returns `contain` for any integrity, tenant isolation, or financial
movement incident. It returns `hold` for fewer than seven distinct stable
calendar days, missing completed workflow, missing pending reward, new
unexpected 5xx or database-error cluster, unhealthy or over-age retry queues,
overdue workflow items, more or fewer than one completed pilot creator, or a
failed containment drill. Thresholds are read from the approved evidence
bundle rather than silently hard-coded after the pilot begins.

Add:

```json
"release:pilot:inspect": "vite-node scripts/release/pilot.ts inspect",
"release:pilot:enable": "vite-node scripts/release/pilot.ts enable",
"release:pilot:observe": "vite-node scripts/release/observer.ts observe",
"release:pilot:evaluate": "vite-node scripts/release/observer.ts evaluate"
```

- [ ] **Step 6: Verify and commit**

Run:

```powershell
npx.cmd vitest run scripts/release/pilot.test.ts scripts/release/observer.test.ts --reporter=verbose
npm.cmd run type-check
git diff --check
```

Expected: PASS; no default command mutates a mission.

```powershell
git add package.json scripts/release/contracts.ts scripts/release/pilot.ts scripts/release/pilot.test.ts scripts/release/observer.ts scripts/release/observer.test.ts
git commit -m "feat: guard and observe release pilot"
```

---

### Task 9: Wire acceptance gates, CI, and the operator runbook

**Files:**
- Create: `scripts/release/release-acceptance.test.ts`
- Create: `docs/operations/production-release-foundation.md`
- Modify: `docs/operations/active-mission-workspace.md`
- Modify: `docs/operations/publication-proof-release-runbook.md`
- Modify: `docs/operations/reward-handoff.md`
- Modify: `.github/workflows/ci.yml`
- Modify: `package.json`

**Interfaces:**
- Consumes: every release module and package command from Tasks 2-8.
- Produces: one non-mutating `release:check` gate, one disposable-only
  `release:rehearse` gate, linked runbooks, and an explicit go-live approval
  handoff.

- [ ] **Step 1: Write the failing release acceptance contract**

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const ci = readFileSync(".github/workflows/ci.yml", "utf8");
const runbook = readFileSync(
  "docs/operations/production-release-foundation.md",
  "utf8",
);

describe("production release foundation acceptance", () => {
  it("exposes complete non-mutating checks and disposable rehearsal", () => {
    expect(pkg.scripts["release:check"]).toContain("release:manifest:check");
    expect(pkg.scripts["release:check"]).toContain("test:release-foundation");
    expect(pkg.scripts["release:rehearse"]).toContain("rehearsal.ts");
    expect(ci).toContain("npm run release:check");
    expect(ci).not.toContain("release:execute");
    expect(ci).not.toContain("release:pilot:enable");
  });

  it("documents exact approval and containment boundaries", () => {
    expect(runbook).toContain("APPROVE <projectRef> <evidenceDigest>");
    expect(runbook).toContain("ENABLE PILOT <workspaceId> <missionId> <evidenceDigest>");
    expect(runbook).toContain("Do not run production execution in this phase");
    expect(runbook).toContain("close new entry");
    expect(runbook).toContain("preserve workflow and audit records");
    expect(runbook).not.toMatch(/db reset --linked|migration down|--include-seed/);
  });
});
```

- [ ] **Step 2: Run to verify RED**

Run:

```powershell
npx.cmd vitest run scripts/release/release-acceptance.test.ts --reporter=verbose
```

Expected: FAIL because the aggregate scripts and runbook are absent.

- [ ] **Step 3: Add aggregate package gates**

Merge into `package.json`:

```json
"test:release-foundation": "vitest run scripts/release/*.test.ts --reporter=dot",
"release:check": "npm run release:manifest:check && npm run test:release-foundation && npm run type-check",
"release:rehearse": "vite-node scripts/release/rehearsal.ts"
```

Add one step to `build-test` in `.github/workflows/ci.yml` after `npm ci`:

```yaml
- run: npm run release:check
```

Do not add production, Vercel, database, service-role, or access-token secrets
to pull-request CI.

- [ ] **Step 4: Write the runbook with exact preparation and stop rules**

`docs/operations/production-release-foundation.md` must contain these ordered
sections:

1. authorization boundary;
2. pinned toolchain installation;
3. GitHub Actions availability and billing check, with the rule that a queued
   or unexecuted workflow is not release evidence and local gates remain
   mandatory;
4. reward stack integration evidence;
5. manifest write/check;
6. read-only production preflight;
7. operator-provided disposable empty and production-shaped targets;
8. rehearsal commands and expected artifacts;
9. evidence generation and expiry;
10. explicit statement that production execution is not run in this phase;
11. later go-live approval phrase and protected workflow inputs;
12. deployment verification;
13. pilot inspection and separate enable phrase;
14. seven-day observation and exit decision;
15. containment: close new entry, freeze risky mutations, restore compatible
    application, preserve workflow and audit records;
16. forbidden commands and data-handling rules.

Link this runbook from the active-mission, publication-proof, and reward-handoff
runbooks.

- [ ] **Step 5: Run focused acceptance and whole-repository verification**

Run:

```powershell
npm.cmd run release:check
npm.cmd run test:active-missions
npm.cmd test -- --reporter=dot
npm.cmd run lint
npm.cmd run type-check
npm.cmd run build
git diff --check
git status --short
```

Expected: all commands exit 0; lint may show already-recorded warnings but no
errors; only intended release-foundation files are modified.

- [ ] **Step 6: Commit**

```powershell
git add .github/workflows/ci.yml package.json scripts/release/release-acceptance.test.ts docs/operations/production-release-foundation.md docs/operations/active-mission-workspace.md docs/operations/publication-proof-release-runbook.md docs/operations/reward-handoff.md
git commit -m "docs: complete production release foundation gate"
```

---

## Final Verification and Handoff

- [ ] Re-run the complete static gate from a clean checkout:

```powershell
npm.cmd ci
npm.cmd run release:check
npm.cmd run test:active-missions
npm.cmd test -- --reporter=dot
npm.cmd run lint
npm.cmd run type-check
npm.cmd run build
git diff --check
```

- [ ] Run disposable rehearsal only after the operator supplies two explicitly
non-production targets:

```powershell
npm.cmd run release:rehearse
```

Expected: empty replay, production-shape match, migration dry-run/apply,
integration, active-mission, reward acceptance, and postflight all pass.

- [ ] Generate the sanitized evidence bundle and inspect it manually for
credentials, personal data, exact target, digest, expiry, recovery reference,
roles, and containment commands.

- [ ] Stop and request the separate production go-live approval. Do not invoke
`release:execute -- --apply` or `release:pilot:enable` during plan
implementation.

## Reference Material

- Approved design:
  `docs/superpowers/specs/2026-08-01-adfocate-production-release-foundation-design.md`
- Reward-handoff design:
  `docs/superpowers/specs/2026-07-31-adfocate-mission-completion-reward-handoff-design.md`
- Supabase local CLI installation and pinning:
  <https://supabase.com/docs/guides/local-development/cli/getting-started>
- Supabase migration status and dry-run workflow:
  <https://supabase.com/docs/guides/local-development/cli-workflows>
- Supabase CLI reference for `db push --dry-run`, `db dump --db-url`, and
  `migration list --db-url`:
  <https://supabase.com/docs/reference/cli/getting-started>
