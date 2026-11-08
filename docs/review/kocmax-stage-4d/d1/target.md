# D1 target record

Updated 2026-10-31. User approved isolated D1 setup on `codex/kocmax-studio-stages-1-2`, baseline `5c60020091e8e6fee934b61c498bf7518944c433`. Real Instagram/Drive connections and production deployment remain disabled. This record contains no credentials.

**Latest steering:** the user explicitly selected the existing Supabase project `mhkoayftiuojxlrkollf` itself, then requested an impact assessment **before confirmation**. A paid child branch was not approved or created. See [existing-database-impact.md](existing-database-impact.md). Existing-project writes remain unapproved; original isolated D1 acceptance cannot be reused for a shared database.

## Read-only resource discovery

| Resource | Observed metadata | Decision |
| --- | --- | --- |
| Vercel team | `team_qvzlsFmfCsLkgItSypqHjw3z`, `ynwaforevers-projects` | Candidate owner; not an approved new resource or billing limit |
| Existing Vercel projects | `kocmax` (`prj_1kjq3IJGCYVzlGnxRlzUpypJeMg5`), `kocmax2` (`prj_7zxcc1I7x6lAOHIEVCCCAX0nh6hO`), `adfocate-2` (`prj_tBHX5vuMvZ4dEbQJpzhkM3VRJd0g`), `adfocate-site` (`prj_xHgVQRoZheStpNLVAUMZvq2p9R11`) | Existing products; excluded from isolated pilot targets |
| Supabase organization | `eerkaskxrxxfrtgetuqx`, willylai@fimmick.com's Org | Parent ownership verified; proposed branch cost was not approved |
| Existing database | `Remix-Adfocate`, `mhkoayftiuojxlrkollf`, `ap-northeast-1`, ACTIVE_HEALTHY | User-selected candidate for a shared pilot, pending impact confirmation. Original isolated D1 gate rejects it. Never cloned or used for D1 writes/tests |
| New pilot | No matching `kocmax-integrations-pilot` in the inspected inventories | Not provisioned |

Only project metadata, migration history and relevant schema catalog metadata were read. No application rows or secrets were read and no remote mutation occurred. These checks do not establish isolation or ordinary-user permission acceptance.

## Values still required before cloud mutation

For a new isolated target, the original requirements remain: owner organization, spending ceiling and quote acknowledgement; approved hosting/DB regions; exact HTTPS preview origin; named fixture actors and cleanup owner. For the proposed shared database, replace that execution plan with a reviewed schema reconciliation, exact SQL/write inventory, limited acceptance and cleanup scope. Selection of the existing project alone does not authorize these changes. Google/Meta project/client IDs are not invented or copied from existing applications.

App, DB, logs and backup locations must be recorded separately. Tokyo in the existing product's metadata is not evidence of a new pilot region, nor Hong Kong processing.

The parent project/organization is now known. The user requested direct existing-project impact review instead of the proposed paid child branch. No provisioning/deployment or application-data write was attempted. The alternative needs a scoped migration/data-writing decision after review.

## Hosting constraints verified from current documentation

Vercel protection is in front of the application and can intercept callbacks; a successful app route unit test cannot prove callback accessibility. No protection bypass secret may appear in an OAuth URL. See [deployment protection](https://vercel.com/docs/deployment-protection).

Hobby cron has a daily minimum interval, so it cannot meet the planned hourly retention cadence. Preview scheduling and a separately approved scheduler must be verified before claiming the hourly target. No plan upgrade or production deployment will be used to satisfy it. See [cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing).

## Runtime evidence

Remote Auth/JWT/RLS, two independent DB connections, actual worker packaging, host logs, maintenance scheduling, backup horizon and restore quarantine: **NOT RUN**. A shared-target plan must explicitly state which checks can run safely; whole-database restore and destructive drills remain excluded from the existing product database. Local fixture results are recorded in `verification.md` and do not clear original D1 isolation requirements.
# Latest preparation checkpoint — 2026-10-31

The user approved preparing SQL, test data and rollback for existing `mhkoayftiuojxlrkollf`, with no database application, deployment or real connections. See [the concrete review packet](shared-database/README.md). Read-only catalog/privilege guards and four aggregate data checks passed; exact mutation payload and fixtures were rehearsed only in disposable memory. Neither the existing-project runtime denial nor the original isolated-pilot requirements were changed. Approval to prepare is not approval to execute or a target acceptance receipt.

