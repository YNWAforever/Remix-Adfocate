# Vision processor review — BLOCKED for live use

Reviewed offline on 2026-11-04 against the approved growth Studio spec §§5–6, 8–10 and publishing pilot Task 7. The user authorized offline implementation and selected self-upload. **No actual processor, model, endpoint or data terms are approved.** The current text gateway is not evidence of image support or permission to send images.

```json
{
  "status": "BLOCKED",
  "liveVisionEnabled": false,
  "processorConfig": null,
  "providerSpecificAdapter": null,
  "approvalReference": null,
  "fallback": "local_preview_and_manual_description"
}
```

This is a review record, not executable configuration. No default approved record or processor registry is shipped. The only successful adapter calls in this task use an injected synthetic function and generated test PNG bytes; no real upload, model service, network or processor was used.

## Missing approval fields

Every following entry remains **null / unapproved**: actual processor legal entity and product; model/processor ID and pinned version; endpoint/protocol and supported image capabilities; account/contract; reviewed configuration revision; processing and storage regions; cross-border terms; subprocessors; retention including temporary copies/logs; training/reuse policy; deletion API or manual process, receipts and backup limitations; exact data categories/purpose; versioned creator disclosure/consent copy; dated evidence sources; approving owner and approval reference/validity; default-off activation control; covered pilot actions/resources; cleanup/restore owner and verification. These must be reviewed before implementing a provider-specific transport. This task does not select values or claim legal approval.

## Offline server contract

`authorizeVisionProcessing(grant, actor, asset, processorConfig, { now, connection })` is a pure Boolean check. It performs no reads, writes, network calls, model/tool execution or browser/global configuration lookup. Its arguments must be **current, trusted server projections**, not request JSON. The function cannot authenticate the provenance of an object by itself.

The decision requires:

- An authenticated server actor (`ownerId`, `workspaceId`) matching both the grant and asset; a stable grant ID and exact selected asset ID/SHA-256.
- Purpose exactly `image_diagnosis`; exact consent version, processor ID/version and reviewed configuration version. `approved` and `enabled` must both be true in the trusted configuration. Unknown/null configuration denies.
- Canonical UTC timestamps, approval no later than consent, consent already issued, and unexpired consent, asset and configuration at the explicitly injected clock. Revocation state must be explicitly null for all three; missing state denies.
- For a connection-bound source, the asset and grant must retain the same connection ID/generation, matching the current active, unexpired connection and owner/workspace. Reconnect, revoked/reauth state or dropped binding denies. An unbound self-upload uses explicit null connection bindings and requires no Instagram connection.

Every relevant consent/configuration change needs a fresh version/identity. `configVersion` denotes the complete reviewed configuration (including region/retention/training/deletion and disclosure terms), not just the model name. Future persistence must change it whenever those reviewed facts change and must invalidate outstanding work on revoke. No persistence implementation is added here.

## `analyzeImage` boundary

The existing `processingApproved` Boolean is only a stop flag, never sufficient approval. A client `consentVersion` is only an expected-version assertion; it must match the loaded server grant. Without the optional server-only `authorization` dependencies, external calls remain disabled.

The trusted asset loader must now supply `owner` for external processing, alongside its existing asset ID, sanitized bytes, digest and source kind. That ownership is compared with the server actor; the independently loaded current asset ID/hash must match the actual inspected bytes. Owner is optional in the shared type solely to preserve existing mock/manual callers; absence always denies external processing.

`authorization` supplies the server actor, an explicit `now()` clock and `loadCurrent(assetId)` for a fresh coherent consent/asset/configuration/connection snapshot. The external adapter must identify its processor ID/version/configuration version. Nothing is read from browser settings, and there is no global approval registry. Existing routes have not been wired to this new seam and cannot enable it by sending a consent string.

1. Validate request/asset, recompute SHA-256, enforce sanitized image form, and copy the trusted bytes and owner before asynchronous lifecycle reads.
2. Load current server state, sample the injected clock, and check the entire binding immediately before invoking the adapter, with no intervening asynchronous work.
3. Send only a defensive copy of the selected image bytes and an optional validated caption (existing limit: 500 code points). No owner IDs, token, storage path, temporary URL, other images, metrics, history, tool capability or full consent/configuration record is passed to the adapter.
4. Normalize only bounded observation fields. Objects/composition/visible OCR are distinct from caption alignment and uncertainty. OCR, captions and image text are inert data: instruction-like text is neither consent nor a tool command. Extra returned action fields are discarded; there is no dispatch/evaluation/tool interface here.
5. Reload current state after the adapter resolves, resample the clock and compare the exact authorization revision. Revocation, expiry, reconnect, replacement consent, asset/configuration/actor changes, a disabled stop flag or lookup failure returns an empty manual observation with `processing_state_changed`; no usable observed content escapes this API. Sanitized adapter errors contain no provider error payload.

The trusted synthetic fixture mock remains available offline only for a registered fixture/hash. It never describes a creator-upload asset, even if the client supplies a fixture source reference. Any observed result bound to a trusted synthetic asset retains `sampleOnly: true`, including through an external-kind synthetic test adapter. Actual uploads never become synthetic observations through the mock path.

## Revocation and in-flight limits

This API stops new calls on a failed current-state check and suppresses late results when its post-call check detects a change. It has no cross-process transaction/lock and cannot make a state read atomic with an external service receiving bytes. `loadCurrent` must not return cached authorization, and downstream persistence/sharing must recheck the authoritative owner/generation/revision in its own transaction. A change after the final read cannot be detected by a completed pure call. Route/repository integration is outside this write set.

Revocation cannot recall bytes already accepted by a provider. There is no live adapter, cancellation/deletion receipt or provider-side deletion verification here. A future approved processor needs its own bounded cancellation/deletion protocol, audit and truthful pending/failed status. A manual result means KOCmax withheld the observation; it does **not** mean external copies or backups were erased.

## Evidence and limits

Tests use in-memory server records and a no-network synthetic adapter. They cover denial before any adapter call, allowed minimal payload, current generation, time and revocation, post-call lifecycle changes, defensive byte copying, inert OCR and mock-upload refusal. The returned envelope contains only a trusted safe asset binding and bounded observation; it does not carry raw input bytes, credentials or media URLs. This layer has no chat/history/analytics/storage writers. These checks do not establish downstream export sanitization, DB/Auth/RLS acceptance, processor retention/deletion, legal rights or live processing acceptance. See the scoped task report and logs for exact commands/results.
