# Application-turn UI verification

Run: 2026-11-01 HKT. Same branch `codex/kocmax-studio-stages-1-2`, HEAD `5c60020091e8e6fee934b61c498bf7518944c433`. Product checks used the in-app browser against the parent-owned Vite fixture at `http://127.0.0.1:8783`. Edge was used only to inspect the authorized Supabase backup/connection pages.

## Evidence boundary

The visible banner was **本機示例 · 無真實連接**. The fixture uses a dummy Supabase URL/key and does not load the real API server. The integration adapter was established with `?integrationPreview=d0`. No OAuth, Google Picker, external AI, real upload, Auth creation, email, real payment or deployment was exercised. These results verify the rendered product and simulated response handling, **not shared-database Auth/RLS, JWTs or durable browser persistence**.

Widths: 390×844 mobile, 1440×1000 desktop, 320×844 narrow visitor, 390×360 short dialog. Measured document width did not exceed viewport width on the inspected connections, Brief, visitor, operator and redemption states. Temporary size changes can remount responsive UI, so subsequent interactions used the settled layout.

## Observed journeys

| Area | Viewport and action | Observed result |
| --- | --- | --- |
| Connections | Mobile and desktop D0, both providers | Instagram and Drive connection buttons disabled; no account or sync fabricated. Basic creation link remained available. D0 was explicitly re-established with the query parameter for the final desktop check after role changes. |
| Creator home | Mobile and desktop | Ten task cards, composer, mission context and topic selector available. 200 fixture points and 800 XP remained unchanged after Brief/save/submission. Login streak unavailable, with no rest penalty. |
| Evidence | Mobile | Saved an own-observation source with actual question, platform, local observation time, `HK / zh-Hant`, and **未驗證**. Added a second private source without sharing rights. |
| Private Brief | Mobile | Saved v1 privately. Selecting the paragraph containing the private source displayed an alert and disabled sharing confirmation and transfer. |
| Original workflow | Mobile | Selected an eligible own-content paragraph, exact mission and deliverable, explicitly confirmed it, then received a fixture transfer receipt and draft version 1. Original draft contained only the selected paragraph. Required disclosure checklist blocked submission until checked; submission then showed **審批中** and version 1. No reward was issued. |
| History and edit safety | Desktop | Returned through home/history without reloading and reopened saved private Brief v1. Changing a previously confirmed paragraph cleared confirmation and disabled transfer. Saved a new private version. This is in-memory navigation continuity only. |
| Wallet failure | Mobile | Failed point read showed **暫未能讀取**, with retry/error messages, rather than zero. Previously loaded transaction/cash information remained alongside explicit refresh errors. |
| Brand editor | Mobile | Missing deliverable and publication instructions produced field errors without losing the edited title. After supplying required fields, save returned to the mission list with the new fixture title. No publication action taken. |
| Brand conflict/privacy | Desktop | Simulated version conflict retained unsaved title and showed the conflict explanation. Permission denial removed the form; a subsequent load error did not resurrect the private title/form. |
| Operator applications | Desktop | Rejection was disabled without a reason. Supplying a reason and rejecting the simulated application removed it from the pending queue. This application screen did **not** present a second confirmation dialog; no cancellation result is claimed. |
| Operator creator case | Mobile | Internal note and review summary saved and read back. Social account remained unsynced; ownership and risk remained unknown. No reward/settlement action taken. |
| Restricted staff | Mobile | Reviewer could not obtain reward-handoff data/actions. Finance viewer home exposed its reward-handoff entry and explained that settlement requires an authorized administrator. Fixture role behavior only. |
| Visitor guard | Mobile | Direct `/studio` as visitor redirected to `/login?next=%2Fstudio`; no private discussion was displayed. |
| Visitor navigation | 320px/390px and desktop | Public homepage, mission preview, navigation expansion/collapse and sign-up destination were available. Desktop English labels and explanation rendered; example mission title remained its original language. No sign-up request sent. |
| Reward cancellation | Desktop / 390×360 | Confirmation showed the exact reward and 100-point cost. Desktop Escape and mobile Cancel returned focus to the redeem trigger. The fixture balance stayed 200; no redemption committed. |

Browser error-log inspection returned no captured errors at the desktop visitor checkpoint. Expected mocked error states were inspected separately. This is not a network interception audit or a real-device keyboard/screen-reader test.

## Automated checks performed in this turn

- Three inspected, mock-only Vitest files passed: `studioIntegrationPreview.test.ts` (10), `Connections.test.tsx` (17), `StudioWorkspace.test.tsx` (4): **31/31** tests, 3/3 files. Integration/disposable database flags were explicitly off. No real integration suite was invoked.
- The separate local SQL rehearsal passed its existing eight checks and five role-journey groups. The new committing wrapper passed six local checks with zero network attempts. Hosted metadata guards are excluded from the local wrapper rehearsal because PGlite cannot reproduce the hosted catalog; live read-only preflight was checked independently.

## Screenshots

- [Mobile connections](screenshots/mobile-connections.png)
- [Desktop D0 connections](screenshots/desktop-connections-d0.png)
- [Mobile selected-content transfer receipt](screenshots/mobile-brief-transfer.png)
- [Desktop creator home](screenshots/desktop-home.png)
- [Mobile wallet failure](screenshots/mobile-wallet-error.png)
- [Mobile brand list after save](screenshots/mobile-brand-list.png)
- [Desktop retained-input conflict](screenshots/desktop-brand-conflict.png)
- [Mobile operator review](screenshots/mobile-operator-review.png)
- [320px visitor homepage](screenshots/mobile-visitor-320.png)
- [Desktop visitor in English](screenshots/desktop-visitor-en.png)
- [Short mobile reward dialog](screenshots/mobile-short-dialog.png)

Some screenshot captures dismissed transient dialogs in the automation surface; cancellation/focus behavior was therefore checked directly without an intervening capture. Screenshots are supporting visual evidence, not assertions of database writes.

Remaining acceptance: actual approved test identities and persistent fixtures; normal Auth/JWT sessions; shared-DB owner/peer/outsider reads and denials; reload durability; provider pilot acceptance. None is cleared by the mock UI pass or schema application alone.

## TLS-repair continuation checks

Additional checks on 2026-11-01 HKT, before any database application, reused the same local fixture and in-app browser:

- At 390×844, both D0 real-provider connection buttons were disabled; document width was 384px. The basic-creation link reached the creator homepage, showing ten cards, private discussion, 200 example points, 800 example XP, and no login penalty.
- Choosing the Brief task card preserved the selected mission and filled the composer. Starting the fixture discussion exposed private chat, evidence and Brief tabs. The evidence view showed no connected account, zero sources, explicit AI/sharing rights and unverified-source language.
- The attempt to fill/save a local example evidence record was rejected by automatic approval review because it was classified as creating persistent browser fixtures. This continuation did not retry or bypass the rejection. No saved source/Brief or new transfer acceptance is claimed from this attempt; the earlier completed fixture journeys above remain their separate evidence.
- At 1440×1000, the empty Brief remained private and unsaved; save was disabled, and document width was 1434px. Normal navigation and explicit D0 URL restored the offline connections screen; both real-provider buttons were disabled, again with no horizontal document overflow.
- Navigating to `/connections` without the query can show the ordinary **mock** connect buttons. No connection button was used. The final explicit `?integrationPreview=d0` view was verified separately, with both real-provider buttons disabled.
- A direct navigation initially returned `ERR_ABORTED`; the existing page remained available. Normal navigation succeeded and a later explicit D0 navigation loaded successfully. This was not counted as a successful first navigation or a database result.
- Temporary viewport overrides were reset. Application source code was not changed by the TLS repair; the previously passed 31 mock tests were not unnecessarily rerun.

Supporting captures: [mobile D0](screenshots/mobile-connections-tls-followup.png), [desktop private unsaved Brief](screenshots/desktop-private-brief-tls-followup.png), [desktop D0](screenshots/desktop-connections-tls-followup.png).

## Native read-only backup repair continuation

On 2026-11-01 HKT, the unchanged local fixture at `http://127.0.0.1:8783/connections?integrationPreview=d0` was inspected again in the in-app browser. At 390×844 and 1440×1000, the Instagram and Google Drive real-connection buttons remained disabled. Document widths were respectively 384px and 1434px, without horizontal overflow. The screen retained the manual basic-creation entry and explicit offline/unverified account status. No form was filled, no fixture record was saved, and no provider connection was attempted. The viewport override was reset afterward.

The old convenience tab handle could not be used in this continuation. The documented existing-browser `tabs.get('27')` API restored access to the same tab; no browser switch or new app connection was needed. This is browser-control recovery, not an application fix.

Supporting captures: [mobile D0 v3 follow-up](screenshots/mobile-connections-v3-followup.png), [desktop D0 v3 follow-up](screenshots/desktop-connections-v3-followup.png). These remain mock/offline UI evidence, not hosted Auth, RLS, persistence or backup acceptance.

## After the approved database application

After migration `20261031201901` succeeded, the same local mock build was checked in a fresh in-app browser tab. The old tab handle could not be reclaimed in this turn. The new tab initially used the visitor scenario and correctly showed login for the private route. Selecting the existing creator scenario and navigating to the explicit D0 URL displayed the offline connections screen. No real sign-in, account creation, source/Brief save, review, reward or provider operation was performed.

- At 390×844, document width was 384px. Both real-provider connection buttons were disabled.
- At 1440×1000, document width was 1434px, and the later check was 1440px; neither exceeded the viewport. Main-content width was 1210px. Both real-provider connection buttons were disabled.
- The viewport override was reset and the local preview tab retained. Application source and fixture data definitions were unchanged; the earlier 31 mock tests remain separate evidence and were not rerun without a code change.

The [mobile capture](screenshots/mobile-connections-post-apply.png) is valid visual evidence. The initial desktop screenshot was cropped by the browser capture surface; a full-page retry failed. It is not claimed as a complete desktop screenshot. The desktop DOM/viewport checks above passed, and the [earlier complete desktop capture](screenshots/desktop-connections-v3-followup.png) remains evidence of the unchanged layout. No hosted JWT/RLS or persistent cross-session journey is inferred from these mock checks.
