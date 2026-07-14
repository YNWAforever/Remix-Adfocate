# Creator Activation Spine Implementation Report

Date: 15 July 2026
Branch: `codex/creator-activation-spine`
Reviewed implementation range: `b0b2940..a123fc0`
Live URL: [https://adfocate-2.vercel.app/](https://adfocate-2.vercel.app/)

## Outcome

The branch implements a coherent first-session activation slice from creator acquisition through the first suitable-mission decision. It reuses the existing TanStack Router, React Query, Hono, Supabase, localization, mission, wallet, progression, and notification architecture. It does not replace backend state machines or claim that downstream revision, publication, payout, or retention workflows are complete.

At commit `00e9c18`, the implementation range contains 49 changed files, 5,820 insertions, and 498 deletions, including the approved plan. The principal shipped behaviors are:

- Creator acquisition CTAs and bilingual expectations.
- Recoverable magic-link request and PKCE callback behavior.
- Resumable five-step onboarding with Back, skip, retry, saved progress, and real recommendation states.
- Pure activation/readiness/next-action derivation from existing query data.
- Action-led dashboard with independent section recovery.
- Rich mission facts and a pre-commitment summary before Apply/Join.
- Typed, PII-limited analytics and locale-aware creator date/currency formatting.

## Architecture

```text
Existing React Query hooks
  useMe + useOnboardingStatus + useSocialAccounts
  + useMyMissions + useMissionMatch + useEarnings
                    |
                    v
       useCreatorActivation (composition only)
                    |
                    v
       deriveCreatorActivation (pure domain logic)
          | readiness | next action | active work
          | sorted suitable missions | activated evidence
                    |
                    v
  presentational cards + onboarding/home/mission routes

Existing Hono/Supabase APIs remain authoritative for writes,
eligibility, mission status, welcome points, points/XP/cash awards,
notifications, and redemption.
```

The resolver has no network, storage, clock, React, or analytics dependency. `useCreatorActivation` composes six existing queries and returns independently recoverable sections. No duplicate activation store or new server endpoint was introduced.

## Changes by task

### Task 1: contracts and formatting

- Added `src/lib/activationAnalytics.ts` and tests.
- Added `src/lib/creatorFormatting.ts` and tests.
- Defined a typed activation event map, null-by-default analytics sink, device categories, HKD formatting, Hong Kong date formatting, and combined mission reward formatting.

### Task 2: acquisition and authentication

- Added auth error classification and `AuthFeedback`.
- Updated creator public CTAs, FAQ localization, login, callback, auth flow, and route tests.
- Added locale-readiness coordination, user-triggered retry, callback phase memory, preserved input, and created-only signup completion.
- Preserved strict `/admin` callback bypass and bootstrap/navigation ordering.

### Task 3: activation domain

- Added pure `deriveCreatorActivation` and `useCreatorActivation`.
- Added exact five-by-20 readiness rules, zero-weight future milestones, deterministic mission sorting, active mission filtering, next-action priority, and durable activation evidence.
- Kept earnings, recommendations, and readiness errors independently visible.

### Task 4: activation components

- Added `NextBestActionCard`.
- Added `ActivationProgressCard`.
- Added `EarningsSummaryCard`.
- Added `ActiveMissionSummary`.
- Localized optional accessible terms for deadline and reward context.

### Task 5: onboarding

- Added `OnboardingShell` and `OnboardingSteps`.
- Reworked `/onboarding` to resume persisted progress, cache successful steps, protect dirty Back navigation, support optional skips, retry recommendations, avoid repeating successful social writes, and show completion/readiness outcomes.
- Deduplicated step and completion analytics and implemented discard focus entry/restore.

### Task 6: dashboard

- Reordered `/home` around next action, active work, earnings, recommendations, and readiness.
- Kept points distinct from cash earnings and prevented unrelated query errors from collapsing the page.
- Expanded `MissionCard` to optional API-backed facts.
- Added per-mount view/click/recommendation analytics deduplication.

### Task 7: first mission decision

- Added `MissionCommitmentSummary`.
- Expanded mission list, match, facts, and detail presentation using existing typed mission data.
- Kept Apply/Join write handlers and gate errors intact.
- Added per-mission `mission_viewed` and suitable-mission activation tracking.

## File-level summary

### New production modules

- `src/lib/activationAnalytics.ts`
- `src/lib/authFeedback.ts`
- `src/lib/creatorActivation.ts`
- `src/lib/creatorFormatting.ts`
- `src/lib/useCreatorActivation.ts`
- `src/components/AuthFeedback.tsx`
- `src/components/NextBestActionCard.tsx`
- `src/components/ActivationProgressCard.tsx`
- `src/components/EarningsSummaryCard.tsx`
- `src/components/ActiveMissionSummary.tsx`
- `src/components/onboarding/OnboardingShell.tsx`
- `src/components/onboarding/OnboardingSteps.tsx`
- `src/components/MissionCommitmentSummary.tsx`

### Modified production modules

- `src/lib/auth-flow.ts`
- `src/lib/i18n.tsx`
- `src/lib/i18n.dict.ts`
- `src/components/MissionCard.tsx`
- `src/components/MissionFacts.tsx`
- `src/routes/_site.creators.tsx`
- `src/routes/_app.login.tsx`
- `src/routes/_app.auth.callback.tsx`
- `src/routes/_app.onboarding.tsx`
- `src/routes/_app.home.tsx`
- `src/routes/_app.mission.index.tsx`
- `src/routes/_app.match.tsx`
- `src/routes/_app.mission.$missionSlug.tsx`

### Automated coverage

New or expanded tests cover analytics, formatting, auth classification, auth feedback, login, callback, public creator CTAs, localization parity/hydration, activation derivation, hook composition, activation cards, onboarding shell/route, dashboard, mission card/facts, mission list/match/detail, and commitment summary.

## Activation event contract

The typed contract defines 16 events:

- `landing_page_viewed`
- `signup_started`
- `signup_completed`
- `auth_link_requested`
- `auth_link_failed`
- `onboarding_step_viewed`
- `onboarding_step_completed`
- `onboarding_abandoned`
- `social_profile_added`
- `onboarding_completed`
- `dashboard_viewed`
- `activation_action_viewed`
- `activation_action_clicked`
- `mission_recommendation_viewed`
- `mission_viewed`
- `creator_activated`

Allowed structured properties vary by event and include locale, device category, CTA source, auth method, classified error category, onboarding step and saved/skipped status, platform, reward type, creator level, action kind, mission ID/type, and activation path.

### Privacy boundary

The contract must not collect:

- Email address or phone number.
- Display name or creator ID.
- Social handle or free-text profile input.
- Caption, submission text, uploaded file, or content URL.
- Raw auth/provider error or callback query.
- Reviewer notes or other creator-authored content.

The sink defaults to `null`, producing no event delivery or console fallback until a provider is explicitly configured. Route effects guard against duplicate page, action, recommendation, mission, and activation events within a mount.

## Verification evidence

### Recorded task checkpoints

| Checkpoint | Command or scope | Recorded result |
| --- | --- | --- |
| Task 1 | Analytics and creator-formatting focused suite | 2 files, 15 tests passed |
| Task 2 | Exact focused auth/acquisition suite | 6 files, 44 tests passed |
| Task 2 review | Auth feedback, public smoke, login, callback, i18n | 5 files, 43 tests passed |
| Task 2 final full suite | `npm.cmd test -- --reporter=dot` | 118 files and 598 tests passed; 37 files and 248 tests skipped; existing `activeProps` DOM warning noted |
| Task 3 | Activation resolver and composition hook | 2 files, 15 tests passed |
| Task 4 | Activation components and dictionary | 2 files, 18 tests passed |
| Task 5 final | Onboarding route, shell, and dictionary | 3 files, 30 tests passed |
| Tasks 1–5 | Per-task `npm.cmd run type-check` | Exit 0; existing TanStack Router warning for `_site.smoke.test.tsx` noted |

These checkpoints prove their recorded commits, not the final release state by themselves.

### Current-branch focused run

Command run at `a123fc0`:

```text
npm.cmd test -- src/lib/activationAnalytics.test.ts src/lib/authFeedback.test.ts src/lib/creatorFormatting.test.ts src/lib/creatorActivation.test.ts src/lib/useCreatorActivation.test.tsx src/components/AuthFeedback.test.tsx src/components/creator-activation.test.tsx src/components/onboarding/OnboardingShell.test.tsx src/components/MissionCommitmentSummary.test.tsx src/routes/_site.smoke.test.tsx src/routes/-_app.login.test.tsx src/routes/-_app.auth.callback.test.tsx src/routes/-_app.onboarding.test.tsx src/routes/-_app.home.test.tsx src/routes/-_app.mission.index.test.tsx 'src/routes/-_app.mission.$missionSlug.test.tsx'
```

Result: exit 0; all 16 test files and 146 tests passed. The review fix explicitly maps `applied` and `declined`, and the full-mission regression confirms that unavailable missions do not also display positive eligibility.

### Release checks

Fresh release output from the final branch state:

```text
npm.cmd run type-check
npm.cmd run lint
npm.cmd test
npm.cmd run build
git diff --check b0b2940..HEAD
```

| Check | Result |
| --- | --- |
| `npm.cmd run type-check` | Exit 0; existing TanStack Router warning for `_site.smoke.test.tsx` |
| `npm.cmd run lint` | Exit 0; 0 errors and 2 `react-hooks/exhaustive-deps` warnings, one in the onboarding route and one in an ignored scratch copy |
| `npm.cmd test -- --reporter=dot` | Exit 0; 122 files and 655 tests passed; 37 files and 248 integration-dependent tests skipped |
| `npm.cmd run build` | Exit 0; ESM check, route generation, TypeScript, and Vite build passed; existing route-file and chunk-size warnings noted |

The relevant local Supabase integration suites should be run only when local configuration is available. Absence of that environment must be recorded rather than converted into a passing result.

## Browser verification matrix

Authenticated production results are not claimed. Supabase email rate limiting and one-time PKCE magic links constrained repeat production authentication. Any local result must remain labeled local; any public live result must remain labeled unauthenticated unless a fresh disposable-account flow is completed.

| Surface or route | Result | Evidence level |
| --- | --- | --- |
| Local `/creators` | HTTP 200 from Vite on `127.0.0.1:5173`; public smoke test passes | Transport and automated render only |
| Local `/login` | HTTP 200 from Vite; auth feedback and login tests pass | Transport and automated render only |
| Local `/onboarding`, `/home`, `/mission`, `/mission/:slug` | Not authenticated: no local Supabase environment files are present | Not visually verified |
| In-app Browser, Chrome control, Windows computer control | Each trusted runtime failed to initialize under the same Windows deny-read ACL | No visual evidence |
| `agent-browser` | CLI absent; environment rejected third-party download-and-execute via `npx` | Not run |
| Production authenticated flow | Not retried because the provided PKCE link was one-time and email rate limiting had already constrained the flow | Not claimed |

The required matrix covers:

- Routes: `/creators`, `/login`, `/onboarding`, `/home`, `/mission`, and a real `/mission/:slug`.
- Viewports: 375x812, 390x844, 768x1024, and 1440x900.
- English and Traditional Chinese.
- Keyboard-only traversal and visible focus.
- 200% text zoom and reduced motion.
- Loading, error, empty, long-copy, and real-data states.
- Console errors, horizontal overflow, obscured actions, and false financial/mission claims.

## Screenshot evidence

The three baseline files were copied without recompression. Source and repository file sizes and SHA-256 hashes match.

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| [before-landing.png](assets/creator-ux/before-landing.png) | 600,107 | `A7F3183580FA4CC076EDD4230AE7B9B226F5398328E4729F98B1EA643DCC91FF` |
| [before-creators.png](assets/creator-ux/before-creators.png) | 738,578 | `C9280E1142F46C5886CF57076E161103588D4CBABA56966B8D5F9F241EFE304C` |
| [before-login.png](assets/creator-ux/before-login.png) | 28,293 | `290C70CC040384C10266D039B7A56CE40ADBB5A328B2B6D9DAB23405B174B0D3` |

### After-change captures

No `after-*` image is committed. Creating placeholder or production-old captures would misrepresent the current local branch, so the requested after-change mobile/desktop images remain pending until a trusted visual-control surface and an authenticated local or preview environment are available.

## Deferred backend and product dependencies

- Canonical active-mission states beyond the current submission record.
- Draft/file storage, upload validation, immutable submission versions, revision and resubmission.
- Publication approval, proof, validation, completion, and reward-pending states.
- Withdrawal eligibility, payment method, payout processing, paid/failed/reversed transactions, compliance, and disputes.
- Product/experience, usage-rights, cancellation, reimbursement, and performance-reward fields when missions need them.
- Notification preferences, external delivery channels, deadline reminders, and feedback-ready messages.
- Operational daily check-in, streak, and weekly-goal ledgers if the product retains those claims.
- Analytics provider configuration, data governance, retention, consent, and downstream funnel definitions.
- Regular validation of marketing level unlocks and income examples against real entitlement and supply.

## Product-owner decisions

1. Choose the canonical creator-facing active-mission state model and its mapping to persisted records.
2. Define revision ownership, response times, version history, and resubmission rules.
3. Define publication proof, validation, and content-usage-rights requirements.
4. Define when cash is pending, available, withdrawable, processing, paid, failed, or reversed.
5. Confirm whether daily check-in remains a product promise; remove the claim if no auditable mechanic is planned.
6. Validate every level benefit and public income example as guaranteed, eligibility-based, or illustrative.
7. Decide analytics provider, consent, retention, access, and deletion policy.
8. Decide notification categories, channels, quiet hours, and creator controls.

## Remaining priorities

- P1: Build the active-mission through payout state spine.
- P1: Audit wallet zero/error behavior and add a truthful payout lifecycle.
- P1: Remove or implement unsupported daily check-in language.
- P1: Complete the browser/accessibility matrix and authenticated verification when safe evidence is available.
- P2: Add useful mission sorting/filtering when real mission volume justifies it.
- P2: Connect learning completion to progression only after a verified assessment/reward rule exists.
- P2: Add notification preferences and action-conversion measurement.
- P3: Refine celebrations and motion after confirmed outcome states are complete.

## Recommended next phase

Proceed with a mobile-first active-mission workspace. Start with the canonical states and backend facts, then implement one vertical flow from accepted mission through review, publication proof, reward validation, and payout visibility. Preserve the current principles: one next action, source-backed facts, independent recovery, PII-limited analytics, and no reward claim before confirmation.
