# KOCmax P5 Candidate Freeze Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a deterministic offline application candidate and evidence-bound zero-post P5 approval packet without enabling any live action.

**Architecture:** Separate the immutable application/SQL/config fingerprint from append-only verification evidence and human gate decisions. A repository-only CLI creates and verifies both records; generated gate and approval documents consume those records. Every output keeps `executionAllowed: false`.

**Tech Stack:** TypeScript, Node.js ESM, Vite, Vitest, PGlite, Hono/React, local browser tooling.

**Spec:** `docs/superpowers/specs/2026-11-07-kocmax-p5-candidate-freeze-design.md`

## Global Constraints

- Work on `codex/kocmax-studio-stages-1-2`; preserve every existing staged, unstaged and untracked change and do not commit unless separately requested.
- Everything is offline: no deployment or preview, remote SQL, OAuth, account connection, secret loading, public media exposure, provider API call or post.
- DEV - Ads and existing consumer settings are read-only outside the repository; never reset, replace or remove existing integration values.
- `executionAllowed` remains literal `false` in every generated candidate, evidence and gate record.
- Mocks and historical evidence cannot close a live gate.
- Missing owner values produce explicit blockers; never invent URLs, IDs, scopes, costs, identities or credentials.
- Zero-post P5 is the core candidate. P5.4 is a separate optional appendix.
- Preserve original task, proof, approval, reward-handoff, wallet, visitor, brand and operator behavior.
- Follow repository conventions for ESM `.js` imports, TypeScript, tests and Markdown.

## Review Focus

- Secret-shaped content could enter a candidate manifest through configuration or evidence; tests must reject it before publication.
- Evidence could be detached from or reuse a stale application fingerprint; tests must reject candidate-ID mismatches.
- Tracked deletion, untracked implementation files, symlinks or path escapes could be omitted; tests must fail closed.
- A mock or unexecuted case could be promoted to live PASS; gate tests must enforce state transitions.
- Evidence writing could mutate the frozen application; verification must detect any post-freeze core change.

---

### Task 1: Immutable candidate core

**Files:**
- Create: `scripts/integrations/pilotCandidateCore.ts`
- Test: `scripts/integrations/pilotCandidateCore.test.ts`

**Interfaces:**

```ts
export type CandidateFile = {
  path: string;
  size: number;
  executable: boolean;
  sha256: string;
};

export type CandidateCore = {
  version: 1;
  candidateId: string;
  generatedAt: string;
  branch: string;
  head: string;
  dirtyWorktree: boolean;
  files: CandidateFile[];
  executionAllowed: false;
};

export async function buildCandidateCore(root: string): Promise<CandidateCore>;
export async function verifyCandidateCore(
  root: string,
  core: unknown
): Promise<{ verified: boolean; blockers: string[]; executionAllowed: false }>;
```

- [ ] **Step 1: Write failure tests for candidate selection**

Assert that the builder includes tracked and untracked files under `src/`, `server/`, `api/`, `scripts/` and `supabase/migrations/`, plus approved root manifests/lock/config files; excludes `node_modules/`, `dist/`, `.git/`, `.superpowers/`, local databases and candidate records; rejects symlinks; and sorts paths deterministically.

- [ ] **Step 2: Run the focused test to verify RED**

Run: `node node_modules/vitest/vitest.mjs run scripts/integrations/pilotCandidateCore.test.ts --reporter=dot`

Expected: FAIL because `pilotCandidateCore.ts` does not exist.

- [ ] **Step 3: Implement repository inventory and hashing**

Use `git ls-files --cached --others --exclude-standard -z` through `execFileSync` without a shell. Filter only approved application, SQL, script and root configuration paths. Validate paths are relative, normalized and inside the supplied root. Reject symlinks, missing files and files over 16 MiB. Hash file bytes and derive `candidateId` from canonical metadata excluding `generatedAt`, evidence and `candidateId`.

- [ ] **Step 4: Add verifier failure tests**

Assert mismatch blockers for altered bytes, missing/extra files, changed lockfile, malformed hashes, wrong `candidateId`, symlink replacement and a dirty tree that differs from the recorded `dirtyWorktree` marker.

- [ ] **Step 5: Implement strict core verification**

Return one deterministic blocker per invalid class, never repair the input, and always return `executionAllowed: false`.

- [ ] **Step 6: Run focused tests**

Run: `node node_modules/vitest/vitest.mjs run scripts/integrations/pilotCandidateCore.test.ts --reporter=dot`

Expected: PASS.

### Task 2: Evidence manifest binding

**Files:**
- Create: `scripts/integrations/pilotCandidateEvidence.ts`
- Test: `scripts/integrations/pilotCandidateEvidence.test.ts`

**Interfaces:**

```ts
export type EvidenceRun = {
  kind: 'test' | 'build' | 'lint' | 'typecheck' | 'browser' | 'inventory';
  command: string;
  environment: 'offline' | 'local-browser' | 'pglite';
  startedAt: string;
  completedAt: string;
  exitCode: number;
  logPath: string;
  logSha256: string;
};

export type EvidenceManifest = {
  version: 1;
  runId: string;
  candidateId: string;
  completedAt: string;
  runs: EvidenceRun[];
  executionAllowed: false;
};

export async function buildEvidenceManifest(
  root: string,
  core: CandidateCore,
  runs: readonly EvidenceRun[]
): Promise<EvidenceManifest>;
export async function verifyEvidenceManifest(
  root: string,
  core: CandidateCore,
  manifest: unknown
): Promise<{ verified: boolean; blockers: string[]; executionAllowed: false }>;
```

- [ ] **Step 1: Write failure tests**

Assert rejection of a candidate-ID mismatch, duplicate/missing required run kinds, changed/Absolute/escaped/symlinked log paths, wrong log hash, nonzero exit code, timestamps out of order, and any run claiming online environment.

- [ ] **Step 2: Run RED**

Run: `node node_modules/vitest/vitest.mjs run scripts/integrations/pilotCandidateEvidence.test.ts --reporter=dot`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement evidence construction and verification**

Bind every run to the verified core. Hash logs under the repository, allow only the documented environment values, derive `runId` deterministically from core and canonical run records, and return copied data. A failed or skipped required run remains a blocker.

- [ ] **Step 4: Run GREEN and tamper tests**

Run: `node node_modules/vitest/vitest.mjs run scripts/integrations/pilotCandidateEvidence.test.ts --reporter=dot`

Expected: PASS, including post-freeze core mutation detection.

### Task 3: Gate ledger

**Files:**
- Create: `scripts/integrations/pilotGateLedger.ts`
- Test: `scripts/integrations/pilotGateLedger.test.ts`
- Create after implementation runs: `docs/review/kocmax-controlled-pilot/p5-gate-ledger.json`
- Create after implementation runs: `docs/review/kocmax-controlled-pilot/p5-gate-ledger.md`

**Interfaces:**

```ts
export type GateState =
  | 'OFFLINE_PROVEN'
  | 'LIVE_TEST_REQUIRED_AFTER_APPROVAL'
  | 'OWNER_INPUT_REQUIRED'
  | 'BLOCKED'
  | 'NOT_RUN'
  | 'NOT_APPLICABLE';

export type CandidateReadiness =
  | 'HOLD_WITH_BLOCKERS'
  | 'READY_FOR_OWNER_INPUT'
  | 'READY_FOR_USER_APPROVAL';

export function evaluateP5Gates(gates: readonly GateRecord[]):
  {status: CandidateReadiness; blockers: string[]; executionAllowed: false};
export function renderGateLedger(ledger: P5GateLedger): string;
```

- [ ] **Step 1: Write gate-transition tests**

Assert that mocks cannot close live gates; owner-required fields prevent approval readiness; `NOT_APPLICABLE` needs a reason; unknown statuses reject; missing/expired evidence blocks; and `executionAllowed` is always false.

- [ ] **Step 2: Run RED**

Run: `node node_modules/vitest/vitest.mjs run scripts/integrations/pilotGateLedger.test.ts --reporter=dot`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Encode B1–B10**

Seed current states from `real-launch-approval-package.md`, `p5-0-readiness.md` and `p5-0-configuration-change-review.md`:

- B1 `OWNER_INPUT_REQUIRED`;
- B2 `OWNER_INPUT_REQUIRED`;
- B3 `LIVE_TEST_REQUIRED_AFTER_APPROVAL`;
- B4 `LIVE_TEST_REQUIRED_AFTER_APPROVAL`;
- B5 `LIVE_TEST_REQUIRED_AFTER_APPROVAL`;
- B6 `NOT_RUN`;
- B7 `LIVE_TEST_REQUIRED_AFTER_APPROVAL`;
- B8 `LIVE_TEST_REQUIRED_AFTER_APPROVAL`;
- B9 `OWNER_INPUT_REQUIRED`;
- B10 `OWNER_INPUT_REQUIRED`.

Each gate names its owner, evidence refs, action scope, invalidation trigger and blocker text.

- [ ] **Step 4: Render deterministic JSON and Markdown**

Sort B1–B10 and include candidate/evidence IDs once available. Markdown echoes the same state and blockers; it does not recalculate readiness independently.

- [ ] **Step 5: Run GREEN**

Run: `node node_modules/vitest/vitest.mjs run scripts/integrations/pilotGateLedger.test.ts --reporter=dot`

Expected: PASS.

### Task 4: Offline CLI and package commands

**Files:**
- Create: `scripts/integrations/pilotCandidateCli.ts`
- Modify: `package.json`

**Interfaces:**

```text
npm run pilot:candidate:write
npm run pilot:candidate:check
npm run pilot:candidate:evidence -- --input <relative-json>
npm run pilot:candidate:gates
```

- [ ] **Step 1: Write CLI tests**

Test argument dispatch without shell execution, output paths fixed under `docs/review/kocmax-controlled-pilot/`, refusal to overwrite a different immutable core, and generic error output that never echoes configuration values.

- [ ] **Step 2: Run RED**

Run: `node node_modules/vitest/vitest.mjs run scripts/integrations/pilotCandidateCli.test.ts --reporter=dot`

Expected: FAIL because the CLI does not exist.

- [ ] **Step 3: Implement `write` and `check`**

`write` fails if a different `p5-candidate-core.json` already exists; `check` verifies core, optional evidence and gate records. No command executes external services.

- [ ] **Step 4: Implement `evidence` and `gates`**

`evidence` accepts only a repository-relative input path and verified log paths. `gates` regenerates JSON/Markdown from the deterministic source. Reject unknown arguments and symlinks.

- [ ] **Step 5: Add npm scripts and run GREEN**

Run: `node node_modules/vitest/vitest.mjs run scripts/integrations/pilotCandidateCli.test.ts --reporter=dot`

Expected: PASS.

### Task 5: Approval packet and freeze evidence

**Files:**
- Create: `docs/review/kocmax-controlled-pilot/p5-live-run-approval-packet.md`
- Create after verification: `docs/review/kocmax-controlled-pilot/p5-candidate-core.json`
- Create after verification: `docs/review/kocmax-controlled-pilot/p5-evidence-manifest.json`
- Modify: `docs/review/kocmax-controlled-pilot/real-launch-approval-package.md`
- Modify: `.superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/progress.md`

- [ ] **Step 1: Create the approval packet**

Document scopes A, B, C and optional D; exact action IDs; owners; readbacks; stop conditions; rollback; evidence destinations; zero-post default; integration-preservation boundary; unresolved owner fields; and approval lines that remain unchecked.

- [ ] **Step 2: Run required offline verification**

Run the candidate-focused suites, affected pilot/original workflow regressions, TypeScript, changed-file lint, `git diff --check`, default-off and Studio builds with fixture markers absent, bundle boundary, SQL/PGlite inventory and local browser journeys at 320/390/430/1024/1440. Record every command/result; no whole-suite PASS claim unless all tests actually pass.

- [ ] **Step 3: Generate core, evidence, gate and artifact records**

Run the four offline CLI commands after code/tests are green. Confirm the core cannot change while evidence is appended and verify all hashes twice.

- [ ] **Step 4: Update package status**

Write the candidate ID, evidence ID, verification summary, exact blockers and either `HOLD_WITH_BLOCKERS` or `READY_FOR_USER_APPROVAL`. Keep `executionAllowed: false` even when approval-ready.

- [ ] **Step 5: Independent scoped review**

Review candidate selection completeness, evidence binding, secret/path handling, gate semantics, approval completeness and no-live-action guarantees. Fix Critical/Important findings once and rerun affected checks.

## Completion Criteria

- All focused candidate tests and affected regressions pass.
- Required builds and local browser checks pass or are explicitly `NOT_RUN` with blockers.
- The candidate file inventory covers all application/SQL/config inputs and excludes secrets/temp/generated content.
- Evidence is bound to the exact candidate ID and cannot survive core mutation.
- Gate ledger never promotes mock or unexecuted live evidence.
- Zero-post P5 packet is complete; P5.4 remains separate.
- DEV - Ads existing integrations remain unchanged.
- No deployment, remote SQL, OAuth, connection, secret loading, media exposure or posting occurred.
