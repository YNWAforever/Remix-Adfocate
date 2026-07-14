# Adfocate 2.0 Creator Experience Audit

Date: 15 July 2026
Live product: [https://adfocate-2.vercel.app/](https://adfocate-2.vercel.app/)
Implementation slice: creator acquisition through the first suitable-mission decision

## Executive assessment

Adfocate already has the foundations of a creator growth platform: bilingual public and authenticated routes, missions, application and submission records, points, cash earnings, XP levels, a Creator Passport, notifications, learning content, and reward redemption. The main activation weakness was not a lack of features; it was that the first-session path did not consistently answer what to do next, why it matters, what is real, and how to recover when one part fails.

This slice creates a clearer activation spine:

1. Creator-specific public calls to action lead to account creation with accurate expectations.
2. Magic-link authentication classifies recoverable failures without exposing provider messages.
3. Onboarding resumes persisted progress, separates saved server state from local navigation, supports Back and optional skips, and ends with real recommendations or honest alternatives.
4. The dashboard leads with one next-best action, then active work, earnings, recommendations, readiness, news, and secondary navigation.
5. Mission cards and detail pages use API-backed decision facts and place a commitment summary immediately before Apply or Join.

The implemented work is a meaningful P1/P2 activation improvement, not a full creator-workflow redesign. Active-mission guidance, revision history, approval-to-publication, proof submission, payout operations, and retention programs still require separate product and backend work.

## Method and evidence

The assessment combines:

- The supplied product brief and three public-page baseline captures.
- The indexed code knowledge graph for architecture and route discovery. The index described the main repository before this branch, so branch-specific conclusions were checked against current source and tests.
- Current branch source at commit `00e9c18`, covering commits `b0b2940..00e9c18`.
- Supabase migrations and server routes for mission, reward, XP, wallet, notification, trust, and redemption rules.
- Focused component, route, domain, localization, and auth tests recorded during Tasks 1–7.

Target browser viewports for final verification are 375x812, 390x844, 768x1024, and 1440x900. Public routes can be checked without an account. Authenticated production verification is constrained by one-time PKCE magic-link behavior and the previously encountered Supabase email rate limit. This document therefore does not treat the authenticated production journey as verified. Local or test evidence is identified separately from live production evidence.

## Scope boundary

### Implemented in this activation slice

- `/creators` acquisition copy, creator CTA routing, FAQ localization, and PII-free acquisition analytics.
- `/login` and `/auth/callback` error classification, accessible recovery, preserved input, locale-hydration safety, and phase-aware PKCE retry.
- `/onboarding` resumable five-step flow, saved progress, Back/Skip behavior, discard confirmation, recommendation recovery, completion summary, and activation analytics.
- `/home` next action, active mission summary, honest earnings, points kept separate, unlocked recommendations, readiness, independent query errors, and deduplicated analytics.
- `/mission`, `/match`, and `/mission/:slug` richer API-backed facts, availability and lock labels, mission-view analytics, and pre-commitment summary.

### Deferred product slices

- A guided active-mission workspace with owner, due date, checklist, and canonical timeline for every state.
- Draft storage, uploads, validation, submission history, structured reviewer feedback, revision and resubmission.
- Approval-to-publication instructions, publication proof, validation, completion, reward pending, and paid states.
- Withdrawal eligibility, payment method, failed or reversed payouts, compliance, disputes, and payout support.
- Operational weekly goals, creator streaks, notification preferences, and evidence-based retention experiments.

## Creator route inventory

| Route | Purpose and primary action | Current strength | Remaining friction or risk | Severity | Status |
| --- | --- | --- | --- | --- | --- |
| `/` | Public product landing; navigate to a relevant proposition | Strong branded entry point and broad ecosystem context | Creator-specific value competes with wider platform messaging | P2 | Public baseline captured; wider landing redesign is outside this slice |
| `/creators` | Explain creator value; create account or browse missions | Creator CTA now leads to `/login`; FAQ is bilingual; acquisition events are typed | Some marketing level and income examples need product-owner validation against actual eligibility and supply | P1 | Activation path improved; claims audit remains |
| `/login` | Request an email magic link or use an available provider | Visible labels, field descriptions, busy state, preserved input, specific recovery actions | Delivery and rate limiting remain external dependencies | P0 | Recovery improved and tested |
| `/auth/callback` | Exchange PKCE code, bootstrap creator, route to onboarding/home | Admin bypass preserved; retry resumes the failed phase without replaying a successful exchange | A one-time link cannot support repeated production testing; failure support still depends on provider availability | P0 | Recovery improved and tested; authenticated production not claimed |
| `/onboarding` | Set profile basics, interests, social details, view recommendations, complete | Persisted progress, local Back, optional skips, retry, dirty-state confirmation, honest empty state | Payment readiness and verified ownership remain later actions; recommendation quality depends on available mission data | P1 | First-session funnel improved |
| `/home` | Identify today’s next action and current work | Action-led order; earnings and points are separate; section failures do not collapse the page | Active mission summary is not yet a full workflow; notifications and feedback are secondary | P1 | Daily command-centre foundation implemented |
| `/mission` | Browse missions by category and open details | Cards now expose available mission, access, reward, schedule, effort, quota, eligibility, and status facts | No volume-dependent sorting or advanced filters; missing API facts are correctly omitted | P2 | First-decision clarity improved |
| `/match` | Review ranked recommendations | Fit rationale, score, lock, availability, and reward facts are visible | Locked cards remain explorable but do not yet provide a dedicated remediation panel | P2 | Matching clarity improved |
| `/mission/:slug` | Understand a mission; Apply, Join, or submit content URL | Commitment summary is immediately before action; gate errors deep-link to profile; mission analytics are deduplicated | Current joined-state submission is a URL textarea, not a guided creation/revision/publication workspace | P1 | First commitment improved; downstream work deferred |
| `/my` | Review a creator’s mission records | Existing mission records support durable activation evidence | Status guidance and next action per record need a future workflow pass | P1 | Not changed in this slice |
| `/profile` | Maintain creator profile and social trust | Supports categories, handles, and verified social ownership used by readiness and eligibility | Progressive profiling, sensitive-field explanations, and payment setup sequencing need a dedicated audit | P1 | Used as recovery destination |
| `/wallet` | View points, earnings, and histories | Separate points and cash data sources exist | Existing wallet can render numeric zero before/error fallback and lacks withdrawal/payment-method lifecycle | P1 | Dashboard earnings card hardened; wallet redesign deferred |
| `/redemption` | Spend points on available gifts | Atomic redemption and history exist | No evidence in this slice of broader reward discovery or fulfillment support UX | P2 | Not changed in this slice |
| `/passport` and `/passport/:token` | Show or share verified creator progression | Data-derived scores and badges create meaningful recognition | Score explanations and benefit guarantees need ongoing content governance | P2 | Not changed in this slice |
| `/notifications` | Review status updates and deep-link to work | Backend triggers cover key mission, level, campaign, and redemption transitions | Preferences by category/channel and notification-to-action measurement are absent | P2 | Future retention slice |
| `/guide` | Learn mission, points, wallet, and creator topics | Provides a real fallback when no mission is suitable | Learning completion and its value are not yet connected to a verified progression rule | P2 | Used as honest growth fallback |

## Prioritized findings

| Screen or route | Problem | User impact | Evidence | Severity | Recommendation | Implementation status |
| --- | --- | --- | --- | --- | --- | --- |
| `/login`, `/auth/callback` | Raw or generic auth failures did not provide phase-specific recovery | Creator can abandon before account creation | Auth classifier, feedback component, PKCE phase tests | P0 | Classify known failures, preserve input, offer retry/new link/back actions, never expose raw provider text | Implemented |
| `/onboarding` | Server progress and local navigation could diverge | Repeated work, skipped steps, or lost confidence | Persisted-step, cache, stale-response, and Back-navigation regression tests | P1 | Treat server state as canonical progress while preserving intentional local Back | Implemented |
| `/onboarding` | A recommendation request could block completion | Creator cannot finish when matching is empty or unavailable | Loading/error/empty tests and recommendation retry | P1 | Isolate recommendation state and offer profile/guide alternatives | Implemented |
| `/home` | Decorative hierarchy competed with actionable work | Creator cannot quickly answer “what now?” | Exact-order route tests | P1 | Lead with one next-best action, active work, earnings, opportunities, then readiness | Implemented |
| `/home` | One failed query could undermine trust in unrelated sections | Earnings or recommendation outage makes the whole dashboard feel broken | Section-isolation tests | P1 | Keep me, active missions, recommendations, earnings, and readiness independently recoverable | Implemented |
| `/home`, `/wallet` | Points and cash can be conflated or missing data can look like zero income | Financial misunderstanding | Separate points/earnings components and formatter tests | P1 | Keep points and HKD distinct; render unavailable/error states without fabricated cash | Implemented on dashboard; wallet remains |
| `/mission`, `/match` | Thin cards required creators to open multiple missions to compare | Slower discovery and poor-fit applications | Mission-card and list/match route tests | P2 | Show only available decision facts: access, deliverables, reward, deadline, effort, eligibility, availability, rationale | Implemented |
| `/mission/:slug` | Apply/Join appeared without a concise commitment recap | Creator can commit without understanding deliverables or reward | Commitment component and DOM-order tests | P1 | Put an API-backed summary immediately before Apply/Join | Implemented |
| Mission workflow | Existing statuses do not form a guided mobile workspace through revision/publication/payout | Creator cannot see owner, deadline, requirements, or full history at every stage | Current route and submission model; no revision/publication UI in this slice | P1 | Define a canonical state model and build state-specific next actions/history | Deferred |
| Retention | Daily check-in and streak language is not backed by a reviewed creator-facing implementation | Expectations may exceed actual behavior | Legal/i18n copy mentions check-in; no corresponding creator check-in or streak flow found | P1 | Remove unsupported claims or implement an auditable, non-manipulative mechanic | Product decision required |

## Onboarding audit

### Strengths after this slice

- Five visible steps with a percentage progress model.
- Persisted onboarding state is loaded and resumed; successful server responses update the cache.
- Back navigation does not erase confirmed server progress.
- Optional interests and social steps can be skipped, while copy explains their matching benefit.
- Dirty Back navigation requires explicit discard and manages focus between Back, discard, and cancel.
- Social retries avoid repeating already successful handle connections.
- Completion awards the existing idempotent 100-point welcome bonus through a service-role-only RPC.
- Completion renders readiness and a useful next route instead of ending at a dead end.

### Remaining issues

- Readiness is not payment setup. Payment readiness is explicitly zero-weight and not applicable in the activation score.
- A self-entered handle proves only that a social profile was added; verified ownership is a separate milestone.
- No points or XP are awarded for readiness milestones, form entry, or optional profile completion. This is intentional.
- More sensitive payment/compliance collection should happen only when the creator has a relevant earning or withdrawal need.

## Dashboard audit

The implemented order is:

1. Identity controls and compact welcome.
2. Next-best action.
3. Active mission summary.
4. Available/pending cash earnings, with points shown separately.
5. Unlocked suitable mission recommendations.
6. Activation readiness.
7. News and secondary navigation.

The next-action resolver currently emits supported actions for a joined mission, incomplete onboarding, locked matches without verified social ownership, the highest-scoring unlocked match, missing categories, or the growth guide. Typed future action names exist for urgency, feedback, and publication, but the resolver does not emit them without supporting workflow evidence.

Readiness comprises five equal 20-point milestones: account, onboarding, interests, social added, and social ownership verified. Payment readiness, first mission viewed, and first mission joined remain visible but do not increase readiness.

## Mission-flow audit

Mission list and match cards now receive only API-backed values. Missing values are omitted rather than guessed. Full quota is labeled unavailable; no countdown, demand, or urgency claim is invented. Conditional cash and points remain separate facts.

Mission detail preserves the existing Apply, Join, submit-content, gate-error, status, and hook-helper behaviors. The new commitment summary can show deliverables, platforms, valid deadline, points, cash, and effort. Usage rights, cancellation terms, and product/experience details are not shown because this slice did not add typed fields for them.

The current persistence model supports `applied`, `joined`, `submitted`, `under_review`, `approved`, `rejected`, `declined`, and `expired`. It does not yet represent the richer creator-facing workflow requested for product pending, product received, revision requested, approved to publish, published, proof submitted, validating, reward pending, or paid.

## Earnings and trust audit

- Mission approval credits the configured points reward and any positive cash reward; approval is state-guarded and service-only.
- Dashboard cash shows available and pending earnings through a dedicated component and locale-aware HKD formatting.
- Points remain a separate balance and redemption currency.
- Mission cards do not describe estimated or conditional cash as guaranteed beyond the API’s configured `cash_reward` field.
- The current wallet does not expose withdrawal eligibility, payment method, payout timing, failed/reversed payment, tax/compliance, or dispute states. Those are backend and product dependencies.
- Public marketing income examples and unlock descriptions should be validated regularly; they are not transaction guarantees.

## Gamification audit

Meaningful existing mechanics include server-controlled welcome points, mission points, mission and campaign XP, L0–L6 levels, data-derived Passport scores and badges, eligibility gates, point redemption, and level/status notifications. The strongest mechanics reward accepted work, verified identity, reliability, quality, or campaign outcomes.

The activation readiness meter is guidance, not a currency. It grants no points or XP. This avoids rewarding low-quality profile entry and keeps readiness distinct from mission performance.

Daily check-in is mentioned in existing copy, but no reviewed creator-facing check-in or streak implementation was found. Weekly goals and streak rewards should not be described as operational until there is a durable ledger, time-zone rule, missed-day policy, anti-abuse behavior, and opt-out-friendly UX.

See [GAMIFICATION_SYSTEM.md](GAMIFICATION_SYSTEM.md) for canonical rules and guardrails.

## Accessibility findings

Implemented evidence includes visible form labels and descriptions, semantic alerts and status regions, unique feedback IDs, explicit button busy states, focus-visible styles, 44px-class onboarding actions, semantic headings, accessible progress text, discard-dialog focus entry/restore, and reduced-motion classes on acquisition actions.

Automated tests cover semantics and focus behavior, but they do not replace browser checks. Keyboard-only traversal, 200% text zoom, contrast in every state, screen-reader announcements, reduced motion, and sticky-action overlap still require final browser evidence across the target viewports.

A final Web Interface Guidelines scan also found legacy follow-ups in touched screens: avatar and mission images rely on CSS sizing without explicit `width` and `height`, the existing mission-submission URL textarea needs a dedicated visible label and field metadata, and mission category filter state is not reflected in the URL. These pre-date the activation slice but remain actionable accessibility, performance, and navigation-state debt.

## Responsive findings

The touched routes use mobile-first single-column layouts and expand to two-column or wider arrangements at large breakpoints. Mission commitment is placed adjacent to details on desktop and before action in DOM order. Cards omit absent facts, which reduces empty density on narrow screens.

Final evidence still needs to confirm no horizontal overflow, clipped bilingual copy, obscured buttons, unsafe fixed elements, or broken focus order at 375x812, 390x844, 768x1024, and 1440x900.

## Localization and UX writing

The activation copy contract is present in English and Traditional Chinese with dictionary parity tests. Dates use `en-HK` or `zh-Hant-HK` in the Hong Kong time zone, and money uses HKD formatting. Error copy explains the category and a recovery action without exposing provider details.

The wider public creators page still contains some legacy inline bilingual marketing strings outside the new dictionary contract. That content should receive a separate copy-quality and encoding pass before broader localization claims are made.

## Loading, empty, and error states

- Auth: classified alert with retry, new-link, or login recovery.
- Onboarding status: retry without discarding saved progress.
- Recommendations: independent loading, error/retry, empty alternative, and real-results states.
- Dashboard: active missions, earnings, recommendations, and readiness fail independently.
- Mission list: semantic loading status, alert on error, and category-specific empty state.
- Mission detail: loading skeleton, load-error recovery link, and classified eligibility/action errors.

Future active-mission and payout states need the same explicit treatment, including preserved input and clear responsibility.

## Analytics and privacy findings

The typed activation contract covers acquisition through first suitable-mission viewing. It permits locale, device category, provider method, CTA source, classified error category, onboarding step/status, platform, reward type, creator level, action kind, mission ID/type, and activation path as appropriate.

It excludes email, phone, social handle, display name, caption, uploaded content, content URL, callback query, raw provider error, and other creator-authored text. The default sink is `null`, so events are a safe no-op until an analytics provider is explicitly configured. Page/action/recommendation effects use per-mount deduplication.

## Recommended product metrics

Use the typed event contract as the first funnel layer, then add later events only when their product states exist:

- Visitor-to-signup-start conversion by locale and device category.
- Auth-link request success and classified failure rate.
- Signup completion rate and callback recovery rate.
- Onboarding completion, step abandonment, optional-step skip, and time-to-complete.
- Time to first unlocked recommendation and first suitable mission view.
- Activation action view-to-click rate by action kind.
- Dashboard-to-mission-view conversion.
- Time to first Join/Apply, first accepted mission, first approved submission, and first available cash earning.
- Mission join-to-submit, submit-to-approve, revision, and on-time completion rates after those states are implemented.
- 7-day and 30-day creator retention, segmented by activation path without storing direct PII in event payloads.
- Payout completion and notification-to-action conversion after the relevant workflows and events exist.

## Screenshot evidence

The following files are unchanged copies of the supplied baseline captures:

- [Before: public landing](assets/creator-ux/before-landing.png)
- [Before: creators page](assets/creator-ux/before-creators.png)
- [Before: login](assets/creator-ux/before-login.png)

### After-change evidence

No after-change screenshots are committed because no visual-control path completed safely in this environment. The in-app Browser, Chrome extension control, and Windows computer control all failed during trusted runtime setup with the same Windows deny-read ACL error. The documented `agent-browser` CLI was not installed, and downloading it through `npx` was rejected by the environment's third-party execution safeguard.

The local Vite server did respond with HTTP 200 for `/creators` and `/login`, and automated smoke tests exercise both public routes in English and Traditional Chinese. Those are render and transport checks, not visual evidence. Authenticated routes could not be exercised locally because `.env`, `.env.local`, and `.env.development.local` are absent; production authentication was not retried with a one-time PKCE link.

The viewport, keyboard, zoom, reduced-motion, and authenticated-state matrix therefore remains a release follow-up rather than a completed claim.

## Recommended next phase

Build the active-mission spine from accepted mission through paid outcome. Start by agreeing one canonical creator-facing state model and the backend facts for owner, deadline, deliverable checklist, feedback history, publication proof, reward validation, and payout. Then implement the mobile workflow and its analytics before adding retention mechanics.
