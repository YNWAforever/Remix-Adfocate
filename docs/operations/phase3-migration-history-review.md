# Phase 3 migration history and assignment-XP review

Status: preparation only. No production migration, history repair, mission,
assignment, or reward action was performed by this review. Production remains
on its existing assignment-XP behavior until the new migration is separately
reviewed and applied. The pilot remains HOLD.

## What the history difference means

The 2026-11-13 read-only catalog capture found 17 recorded migration versions.
The new checkout has 67 feature-manifest versions, including the proposed XP
fix: two match recorded versions and 65 have no individual history row.

This is primarily an intentional deployment-profile difference, not evidence
that 65 migrations should be replayed:

| Group | Versions | Evidence and treatment |
| --- | --- | --- |
| Reviewed shared-target source envelope | 62 | Applied as one derived packet, recorded as `20261031201901`; preserve that record and its original history policy |
| Individually recorded feature migrations | 2 | `20261101075946` auth boundary and `20261113090000` creator resubmission |
| Other private feature schema | 2 | `20261103215321` creator growth and `20261104134202` publish intents have no history row and their listed object names were not observed; do not add these to a pilot fix implicitly |
| Proposed assignment-XP fix | 1 | `20261113090001`; prepared and tested, not applied |

The other 15 history rows sit outside the feature manifest: fourteen earlier
baseline records and the combined packet. Their absence from this manifest does
not make them unreviewed. Some baseline history names include their original
numeric filename prefix; the audit lists those as comparison candidates only.

The [approved application manifest](../review/kocmax-stage-4d/d1/shared-database/execution/application-manifest.json)
explicitly says: **"One new named migration; preserve 14 previous entries. Never
claim the 62 raw source files were applied unmodified."** Its
[completion report](../review/kocmax-stage-4d/d1/shared-database/execution/completion-report.md)
records the approved derived SQL and overlays. The current recorded name and
archived one-statement SHA-256 match that receipt:

```text
version: 20261031201901
name: kocmax_studio_shared_review_c879b204
archived applied SQL SHA-256:
9cbecbf1b4b68c476ed8d996f8f3d1c61408e46986584c22ab0111788cd9e5a5
```

The reviewed inner payload hash `c879b204...` and the applied wrapper hash above
identify different artifacts. Neither is a current release-approval digest.
Historical backup/restore receipts establish their original execution only;
they do not replace a fresh recovery plan for a new production change.

## Non-mutating audit tool

[history-audit-capture.sql](../../scripts/release/history-audit-capture.sql)
is a single catalog/history SELECT for an operator-controlled driver. Establish
the connection identity independently, verify the server certificate, begin a
repeatable-read READ ONLY transaction, bind the exact project reference as `$1`,
set a short local statement timeout, execute the query, then ROLLBACK. The
supplied reference is a label; it does not itself attest the connection target.

The query exports names/counts/hashes only. Archived statements are hashed in
the database, never returned. It reads no creator rows, proof URLs, reviewer
notes, credentials, or account data.

The offline analyzer has no database client or network/write-to-database path:

```powershell
npx vite-node --script scripts/release/history-audit.ts --snapshot <sanitized-snapshot.json> --project-ref mhkoayftiuojxlrkollf --output <new-report.json>
```

The output parent must already exist. The analyzer verifies the project label,
read-only flag, strict input fields, duplicate versions, and source hashes
against the manifest. It refuses apply flags, existing output files, and output
inside migrations, including through a directory symlink or junction. Source
hashing uses the manifest's LF/CRLF/lone-CR normalization.

Every report is explicitly **HOLD**. Object existence is a review lead, not a
schema fingerprint, ACL/policy/body verification, or proof of execution. Trigger
names may be recorded as schema/name in older manifest entries; capture records
the table too and the analyzer matches those forms within the same schema.
Unsupported capability checks remain unchecked. Do not treat a bare function's
presence as proof that a replacement function body was installed.

## Proposed XP correction

The new [forward migration](../../supabase/migrations/20261113090001_active_assignment_xp_neutrality.sql)
changes only two assignment primitives, reasserting their existing ACLs:

- `private.join_mission(uuid)` uses the mode returned by the existing atomic
  capacity update. An active-workspace assignment starts with `xp_awarded=0`
  and does not update creator XP. Legacy/NULL modes retain the +10 award.
- `public.accept_application(uuid)` changes active assignment status without
  adding or subtracting XP. Existing earned anchor XP is preserved; legacy
  acceptance keeps the one-time +10 award and the joined replay is unchanged.

The latest staff decision wrapper, workflow creation, reward contract, observer,
quota enforcement, tenant/staff gates, and reward-settlement paths are not
rewritten. Existing balances and historical submissions are not backfilled.

A separate read-only production check matched the entire current function body
hash for each replaced primitive to its canonical predecessor. Existing owner,
SECURITY DEFINER setting, `search_path=public`, and role EXECUTE booleans were
recorded; the new migration preserves those settings. This is pre-change
compatibility evidence, not confirmation that the new code is live.

The pinned CLI generated the migration file. Its generated UTC timestamp fell
before the already-recorded future-stamped `20261113090000` head, so the new file
was deliberately placed at `20261113090001`. This avoids requiring a retroactive
`--include-all` insertion; no older migration was renamed or edited.

## Recovery and release path

1. Preserve the fourteen baseline records, combined-packet history, auth-boundary
   record, and creator-resubmission record. Do not insert 62 synthetic source
   history rows or use migration repair to make raw history appear complete.
2. Define and review the actual production baseline as the approved combined
   packet plus its individually approved successors. Verify current function
   definitions, policies, ACLs, constraints, storage configuration, and current
   schema fingerprint; object names alone are insufficient.
3. Keep the two absent private feature groups outside this narrowly scoped
   assignment-XP change. Their activation needs its own reviewed delta and
   dependency/recovery evidence.
4. Prepare the smallest forward delta containing the new XP correction, with
   explicit current-body/ACL preconditions, source checksum, postflight checks,
   and one new history record. A baseline-aware release/rehearsal profile must
   be reviewed before using the protected executor. The existing raw-migrations
   push is not made safe by this audit and was not run against production.
5. Rehearse the exact approved delta against disposable empty and
   production-shaped targets, obtain a current recovery reference and
   containment ownership, verify the deployed commit, and generate fresh
   expiring release evidence. Do not copy an old report hash into approval.
6. Obtain the exact concrete release approval only after those gates pass.
   Pilot enablement still needs its separate exact workspace/mission approval,
   and publication/admission/creator actions remain separately scoped as in the
   [pilot runbook](phase3-pilot-rollout.md).

## Validation and limits

The assignment fix has executable PGlite coverage for active neutrality, prior
XP preservation, legacy +10, role/tenant gates, capacity/replay, frozen reward
contracts, and rollback on workflow/contract/audit failures. Three additional
integration cases cover real-client capacity races and acceptance; they are
registered in the loopback integration runner. PGlite is not hosted Auth/RLS or
independent-session concurrency evidence.

The history tool has regression coverage for project substitution, raw/extra
fields, duplicate versions, source drift, recorded-name candidates, trigger
aliases, line endings, output overwrite/apply refusal, and junction containment.
See the [dated review summary](../verification/2026-11-13-phase3-migration-history.json)
for the exact observed counts, source hashes, proposed migration, and remaining
gates. It is a review artifact, not an approval bundle.
