# Stage 4D persistence: independent review reproductions

Reviewed against base `3fcdda17dee4a349ed791f305d44f5765d7924ff` in the shared worktree. The three observations below were reproduced at **2026-10-31T10:00:52.447Z** with the migration SHA-256 `ab794d778d7e905119f1f94e8abe050e33b84f7581ad7ac214ab515407520d89`. That snapshot includes the optional provider-notice SQL. `memoryRepo.ts` at review: `8882d97569af4571179579cef20cc4a13576cd67050ad6d88bebd508fd998557`.

The review made no implementation edits. Reproductions used the existing offline fixture and a separate `memory://` PGlite database, with each case rolled back. No provider/account API, remote database, model, build, broad suite, commit, push or deployment was used. Fixture envelopes contain dummy values and are never printed.

## R1 — P1: historical Google purge revokes a newly authorized peer

Location in reviewed snapshot: `supabase/migrations/20261031123000_integration_pilot_persistence.sql:346-357`; equivalent fanout in `server/lib/integrations/memoryRepo.ts:220-225`.

Sequence:

1. Connect A and B in different workspaces with the same Google provider project and subject hash, both generation 1.
2. `revoke` A generation 1; fanout stops both at generation 2.
3. `revoke_result` A generation 2 with `provider: "revoked"`; both grants are confirmed stopped.
4. Explicitly reauthorize B, producing its fresh generation 3 connection.
5. `purge` A's historical connection using a new request ID.

Expected: A's historical data is erased; B remains connected at generation 3. Observed: B becomes `{"status":"revoked","generation":4,"provider":"pending"}`. The ordinary service purge path reaches this: `revokeConnection` returns early for A's already-confirmed revocation, then `purgeConnection` submits `purge`. The historical binding must not cause fresh-grant fanout.

## R2 — P2: SQL refresh commit accepts a missing lease and missing CAS fields

Location: migration lines 256-258. The memory repository already rejects a missing lease.

Sequence: create a connection, do **not** call `refresh_acquire`, then call `refresh_commit` with only `{id, generation:1, credential, expiresAt}`. Omit both `leaseId` and `credentialVersion`.

Expected: `REFRESH_LEASE_STALE` or an input rejection, with credentials unchanged. Observed: `{"credentialVersion":2}` while the refresh-lease table contains zero rows. With no lease, comparing its null fields against omitted/null payload fields lets the SQL `IF` condition evaluate to null instead of true. Explicitly reject a missing lease and missing fence fields; cover both omission and explicit null, including `refresh_abandon`.

## R3 — P2: a new Instagram selection window conflicts with unchanged content

Location: migration lines 313-316. The evidence key is `(resource_id,generation,content_hash)`, followed by exact evidence equality.

Sequence: persist an Instagram resource and its lifetime metric evidence, then persist the same resource/version/content hash with a later `fetchedAt` and shifted `selectionPeriod.start/end`. These are separate successful observations of unchanged metrics.

Expected: the second observation succeeds, current evidence shows the new selection window, and earlier snapshot/source evidence remains unchanged. Observed: the second `resources` command raises `SOURCE_CHANGED`.

The provider produces this naturally: `providers/instagramLive.ts:163-166` keeps the metric/source version stable when media and metrics are unchanged but computes a fresh selection window on each read. `instagram.ts:19` hashes metrics and source version. **Do not put the moving window or fetch timestamp into the content hash/version to resolve this conflict:** `IntegrationService.revalidate` compares version/hash on a later read, so that would make unchanged content fail revalidation. Distinguish observation identity/history from content identity. Test a later successful import/revalidation as well as repeated sync and immutable prior snapshot/source evidence.

## Exact local reproduction command

Run the following PowerShell command from the repository root. It uses the existing fixture definitions without editing or importing a Vitest test module. Its failure labels name the expected invariant, not a Vitest result. It creates no persistent database or extra script file.

```powershell
@'
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {PGlite} from '@electric-sql/pglite';
const helper=await readFile('server/test/helpers/integrations-fixture.ts','utf8');
const code=ts.transpileModule(helper.replace(/^import .+;\r?\n/gm,'').replace(/\bexport /g,''),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const f=new Function('readFile','PGlite','expect',code+'; return {fixture,connect,connection,rpc,resources,resource,ws,actor,other,otherWs,connectionId,credential};')(readFile,PGlite,null);
const migration=await readFile('supabase/migrations/20261031123000_integration_pilot_persistence.sql','utf8');
const {db}=await f.fixture(); await db.exec(migration);
console.log(JSON.stringify({reviewedAt:new Date().toISOString(),migrationSha256:createHash('sha256').update(migration).digest('hex'),migrationLines:migration.split('\n').length}));
async function scenario(name,run){await db.exec('begin');try{console.log(JSON.stringify({name,...await run()}));}catch(error){console.log(JSON.stringify({name,error:error.message}));}finally{await db.exec('rollback');}}
async function live(owner,workspace,id,generation=1){const binding=await f.rpc(db,'pilot_bind',{id,generation,provider:'google_drive',environmentId:'fixture-pilot',databaseProjectId:'fixture-db',origin:'https://pilot.invalid',providerProjectId:'fixture-google',subjectHash:'a'.repeat(64),apiVersion:'v3'},undefined,owner,workspace);return f.rpc(db,'connect',{expectedGeneration:generation-1,bindingId:binding.bindingId,credential:f.credential,connection:f.connection({id,workspaceId:workspace,creatorId:owner,generation,sampleOnly:false})},undefined,owner,workspace);}
await scenario('FAIL_expected_missing_refresh_fence_rejection',async()=>{await f.connect(db);return{actual:await f.rpc(db,'refresh_commit',{id:f.connectionId,generation:1,credential:f.credential,expiresAt:'2099-01-01T00:00:00Z'}),leases:(await db.query('select count(*)::int n from private.integration_refresh_leases')).rows[0].n};});
await scenario('FAIL_expected_fresh_peer_survives_old_purge',async()=>{const peer=crypto.randomUUID();await live(f.actor,f.ws,f.connectionId);await live(f.other,f.otherWs,peer);await f.rpc(db,'revoke',{id:f.connectionId,generation:1});await f.rpc(db,'revoke_result',{id:f.connectionId,generation:2,provider:'revoked'});await live(f.other,f.otherWs,peer,3);await f.rpc(db,'purge',{id:f.connectionId});return{expected:{status:'connected',generation:3},actual:(await db.query("select status,generation,data->>'providerRevocation' as provider from public.integration_connections where id=$1",[peer])).rows[0]};});
await scenario('FAIL_expected_unchanged_metrics_new_selection_window_syncs',async()=>{await f.connect(db,{provider:'instagram',scopes:['instagram_business_basic','instagram_business_manage_insights']});const evidence={apiVersion:'v26.0',endpoint:'https://graph.instagram.com/v26.0/123/insights',measurementPeriod:'lifetime',selectionPeriod:{start:'2026-10-01T00:00:00Z',end:'2026-10-31T00:00:00Z'}};const value=f.resource({evidence,mimeType:'application/instagram-insights'});await f.resources(db,[value]);try{await f.resources(db,[{...value,fetchedAt:'2026-10-31T02:05:00Z',evidence:{...evidence,selectionPeriod:{start:'2026-10-01T00:05:00Z',end:'2026-10-31T00:05:00Z'}}}]);return{actual:'accepted'};}catch(error){return{actual:error.message};}});
await db.close();
'@ | node --input-type=module
```

Observed output (the metadata line above identified the reviewed snapshot):

```json
{"name":"FAIL_expected_missing_refresh_fence_rejection","actual":{"credentialVersion":2},"leases":0}
{"name":"FAIL_expected_fresh_peer_survives_old_purge","expected":{"status":"connected","generation":3},"actual":{"status":"revoked","generation":4,"provider":"pending"}}
{"name":"FAIL_expected_unchanged_metrics_new_selection_window_syncs","actual":"SOURCE_CHANGED"}
```

## Independent re-review status and limits

**First fix re-review, 2026-10-31:** reviewed frozen migration `cf4d6ea3ebc22585d8e55638c049fda04ca6a783930fd6bb4cd5cffd1f212dd3`. R1 and R2 are resolved in this bounded review: historical revoke/purge avoids fresh-peer fanout, malformed/missing CAS fences fail before mutations, and a valid acquired lease still commits. R3 now appends observation-specific evidence/snapshots without changing content identity and retains older snapshot/source evidence, but remains open because of the retry regression below. No code was edited by the reviewer.

Independent focused command:

```text
node node_modules/vitest/vitest.mjs run server/test/integrations-pilot-persistence.test.ts server/test/integrations-pilot-memory.test.ts server/test/assistant-studio-classification.test.ts --maxWorkers 2 --minWorkers 1
```

Result at 18:17:58 Hong Kong time: **31 passed across 3 files** (15 SQL persistence, 8 memory, 8 assistant classification), duration 3.42 seconds. This is not the parent's full validation.

### R3 follow-up — P2: observation-pointer mutation breaks intent replay

Location in `cf4d6ea3`: migration lines 328-331. The wrapper clears `snapshot_id` before calling the original dispatcher. That dispatcher validates a cached selection result against the current snapshot pointer before replaying it. A fresh provider observation on a retry therefore invalidates its own otherwise valid receipt.

Use the `f`/`db` fixture bootstrap from the command above, replacing its three scenario calls with:

```javascript
await f.connect(db);
const row = f.resource({ evidence: {
  apiVersion: 'v3', endpoint: 'drive/v3/files', measurementPeriod: 'document_version'
} });
const request = crypto.randomUUID();
const save = value => f.rpc(db, 'resources', {
  id: f.connectionId, generation: 1, resources: [value],
  intent: { fileIds: [value.externalId] }
}, request);
const first = await save(row);
// Same request/selection/content/version; the provider read happened one minute later.
await save({ ...row, fetchedAt: '2026-10-31T02:01:00Z' });
```

Expected: replay `first` with its original snapshot, as the pre-existing selection-intent contract allows. Observed independently: `SOURCE_UNAVAILABLE`. `IntegrationService.registerSelectedFiles` reads the selected files again before submitting this command, so this is a reachable retry path. Parfit received this exact reproduction for RED/fix. Cache validation must precede observation-pointer mutation, while retaining conflict, generation, revocation and source-availability checks. A new request must still append new observation evidence; hashing a timestamp is still unsuitable.

### Assistant classification fix — independent read-only review

Poincare reported the code frozen before review. Reviewed `server/routes/assistant.ts` SHA-256 `1789d8b2f270995a77d78cd75edbb8fc74d11b83387af2fdbb5f9d30e19f149a` and classification tests `aae182544494bf1fd95dbf368405fa2ecd3168805dc67a998b4be9b4f1bab751`.

No finding in the bounded classification fix. With Studio disabled/unset, an existing conversation is classified using owner/workspace filters before request reservation, history reads or model/embedding calls. A matching Studio conversation stops; unavailable classification fails closed. Ordinary existing conversations and new manual chat retain their paths. The enabled Studio path continues through its scoped context loader. All eight classification tests passed in the independent command above. Parent owns full regression and approval-boundary validation.

The new provider-notice SQL and repository wrapper received static review; the three probes above do not establish notice lifecycle acceptance or real multi-worker PostgreSQL behavior. Restore remains an explicitly documented operational limitation: `restore_pending` blocks integration commands, while direct SELECT/RLS and Studio reads are still possible. The D1 restore procedure must quarantine the whole target until the complete tombstone log is replayed. No live acceptance is claimed.

### Final resolution recorded by the coordinating reviewer

Copernicus independently cleared R1-R3, the R3 retry-ordering follow-up and the assistant classification fix on 2026-10-31. Final SQL SHA-256: `485bee1d9978bced3983a70a846825e410a19805dd47d972739c7ae2c55ebdbc`. Its targeted regression and original independent retry reproduction passed: replay preserves the original snapshot, while a new observation appends evidence without changing content identity. No open finding remains in that bounded review. The parent subsequently reran 111 affected tests, including the 49-case original SQL behavior suite, the 16 SQL/8 memory pilot cases, full offline composition, and both release-manifest/preflight suites. Final results and remaining live gates are in [verification.md](verification.md).
