# P5 Scope A-R — preflight record

**Date:** 2026-11-07 (Hong Kong time)  
**Approved scope:** A-R only. **Production backup and restore: NOT_RUN.** The 120-minute execution window did not start.

The [approved rehearsal plan](p5-scope-a-backup-restore-rehearsal.md) requires 10 GiB free on encrypted storage, a verified unused uncached egress allowance of at least 2 GB, and named operators and a window. Read-only Supabase management metadata confirmed Remix-Adfocate (`mhkoayftiuojxlrkollf`), its region, and the owning organization's Free plan. No PostgreSQL session was opened to the source. No project settings, schema, data, accounts or integrations were changed.

| Check | Result |
| --- | --- |
| Workstation and capacity | `DESKTOP-30TFME5`, Windows session `laich`, private backup destination on `C:`. **3.11 GiB** available at 15:59 HKT; required **10 GiB**. No other local volume was reported. |
| Encryption | **UNVERIFIED.** Windows denied this account's read-only BitLocker status queries. The location and encryption of the Docker data volume also need confirmation. |
| Egress | **UNVERIFIED.** The authenticated connector returned Free plan metadata but no current-cycle usage. The signed-in dashboard was not accessible from the browser tools. An owner still needs to confirm headroom for the entire organization and the planned window. |
| Operator, reviewer, window | Willy Lai was proposed as operator on the identified workstation. The operator and independent reviewer have not been confirmed, and no two-hour window has started. |
| Tool identity | Both previously pinned Docker images are installed on the local Linux engine. The pinned CA file SHA-256 matches the runbook. Source TLS and source compatibility checks were not performed. |
| Synthetic snapshot and restore | **PASS.** A write committed after snapshot export did not enter the restored data. A sequence change was checked against the archive's sequence entry. Row and catalog comparisons detected intentional ACL, column default, role, membership and large-object changes. The synthetic owner/peer/cross-workspace/anonymous checks and finance read-only check passed. |
| Synthetic transfer cutoff | **PASS (2 checks).** One aggregate loopback counter stopped both sessions exactly at the cutoff without forwarding that chunk; a third concurrent connection was denied. |
| Synthetic Docker isolation | **PASS.** The worker on an isolated internal bridge reached the relay through a fixed sidecar and failed to connect directly to the same host endpoint. No published ports. The automatic Docker address pools were exhausted; two small private test subnets were checked against Docker allocations and Windows routes before use. All run-owned networks and containers were removed and absence read back. |

The synthetic components are under `.superpowers/p5-scope-a-r/preflight/`. They contain no production data or credentials. The probes verify their named cases, not live source TLS, the actual egress allowance, provider-side byte accounting, or a current restore point. Before a live capture, bind the reviewed coordinator and TLS route to the confirmed run sheet, retain margin for upstream bytes received before a socket closes, and verify the exact endpoint and isolation again. No backup exists for this A-R attempt. **B6 stays `NOT_RUN`; no live or SQL gate changes.**
