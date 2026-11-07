# Database application completion

**Completed:** `APPLIED_AND_READ_ONLY_POSTCONDITIONS_PASSED` for existing Remix-Adfocate `mhkoayftiuojxlrkollf`. Migration `20261031201901` / `kocmax_studio_shared_review_c879b204` is recorded in the [application receipt](application-receipt.json) and [application manifest](application-manifest.json). This documentation update performs no database action.

V3 backup attempt `20261031T194921Z-932d4da79f9741b7b87a26a186b34831` passed capture, full archive read and disposable restore. The [backup verification receipt](backup-verification-receipt.json) records each stage. Private archives and their hashes are unchanged; the immutable capture-time restore NOT_RUN and full-read NOT_TESTED statuses remain historical, while the separate receipt proves the later restore.

The first application request ended with connector confirmation expiry. Before the second request, the parent rechecked that the original schema, all 14 history records and 39 original-table fingerprints were unchanged. The second request succeeded with the exact 775,304-byte approved artifact, SHA-256 `9cbecbf1b4b68c476ed8d996f8f3d1c61408e46986584c22ab0111788cd9e5a5`. The original packet and source migrations were untouched.

Postconditions passed: 55 new tables empty; new public-table RLS enabled; two new private asset buckets limited to 20 MiB each; direct private credential/source-write denials preserved. Application schema totals are 94 tables (80 public / 14 private), 987 columns, 86 policies and 192 non-extension functions. The original 39 tables / 400 columns retain exact row counts and opaque content hashes. All 14 original migration records remain plus exactly one named migration `20261031201901` / `kocmax_studio_shared_review_c879b204`.

See [application receipt](application-receipt.json), [application manifest](application-manifest.json) and [original-data after evidence](existing-data-after.json). The 62-file source envelope is not represented as 62 newly pending or separately replayed migration records.

The [existing-data-after.json](existing-data-after.json) evidence records unchanged original-table counts and opaque hashes; no customer rows are published here.

## Restore scope

The disposable restore recovered all archive entries and matched exact row counts and opaque hashes across the source 39 public tables / 400 original columns. Restored metadata: 39 public tables, 27 auth tables, 8 storage tables, 54 public policies, 7 event triggers and 14 migration-history rows. Auth/Storage and other schemas restored without native errors but were not independently row-hashed.

Source bootstrap identity `supabase_admin` at OID 10 was required: a different bootstrap identity failed the auth grantor semantics. Only the redundant `CREATE ROLE supabase_admin` was omitted from a local tmpfs roles copy; every ALTER, GRANT and original grantor was retained. Source Supautils session preload and privileged role `supabase_privileged_role` were supplied only in the disposable environment.

Native base restore covered all entries except event triggers, then all 7 event-trigger entries were restored under their original owners via session authorization. The two TOC selections formed an exact union, every entry once. This archive had no MATERIALIZED VIEW DATA entries, making this ordering valid for this archive; it is not a universal ordering shortcut. All restore containers had network none, no published ports, tmpfs storage and no source credentials, and were destroyed. The source backup mount stayed read-only.

Storage object bytes, role passwords, platform settings, encryption root keys and hosted Auth/Storage/provider recovery remain outside this logical restore evidence.

## Remaining advisor findings

The [advisors comparison](advisors-comparison.json) is not all clear:

| Finding | Before → after | Status |
|---|---|---|
| Authenticated SECURITY DEFINER warnings | 10 → 19 (+9) | All nine added functions have fixed empty search_path and anon EXECUTE false. Bounded static review found intentional, guarded authenticated entrypoints and no concrete unexpected exposure. Real-JWT/runtime authorization remains untested. |
| RLS enabled without policy, INFO | 7 → 28 (+21) | Retained for review. |
| Unindexed foreign keys, INFO | 33 → 121 | Retained for review. |
| Unused indexes, INFO | 15 → 77 | Retained for review. |
| Auth RLS initplan warnings | 43 → 41 | Two fewer findings; remaining findings retained. |
| Duplicate index warning | 0 → 1 | `creators_id_workspace_unique` / `integration_creator_workspace_key` on creators. Neither index was dropped; constraint/dependency review is required before any separate change. |

Other recorded advisor findings remain in the receipt/comparison. No warning-cleared claim or unapproved remediation is made.

Static-review limits include global Academy content, self-attested lesson progress and a retained redemption-helper dependency. No SQL change was made solely to silence these advisor warnings.

The [RPC guard review](rpc-advisory-review.md) records each entrypoint and its limits. Supabase references: [authenticated SECURITY DEFINER advisory](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [duplicate-index advisory](https://supabase.com/docs/guides/database/database-linter?lint=0009_duplicate_index). Removing an index still requires checking its constraints and foreign-key dependencies; neither was removed here.

Advisor findings remain open; see [advisors comparison](advisors-comparison.json). No deployment, real Instagram/Drive connection, external AI, pilot enablement, Auth account creation or persistent browser fixture occurred. Mobile/desktop evidence remains local mock/read-only D0 evidence, not real Auth/JWT tenant acceptance. The existing 31 mock tests remain their original evidence layer. A fresh post-application in-app-browser check passed at 390×844 and 1440×1000, with real-provider buttons disabled and no horizontal document overflow. No source/Brief save, fixture record write or reward action occurred. The post-application mobile screenshot is available; the new desktop capture was cropped and its full-page retry failed, so only the desktop DOM checks and earlier complete screenshot are claimed. See [UI verification](ui-verification.md).
