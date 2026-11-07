# Cleanup manifest — review only

No external resource or account was created by this stage. No deletion is authorized or executed here.

| Resource | Current disposition |
| --- | --- |
| In-process PGlite test databases | Closed by test teardown; synthetic only |
| Vite memory fixture intents/previews | Retained while preview runs; process restart resets them, not a verified cleanup mechanism |
| Synthetic screenshots/tests/SQL/logs | Retain as review evidence in this branch |
| Unknown/known-media job tombstones | Hold; never delete to make a retry possible |
| Original mission/proof/ledger rows | Untouched; never include in blanket cleanup |
| Instagram posts/grants / Google Drive | None created |

Pure cleanup planner produces eligibility only for explicitly identified closed synthetic diagnostics/test records beyond retention. It never executes deletion and cannot erase financial, mission, publication or unresolved records. A future live manifest must include exact IDs, ownership, run, reasons, retention, before/after counts and separately authorized actions; secrets/private evidence stay outside Git.
