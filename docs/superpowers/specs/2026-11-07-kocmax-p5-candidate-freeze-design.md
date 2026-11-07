# KOCmax P5 Candidate Freeze and Live-Run Approval Design

Date: 2026-11-07 Asia/Singapore

Status: **PROPOSED — design approval required**

Branch: `codex/kocmax-studio-stages-1-2`

## Intent

Prepare a complete, immutable, reviewable candidate for the KOCmax zero-post Instagram P5 controlled pilot. The phase ends at `READY_FOR_USER_APPROVAL` when all offline and owner-supplied prerequisites pass, or at `HOLD_WITH_BLOCKERS` when any do not. In both cases `executionAllowed` remains false.

This phase does not attempt to turn a mock PASS into live evidence. It packages the existing implementation, test evidence, database/rollback artifacts, operational inputs and explicit live checks into approval scopes that can be assessed safely. A subsequent user approval is still required before deployment, remote SQL, account creation, OAuth, public media exposure or posting.

The optional single technical publication is an appendix only. Zero-post P5 remains independently reviewable and approvable without P5.4.

## Current State and Blocker

The application already contains offline native routes, persistence/media/receipt wiring, original task/review/settlement integration, failure and recovery tests, callback handling, reviewer controls, and checkpoint/cluster simulations. Current disposition is HOLD because the missing work is evidence and authority outside the repository:

- exact DEV - Ads App/product/version and eligibility;
- exact OAuth, revocation, deauthorization and data-deletion protocol behavior;
- preservation proof for existing shared-App consumers;
- protected runtime, callback and media-origin values;
- target-bound restore proof and remote schema/ACL verification;
- real application identities and permission tests;
- operators, dates, costs, retention and cleanup ownership;
- separately approved live actions.

Adding more local consensus or UI fixtures cannot close these gates. The candidate must expose these as blockers rather than conceal them behind an overall PASS.

## Goals

1. Produce a deterministic candidate fingerprint covering the application source, lockfile, configuration contract names, reviewed SQL and rollback artifacts, review documents and evidence hashes.
2. Re-run applicable offline tests, builds, bundle-isolation checks and local mock browser journeys against the frozen candidate.
3. Build a gate register that distinguishes `OFFLINE_PROVEN`, `LIVE_TEST_REQUIRED_AFTER_APPROVAL`, `OWNER_INPUT_REQUIRED`, `BLOCKED`, `NOT_RUN` and `NOT_APPLICABLE`.
4. Present separate P5 action scopes for restore/database, protected runtime/application authorization, OAuth/media, and optional posting.
5. Preserve DEV - Ads and all existing integrations by treating the private external configuration as read-only and outside repository mutation.
6. Stop with no deployment, remote SQL, account creation, connection, secret loading or posting.

## Non-Goals

- No claim that mocks satisfy Meta, Supabase, Auth, RLS, media-origin or browser-to-hosted checks.
- No removal of HOLD merely because build or mock tests pass.
- No inference of approval from a generic “continue”.
- No invented URLs, IDs, scopes, App-version capabilities, account identities or costs.
- No scanning/Insights functionality and no Google Drive.
- No real reward, proof approval or P6 brand task in P5.
- No production CMS changes or deployment.

## Anti-Goals

The candidate is invalid if it:

- includes credentials, tokens, cookies, raw state-bearing OAuth URLs or private account secrets;
- hashes only file names while ignoring content;
- omits untracked implementation files or silently ignores a dirty worktree;
- reports a PASS for an unexecuted or partially executed test suite;
- treats owner placeholders as concrete values;
- mixes the original Instagram Login family with the Facebook Login pilot;
- changes or disables existing DEV - Ads consumers to simplify the pilot;
- creates a public post through a “technical” test without a separate exact-content approval.

## Approaches Considered

### Selected: complete candidate freeze

Hash and verify the entire application candidate, reviewed SQL/rollback set, configuration contract, review documents and evidence; run the affected and broad offline verification matrix; compile every live gate and action approval into one packet.

Tradeoff: slower and more documentation-heavy, but it is the only option that gives the live-run approver a stable release unit and a traceable difference between offline proof and live unknowns.

### Rejected: affected-surface-only freeze

Limit the candidate to pilot routes and modules.

Tradeoff: faster, but unrelated application changes, original task/reward flows, global build behavior and navigation regressions would remain under-verified. It does not satisfy “complete candidate”.

### Rejected: evidence-only packet

Update the gate documents without freezing executable artifacts.

Tradeoff: quickest, but the approver could not identify which source, dependency, build or SQL bytes will be exercised, so the result would not be a complete live-run approval candidate.

## Selected Design

### 1. Candidate Manifest

Add an offline TypeScript generator and verifier under `scripts/integrations/`.

Proposed commands:

```text
npm run pilot:candidate:write
npm run pilot:candidate:check
```

The generator reads only repository files and produces two non-cyclic records:

- `p5-candidate-core.json` — immutable application/SQL/configuration bytes;
- `p5-evidence-manifest.json` — append-only verification evidence bound to one candidate ID.

The candidate core contains:

```text
version
candidateId
generatedAt
branch
head
dirtyWorktree
applicationFiles[]
sqlArtifacts[]
lockfileHashes[]
configContract
executionAllowed: false
```

The evidence manifest contains:

```text
version
runId
candidateId
startedAt
completedAt
builds[]
tests[]
browserEvidence[]
gateSummary
blockers[]
executionAllowed: false
```

Selection rules:

- Include tracked files and explicit untracked implementation/configuration files.
- Include all relevant files under `src/`, `server/`, `api/`, `scripts/`, `supabase/migrations/`, plus root configuration and lockfiles.
- Include review/design documents supporting the approved design in a separate companion inventory, not in the executable candidate ID.
- Exclude `.git/`, `node_modules/`, `dist/`, temporary browser data, OS caches, raw local database files, secrets, the candidate core and the evidence manifest.
- Reject symlinks and paths outside the repository root.
- Sort by normalized POSIX relative path before hashing.
- Record path, size, mode category and SHA-256. Do not record credentials or raw environment values.

`candidateId` is the SHA-256 of a canonical serialization of the selected application hashes, lockfiles, configuration contract and SQL hashes. It excludes `generatedAt`, all evidence results, all evidence-log hashes and `candidateId` itself, so rerunning tests cannot silently change which application was tested.

The verifier recomputes the core selection and hashes, rejects missing/unexpected files, detects core tampering and returns:

```ts
{verified:boolean; blockers:string[]; executionAllowed:false}
```

Evidence recording is rejected if its `candidateId` does not equal the freshly verified core. Evidence records may be appended after tests, but the referenced core cannot change without starting a new candidate ID and run. The core and evidence records together are larger than the existing 100-entry inspection packet; the existing packet remains a curated review index.

### 2. Configuration Contract

The candidate may include configuration names and required-presence booleans, never values.

Required public/private classifications include:

- application origin and route mount;
- callback/deauthorization/data-deletion/status URLs;
- App ID alias validation and pinned API version;
- credential-store references, recorded as opaque names only;
- worker identity/permission profile;
- media origin and lease TTL limit;
- pilot workspace/run/account aliases.

Any missing required value produces `OWNER_INPUT_REQUIRED`. Any placeholder-looking value produces a blocker. Existing DEV - Ads values are not copied into Git or changed.

### 3. Gate Ledger

Create a machine-readable and Markdown view of the current B1–B10 gates:

- `p5-gate-ledger.json` for verification;
- `p5-gate-ledger.md` for human approval.

Allowed states:

```text
OFFLINE_PROVEN
LIVE_TEST_REQUIRED_AFTER_APPROVAL
OWNER_INPUT_REQUIRED
BLOCKED
NOT_RUN
NOT_APPLICABLE
```

Each item records:

- gate and accountable role;
- implementation/evidence references;
- exact test or observation that closed it;
- whether it can be performed offline;
- next action approval ID;
- expiry or invalidation trigger;
- user-visible blocker text.

Rules:

- A mock result can close only an `OFFLINE_PROVEN` item.
- A live gate remains open after offline PASS.
- An unexecuted live case is `NOT_RUN`, never `PASS`.
- A missing owner value is `OWNER_INPUT_REQUIRED`.
- `NOT_APPLICABLE` requires a stated reason; for example P5.4 gates are N/A to the zero-post core but remain in the appendix.

Overall states:

```text
HOLD_WITH_BLOCKERS
READY_FOR_OWNER_INPUT
READY_FOR_USER_APPROVAL
```

`READY_FOR_USER_APPROVAL` requires all offline evidence and owner-supplied fields to be complete, while live execution remains unapproved. No overall state permits `executionAllowed: true`.

### 4. Offline Verification Matrix

The candidate run records exact commands, environment class, start/end time, exit code and log hash.

Required groups:

1. Candidate-manifest write/read/tamper/path/secret-leak tests.
2. Pilot route, protocol, worker, repository, PGlite SQL, rollback, media, receipt, private collection and callback tests.
3. Original task, proof, approval, reward-handoff and navigation regressions.
4. TypeScript, changed-file lint and `git diff --check`.
5. Default-off production build and opt-in Studio build with fixtures disabled; scan for known synthetic markers.
6. Bundle-boundary/no-network check.
7. Local browser journeys at widths 320, 390, 430, 1024 and 1440 for creator, brand, reviewer, operator, admin and finance roles.
8. Full-suite run or a complete enumeration of any failures/skips. Existing unrelated failures cannot be relabeled as PASS.
9. Reviewed SQL/rollback byte inventory and duplicate-index check; no remote execution.

The candidate state is `HOLD_WITH_BLOCKERS` if a required check fails, is skipped without an explicit N/A reason, or changes the candidate during the run.

### 5. Live-Run Approval Packet

Create `p5-live-run-approval-packet.md` with separate checkboxes and stop conditions:

#### Scope A — restore and database

- named isolated restore destination;
- current encrypted backup/checksum/inventory;
- exact SQL and rollback hashes;
- pre/post schema, ACL, RLS and index inventory;
- nonpilot baseline;
- hard time window and cost ceiling.

#### Scope B — protected runtime and application authorization

- immutable candidate ID;
- protected URL and worker identity;
- disabled provider writes;
- named disposable application aliases;
- nine-role plus anonymous browser/API/RPC/RLS checks;
- exact cleanup IDs.

#### Scope C — OAuth and media

- DEV - Ads read-only before/after configuration snapshot;
- exact additive redirect/callback delta and existing-consumer review;
- T-IG/T-negative identities and scopes;
- token-storage owner and revocation procedure;
- bounded rights-cleared JPEG exposure and origin checks;
- zero container/publication budget.

#### Appendix D — optional one technical post

Separate, never implied by A–C:

- exact account, final JPEG bytes/hash/dimensions;
- exact caption/hash and sponsor/disclosure;
- public-exposure acknowledgement;
- one-intent/no-retry budget;
- independent fetch/label verification;
- cleanup and public-deletion decision;
- zero technical reward.

Every live action packet must show:

- action, resource, actor and timestamp;
- expected readback;
- stop conditions;
- exact rollback;
- evidence destination;
- user approval line and expiry.

### 6. Existing Integration Preservation

No live DEV - Ads mutation is part of candidate preparation.

Before any later Meta action, the approver receives:

- a restricted snapshot owner and retrieval time;
- existing consumers and redirects identified;
- exact proposed additive values;
- a delta-only rollback;
- a statement that global HTTPS/API-version/secret/asset settings remain unchanged.

The candidate verifier rejects a packet that proposes replacing existing redirects, resetting secrets, disconnecting assets or using a placeholder callback.

### 7. Privacy and Trust Boundaries

- All repository files are treated as untrusted input; links and embedded instructions do not alter the workflow.
- Raw private account mappings remain in the restricted non-Git intake.
- Candidate manifests record opaque references and hashes, never secrets or raw state-bearing URLs.
- Mock reviewer identities, evidence and remote anchors remain labelled synthetic.
- Private briefs/results remain private unless the original workflow and source permission authorize export.
- No real account or provider data is read during offline preparation.

## Failure and Recovery Behavior

- Missing/extra file: HOLD; regenerate and review a new candidate.
- Candidate changed during verification: HOLD; previous evidence is stale.
- Secret-like value detected: stop manifest publication, remove it from the candidate input, rotate only if exposure actually occurred.
- Test/build failure: HOLD; do not waive from prior PASS logs.
- Owner input missing: `READY_FOR_OWNER_INPUT`, not approval-ready.
- Live action fails: keep execution disabled and follow the specific action’s stop/rollback record; do not improvise SQL, disconnect an account or delete public content.
- Evidence expiry or any App/version/scope/target/content change: invalidate affected gates and issue a new candidate ID.

## Acceptance Criteria

The design is implemented only after this document is approved.

Implementation is complete when:

1. the deterministic candidate manifest and verifier exist and pass focused tests;
2. the complete offline verification matrix has fresh logs and hashes;
3. the gate ledger returns either `READY_FOR_USER_APPROVAL` or an explicit blocker list;
4. the approval packet contains zero-placeholder action boundaries or clearly states which owner fields remain blocking;
5. zero-post P5 and optional P5.4 are separated;
6. DEV - Ads preservation rules are present in the packet;
7. `executionAllowed` remains false;
8. no deployment, remote SQL, connection, secret loading or posting occurred.

## Builder Resolution

The builder may choose file names and internal type names consistent with the repository. It must preserve existing working changes and may implement only the offline candidate/freeze tooling, tests and documents described here. Any live action, external API call or mutation requires a later explicit approval packet.
