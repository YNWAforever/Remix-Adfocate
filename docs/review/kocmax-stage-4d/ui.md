# Stage 4D W7 — D0 offline UI

Implementation notes for D0, 2026-10-31. Branch `codex/kocmax-studio-stages-1-2`, base `3fcdda1`. The scoped counts below describe the initial UI checkpoint; the final combined results and IAB evidence are in [verification.md](verification.md).

## Public interface coordination

- Main owns `src/lib/integrations/types.ts`. UI consumes `IntegrationList.mode: mock | disabled | live_pilot`, optional `pilot: { stage: 'D0'; externalAccess: false; reason?: string }`, boolean `sampleOnly`, and optional `evidence` (`apiVersion`, `endpoint`, `measurementPeriod`, `selectionPeriod`). Existing mock fields remain compatible.
- Mock connections retain existing journeys. `live_pilot` is inert in this D0 browser client, even if returned connections look connected. Sample revoke/purge remain available with the reading switch off; non-sample commands are refused. D0 displays proposed permissions and offline verification, never a connected-live success claim.
- Later user delegation authorized one additional change in `src/components/studio/StudioWorkspace.tsx`: source-card provenance now uses `sample_only` and displays supplied API/measurement-period details. Only that source-card expression changed. Draft and privacy behavior stays covered by existing tests. Main owns `src/lib/studio/policy.ts`.
- Existing preview adapter `src/test/studioIntegrationPreview.ts` now supports explicit offline states. The shared `src/studio-preview.tsx` runner was not changed.
- Parent update was attempted through app `send_message_to_thread`; the tool rejects native ancestor messaging and no native collaboration tool is exposed here. This note is the shared contract checkpoint.

### Existing command contracts

No new HTTP route, OAuth redirect or token-fetch implementation was introduced by W7.

| Action | Browser payload / behavior |
| --- | --- |
| `start` | `{provider}`; existing request body `{returnPath: '/connections'}`; mock mode only, blocked while provider revocation is unresolved |
| `complete` | `{provider,state,code:'allow'|'partial'|'deny'}`; mock only; rejects a non-sample result |
| `sync` | `{connectionId,requestId}`; requires a current readable sample connection |
| `resources` | `{connectionId,requestId,fileIds:string[]}`; candidates only, server remains authoritative |
| `import` | Existing `{threadId,revision,resourceIds,question,modelConsent,processingRights,shareRights,requestId}` remains unchanged |
| `revoke` / `purge` | `{connectionId,requestId}`; pause sample caches immediately, keep provider pending/manual/confirmed results distinct; available while reads are disabled |

### Injected official web Picker bridge

`createGooglePickerBridge(config, dependencies)` returns `{open(): Promise<GooglePickerSelection>, close(): void}`. Construction performs no work. No provider SDK script, default loader, token endpoint, persistence or network transport is installed.

- Config: `stage: 'D0'|'D2'`, opt-in `externalAccess`, `origin`, `allowedOrigins`, `projectNumber`, `allowedProjectNumbers`, `developerKey` (public browser key), `connectionId`, `generation`. Origin must be an exact approved HTTPS origin matching the current browser origin; project number must be approved. Config and allowlists are copied at construction.
- `loadPicker({signal})` supplies the official `google.picker` namespace. The narrow interface uses `PickerBuilder` plus `DocsView`; no upload view, folders, folder selection or Shared Drives are enabled. MIME filters permit Docs/text/PDF, with five-item multiselect.
- `requestAccessToken({connectionId,generation,signal})` is a direct injected callback, never a React Query mutation/query. Its receipt is `{accessToken,expiresAt,origin,projectNumber,connectionId,generation,scopes}`. The combined D0 work adds an injectable, authenticated server channel with CSRF/origin, actor/generation and no-store checks. It has no runtime coordinator and returns `PILOT_APPROVAL_REQUIRED`; no network callback is installed in this D0 UI.
- Token receipt checks match connection/generation/origin/project, expiry and exactly the proposed `drive.file` + `openid` scope set. This validates the receipt contract, not a real Google grant. Refresh tokens and client secrets are not part of the bridge.
- `open()` in D0 rejects before the loader or token callback, even if `externalAccess` is true. Positive bridge tests use only an injected fake SDK/token callback with an explicit placeholder fixture; D2 is not activated by the UI.
- Result: `{status:'selected'|'cancelled', fileIds:string[]}`. Nonempty unique IDs, supported MIME types, shared-drive markers and the five-file limit are validated; titles, owner/rights/version fields are discarded. These are candidate IDs only. Actual file permissions, subject, MIME, size, source rights and versions still need server validation.
- Cancel/unmount aborts pending work; late tokens and callbacks are ignored. Close hides/disposes the Picker, clears builder token state when supported, and releases bridge token/builder/picker references. Reopening requests a fresh token. Errors are sanitized. No token goes into URL, localStorage, query cache, logs or model input.
- Closing is not remote revocation or guaranteed erasure of provider internals. The token retains Google's scope capabilities and real expiry; it is not converted into a 60-second read-only token.

## UI and privacy changes

| Before | After | Why |
| --- | --- | --- |
| Non-mock mode lost its D0 information | Preserve D0 metadata; display offline sample boundaries and disable live actions | Local UI evidence cannot stand in for live acceptance |
| Drive's current mock scope was the only disclosure | Separately label proposed live `drive.file` + `openid`, stable `sub`, application read restrictions and OAuth write capability | Existing mock consent stays accurate; future permissions are not presented as granted |
| Pending revocation still offered reconnect | Disable/reject reconnect until revocation resolves; disclose same-Google-project effects without workspace names | A delayed remote revoke cannot safely be treated as a new grant |
| A creator switch could retain the previous question/dialog | Remount integration forms on creator/workspace identity; preserve same-user question through denial/cancel | Protect another actor's private input without losing the current user's draft |
| A stale connection object could manually refetch after revocation | Compare current cached generation/permission and mode in the query function, as well as `enabled` | Manual `refetch()` bypasses React Query's enabled option |
| Source-card provenance always said Mock | Distinguish sample/provider source and show supplied API version/measurement period | Provider provenance still does not verify the claim or mission |
| Layout coverage exercised three widths | Six widths plus reduced-height dialogs, expanded scopes and D0 states | Keep narrow screens, touch targets and actions usable |

Sources/Briefs remain private by default. AI, processing and sharing choices start unchecked; reading/download permission does not grant reuse rights. API measurement period and media selection period are displayed separately, with lifetime and reach limitations. Unknown HK/Traditional Chinese coverage stays unknown/unverified. The main agent's external-AI server gate is separate from this offline preview.

## Existing preview entry point

Use the existing local DEV preview with `VITE_STUDIO_FIXTURE=true`, `VITE_STUDIO_SHELL=true`, `VITE_STUDIO_THREADS=true` and `VITE_PUBLIC_MISSION_PREVIEW=true`. These settings belong only to the local fixture process. First select the creator role, then navigate to `/connections` with the desired query parameter and reload; a role change can reset the adapter after navigation removes the query. No new runner or server is needed.

| Query | Offline behavior |
| --- | --- |
| `?integrationPreview=d0` | Inert live-pilot shell, D0 notice, proposed permissions; no real authorization/token/read calls |
| `?integrationPreview=d0-pending` | Sample Drive revocation pending; reconnect blocked; retry resolves sample revocation |
| `?integrationPreview=d0-reauth` | Sample expired authorization; fresh mock consent available |
| `?integrationPreview=d0-manual-action` | Sample manual revocation state, clear explanation and retry |
| `?integrationPreview=d0-reconnect` | Sample confirmed revocation; fresh mock consent, no restoration of old sources or rights |
| No parameter or `?integrationPreview=mock` | Existing complete mock journey, now with an explicit D0 notice |

Unknown scenarios fail closed to `d0`. Scenario account labels include the explicit `synthetic` fixture marker. These are sample states, not provider receipts. The fixture tests verify pending → retry → fresh mock connection, and verify that D0 rejects authorization/token/read requests without touching the network.

### IAB/manual review steps for the main agent

1. Use the existing fixture preview; its toolbar must say `本機示例 · 無真實連接`. Select the creator role, then open `/connections?integrationPreview=mock` and reload. The existing Vite configuration selects `src/studio-preview.tsx` when `VITE_STUDIO_FIXTURE=true`; W7 did not change that runner.
2. Choose **Connect mock Google Drive** / **試用模擬連接**. Inspect the actual mock `drive.file` disclosure; the separate proposed live section also explains `openid`. Press Cancel or Escape: consent closes, keyboard focus returns, and no completion request is sent. Reopen and allow mock consent to exercise the sample Picker.
3. Choose **Choose mock Drive files** / **選擇模擬 Drive 文件**. Select up to five supported files; unsupported or non-downloadable entries are disabled. Cancel (touch) or Escape (keyboard) before confirming: nothing is registered/imported and focus returns to the opener. Confirming registers only selected IDs; it does not grant AI/sharing consent or import into a discussion.
4. In an existing private Studio discussion, choose **Evidence** / **證據**, type a draft source question, open the mock Drive picker, select a file and cancel. The same-user question remains. AI/processing/sharing controls remain separate and unchecked until chosen. Close the dialog before using the preview toolbar; its background is deliberately inert while a modal is open.
5. To inspect sign-out handling through the UI, close the dialog and select Visitor in the existing role toolbar. Private creator content should disappear with the session. Changing creator identity during an open modal, clearing the previous creator's question, and preserving a same-user question through denial are covered by component tests; the toolbar is not a multi-creator/workspace OAuth simulator.
6. Reload `/connections?integrationPreview=d0-pending`, retry sample revocation, then review fresh mock consent. Use `d0-manual-action`, `d0-reauth` and `d0-reconnect` for the other recovery states. Reload `d0` to verify proposed permissions remain readable while live connection/Picker actions remain disabled.
7. Inspect at 320/390/430/768/1024/1440px. Open long permissions, keyboard-tab through the dialog, check focus return and reduced-motion, then inspect a short viewport with dialog actions reachable. A real mobile software keyboard and OAuth browser return are still NOT RUN.

The token-bearing official Picker session cannot be opened in this D0 preview. Its cancellation/late-token boundary is exercised offline with an injected fake SDK/token callback:

```powershell
node node_modules/vitest/vitest.mjs run src/lib/integrations/googlePicker.test.ts --maxWorkers 2 --minWorkers 1 --reporter=dot
```

That suite checks cancel during token acquisition, abort signals, ignored late callbacks, cleanup, fresh token requests on reopening and D0 rejection before loading. It makes no real provider request.

## Verification

### Actual checks

The test-first run failed on 10 new UI/query assertions plus the absent bridge module (28 existing tests passed). A separate preview run failed all six newly added D0 scenario assertions. The source-card tests first failed on the unconditional Mock label and absent API details. A later regression test reproduced the stale-generation refetch before its guard was implemented. These failures were corrected; no tests were skipped in the final run.

Final command:

```powershell
node node_modules/vitest/vitest.mjs run src/components/integrations src/lib/integrations/queries.test.tsx src/lib/integrations/googlePicker.test.ts src/test/studioIntegrationPreview.test.ts src/test/integrationStudioProvenance.test.tsx src/components/studio/StudioWorkspace.test.tsx --maxWorkers 2 --minWorkers 1 --reporter=dot
```

**PASS: 9 files, 118 tests**, 17.37 seconds in the recorded final run. Breakdown: Connections 17, source panel 11, Picker UI 1, query/cache guards 14, injected Picker bridge 29, preview 10, Studio provenance 2, existing StudioWorkspace 4, layout 30.

- The 30 layout checks render actual component DOM/CSS into an installed Chromium browser with offline context, request abortion, CSP `default-src 'none'` and reduced-motion emulation. Each of 320/390/430/768/1024/1440px checks provider cards, consent, narrow evidence panel, expanded D0 scope disclosures and a 360px-height dialog. No horizontal overflow, controls smaller than 44px or unreachable tested dialog actions were found. The reduced-height test is not a real mobile keyboard test.
- Scoped ESLint on the owned integration/source-card/preview files: PASS, no warnings/errors.
- Scoped TypeScript program with dependency types loaded: zero diagnostics in the 17 owned TypeScript files. This is not a full-project typecheck.
- `git diff --check` for W7 paths: PASS.
- Tested source fingerprint for the 18 changed code/CSS files (sorted relative paths + NUL + file bytes, SHA-256): `9113e69a083667a2094023c62277b3aacbf47ed45cf0bc6d556d245a45e52bf6`. This excludes this report and colleagues' files; it does not certify the full shared worktree.

### Changed paths

- `src/components/integrations/ConnectionCard.tsx`
- `src/components/integrations/ConnectionConsent.tsx`
- `src/components/integrations/Connections.tsx`, `Connections.test.tsx`
- `src/components/integrations/DriveSourcePicker.tsx`, `DriveSourcePicker.test.tsx` (new test)
- `src/components/integrations/IntegrationSourcePanel.tsx`, `IntegrationSourcePanel.test.tsx`
- `src/components/integrations/integrations.css`, `layout.test.tsx`
- `src/components/studio/StudioWorkspace.tsx` (one source-card expression)
- `src/lib/integrations/queries.ts`, `queries.test.tsx`
- `src/lib/integrations/googlePicker.ts`, `googlePicker.test.ts` (new)
- `src/test/studioIntegrationPreview.ts`, `studioIntegrationPreview.test.ts`
- `src/test/integrationStudioProvenance.test.tsx` (new)
- `docs/review/kocmax-stage-4d/ui.md` (this file)

### Limits and remaining gates

W7 offline acceptance only. The main agent owns the later IAB review. No actual Google SDK was loaded, no real token was issued, and no platform consent/Picker/remote revocation was exercised. No real provider/model calls, remote DB/Auth/RLS checks, deployment, push or commit were performed by W7. Actual iOS/Android/desktop OAuth, screen-reader hardware, software keyboard behavior, CSP/referrer deployment settings, subject reconciliation and token transport remain unverified. The full suite/build and broad project acceptance were not run. Existing 4A–4C server fixes were not edited by W7 and remain subject to the main agent's scoped integration checks.
