# KOCmax P5 Zero-Post Live-Run Approval Packet

Date prepared: 2026-11-07 Asia/Singapore

Status: **HOLD_WITH_BLOCKERS — review packet, live execution not authorized**

Candidate: `c14c2acc6a33b902913063dca87f3d1da0dba6462fe3997f70294f0e6785056c`

Evidence: `d99a35830a6c90340bc8ba9f53f007806d7e52923438e8f53590fc7df55a0853`

Gate result: `HOLD_WITH_BLOCKERS`

Execution allowed: **FALSE**

This packet defines the actions that could be approved later for a zero-post Instagram P5 technical pilot. No deployment, remote SQL, account creation, OAuth, secret loading, public media exposure or posting is authorized. Each scope requires explicit approval after its owner inputs and prerequisites are complete.

## Candidate Boundary

- Branch: `codex/kocmax-studio-stages-1-2`.
- Base HEAD: `e491e2dd30f42090458eacb82777d45b67275627`.
- Candidate core: `docs/review/kocmax-controlled-pilot/p5-candidate-core.json`.
- Evidence manifest: `docs/review/kocmax-controlled-pilot/p5-evidence-manifest.json`.
- Gate ledger: `docs/review/kocmax-controlled-pilot/p5-gate-ledger.md`.
- Default technical post budget: **0**.
- Real reward/proof settlement budget during P5: **0**.
- Optional P5.4 post budget remains separately controlled and is not approved here.

An approval is valid only for the candidate ID and resource/action values recorded in the final packet. Any source, dependency, SQL, App, product, version, scope, account, target, operator, content or environment change invalidates affected evidence and requires a new review.

## DEV - Ads Preservation

Existing DEV - Ads integrations are read-only during candidate preparation.

No person or automation may:

- replace or remove existing redirect destinations;
- reset App Secret, client token, system-user credentials or signing secrets;
- disconnect existing Pages, Instagram accounts or business assets;
- alter existing roles, webhooks, API defaults, HTTPS settings or products;
- reuse existing consumer callbacks for KOCmax without an explicit additive delta and consumer impact review.

Before any later Meta action, the owner must capture an exact restricted configuration inventory outside Git, identify all affected consumers, propose only the minimum additive delta, and define a delta-only rollback. Raw secrets and state-bearing URLs never enter this repository.

## Candidate Evidence

The final packet must link:

- exact candidate and evidence IDs;
- fresh test/build/type/lint outputs;
- local browser results at 320, 390, 430, 1024 and 1440;
- reviewed SQL and empty-only rollback hashes;
- configuration names and presence only, never values;
- known failures, skips or `NOT_RUN` items;
- an explicit statement that no live Meta, Auth, RLS or media check has occurred.

Mock tests can establish application logic and failure behavior. They cannot close a live gate.

### Current verification result

- Full offline Vitest run: **PASS** — 4,755 passed, 363 skipped. Live-only suites remained disabled.
- Candidate and socket-free HTTP checks: **PASS** — 33 passed. The same nine HTTP contracts also passed using a temporary listener on 127.0.0.1.
- Chrome synthetic fixtures: **PASS** — 30 role/width combinations at 320, 390, 430, 1024 and 1440 px; all six roles reloaded at 390 and 1440 px.
- TypeScript: **PASS** for the application and **PASS** for verification sources. Repository lint: **PASS** (0 errors, 8 warnings); diff check: **PASS**.
- Default-off build: **PASS**. Studio build with fixtures disabled: **PASS**. Synthetic marker scans: **PASS / PASS**. Bundle isolation: PASS — 1/1 in 46 seconds.
- PGlite schema and rollback inventory: **PASS** — 103 passed; no remote SQL executed.

Candidate and log integrity: **VERIFIED**. Live execution allowed: **false**.

The selected delta changes only the release-manifest test harness: it gives the direct `vite-node` subprocess a bounded execution window, allows the integration test enough time under full-suite load, and retries Windows cleanup briefly after a child exits. Product behavior and reviewed migration bytes are unchanged. See the [freeze evidence](p5-candidate-freeze-evidence.md) and [A-R run sheet](../../../.superpowers/sdd/2026-11-06-kocmax-real-instagram-controlled-pilot/p5-scope-a-r-c14c2acc6a33b902/run-sheet.md) for exact logs and hashes.

**Credential remediation:** the exposed Remix-Adfocate database login was rotated once through the authenticated Supabase dashboard. The replacement is stored in Windows Credential Manager under `KOCmax/Remix-Adfocate/database` for the approved project role. It was not printed, added to Git-tracked files or placed in process environment variables. Local syntax, stored-credential, wrong-target rejection and leak checks passed without Docker, TLS or database access.

Physical iOS/Android testing, hosted Auth/RLS, target restore, Meta OAuth/revocation and media-origin checks have not run. See the [gate ledger](p5-gate-ledger.md) for the live and owner prerequisites.

## Scope A — Restore and Database

**A-R remains on hold (B6: NOT_RUN).** No source backup or restore was run. The earlier rehearsal-only approval is recorded for the archived candidate. This fingerprint has no live authorization. See the [rehearsal runbook](p5-scope-a-backup-restore-rehearsal.md) and [preflight record](p5-scope-a-r-preflight.md) for the outstanding workstation, encryption, egress, reviewer and window requirements. A.4/A.5 remain separately unapproved.

Requested authority when complete: perform one current target backup/restore rehearsal and apply the exact reviewed additive SQL transaction to the named pilot target with provider writes disabled.

| Item | Required exact value | Current state |
| --- | --- | --- |
| Database target | Existing Remix-Adfocate project/ref and nonpilot impact acknowledgement | Target alias selected; restore proof absent |
| Restore destination | Named isolated destination controlled by the DB operator | OWNER_INPUT_REQUIRED |
| Backup | Current encrypted backup, checksum, inventory and capture time | NOT_RUN |
| SQL | `native-offline-bundle.sql` | SHA-256 `05c268bdd175e07efb23d60e49a23d0c46d1769dadd6bf96357ebca259d5725b`; reviewed locally, unapplied |
| Rollback | `native-offline-rollback.sql` with empty-only stop conditions | SHA-256 `89eff8ab00c42a9e8eecd842f70deeab267ac7afc34b1d7ae1959677923689a1`; reviewed locally, unapplied |
| Inventory | Before/after schema, ACL, RLS, migration and index inventory | NOT_RUN |
| Window and ceiling | Start/end, maintenance window and cost ceiling | OWNER_INPUT_REQUIRED |

Execution order (P5.1; DB operator and reviewer):

1. A.1 — Capture the restricted before inventory and current backup.
2. A.2 — Restore and verify the original task, proof, approval, reward, wallet and schema/ACL boundaries in the isolated destination.
3. A.3 — Review shared-target impact and the nonpilot baseline.
4. A.4 — Apply the exact hash-approved transaction once.
5. A.5 — Read back objects, ACL, RLS, indexes and unchanged nonpilot invariants. Stop on mismatch and use the reviewed rollback decision.

**Approval A:** `[ ] NOT APPROVED`

## Scope B — Protected Runtime and Application Authorization

Requested authority when complete: deploy the immutable candidate to one protected pilot URL with provider transport disabled and run the named nine-role plus anonymous authorization matrix.

| Item | Requirement | Current state |
| --- | --- | --- |
| Candidate | Exact candidate ID at the top of this packet, with the Scope A SQL hashes above | Frozen locally; hosted proof pending |
| Runtime | Protected HTTPS origin, route mount and hosting target | OWNER_INPUT_REQUIRED |
| Worker identity | Scoped identity and permissions; provider writes disabled | OWNER_INPUT_REQUIRED |
| Accounts | Private alias mapping for C1-test, C-peer, C-other, B-owner, B-member, R-reviewer, O-operator, A-admin and F-finance | OWNER_INPUT_REQUIRED |
| Cleanup | Exact run/workspace/Auth IDs and deletion order | OWNER_INPUT_REQUIRED |

Required checks (P5.2; engineer, QA and security):

- B.1 — Start only the protected deployment with provider writes disabled; verify private/default-disabled responses and no credential exposure in URLs, logs or browser state.
- B.2 — Run the nine-role plus anonymous matrix, including direct API/RPC/RLS denial, same-workspace peer and cross-workspace denial, and owner-only media, collections, receipts and proof.
- B.3 — Check stale session, sign-out, refresh replay, two tabs, Back/Forward/reload and workspace switching.
- B.4 — Recheck original visitor, task, manual proof, review, reward handoff, wallet, brand and operator journeys with zero real P5 rewards.

**Approval B:** `[ ] NOT APPROVED`

## Scope C — OAuth and Media Lifecycle

Requested authority when complete: connect the named technical account through the approved DEV - Ads product, test consent/denial/revoke behavior and expose only a rights-cleared technical JPEG to the narrow provider-fetch path. Container creation and publishing remain enabled=false.

| Item | Requirement | Current state |
| --- | --- | --- |
| App/product/version | Verified DEV - Ads product, access eligibility and pinned API version | DEV - Ads proposed; product/version/eligibility evidence pending |
| Configuration delta | Restricted before snapshot, additive redirect/callback delta and existing-consumer regression | OWNER_INPUT_REQUIRED |
| Technical account | T-IG consenting owner, professional account, linked Page and immutable IDs | Proposed: 50+友 and @50addoil; consent, eligibility and immutable identities NOT_RUN |
| Negative account | Separate T-negative/wrong-account/denied-scope check | OWNER_INPUT_REQUIRED |
| Scopes | Requested/granted/denied minimum scopes recorded independently | NOT_RUN |
| Callback identity | One-use state, session/product binding, exact redirect allowlist and signed callback validation | NO REAL TEST |
| Revocation | Local stop, provider request where available and independent readback kept distinct | NO REAL TEST |
| Media | Exact JPEG bytes/hash/dimensions, HTTPS origin, no-store, TTL ≤900 seconds and purge/denial readback | Local mock verified; exact live origin, approved JPEG and external verifier pending |

Execution order (P5.3; Meta owner, technical account owner, security and privacy):

1. C.1 — Review the restricted configuration snapshot and additive delta; confirm existing DEV - Ads consumers still work.
2. C.2 — Run consent, wrong-account, denied-scope, replay, revoke and signed-notice cases with exact App/product/account binding.
3. C.3 — Verify the approved JPEG lease, expiry, terminal denial and purge from the named verifier.
4. C.4 — Close out with zero containers, posts and real rewards; actual Meta media fetch and rendered label stay outside the zero-post run.

Required stop conditions:

- wrong App/product/account/Page/IG identity;
- missing/denied required scope;
- replayable state or callback;
- private-source/token exposure;
- public media remains readable after terminal/expiry state;
- failed revoke/cleanup;
- any container or publication count above zero.

**Approval C:** `[ ] NOT APPROVED`

## Appendix D — Optional Single Technical Post

This appendix is excluded from zero-post P5 and cannot be activated by approval of A, B or C.

Requested authority only after separate review: one exact public technical post to T-IG, zero technical reward, no brand payment and no C2–C5 expansion.

| Item | Required exact value | Current state |
| --- | --- | --- |
| Account | Immutable T-IG identity | NOT_SUPPLIED FOR POST |
| Image | Final JPEG bytes/hash/dimensions and rights evidence | NOT_SUPPLIED |
| Caption | Exact caption/hash and UTF-8/length validation | NOT_SUPPLIED |
| Sponsor label | Exact disclosure/partnership label and rendered expectation | NOT_SUPPLIED |
| Approval | Creator per-post consent, one-use session/nonce, posting window | NOT_SUPPLIED |
| Recovery | One known intent, no blind retry, read-only known-ID recovery | OFFLINE ONLY |
| Cleanup | Media expiry/purge and separate public-deletion decision | NOT_SUPPLIED |

**Approval D:** `[ ] NOT APPROVED`

If separately approved, D.1 binds the exact account, image, caption, label and window; D.2 allows one confirmed durable intent; D.3 limits recovery to known-ID readback and records cleanup. The zero-post packet grants none of these actions.

## Stop and Rollback

On any failure:

1. Disable pilot admission and provider writes first.
2. Fence current grant generations and worker claims.
3. Preserve accepted media IDs, receipts, reservations and unknown outcomes.
4. Close media leases and verify origin/cache denial.
5. Roll application back to the previous reviewed artifact with pilot disabled.
6. Prefer disabling over down-migration. Database rollback is empty-only and refuses retained evidence.
7. Treat local stop and confirmed provider revocation as separate states.
8. Do not claim local rollback deletes a public post; public deletion requires the account holder’s separate decision and approval.

## Approval Record

No live action has been approved for this candidate.

Store live logs and exact account or target identifiers in the restricted pilot run evidence directory named by the owners. Keep the repository's evidence index limited to aliases, outcomes and hashes. Before any live action, complete the operational roster, cost ceiling, time window, retention and cleanup assignment.

| Scope | Approver | Timestamp | Exact resources/hashes reviewed | Result |
| --- | --- | --- | --- | --- |
| A | — | — | — | NOT APPROVED |
| B | — | — | — | NOT APPROVED |
| C | — | — | — | NOT APPROVED |
| D | — | — | — | NOT APPROVED |

The user may approve scopes separately after all required values are concrete. Approval must name the exact candidate ID, action, resources, costs, window, operators, evidence hashes and exclusions. “Continue” alone is not approval.
