# Mission approved-image publishing entry — mock acceptance

Date: 2026-11-06 (Asia/Singapore)
Branch: codex/kocmax-studio-stages-1-2
Scope: Native inline implementation and one independent scoped review. All work remains local and uncommitted.

## Delivered

A DEV/fixture-only entry beside original publication instructions binds one approved JPEG and exact caption to the creator, account, revision, source-sharing rights and disclosures. It reuses PublishPreview and MockNativeJourney. Consent is unchecked initially. Receipt return only focuses the original proof form; it does not populate, submit or award anything. The dedicated sample submission ends in 931; the existing video fixture is preserved. All non-GET writes to this sample are refused.

Context is revalidated after every asynchronous adapter boundary. Changed context or unmount disposes the active journey; attempted sessions cannot silently retry. Required disclosures retain their exact span in the approved caption.

## Automated evidence

- Selected combined regression: **346/346**, 26 files, including original task/query/race flows, saved-output cards, Studio, native mock journey and production-bundle exclusion. Log: `.superpowers/sdd/2026-11-06-kocmax-mission-publish-entry/final-regression.log`.
- Review regressions: context revocation RED then GREEN; multiple nonadjacent disclosure RED (with proper URL stub) then GREEN. Final focused UI 4/4; wrapper/native/UI 30/30.
- TypeScript: exit 0.
- ESLint for all phase TS/TSX files: zero errors, one warning about the mutable generation counter in effect cleanup. The counter intentionally invalidates pending async responses.
- This is selected regression acceptance, not a full-repository or live Auth/provider acceptance claim.

## Direct browser evidence

In-app browser, localhost:8772, synthetic data only:

- 390x844 and 1440x1000: approved task → exact preview → unchecked consent → mock confirmation → labelled receipt → existing proof-form focus. Proof URL remained empty. No horizontal overflow (scroll widths 384/1434).
- Desktop reload: zero prior success headings, one fresh rehearsal entry; no automatic publication.
- Desktop six blocked scenarios: unsupported partnership label, missing account, revoked grant, private source, changed approved version and mismatched account all disabled entry.
- Unknown result: query preserves unknown outcome and explicitly states no republishing.
- Mobile same-workspace peer: direct sample task shows access denied; switching back restores owner access.
- Viewport override reset; preview retained as deliverable.
- Screenshots: `mission-publish-mobile.png`, `mission-publish-desktop.png`.
- Separate browser Back/Forward, HTTP401 and cancel/edit checks were not repeated in this final pass; component/session regressions cover relevant invalidation. No live multi-account test was run.

## Review decisions and remaining limits

1. Retain worktree/evidence without commits; review scoped phase files rather than unrelated dirty baseline. Cost: no acceptance claim for the entire dirty branch.
2. Read owner identity inside DEV entry; no new production-route identity hook. Cost: authority remains synthetic.
3. Upgrade multiple-disclosure finding to Important because valid approved captions were blocked; fix preserves original caption. Cost: integration with a future live provider still needs separate acceptance.
4. Reviewer declined browser/build acceptance: controller supplied direct browser and automated build evidence above. Cost: only the enumerated viewports and scenarios are proven.
5. Reviewer declined real provider/SQL/auth/cross-tab behavior: those remain explicitly outside this mock. No live or durable guarantees.

Resolved in the follow-up below: expired unattempted previews can now renew on reopening; attempted records remain protected.

No deployment, SQL application, real connection, publication, proof submission or reward write. Native official-provider blockers remain unchanged.

## Preview renewal follow-up — 2026-11-06

User continuation authorized resolving the deferred minor on the same branch. Registry now replaces only a non-disposed, unattempted session whose prepared preview has reached expiry. It disposes the old session before issuing a new preview. Both old-session confirmation and replaying its nonce against the new session fail. Completed and outcome-unknown sessions retain their attempted record after expiry; neither can publish twice. Cancel/reopen before expiry continues to reuse the valid preview and requires unchecked consent again.

Verification:
- Renewal regression observed RED (same expired session), then GREEN. Three new tests cover expiry boundary, old confirmation invalidation, and attempted published/unknown sessions.
- 232/232 selected tests across 20 files, including original route tests, native mock journey, ownership, and production bundle isolation. Log: `.superpowers/sdd/2026-11-06-kocmax-mission-publish-entry/renewal-regression.log`.
- TypeScript exit0. Changed-file ESLint exit0, no warnings. Existing UI cleanup warning remains outside these two changed files.
- Direct in-app browser: 390x844 cancel/reopen requires fresh consent; 1440x1000 confirmation yields labelled sample receipt. Neither viewport overflows. Screenshot: `mission-publish-renewal-desktop.png`.
- Five-minute expiry itself was verified with controlled-time unit tests, not by waiting five minutes in the browser. No live provider, real account, database or reward acceptance is implied.
- Scoped self-review: replacement occurs only before any attempt and while the session is active; source/owner/grant revalidation still occurs when preparing and confirming. No second independent review was requested for this small follow-up.

No commit, deployment, SQL application, connection or real publication.
