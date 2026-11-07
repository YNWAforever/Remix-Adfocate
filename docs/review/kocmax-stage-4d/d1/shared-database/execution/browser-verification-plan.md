# Browser verification plan — Studio, providers disabled

Inspection only, 2026-10-31 HKT. Workspace: `C:/Users/laich/.codex/worktrees/kocmax-studio/Adfocate`; branch: `codex/kocmax-studio-stages-1-2`; observed HEAD: `5c60020091e8e6fee934b61c498bf7518944c433`. The worktree contains concurrent D1 changes. This helper changed only this document and ran no browser, application, tests, database client, account creation or deployment. The parent's newly approved reviewed SQL application remains separate from this plan; older preparation reports are not a revocation of that authorization.

## Harness findings and exact commands

| Harness | Source-bound finding | Suitable evidence |
| --- | --- | --- |
| `node scripts/studio-dev.mjs` | Binds `127.0.0.1:8772` with strict port; enables four Studio fixture flags and replaces browser Supabase configuration with `http://127.0.0.1:1` / a dummy key (`scripts/studio-dev.mjs:1–9`). Vite selects `src/studio-preview.tsx` and returns before importing the Hono server (`vite.config.ts:23–33`). | Real React/router UI with in-memory responses; **no shared-database connection**. |
| Preview transport/auth | Replaces `window.fetch`, session lookup, password sign-in and sign-out; toolbar changes simulated identities (`src/test/studioPreview.ts:152–186`). Dispatch rejects off-origin/non-API fetches and unsupported operations (`:64–133`). Domain data/receipts are module memory; role alone survives in sessionStorage (`:18–22`). Preview boot skips analytics (`src/studio-preview.tsx:8–20`). | Navigation, UI interactions and simulated errors. Reload resets working data; it does not prove durable saves, JWT verification, RLS or provider isolation outside this adapter. Do not exercise OAuth/signup/email actions as if they were supported fixture authentication. |
| Review fixture and runners | `tests/review/support/fixture.ts:11–24` checks flags/loopback and constructs a service client at import; `:52–94` creates Auth users and product roles; `:97–118` inserts workspaces/missions and submits work. Runners read `supabase status`, inject real local keys and run the real app (`tests/review/run-review-tests.mjs:8–26`, `run-review-e2e.mjs:8–30`). | **Real local Supabase integration**, not mock-only and not a runner for Remix-AdfocateDB. Loopback checks alone do not prove target isolation. Do not import/run it for this bounded browser pass. |
| Existing browser specs | Review Playwright defaults to 1280×900; creator spec adds one 375×812 case. It creates accounts and includes permanent account deletion; operator spec injects a locally issued session, bypassing staff login (`tests/review/e2e/playwright.review.config.ts:16–33`, `creator.spec.ts:25–54,139–152`, `operator.spec.ts:1–22`). | Useful regression references, not current Studio coverage or approval to replay these mutations on the shared DB. |

Parent startup, using installed dependencies from the repository root:

```powershell
Set-Location -LiteralPath 'C:/Users/laich/.codex/worktrees/kocmax-studio/Adfocate'
node scripts/studio-dev.mjs
```

Use `http://127.0.0.1:8772/` in IAB. Verify the banner **本機示例 · 無真實連接** before interacting. If port 8772 is occupied, identify the existing parent-owned fixture process; do not kill unrelated processes or silently reuse an unknown server. Do not substitute plain `npm run dev`: without the fixture flag Vite imports the real server. Vite's router plugin may regenerate route metadata; record any resulting diff separately. Stop only the process started for this pass with Ctrl+C.

**Keep connections disabled:** select Creator in the toolbar, then explicitly load/reload `http://127.0.0.1:8772/connections?integrationPreview=d0`. The scenario is selected when the adapter is created. No query parameter defaults to `mock`; `d0-pending`, `d0-reauth`, `d0-manual-action` and `d0-reconnect` also expose simulated connection operations. They are not the disabled baseline (`src/test/studioIntegrationPreview.ts:14–24,69–76`). Keep `integrationPreview=d0` on every full reload; SPA navigation in the same document retains the adapter. Check the D0 notice and disabled Instagram/Drive buttons after each role/reload transition. Do not select mock connection/import actions during this pass.

Optional parent-run regression command in a separate terminal, **not executed by this helper**:

```powershell
Set-Location -LiteralPath 'C:/Users/laich/.codex/worktrees/kocmax-studio/Adfocate'
$env:RUN_INTEGRATION = '0'
$env:RUN_AUDIT_INTEGRATION = '0'
$env:REVIEW_DISPOSABLE_DB = '0'
node node_modules/vitest/vitest.mjs run --config vitest.config.ts src/test/studioIntegrationPreview.test.ts src/components/integrations/Connections.test.tsx src/components/studio/StudioWorkspace.test.tsx --maxWorkers=2 --minWorkers=1 --reporter=dot
```

These three files were inspected: the preview suite uses `MemoryIntegrationRepository`/mock providers; Connections replaces `apiFetch`; StudioWorkspace replaces queries/mutations/chat. They cover D0 refusal, connection disclosures, cancellation/identity changes, private-source sharing, invalidated confirmation and context-change retry. Setup only supplies DOM helpers/in-memory storage (`src/test/setup.ts:1–45`; `vitest.config.ts:7–24`). Some assertions deliberately exercise **simulated** connections; none establishes real-provider acceptance. Do not broaden to `npm test`, integration scripts or Playwright suites without inspecting their targets and setup first.

## Parent IAB checklist

Repeat the core rows at **390×844** and **1440×1000**, in Traditional Chinese and with an English navigation/form spot check. Add **320px** width for public navigation/long permissions, **768px** for navigation transition, and a **360px-high** viewport for dialogs. Use the toolbar's actual screen options for dynamic IDs (`src/test/studioPreviewJourneys.ts:124–125`). Start each viewport with a fresh fixture document and re-establish D0; do not expect the previous viewport's in-memory records to survive a reload.

| Role / journey | Concrete actions and required result |
| --- | --- |
| Visitor | Open `/`, `/creators`, `/brands`, `/guide`, `/contact`, `/legal/privacy`, `/login`, `/brand/login`, `/passport/local-public-example`. Open/close exploration navigation and switch language. Contact remains a clearly labelled preview; public passport has no private email. Direct `/studio`, `/my` and `/admin` cannot display protected data. Callback pages without valid inputs show a recoverable error; do not send login/signup/link requests. |
| New creator | Select New creator; walk the five onboarding steps, skip optional social accounts, follow the guide link and return. Basic work must remain available without connections. This adapter returns `needsAcceptance:false`, so real consent gating/persistence is not covered by this journey. |
| Creator — Studio | Select Creator, establish D0, then `/home` → mission `tea-story` → Studio. Create a discussion from a template with mission context; add a manual HK/zh-Hant source with question, observation time and unverified status. Discuss, save private Brief v1, navigate away and return **without reload**. Private-source paragraphs cannot be shared merely by selecting a recipient; an eligible own paragraph requires explicit confirmation and an original mission/deliverable. Editing the Brief invalidates confirmation. Successful transfer gives a receipt and opens the original draft; checklist/version/submission controls remain available. Chat/Brief save must not award points, XP or badges. |
| Creator — disabled connections / recovery | `/connections?integrationPreview=d0`: read proposed permissions, verify both live connection actions disabled, no Picker/OAuth opens, and Start creating returns to `/home`. Use toolbar `error`, `empty`, `denied`, `stale` where supported: errors differ from empty data; stale writes retain input; after permission denial private cached content must not reappear on a later error. Restore `normal` between independent cases. |
| Creator — existing functions | Open `/my`, its active workspace, `/wallet`, `/redemption`, `/profile`, `/notifications`, `/guide`. Check original deadlines, draft/checklist and reward-pending wording; failed wallet reads are unknown, not a fabricated zero, and redemption is disabled. For a normal fixture redemption, cancel/Escape restores focus; confirmation produces one synthetic receipt/history entry and moves focus to success. Profile edit and notification-read updates remain visible within the session. Do not perform account deletion or real upload. |
| Operator / restricted staff | Select Operator; open `/admin`, applications, submissions, active missions and creator detail using the toolbar. Accept one simulated application, save one internal note/review summary and inspect the refreshed state. Rejection needs a reason and confirmation; cancel leaves state unchanged. Keep social evidence unknown. Spot-check Reviewer and Finance viewer: review approval does not imply settlement, reviewer lacks reward-handoff authority, finance lands on its permitted read-only page. Do not use simulated settlement as evidence of real payments/awards. |
| Brand | Select Brand; `/brand` → `/brand/missions` → existing draft. Edit/save and return to the list: title refreshes; engaged/locked fields retain their restrictions. With `stale`, a save conflict retains unsaved text; with `denied`, private mission data disappears and stays hidden if the next state is `error`. Check `/brand/resources` and deny staff/private-creator access. This is a single-workspace role simulation, not cross-tenant proof. |

For every row record role, URL, viewport, fixture/scenario, action, observed result, console errors and screenshot reference. Check no page-wide horizontal overflow, visible focus, approximately 44px action targets, readable disabled/error states, mobile navigation that does not cover content, and reachable dialog actions. Keyboard Tab/Shift+Tab/Escape and focus return are desktop checks; viewport resizing is not a real mobile keyboard/device test. Observe that no provider/OAuth/AI requests are initiated, while distinguishing Vite/assets from domain calls: intercepted fixture fetches may never appear as network requests.

Preserved-fix references: `docs/review/kocmax-stage-3/verification.md:38–68` (wallet, focus, brand conflict/cache and capabilities); `docs/review/kocmax-stage-4d/ui.md:39–51` (identity, consent, stale-generation guards); `tests/review/e2e/creator.spec.ts:70–136` and `operator.spec.ts:25–49` (legacy rejection, guide/sign-out, loading-zero, public privacy and finance landing). These are historical/source expectations, not newly passed checks. The fixture does not reproduce every legacy rejection, delayed loading, real-zero, multi-creator or cross-workspace condition: mark unavailable cases NOT TESTED instead of forcing a pass. Pending-revocation and Picker-cancel regressions remain in the scoped mocked tests while IAB stays in D0.

## Real Auth / shared-database evidence still absent from this harness

- An explicitly configured, verified real app/API target for Remix-AdfocateDB, matching browser public Auth configuration and server configuration, plus approved callback origins. The preview intentionally replaces/bypasses them. No environment/secret values were inspected; this is absence from the supplied harness, not a claim that the user's environment has no credentials.
- Ordinary authenticated sessions for the intended creator, same-workspace peer, other-workspace creator and restricted staff actor; role/workspace mappings and an independently usable brand-only session. Visitor requires no account. Account creation, outbound login email and provider login are outside this helper's work; use only parent-authorized existing access.
- The SQL fixture requires `kocmax.fixture_creator_a`, `kocmax.fixture_creator_peer`, `kocmax.fixture_creator_b`, `kocmax.fixture_operator_a` and `kocmax.fixture_approval`, and demands four distinct existing Auth IDs with no product roles (`30-fixture-transaction.sql:9–29`). It grants its purported operator **workspace_admin**, with a brand membership on the same identity (`:40–45`); this does not prove restricted-operator or brand-only isolation.
- A reviewed persistent browser fixture with precise records/write/cleanup boundaries. The inspected `30-fixture-transaction.sql` substitutes SQL claims and ends in `ROLLBACK` (`:72–98`); those rows cannot serve a separate browser connection. Its successful execution would not create valid JWTs or authenticate a browser. Schema application alone does not supply this missing fixture.

Once the parent has actual authorized sessions and persistent fixtures, repeat Studio save → reload → owner readback and peer/outsider/anonymous denial against the real target, plus applicable profile/social-handle, notification, portfolio and brand edit readbacks. Keep server/provider/model gates disabled and label SQL, API/JWT and browser results independently. If these inputs remain unavailable, report **fixture UI verified / real Auth and shared-DB browser integration NOT TESTED**; do not turn older fixture screenshots or SQL role substitution into current runtime acceptance.

Source binding: the six harness files below were clean relative to observed HEAD. Capture fresh HEAD/diff and fingerprints before the parent's run because concurrent files are changing.

| File | SHA-256 at inspection |
| --- | --- |
| `scripts/studio-dev.mjs` | `6784bd411038d21d402fd12972f4914aff6690f2cb581d0eed9014a65a2e0679` |
| `vite.config.ts` | `84fd2bbbe8df879cb63ea73a4b7faef7b29c12f382ecbd76e42a75458b9e8787` |
| `src/test/studioPreview.ts` | `00e2d6d61529f6fad4dd4d93731c6c929e20cf41a9909c5344451659814ad000` |
| `src/test/studioPreviewJourneys.ts` | `2ce3a066fbcb4775287962c74b4c4b8c2bf1f9113b5af2ddd64f6620f6cd591b` |
| `src/test/studioIntegrationPreview.ts` | `81b6c46b8ef724d4456a1afaede05f1583a81d3c8459575f8b615a8c3541ef88` |
| `tests/review/support/fixture.ts` | `23ddd23972e03bf65e24fe8dd212aec3bbd126b67950fad197075819bd2f2b48` |
