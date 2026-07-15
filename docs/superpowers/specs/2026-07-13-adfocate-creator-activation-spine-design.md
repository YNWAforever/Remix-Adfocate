# Adfocate Creator Activation Spine Design

**Date:** 2026-07-13  
**Status:** Approved for specification  
**Scope:** Creator acquisition through the first suitable mission  
**Repository:** `YNWAforever/Remix-Adfocate`

## 1. Purpose

Adfocate already contains the mechanics needed for a credible creator platform: passwordless authentication, resumable onboarding, social-profile connection and verification, mission matching, points and cash earnings, creator levels, notifications, and bilingual UI. The creator experience does not yet combine those mechanics into one clear activation journey.

This slice creates an activation spine across acquisition, sign-in, onboarding, profile readiness, the creator dashboard, mission discovery, and the first mission view. It reuses the current React, TanStack Router, TanStack Query, Hono, Supabase, and i18n architecture. It does not rewrite the application or change payment, eligibility, XP, or mission-state business rules.

The product loop introduced by this slice is:

> Understand value -> Sign in -> Build a useful profile -> See suitable work -> Know the next action -> Open the first suitable mission

## 2. Current-State Assessment

### Strengths

- The public creator proposition already communicates growth, missions, Creator Passport, earnings, and levels.
- Authentication is passwordless and first authentication bootstraps a creator account.
- Onboarding persists its step and already supports interests, social handles, recommendations, and a completion reward.
- The application has real mission, wallet, profile, verification, notification, level, and earnings surfaces.
- The app uses one bilingual dictionary and responsive app shells with bottom navigation on mobile and side navigation on larger screens.
- A recent UX pass improved focus handling, bottom-navigation wrapping, heading hierarchy, mobile overlap, and several empty and error states.

### Primary Friction

- The public promise is richer than the post-login activation experience.
- Login errors expose provider language such as rate limits without a recovery action or retry timing.
- Onboarding is resumable but does not offer consistent back navigation, explicit autosave feedback, or a final readiness summary.
- Optional social entry and later verification are not framed clearly enough as separate stages.
- Dashboard content is a collection of useful cards rather than a prioritized daily command centre.
- Profile completion has no shared, transparent definition.
- Mission cards omit several decision-critical facts and do not explain why a mission matches the creator.
- Mission detail goes directly from facts and brief to Apply or Join without a compact commitment summary.
- Empty states do not consistently route creators toward the next useful action.
- Activation and funnel analytics do not have one typed event contract.

### Audit Constraint

Public landing, creator-acquisition, and login pages were inspected in production. Authenticated production inspection was attempted with a disposable creator account, but Supabase email delivery rate limiting prevented establishing the isolated browser session. Authenticated findings in this specification are therefore grounded in the indexed code graph, source routes, existing tests, and existing product specifications. The implementation report must state this constraint until an authenticated production session is verified.

## 3. Goals and Success Criteria

### Goals

1. Make the value and earning model clear before and during sign-in.
2. Make onboarding resumable, forgiving, and explicit about required versus optional information.
3. Give every creator a transparent readiness model based on meaningful progress.
4. Put one deterministic next-best action at the top of the dashboard.
5. Help creators decide whether a mission is suitable without decoding a long brief.
6. Create useful no-mission and partial-failure states without fake demand or urgency.
7. Instrument the activation funnel without collecting unnecessary personal data.

### Product Success Criteria

- A creator can explain how Adfocate creates value and how rewards work before submitting an email address.
- A creator can move backward, skip optional onboarding steps, leave, and resume without losing persisted progress.
- Onboarding completion ends on a summary that explains profile readiness, recommendations, and the next action.
- The dashboard's first content block always provides one actionable priority or one honest fallback.
- A mission card communicates reward type, platform or format, effort, deadline, eligibility, and match reason when those data exist.
- Mission detail presents a commitment summary before Apply or Join.
- Empty and error states preserve context and identify a recovery action.

### Activation Definition

A creator is considered activated for this slice after all of the following are true:

1. Authentication and creator bootstrap have completed.
2. The onboarding completion endpoint has succeeded.
3. At least one meaningful matching signal exists, such as an interest category or connected social platform.
4. The creator reaches the dashboard.
5. The creator opens a suitable mission or, when no real mission is available, completes the dashboard's recommended readiness action.

Activation does not award XP or points for unverified form entry. Existing welcome rewards remain governed by existing backend behavior.

## 4. Scope

### Included

- Public creator CTA and sign-in handoff copy
- Login form semantics, feedback, and recovery states
- Onboarding information architecture, navigation, progress, persistence feedback, and completion summary
- Canonical creator readiness and next-best-action derivation
- Dashboard priority, earnings context, recommendations, and useful empty states
- Mission-card decision information
- Mission-detail commitment summary
- Bilingual copy and error parity
- Typed activation analytics events
- Unit, component, route, accessibility, and responsive verification for the touched flow
- The four required reports in `docs/`

### Explicitly Excluded

- Payment processing, withdrawal execution, tax, or compliance business rules
- Mission eligibility-rule changes
- XP thresholds, level names, or point-award changes
- A canonical active-mission, revision, publication, and payout state-machine rewrite
- New fake missions, creators, earnings, scarcity, or social proof
- Social OAuth or identity-document verification
- A full visual redesign or replacement of the existing Adfocate design language
- Production secret rotation or paid Supabase resource provisioning

## 5. Creator Journey

### 5.1 Acquisition

The public creator page keeps the existing growth-platform proposition. Its primary creator CTA describes the destination, such as viewing suitable missions or starting a creator profile, rather than using generic copy. Earnings examples must remain clearly labelled as examples or conditional outcomes.

### 5.2 Sign-In

The login screen contains:

- A visible email label
- A short explanation that the same flow creates or signs into an account
- Delivery and expiry expectations
- A disabled and busy state only after submission begins
- A confirmation state that identifies the destination email without exposing more personal information than necessary
- Recovery for invalid, expired, already-used, and rate-limited links
- A specific retry or back-to-login action

Provider errors are mapped to creator-friendly bilingual messages. Unknown errors preserve the entered email and offer retry guidance.

### 5.3 Onboarding

Onboarding remains a five-step experience so it can reuse the persisted `onboarding_step` contract.

1. **Value and earning model** — explain missions, rewards, verification, and what will be requested.
2. **Interests** — select categories used for initial matching; skipping is allowed but its matching impact is explained.
3. **Social profiles** — add optional handles; explain why they help, that ownership verification happens separately, and that the creator can continue without them.
4. **First recommendations** — show real recommendations only; when none exist, show readiness actions and notification expectations.
5. **Completion summary** — show readiness, completed milestones, remaining improvements, welcome-reward status, and the action-specific dashboard CTA.

Every step provides:

- A semantic step title and progress indicator
- Back navigation except on the first step
- Skip only for genuinely optional content
- A saving state and saved confirmation
- Field-level errors associated with the affected controls
- A page-level recovery message for network failures

Local input state is not erased when a save request fails. The server's persisted step remains the source of truth for resume behavior.

### 5.4 Dashboard

Dashboard information is ordered by action value rather than decoration:

1. Today's next-best action
2. Active mission deadlines and statuses
3. Available and pending earnings, with precise labels
4. Suitable mission recommendations
5. Profile readiness and creator growth
6. Recent feedback, notifications, and announcements

Each card must answer what happened, what to do, when to do it, or what the creator gains. Cards that answer none of these questions do not belong on the primary dashboard.

### 5.5 First Mission Decision

Mission cards show available facts without inventing missing ones:

- Brand or category
- Mission and access type
- Platform and deliverable format
- Guaranteed points or cash reward, with conditional reward types labelled separately
- Deadline
- Eligibility
- Estimated effort
- Honest availability information
- Match reason
- Current creator-specific status

Before Apply or Join, mission detail shows a compact commitment summary:

- What the creator will make
- Where it will be published or submitted
- Important dates
- Guaranteed and conditional rewards
- Product or experience provided, when applicable
- Usage-rights or cancellation information only when those data exist

The summary does not manufacture legal, payment, or cancellation terms that the backend cannot provide.

## 6. Canonical Activation Model

Introduce one pure frontend domain module, proposed as `src/lib/creatorActivation.ts`. It converts existing query data into stable presentation state.

```ts
type ActivationMilestoneId =
  | "account_created"
  | "onboarding_completed"
  | "interests_selected"
  | "social_added"
  | "social_verified"
  | "payment_ready"
  | "first_mission_viewed"
  | "first_mission_joined";

type ActivationMilestone = {
  id: ActivationMilestoneId;
  state: "complete" | "recommended" | "blocked" | "not_applicable";
  labelKey: I18nKey;
  benefitKey: I18nKey;
  action?: { to: string; labelKey: I18nKey };
};

type NextBestActionKind =
  | "urgent_mission"
  | "review_feedback"
  | "publish_content"
  | "submit_proof"
  | "resume_onboarding"
  | "improve_profile"
  | "view_recommended_mission"
  | "set_preferences"
  | "review_growth";

type NextBestAction = {
  kind: NextBestActionKind;
  titleKey: I18nKey;
  bodyKey: I18nKey;
  to: string;
  ctaKey: I18nKey;
  deadline?: string;
  rewardContext?: string;
};
```

The exact `I18nKey` typing follows the existing dictionary implementation. The model is pure, deterministic, and independently unit tested.

### Readiness Calculation

Readiness is shown as milestone completion, optionally summarized as a percentage for scanning. The percentage is derived from meaningful milestones and is not a quality, reliability, or eligibility score.

Recommended weighting for the activation slice:

| Milestone | Weight | Evidence |
|---|---:|---|
| Account and bootstrap complete | 20 | Existing `/me` data |
| Onboarding complete | 20 | Existing onboarding fields |
| At least one interest selected | 20 | Existing creator categories |
| At least one social profile added | 20 | Existing social account or handle data |
| At least one social profile verified | 20 | Existing ownership-verification state |

Payment readiness and first-mission completion appear as later milestones but do not reduce the initial activation readiness percentage. Missing optional milestones always explain their benefit.

### Next-Best-Action Priority

The resolver selects the first applicable action in this order:

1. Creator action with an active-mission deadline
2. Revision or feedback awaiting creator response
3. Approved content awaiting publication or proof
4. Incomplete onboarding
5. Blocking profile or verification requirement for an otherwise suitable mission
6. Highest-confidence suitable mission
7. Missing matching preferences
8. Useful growth or learning action

The first implementation may only have data for a subset of these states. Unsupported states remain typed contracts and documented backend dependencies; they are not presented as operational.

## 7. Architecture and Components

### Domain and Query Composition

- `src/lib/creatorActivation.ts` owns milestone and next-action derivation.
- Existing `useMe`, onboarding, mission, match, social, wallet, earnings, and notification hooks remain the data sources.
- A focused composition hook, proposed as `useCreatorActivation`, combines query results and returns section-level loading and error state without hiding successful sections.
- No duplicate server state is introduced in a client store.
- Server-owned onboarding progress remains persisted through existing mutation hooks.

### Proposed UI Boundaries

- `AuthFeedback` — maps authentication status and recovery actions.
- `OnboardingShell` — heading, progress, navigation, save status, and error summary.
- Focused step components for value, interests, social profiles, recommendations, and completion.
- `ActivationProgressCard` — transparent milestone list and readiness summary.
- `NextBestActionCard` — the single dashboard priority.
- `EarningsSummaryCard` — precise available and pending amounts, with links to wallet detail.
- `RecommendedMissionCard` or a backward-compatible extension of `MissionCard` — richer mission decision data.
- `MissionCommitmentSummary` — compact facts immediately before Apply or Join.

Component APIs use typed domain objects and i18n keys. They do not fetch their own data unless the existing component pattern already requires it.

### Data Flow

```text
Supabase Auth -> auth callback -> creator bootstrap -> onboarding queries/mutations
                                                     |
                                                     v
Existing creator, social, mission, wallet queries -> activation resolver
                                                     |
                                                     +-> onboarding completion summary
                                                     +-> dashboard next action
                                                     +-> readiness milestones
                                                     +-> mission recommendations
```

## 8. Empty, Loading, and Error States

### Empty Recommendations

When no suitable real mission exists, show:

- The reason matching may be limited, when known
- A profile or preference action that can improve matching
- Notification expectations or an opt-in route if supported
- Learning or guide content already available in the app
- Example missions only when clearly labelled as examples and sourced from an explicit example-data contract

### Partial Failure

Dashboard sections render independently. A wallet failure does not hide missions; a recommendation failure does not hide the next profile action. Each failed section shows one concise message and one recovery action where retry is safe.

### Authentication Recovery

Authentication errors distinguish expired, used, malformed, rate-limited, and unknown cases. Rate-limit copy does not expose raw provider text. It explains that too many links were requested, preserves the email, and tells the creator when or how to retry without inventing an exact countdown the provider does not supply.

### Onboarding Recovery

- Inputs remain in local state after a failed mutation.
- The current server-confirmed step remains unchanged on failure.
- Retry repeats only the failed mutation.
- Back navigation does not silently discard unsaved input.
- Leaving a step with unsaved edits requires save or an explicit discard decision when applicable.

## 9. Visual and Interaction Direction

Retain the established Adfocate identity: bold ink outlines, pastel surfaces, acid accent, display typography, and Lucide icons. Improve hierarchy by reducing simultaneous accent colors and decorative shadows inside task-focused app screens.

Rules for this slice:

- One visually dominant action per screen or card group
- Semantic design tokens instead of new ad hoc colors
- 16px minimum input text on mobile
- 44px minimum interactive targets, with adequate separation
- Visible `focus-visible` treatment
- No placeholder-only form labels
- No color-only state communication
- Locale-aware date, number, and currency formatting
- Explicit image dimensions or aspect ratios to avoid layout shift
- Motion limited to meaningful 150–300ms transitions
- `prefers-reduced-motion` respected
- Celebration reserved for verified milestones such as activation or an approved reward

## 10. Responsive Design

### Mobile: 375x812 and 390x844

- Single-column priority order
- Safe-area-aware bottom navigation and sticky actions
- No horizontal filter or brief overflow without an intentional accessible scroll pattern
- Mission commitment summary appears before the primary action
- Onboarding actions remain reachable when the software keyboard is open
- Long labels wrap rather than truncate critical meaning

### Tablet: 768x1024

- Single or two-column layout according to content relationship
- Onboarding maintains readable measure rather than stretching to full width
- Dashboard priority spans the content width; secondary cards may form two columns

### Desktop: 1440x900

- Existing side navigation remains
- Dashboard uses a stable primary column for action and work status, with secondary earnings and growth context
- Reading width is constrained for long briefs and onboarding copy
- Keyboard focus follows the visual hierarchy

## 11. Accessibility

Target WCAG 2.2 AA where practical.

- Semantic page landmarks and sequential headings
- Skip link retained and verified
- Visible labels and error associations for every form field
- Error summary focuses the first invalid field when several fields fail
- Progress indicators expose current step and total steps to assistive technology
- Status includes text or icons in addition to color
- Async save and submission feedback uses non-disruptive live regions
- Route changes place focus on the main page heading or main content region
- Dialogs and overlays retain escape, focus containment, and focus restoration
- Touch targets, text resizing, zoom, and reduced motion are verified at required widths

## 12. Analytics Contract

Add a typed event adapter that can target the existing or future analytics provider without coupling components to a vendor.

Initial events:

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

Allowed properties include mission ID, mission type, creator level, platform, onboarding step, reward type, status, device category, locale, and error category. Do not include email addresses, handles, captions, uploaded content, or raw provider errors.

When no analytics backend is configured, the adapter is a documented no-op in production and test-observable in automated tests. The UI must not claim that analytics or notification preferences are operational when they are not.

## 13. Testing Strategy

### Unit Tests

- Milestone completion and weighting
- Optional versus blocking milestones
- Every next-best-action priority branch
- No-mission fallback selection
- Authentication error mapping
- Locale-aware reward and deadline presentation helpers

### Component Tests

- Onboarding progress, Back, Skip, save, retry, and error association
- Completion summary and action-specific CTA
- Dashboard priority and partial-failure rendering
- Mission card required facts and omission of unavailable facts
- Mission commitment summary
- Keyboard interaction and accessible names

### Route and Integration Tests

- Existing authentication callback and bootstrap behavior
- Onboarding step persistence and resume
- Dashboard navigation to the selected action
- Mission detail Apply and Join behavior remains unchanged
- Existing Supabase RLS and API authorization tests remain green

### Responsive and Browser Verification

- 375x812
- 390x844
- 768x1024
- 1440x900
- Reduced motion
- Keyboard-only navigation
- Text zoom and long English and Traditional Chinese copy

### Required Commands

- `npm run type-check`
- `npm run lint`
- `npm test`
- `npm run build`
- Relevant integration tests when local Supabase is available
- Targeted browser verification of acquisition, login, onboarding, dashboard, and first mission

## 14. Documentation Deliverables

The implementation produces:

- `docs/CREATOR_UX_AUDIT.md`
- `docs/CREATOR_JOURNEY.md`
- `docs/GAMIFICATION_SYSTEM.md`
- `docs/IMPLEMENTATION_REPORT.md`

The broad audit documents the full creator surface, while implementation status clearly distinguishes this activation slice from later active-mission, revision, publication, reward, and payout work.

## 15. Future Slices

After activation is verified, the recommended next product slice is the active mission workspace:

1. Canonical mission and submission statuses
2. Guided brief and deliverable checklist
3. Draft, revision, and submission history
4. Publication and proof flow
5. Reward validation and wallet transaction detail

That slice requires explicit product-owner decisions for usage rights, cancellation, revision limits, review SLAs, reward validation, payout timing, and dispute handling.

## 16. Locked Decisions

- Activation-to-first-mission is the first implementation slice.
- Existing architecture and business rules are reused.
- Meaningful readiness is visible but does not create points or XP.
- Social entry is optional during onboarding; verification is a distinct later milestone.
- Dashboard priority is deterministic and action-led.
- Real missions only; example content must be explicitly labelled.
- Financial states remain precise and never present estimates as paid earnings.
- No full visual rewrite.
- Missing backend functionality is represented by typed contracts and documented dependencies, not fake operational UI.

