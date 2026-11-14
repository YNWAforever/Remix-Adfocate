# Phase 3 owned provider rehearsal

This runner exercises provider HTTP and the original application on a newly created local stack. Its observation always remains `HOLD`, `validReleaseEvidence: false`, `productionEquivalent: false` and `ownerAccepted: false`. It cannot authorize the protected two-function release or the pilot.

```sh
npm run release:provider:plan
npm run release:provider:owned
```

The plan command is offline. The owned command requires a committed source tree, Node 22, Docker's local engine and the locked Supabase CLI 2.110.0 package. There are no URL, project, credential, fixture SQL, source binding or output overrides. It allocates a fresh project, private working directory, free loopback ports and an internal bridge with an explicit non-overlapping subnet. Existing projects and volumes are never adopted. No migration is sent to a hosted database.

The full local forward schema includes the legacy foundation files and the complete current manifest. The source profile records normalized hashes of every copied migration. This fresh local history is distinct from the protected production baseline's seventeen recorded ledger rows; it provides no production-history or recovery-equivalence claim. Normal seed execution is disabled. Immutable rows in reviewed migrations remain part of the local baseline.

The pinned Go backend is invoked from the fresh private working copy. The JavaScript CLI shell's user-profile telemetry is not used. Docker configuration and CLI home state are private and fresh, and a fixed unusable management token prevents credential-store fallback. Provider keys, actor passwords, JWTs, TOTP material, object bytes and raw subprocess/SDK errors stay out of the public observation and logs. The private provider working copy is a separate sibling under the existing protected private parent; the frozen paired-recovery artifact helper and its closed four-file inventory are unchanged.

The `provider-acceptance` CI job creates its own stack on an ephemeral GitHub-hosted Linux runner and uploads only the sanitized observation. Its source checkout is the exact PR head or pushed commit. A successful job proves the reported Linux execution. A Windows CLI daemon-pipe access failure is a local setup failure and cannot be labelled a provider pass. Do not broaden private artifact permissions to make a tool run.

## HTTP and identity boundary

Container IDs, image IDs, project labels, mounts, single-network membership, internal bridge settings and loopback-only published bindings are checked before provider HTTP and fixture SQL. The owned namespace is freshly enumerated throughout the run. A mismatched or stopped resource refuses the operation. CLI output is bounded and captured privately; public failures contain only fixed reason categories.

The runner starts a real loopback HTTP listener around the unmodified `createApp()` application after setting a local-only environment. Creator/operator requests cross that listener and use the original middleware, routes and provider clients. `app.request()` and route/provider mocks are not acceptance evidence.

The dedicated process restricts fetch, DNS lookups, HTTP/HTTPS requests and TCP connections to the two owned loopback origins before application imports. External proof inspection therefore records unavailable metadata through the original inspector. It does not fetch a social post, publish content or replace metadata with a successful mock. A final egress case first requires an actual successful application HTTP response, then proves the hosted request was refused before any external response.

All fixture SDKs and the application use the guarded fetch. The shared response counter increments only after a real HTTP response. Cases run sequentially; each receipt requires a new response and stores only a name, status, count and digest of private facts. A failed prerequisite or cleanup discards the run's case receipts. Source hashes, target identity digest, actual image references, timestamps, coverage limits and cleanup states bind the sanitized observation.

## Cases and limits

Auth cases verify provider-issued sessions, a changed signature byte, anonymous denial, tenant isolation, four real TOTP enroll/challenge/verify journeys, AAL1/AAL2 enforcement, staff scope and membership denial, and logout revocation while the original JWT is still unexpired. Expiry uses a twin signed by the verified owned local provider key. The same signer must first produce a fresh twin accepted by the provider. The expired twin is explicitly labelled `providerIssued: false`.

The creator/operator journey verifies legacy join XP, first submission and neutral resubmission, quota with two valid participants in the same workspace, active assignment XP and financial neutrality, draft review, proof correction and the single pending reward handoff. A prior-issued anchor seeded for this rehearsal and matching financial rows must remain unchanged. No ordinary legacy approval or active reward settlement is executed.

Both draft and proof Storage buckets are checked through actual HTTP. Cases cover owner access, same-tenant foreign-owner and anonymous denials, signed upload, exact MIME/size enforcement, finalization and downloaded byte equality. MIME/size cases require a specific provider rejection and then a valid PNG through the same path/token. Authorization or setup failures cannot pass as content-policy enforcement. Exact granted object paths are removed and absence is checked before outer namespace cleanup.

Coverage limits remain explicit:

- The current schema makes workflow mode non-null. Its schema guard is observed, but a historical NULL-mode provider join is not exercised.
- Synthetic issued-history preservation does not prove actual reward issuance or settlement.
- External publication, social metadata availability and production provider equivalence are not exercised.
- The foreign Storage owner is in the same workspace. Cross-tenant Storage writes are not claimed.
- Signed upload tokens are bearer capabilities. Non-transferability, overwrites and delete permissions are not claimed.
- Owner acceptance, accepted report-set hash, recovery coverage, RPO/RTO, fresh production recovery/reference equivalence, protected settings and final outer approval remain independent release inputs.

## Cleanup and review

Storage cleanup removes only validated paths granted during the run. The application listener and clients are closed. Containers are removed by freshly checked exact IDs; only project-labelled, nonce-suffixed local volumes are removed. The labelled network must be empty before its exact ID is removed. Unverified cleanup remains a failed engineering observation with release status `HOLD`; do not adopt or retry its namespace.

Observations are written beneath `docs/verification/phase3-provider-rehearsal/` with a source-commit and run UUID filename. Each file has a canonical content digest. No raw response, credentials, object content, account email, TOTP secret, private path or dump is an allowed extension. The observation validator rejects extra fields, duplicate/missing cases, empty HTTP prerequisites, overlapping response counts, hosted target substitutions, missing coverage limits and release-authority relabelling.

Review the observation together with its exact-source CI result and the paired-recovery observation. Preparation must list the remaining sixteen-gate owner/live inputs. A local provider or recovery receipt cannot replace them by changing its label. Production writes, protection changes, pilot selection/enablement, publication and rewards require the separate protected scope.
