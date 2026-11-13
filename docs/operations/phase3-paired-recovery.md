# Paired-snapshot recovery preparation

Status: **HOLD for live release and pilot enablement.** This producer records scoped facts about a private archive and an isolated restore. It creates no owner acceptance, accepted RPO, final `DeltaRecoveryProof`, approval, production SQL mutation or pilot authority. The protected v2 executor, sixteen gates, complete fingerprints and outer-bundle approval remain unchanged.

The merged protected release path needs its recovery archive and `equivalence.sourceBefore` to refer to the same exported database snapshot. A historical logical backup, a later schema-only observation, or a synthetic native fixture cannot establish this relationship for a live release. Use the new observation only as input to independently reviewed complete equivalence, recovery coverage, time budgets and provider reports.

## Capture and restore protocol

1. Bind the immutable source revision, exact project route, scope and expected seventeen-row baseline root, collector/normalizer bytes, pinned tool profile, finite capture/restore budgets and expiry. The managed adapter keeps its fixed `mhkoayftiuojxlrkollf` direct/session-5432 route and verify-full pinned CA; it verifies recovery bindings before opening a source client.
2. Open one repeatable-read, read-only source backend. Export its actual snapshot, backend PID and database-clock observation time. The observation time stays fixed for that snapshot; a slow export does not renew its age. Query only the fixed semantic and portable-data collectors.
3. Import the same actual snapshot into both schema-only `pg_dump` and the complete custom-format archive. Capture roles with the pinned `pg_dumpall --roles-only --no-role-passwords`, which does not include role credentials. Run unfiltered `pg_restore --list` against the actual archive. No table, schema, section, privilege or owner exclusion is accepted.
4. Compare all source semantic components and complete portable table/sequence state before and after capture. Separately begin fresh RO backends for shared role/membership and database-role settings: the exporter's old RR view cannot prove those catalogs stayed unchanged. Compare those fresh digests to the exported-snapshot components before and after the export. Named change control is still required; snapshot sampling does not freeze other writers, DDL, deployments or configuration.
5. Exclusively write `database.dump`, `roles.sql`, `toc.list` into a new private attempt. Rehash actual bytes before restore. Raw archives, SQL, TOC contents and row values are never public report fields. A failed attempt is retained privately and is not promoted or overwritten.
6. Close the source RO transaction before creating the owned restore target. Restore into a nonce/image/namespace-inspected disposable PG17 server, with no host mounts, published ports or external network. Restore roles, owners, ACLs, schema, data and sequence state; no error-ignore or privilege-disable fallback is used. Recapture the complete semantic and portable-data fingerprints and require equality to the paired source.
7. Confirm owned target cleanup before sealing the private canonical manifest. Produce a sanitized `paired-snapshot-recovery-observation`, permanently marked `status: HOLD` and `validReleaseEvidence: false`. Containment remains required if any owned namespace or source session cleanup is unacknowledged. Private artifact retention and operational restore are separate responsibilities.

The native fixture bootstrap is deliberately scoped: it starts with a fixture superuser `postgres` and removes only the exact duplicate `CREATE ROLE "postgres";` emitted for that already-existing bootstrap role; its following attributes, grants and the complete role fingerprint remain checked. This native bootstrap is not a claim that the managed platform's roles, Auth service, credentials or keys have been recovered. A live platform restore requires its independently reviewed target bootstrap and provider coverage.

## Portable data coverage

The SQL collector runs only inside caller-owned PG17 RR/read-only transactions. It enumerates every stored user or extension relation, including Auth, Storage and Vault tables. It uses `ONLY` to prevent inheritance/partition double counting and preserves duplicate rows, nulls, JSON text/duplicate keys, scalar binary values, array dimensions/lower bounds and element payloads. Logical type and column metadata are bound without cross-cluster physical OIDs. Array wire-header element IDs and optional physical null-bitmap flags are canonicalized; logical null sentinels and contents remain bound.

All unsupported types or unreadable/unmodeled relations produce HOLD. Raw OIDs, OID aliases, composites, ranges and unreviewed custom types are not silently rendered as ambiguous text. Foreign/temp relations, unpopulated materialized views and large objects also hold. Sequence `last_value` and `is_called` are explicitly non-MVCC: they are sampled around the archive and compared after restore, and named writer control remains mandatory.

The current typed SQL unit tests use PG18 WASM instrumentation only, retain the actual `180006` metadata, and confirm the production normalizer rejects it. Actual PG17 archive/restore evidence is a separate explicitly invoked rehearsal.

## Private artifacts

The new private store does not alter or bypass either historical backup profile or its branch guards. It creates a distinct project-specific location outside repository and served roots. Public references are opaque `private-recovery:<uuid>` values. Linux directories/files require exact owner and 0700/0600 modes; Windows requires the current user and SYSTEM only, protected ACLs, normal local paths, by-handle identity, no reparse points and one hard link. Creation and data writes occur with private permissions already established. Existing artifacts are never replaced. Every existing ancestor of the actual private path must have a trusted owner and prevent untrusted replacement/reparenting. Declared, default visualization, code and repository exclusion paths are resolved through their existing parent chains, rejecting aliases/reparse points even when a final path does not exist. These boundaries are rechecked around operations. Public exclusion paths are not private-storage authority; HTTP traversal policy and configuration change control remain separate responsibilities.

On Windows the new fixed helper requires PowerShell Desktop 5.1 or newer APIs, while the old helpers retain their original requirements. The environment classifies the new script file as Internet-zone and rejects `-File` under RemoteSigned. The Node backend verifies a literal SHA-256 pin on the public helper, invokes a fixed noninteractive encoded wrapper that verifies the same bytes again, and passes public parameter metadata as base64 JSON. Only private binary data uses stdin. It refuses restrictive defined MachinePolicy/UserPolicy and makes no execution-policy, registry, unblock or profile change. It accepts no arbitrary helper, script, command or executable override.

This follows PowerShell's documented distinction between [file-loading execution policy and command invocation](https://learn.microsoft.com/powershell/module/microsoft.powershell.core/about/about_execution_policies?view=powershell-5.1). The binary transport uses no shell, inherited credentials or Docker-routing environment, and bounds input/output, stderr, deadlines and unacknowledged child shutdown. Caller and internal input buffers are cleared on success/failure; returned private buffers belong to the caller and are cleared after use.

## Owned native rehearsal

```bash
npm run release:delta:recovery:native -- --output docs/verification/phase3-paired-recovery/native-20261114-owned-check.json
```

The closed command accepts only a fresh sanitized output path in that directory. It has no source URL, SQL, image, Docker host or restore-target override. It uses the already cached exact-six-extension PG17.6 image and pinned 17.11 tools, with an explicitly local Docker endpoint. No image pull or production credential read is performed.

The fixture contains synthetic rows, duplicate JSON keys, unusual array bounds, enums/domains, Auth/Storage-shaped rows and a seventeen-row synthetic ledger. It is not production baseline equivalence or provider Auth. The positive case must actually restore a private custom archive into another owned server. Negative cases must reject restored row/sequence/role/schema drift, source sequence movement and shared-role movement after capture at their expected stages. All owned resource cleanup and input code hashes are checked before publishing a receipt.

The [recorded PG17 rehearsal](../verification/phase3-paired-recovery/native-20261114-restored.json) completed its positive restore and all six expected rejection cases. Seven stored tables, 25 synthetic rows and one sequence matched across distinct servers/snapshots; physical enum OIDs differed, including the enum/domain array fixture. All seven semantic components and the portable data root matched. The measured restore interval was 16.034 seconds for this tiny fixture, with confirmed owned cleanup; it is not an accepted production RTO. Receipt content digest: `30d12faa17c199e88542037d14af69f63e80a3d746325c88015c4a607df57a20`.

The rehearsal retains the private artifacts; the public receipt contains only hashes, counts, timestamps, coverage, opaque references and limitations. Its synthetic code/ledger and fixture superuser are explicit. A native receipt is never relabeled into a fresh production backup.

## Remaining release inputs

A live release still needs protected main/environment policy, fresh source/reference/restored complete equivalence, independently accepted recovery coverage and RPO/RTO, actual provider Auth/role/MFA/API/Storage reports, authenticated current Vercel deployment bindings, exact report-set acceptance and exact outer-digest approval. Source observation and archived recovery must share the exact source snapshot binding. The producer supplies no placeholders or acceptance shortcuts.

A database logical backup does not recover [Storage object bytes or custom-role credentials](https://supabase.com/docs/guides/platform/backups). Platform encryption keys, WAL/PITR and extension binaries are also explicitly not covered by this archive. They remain separately accepted coverage inputs. No production restore is implemented by the owned fixture command.
