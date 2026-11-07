# Private receipt and OAuth mock acceptance — 2026-11-06

Later closeout: [release and recovery acceptance](release-recovery-closeout.md) supersedes the eight release failures, current preview port and unresolved local recovery disposition recorded below. The historical run remains unchanged as evidence. Original bytes are preserved; only visible rows were recovered to a stopped copy. Real-pilot readiness remains BLOCKED.

Requested local mock composition: PASS. Whole live-pilot readiness: BLOCKED.
Branch remains `codex/kocmax-studio-stages-1-2`, HEAD `e491e2dd30f42090458eacb82777d45b67275627`. Changes are unstaged. No deployment, remote SQL, real connection or real publication.

## Delivered

- Local PGlite private receipt storage reuses StudioBrief, StudioSource, SavedOutputCards and copySavedBrief contracts. Explicit receipt-save consent, exact approved-content fingerprint, idempotent save, source lineage, version preview/copy/edit/save. Copies have no approval, publishing authority or reward entitlement.
- Separate Facebook-product mock authorization: fixed fixture account, exact minimal fixture scopes, expiring session-bound one-use state, transactional replay protection, grant generation and local revoke. No provider URL, token or external transport is constructed. Existing Instagram Login coordinator remains unchanged.
- Private API denies colleagues, other workspaces and staff personas. Local revoke hides source-derived text on the server, removes the current draft and disables copies, while retaining publication and original settlement history. Provider revocation remains unverified.
- Independent Lagrange review found one Important fixed-session issue. Fixture sessions now survive reload but rotate on logout/persona changes; stale responses return401. Regression observed RED then GREEN. This is not real authentication evidence.

## Direct browser acceptance

In-app browser, local HTTP service, submission1931/version1951, new synthetic database `.superpowers/controlled-pilot-private-acceptance-db`:

1. Unconnected initial state; authorization confirmation disabled until explicit consent.
2. Approved JPEG/caption/account/disclosure preview, then explicit mock publication. Request suffix `4cdadc1d`.
3. Explicit private receipt save creates v1; copy/edit/save creates v2 with retained private source. Reload retains both versions.
4. Creator submits proof; Reviewer verifies; Operator hands off; Admin invokes original settlement. Zero points before settlement, then400 mock points and exactly1 ledger record.
5. Vite exited normally using `q` plus Enter, restarted against the same database, and browser reloaded: same request, two versions, copied draft, connected mock grant,400 points/1 ledger persisted.
6. Local revoke: source-derived text hidden, v2 copy disabled, zero draft textareas. Previously published history remains.
7. Reviewer and same-workspace/cross-workspace creator views contain zero private panels. Logout followed by Back and Reload contains zero private panels/drafts.
8. Widths320/390/430/1024/1440: no horizontal overflow. Mobile and desktop screenshots: `private-mobile.png`, `private-desktop.png`.

These are fixture personas, not hosted Auth/RLS acceptance. Staff role changes rotate the mock session. Original ready-asset attachment remains a previously documented limitation; this scenario begins with an already approved synthetic work item.

## Local preview incident and retained evidence

The previous `controlled-pilot-local-v2-db` no longer matched its historical browser acceptance: current SQL readback found the same intent in creator_approved and no visible worker checkpoint. An INSERT waited indefinitely while inserting an index tuple. Adding a local statement timeout produced57014 rather than hanging. A retained copy at `controlled-pilot-recovery-20261106-db` also timed out on REINDEX. No successful repair is claimed, and neither directory was deleted or reset. Exact crash/concurrency cause remains unresolved.

This supersedes any claim that the *old database's current state* still proves publication/settlement continuity. The new complete browser run above is independent evidence, not an assertion that old data was recovered. Diagnostic scripts are retained under `.superpowers/sdd/2026-11-06-kocmax-controlled-instagram-pilot/`.

Local runtime now fails closed after a5-second SQL statement or2-second lock wait. Vite awaits database close, excludes evidence artifacts from watching, and accepts `KOCMAX_LOCAL_PILOT_DIRECTORY` only through the existing `.superpowers`-confined runtime path validation. Do not silently reset a damaged database. Use normal `q` shutdown before reopening a database; never open one directory concurrently.

The active preview uses port8797 and the new explicit directory. The default old directory is retained for investigation, not acceptance. A fresh preview also required an unsandboxed loopback listener; no firewall/security setting was changed.

## Verification

Evidence logs are under `.superpowers/sdd/2026-11-06-kocmax-controlled-instagram-pilot/`.

| Check | Result |
|---|---|
| Final pilot/private/session/SavedOutputCards focused run |22 files,119 tests PASS (`private-final-regressions.log`) |
| Full repository run |405 passed files,6 failed,44 skipped;4509 tests passed,17 failed,363 skipped (`private-full-suite.log`) |
| Local transport follow-up outside sandbox |2 files,9/9 PASS (`private-transport-unsandboxed.log`); full-run EACCES failures were environmental |
| Remaining full-run failures |8 release manifest/package/preflight assertions: two unclassified unapplied migrations and capability count620 vs633. Release remains blocked; no manifest was weakened to hide this |
| TypeScript and production builds |Opt-in Studio and default-off build PASS; includes tsc --noEmit |
| Production isolation |Both builds: zero matches for nine synthetic/mock markers, including controlled-pilot-mock and the private mock table |
| Scoped lint |0 errors,2 existing effect-ref warnings |
| Preservation |721/727 baseline hashes identical; six intentional edits listed in private-preservation-check.json; no staged changes; git diff --check PASS |

Do not aggregate focused reruns into a full-suite PASS.

## Remaining gates

This closes private receipt and OAuth **mock** composition. It does not close provider product/identity/label/revocation evidence, production authenticated authority composition, hosted Auth/RLS, actual media-host access/purge, release manifest classification, or recovery of the old local database. Real pilot approval and all external operations remain separate. The launch packet remains BLOCKED.
