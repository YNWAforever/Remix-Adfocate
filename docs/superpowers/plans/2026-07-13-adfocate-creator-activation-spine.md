# Adfocate Creator Activation Spine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Turn the existing creator acquisition, authentication, onboarding, dashboard, and mission surfaces into one honest, bilingual activation journey that gets a creator to a suitable first mission without changing server-owned payment, eligibility, XP, or mission-state rules.

**Architecture:** Add a pure activation domain module and typed analytics/formatting adapters over the existing TanStack Query hooks. Keep Supabase Auth, Hono endpoints, query keys, and persisted onboarding steps canonical. Route components compose the new domain state into focused presentational components; successful sections remain visible when an unrelated query fails.

**Tech Stack:** React 19, TypeScript 5.8, TanStack Router, TanStack Query, Supabase Auth, Tailwind CSS 4, Vitest, Testing Library, Vite.

**Working directory:** `C:/Users/laich/Documents/Adfocate/.worktrees/creator-activation-spine`

## Global Constraints

- Preserve the five-step `onboarding_step` contract and all existing mutation endpoints.
- Do not invent points, XP, scarcity, creator demand, mission terms, payment promises, legal terms, notifications, or payout readiness.
- Keep social entry optional in onboarding; ownership verification remains a later milestone.
- Treat available earnings, pending earnings, points, and conditional opportunities as different concepts.
- Reuse the existing design tokens and bold-outline visual system; do not perform a visual rewrite.
- Add visible labels, associated help/error text, semantic headings, focus-visible controls, text status, live regions, and reduced-motion handling to touched surfaces.
- Add English and Traditional Chinese keys together. `src/lib/i18n.test.tsx` must retain dictionary parity.
- Analytics properties must exclude emails, handles, captions, uploads, content URLs, and raw provider errors.
- Use `Intl.NumberFormat` and `Intl.DateTimeFormat` for new money/date UI.
- For every task: add a failing focused test, observe the expected failure, implement the smallest complete behavior, rerun focused checks, and commit.

---

## Task 1: Add typed analytics and creator formatting contracts

**Files:**

- Create: `src/lib/activationAnalytics.ts`
- Create: `src/lib/activationAnalytics.test.ts`
- Create: `src/lib/creatorFormatting.ts`
- Create: `src/lib/creatorFormatting.test.ts`

### Contract

    export type DeviceCategory = "mobile" | "tablet" | "desktop";
    export type ActivationAuthErrorCategory =
      | "expired"
      | "already_used"
      | "malformed"
      | "rate_limited"
      | "delivery_failed"
      | "unknown";
    export type ActivationEventMap = {
      landing_page_viewed: { locale: string; deviceCategory: DeviceCategory };
      signup_started: { locale: string; deviceCategory: DeviceCategory; source: "creators_hero" | "creators_footer" };
      signup_completed: { locale: string; deviceCategory: DeviceCategory; method: "email_magic_link" | "whatsapp" | "google" | "unknown" };
      auth_link_requested: { locale: string; method: "email_magic_link" };
      auth_link_failed: { locale: string; method: "email_magic_link"; errorCategory: ActivationAuthErrorCategory };
      onboarding_step_viewed: { locale: string; step: number };
      onboarding_step_completed: { locale: string; step: number; status: "saved" | "skipped" };
      onboarding_abandoned: { locale: string; step: number };
      social_profile_added: { locale: string; platform: string };
      onboarding_completed: { locale: string; rewardType: "welcome_points" };
      dashboard_viewed: { locale: string; creatorLevel?: string };
      activation_action_viewed: { locale: string; actionKind: string };
      activation_action_clicked: { locale: string; actionKind: string };
      mission_recommendation_viewed: { locale: string; missionId: string; missionType: string };
      mission_viewed: { locale: string; missionId: string; missionType: string };
      creator_activated: { locale: string; activationPath: "mission_viewed" | "readiness_action" };
    };

    export function trackActivationEvent<K extends keyof ActivationEventMap>(
      name: K,
      properties: ActivationEventMap[K],
    ): void;

    export function setActivationAnalyticsSink(
      sink: ((event: { name: keyof ActivationEventMap; properties: object }) => void) | null,
    ): void;

    export function getDeviceCategory(width?: number): DeviceCategory;

The sink is `null` by default, so production behavior is a documented no-op until a provider is configured. The event map is the PII boundary.

    export function formatCreatorCurrency(
      amount: number,
      locale: "en" | "zh",
      currency?: "HKD",
    ): string;

    export function formatCreatorDate(
      value: string | Date | null | undefined,
      locale: "en" | "zh",
    ): string | null;

    export function formatMissionReward(
      input: { points: number; cash?: number | null },
      locale: "en" | "zh",
    ): string;

Use `en-HK` and `zh-Hant-HK`. Invalid/absent dates return `null` so callers omit them.

### Steps

- [ ] Add analytics tests for sink delivery/reset/default safety and mobile/tablet/desktop widths.
- [ ] Add formatting tests for bilingual HKD, points-plus-cash rewards, valid dates, and invalid/absent dates.
- [ ] Run `npm.cmd test -- src/lib/activationAnalytics.test.ts src/lib/creatorFormatting.test.ts`.
  Expected: FAIL because the modules do not exist.
- [ ] Implement the exact contracts with no vendor dependency and no fallback console logging.
- [ ] Rerun the focused tests and `npm.cmd run type-check`.
  Expected: PASS.
- [ ] Stage task files with `git add src/lib/activationAnalytics.ts src/lib/activationAnalytics.test.ts src/lib/creatorFormatting.ts src/lib/creatorFormatting.test.ts`.
- [ ] Commit with `git commit -m "feat: add creator activation contracts"`.

---

## Task 2: Make acquisition and passwordless authentication recoverable

**Files:**

- Create: `src/lib/authFeedback.ts`
- Create: `src/lib/authFeedback.test.ts`
- Create: `src/components/AuthFeedback.tsx`
- Create: `src/components/AuthFeedback.test.tsx`
- Modify: `src/lib/auth-flow.ts`
- Modify: `src/lib/auth-flow.test.ts`
- Modify: `src/routes/_site.creators.tsx`
- Modify: `src/routes/_site.smoke.test.tsx`
- Modify: `src/routes/_app.login.tsx`
- Modify: `src/routes/-_app.login.test.tsx`
- Modify: `src/routes/_app.auth.callback.tsx`
- Modify: `src/routes/-_app.auth.callback.test.tsx`
- Modify: `src/lib/i18n.dict.ts`
- Modify: `src/lib/i18n.test.tsx`

### Contract

    export type AuthErrorCategory = ActivationAuthErrorCategory;

    export type AuthFeedbackState = {
      category: AuthErrorCategory;
      titleKey: string;
      bodyKey: string;
      actionKey: string;
      action: "retry" | "request_new_link" | "back_to_login";
    };

    export function classifyAuthError(input: {
      code?: string | null;
      message?: string | null;
      status?: number | null;
    }): AuthFeedbackState;

Components display dictionary copy only. Classification covers `otp_expired`, access denied/reused links, malformed callbacks, HTTP 429/rate-limit text, delivery failures, and unknown errors.

    export type FinishAuthResult = {
      created: boolean;
      onboardingCompleted: boolean;
      destination: "/onboarding" | "/home";
    };

`finishAuth` types and returns the existing bootstrap response's `created` value so analytics do not label every returning sign-in as signup.

### Steps

- [ ] Add auth classifier tests for every category; assert dictionary keys/actions and no raw message.
- [ ] Add `AuthFeedback` tests for `role="alert"`, bilingual text, and correct retry/login action.
- [ ] Extend `auth-flow.test.ts` to assert returned result for new and returning creators while preserving routing and refresh-failure behavior.
- [ ] Extend creator smoke tests: both activation CTAs lead to `/login`, accessible names describe profile/missions, and the default Chinese locale renders Chinese FAQ content.
- [ ] Extend login tests: visible email label, associated help, busy state, friendly rate-limit recovery, preserved email value, and PII-free request/failure events.
- [ ] Extend callback tests: expired, reused, malformed/no-code, exchange failure, bootstrap failure, and `signup_completed` only when `created` is true.
- [ ] Run:

      npm.cmd test -- src/lib/authFeedback.test.ts src/components/AuthFeedback.test.tsx src/lib/auth-flow.test.ts src/routes/_site.smoke.test.tsx src/routes/-_app.login.test.tsx src/routes/-_app.auth.callback.test.tsx

  Expected: FAIL because the feedback contract and new behaviors do not exist.
- [ ] Implement `authFeedback.ts` and the presentational `AuthFeedback`; it receives callbacks/links and performs no data fetching.
- [ ] Update `finishAuth` without changing bootstrap, refresh, status, or navigation order.
- [ ] In `_site.creators.tsx`, route hero/footer activation CTAs to `/login`, localize the English-only FAQ array, track page view once, and track CTA source on click.
- [ ] In login, add visible labels for email/phone/code, stable IDs, `aria-describedby`, `aria-errormessage`, friendly classified errors, preserved input, and PII-free analytics.
- [ ] In callback, classify query/exchange/bootstrap failures, show request-new-link/back-to-login actions, and emit signup completion only from `FinishAuthResult.created`.
- [ ] Add matching English/Traditional Chinese keys for CTA, labels, expectations, every recovery category, and actions.
- [ ] Rerun the focused tests, `npm.cmd test -- src/lib/i18n.test.tsx`, and `npm.cmd run type-check`.
  Expected: PASS.
- [ ] Stage task files with `git add src/lib/authFeedback.ts src/lib/authFeedback.test.ts src/components/AuthFeedback.tsx src/components/AuthFeedback.test.tsx src/lib/auth-flow.ts src/lib/auth-flow.test.ts src/routes/_site.creators.tsx src/routes/_site.smoke.test.tsx src/routes/_app.login.tsx src/routes/-_app.login.test.tsx src/routes/_app.auth.callback.tsx src/routes/-_app.auth.callback.test.tsx src/lib/i18n.dict.ts src/lib/i18n.test.tsx`.
- [ ] Commit with `git commit -m "feat: clarify creator acquisition and auth recovery"`.

---

## Task 3: Derive canonical readiness and next-best action

**Files:**

- Create: `src/lib/creatorActivation.ts`
- Create: `src/lib/creatorActivation.test.ts`
- Create: `src/lib/useCreatorActivation.ts`
- Create: `src/lib/useCreatorActivation.test.tsx`
- Modify: `src/lib/queries/kocmax.ts`
- Modify: `src/lib/i18n.dict.ts`
- Modify: `src/lib/i18n.test.tsx`

### Domain contract

    export type ActivationMilestoneId =
      | "account_created"
      | "onboarding_completed"
      | "interests_selected"
      | "social_added"
      | "social_verified"
      | "payment_ready"
      | "first_mission_viewed"
      | "first_mission_joined";

    export type ActivationMilestone = {
      id: ActivationMilestoneId;
      state: "complete" | "recommended" | "blocked" | "not_applicable";
      labelKey: string;
      benefitKey: string;
      action?: { to: string; labelKey: string };
      countsTowardReadiness: boolean;
      weight: number;
    };

    export type NextBestActionKind =
      | "urgent_mission"
      | "review_feedback"
      | "publish_content"
      | "submit_proof"
      | "resume_onboarding"
      | "improve_profile"
      | "view_recommended_mission"
      | "set_preferences"
      | "review_growth";

    export type NextBestAction = {
      kind: NextBestActionKind;
      titleKey: string;
      bodyKey: string;
      to: string;
      ctaKey: string;
      deadline?: string;
      rewardContext?: string;
      missionId?: string;
      missionType?: string;
    };

    export type CreatorActivationInput = {
      me?: Me | null;
      onboarding?: OnboardingStatus | null;
      socialAccounts?: SocialAccount[];
      myMissions?: MyMission[];
      missionMatches?: MissionMatch[];
    };

    export type CreatorActivationSnapshot = {
      readinessPercent: number;
      completedReadinessWeight: number;
      totalReadinessWeight: 100;
      milestones: ActivationMilestone[];
      nextAction: NextBestAction;
      activeMissions: MyMission[];
      suitableMissions: MissionMatch[];
      activated: boolean;
    };

    export function deriveCreatorActivation(input: CreatorActivationInput): CreatorActivationSnapshot;

Readiness is five 20-point milestones: account, onboarding, interests, any social account/handle, and any verified social account. Payment/first-mission milestones remain visible but do not change the denominator.

Implemented action priority:

1. Joined mission -> `submit_proof`.
2. Incomplete onboarding -> `resume_onboarding`.
3. Locked match with no verified social -> `improve_profile`.
4. Highest-score unlocked match -> `view_recommended_mission`.
5. No categories -> `set_preferences`.
6. Otherwise -> `review_growth` at `/guide`.

`urgent_mission`, `review_feedback`, and `publish_content` stay typed but are not emitted until the API supplies the required state.

`activated` is true only when current API evidence proves onboarding completion plus a joined mission. A mission view or readiness-action click may emit the session analytics event, but it is not persisted or reported as durable activation state.

`useCreatorActivation` composes `useMe`, `useOnboardingStatus`, `useSocialAccounts`, `useMyMissions`, `useMissionMatch`, and `useEarnings` into a snapshot plus independent `me`, `activeMissions`, `recommendations`, `earnings`, and `readiness` query sections. Each section exposes data/loading/error/refetch; one failure cannot fail the others.

### Steps

- [ ] Add pure tests for milestone evidence, exact 0/20/40/60/80/100 weighting, non-weighted milestones, sorted matches, every emitted priority branch, and growth fallback.
- [ ] Add hook tests proving successful composition and isolated earnings/recommendation/social failures.
- [ ] Run `npm.cmd test -- src/lib/creatorActivation.test.ts src/lib/useCreatorActivation.test.tsx`.
  Expected: FAIL because the modules do not exist.
- [ ] Implement a deterministic domain module with no React, network, storage, analytics, or current-time dependency.
- [ ] Implement the hook as a thin query composer; use existing query `refetch` functions and no duplicate client store.
- [ ] Extend frontend response types only when an endpoint already returns the field; do not add server-shaped fiction or unsafe casts.
- [ ] Add bilingual milestone benefits/actions and next-action copy.
- [ ] Rerun focused tests, dictionary parity, and type-check.
  Expected: PASS.
- [ ] Stage task files with `git add src/lib/creatorActivation.ts src/lib/creatorActivation.test.ts src/lib/useCreatorActivation.ts src/lib/useCreatorActivation.test.tsx src/lib/queries/kocmax.ts src/lib/i18n.dict.ts src/lib/i18n.test.tsx`.
- [ ] Commit with `git commit -m "feat: derive creator activation state"`.

---

## Task 4: Build reusable activation cards

**Files:**

- Create: `src/components/NextBestActionCard.tsx`
- Create: `src/components/ActivationProgressCard.tsx`
- Create: `src/components/EarningsSummaryCard.tsx`
- Create: `src/components/ActiveMissionSummary.tsx`
- Create: `src/components/creator-activation.test.tsx`
- Modify: `src/lib/i18n.dict.ts`
- Modify: `src/lib/i18n.test.tsx`

### Contract

    NextBestActionCard({
      action,
      locale,
      onAction,
    }: {
      action: NextBestAction;
      locale: "en" | "zh";
      onAction?: (action: NextBestAction) => void;
    })

    ActivationProgressCard({
      snapshot,
      compact,
    }: {
      snapshot: CreatorActivationSnapshot;
      compact?: boolean;
    })

    EarningsSummaryCard({
      earnings,
      locale,
      isLoading,
      isError,
      onRetry,
    }: {
      earnings?: Earnings;
      locale: "en" | "zh";
      isLoading: boolean;
      isError: boolean;
      onRetry: () => void;
    })

    ActiveMissionSummary({
      missions,
      isLoading,
      isError,
      onRetry,
    }: {
      missions: MyMission[];
      isLoading: boolean;
      isError: boolean;
      onRetry: () => void;
    })

The next-action card has one primary link. Readiness is explicitly milestone completion, not quality/reliability/eligibility. Earnings never substitute zero on query failure. Active work promotes joined/pending items only and returns `null` for a successful empty list.

### Steps

- [ ] Add tests for one action link/callback, optional context omission, progressbar semantics, textual milestone states, precise bilingual earnings/error retry, and active-mission status filtering.
- [ ] Run `npm.cmd test -- src/components/creator-activation.test.tsx`.
  Expected: FAIL because the components do not exist.
- [ ] Implement presentational components only; query hooks stay in routes/composition.
- [ ] Use semantic sections/headings/lists, decorative-icon handling, touch-sized actions, and focus-visible styling.
- [ ] Add bilingual headings, readiness explanation, statuses, retry, and wallet-link copy.
- [ ] Rerun component tests, dictionary parity, and type-check.
  Expected: PASS.
- [ ] Stage task files with `git add src/components/NextBestActionCard.tsx src/components/ActivationProgressCard.tsx src/components/EarningsSummaryCard.tsx src/components/ActiveMissionSummary.tsx src/components/creator-activation.test.tsx src/lib/i18n.dict.ts src/lib/i18n.test.tsx`.
- [ ] Commit with `git commit -m "feat: add creator activation cards"`.

---

## Task 5: Refactor onboarding into a forgiving five-step journey

**Files:**

- Create: `src/components/onboarding/OnboardingShell.tsx`
- Create: `src/components/onboarding/OnboardingSteps.tsx`
- Create: `src/components/onboarding/OnboardingShell.test.tsx`
- Modify: `src/routes/_app.onboarding.tsx`
- Modify: `src/routes/-_app.onboarding.test.tsx`
- Modify: `src/lib/i18n.dict.ts`
- Modify: `src/lib/i18n.test.tsx`

### Contract

    export type OnboardingSaveState = "idle" | "saving" | "saved" | "error";

    export function OnboardingShell(props: {
      step: number;
      totalSteps: 5;
      title: string;
      saveState: OnboardingSaveState;
      canGoBack: boolean;
      hasUnsavedChanges: boolean;
      onBack: () => void;
      onDiscardAndBack: () => void;
      onCancelDiscard: () => void;
      children: ReactNode;
    }): JSX.Element;

The shell owns Back, semantic progress, `ProgressBar`, a polite save-status live region, and inline discard confirmation. `OnboardingSteps.tsx` exports value, interests, social, recommendations, and completion presentational steps; the route owns data/mutations.

### Route behavior

- Step 1 explains missions, guaranteed/conditional rewards, optional social data, later verification, and the five-step request.
- Step 2 explains matching impact. Skip persists `categories: []` and step 3.
- Step 3 uses visible labels/names for optional handles, connects non-empty values only, and then persists step 4.
- Step 4 shows real recommendations; loading uses skeletons, error has Retry, empty uses readiness/preferences/guide actions without claiming notifications are enabled.
- Step 5 calls the existing completion endpoint, then shows endpoint-confirmed reward, readiness, remaining improvements, referral code, and next action.
- Track `serverConfirmedStep` separately from rendered step. Initialize when async status arrives, advance only on successful mutation, preserve values on failure, retry only failed work, and retain persisted server progress across local Back navigation.
- Dirty Back on interests/social exposes explicit discard/cancel; it never silently clears edits.

### Steps

- [ ] Add shell tests for progress, Back, live save text, clean Back, dirty confirmation, discard, and cancel.
- [ ] Extend route tests for async resume, primer persistence, save/skip payloads, visible social labels, empty-handle omission, value preservation/retry, Back/discard, recommendation loading/error/empty/real states, completion invalidations, summary CTA, and PII-free onboarding analytics.
- [ ] Run `npm.cmd test -- src/components/onboarding/OnboardingShell.test.tsx src/routes/-_app.onboarding.test.tsx`.
  Expected: FAIL because the new behavior does not exist.
- [ ] Implement shell and focused step components in the existing visual language.
- [ ] Refactor the route without changing `useSaveProfile`, `useConnectSocial`, or `useCompleteOnboarding` request contracts.
- [ ] Seed interests from `useMe().data.categories` and handles from creator data only until the creator edits locally.
- [ ] Associate field errors with stable IDs; retain page-level network recovery without erasing inputs.
- [ ] Pass only real API recommendations to `MissionCard`; select fallback routes from real readiness state.
- [ ] Derive completion summary only after endpoint success; do not pre-announce reward success.
- [ ] Add bilingual copy and rerun focused tests, dictionary parity, components tests, and type-check.
  Expected: PASS.
- [ ] Stage task files with `git add src/components/onboarding/OnboardingShell.tsx src/components/onboarding/OnboardingSteps.tsx src/components/onboarding/OnboardingShell.test.tsx src/routes/_app.onboarding.tsx src/routes/-_app.onboarding.test.tsx src/lib/i18n.dict.ts src/lib/i18n.test.tsx`.
- [ ] Commit with `git commit -m "feat: strengthen creator onboarding journey"`.

---

## Task 6: Reorder the dashboard around action, work, earnings, and readiness

**Files:**

- Modify: `src/routes/_app.home.tsx`
- Modify: `src/routes/-_app.home.test.tsx`
- Modify: `src/components/MissionCard.tsx`
- Modify: `src/components/components.test.tsx`
- Modify: `src/lib/i18n.dict.ts`
- Modify: `src/lib/i18n.test.tsx`

### Dashboard order

1. Identity controls and compact welcome heading.
2. `NextBestActionCard`.
3. `ActiveMissionSummary`.
4. `EarningsSummaryCard` plus the existing points card as separate context.
5. Suitable real mission recommendations.
6. `ActivationProgressCard`.
7. News/announcements and existing secondary navigation.

Replace the decorative hero as the first content block; retain its useful welcome proposition as compact copy. The route uses `useCreatorActivation` and keeps existing realtime points behavior. Each query section renders independently.

### Steps

- [ ] Extend home tests to mock all activation sections and assert the exact heading/card order.
- [ ] Add cases for joined mission priority, onboarding fallback, unlocked recommended mission, wallet failure with missions still visible, recommendation failure with readiness still visible, and all-empty useful growth fallback.
- [ ] Assert `dashboard_viewed`, `activation_action_viewed`, click tracking, and one `mission_recommendation_viewed` per rendered recommendation without raw user data.
- [ ] Extend `MissionCard` tests for optional cash, mission/access type, platform, effort, match rationale/score, status, and omission of absent facts.
- [ ] Run `npm.cmd test -- src/routes/-_app.home.test.tsx src/components/components.test.tsx`.
  Expected: FAIL against the current decorative-first dashboard and thin mission card.
- [ ] Refactor home to the locked order. Do not gate successful sections behind a combined loading/error branch.
- [ ] Keep available/pending earnings exact; preserve points as points; use retry callbacks from the composition hook.
- [ ] Render only real unlocked suitable matches as primary recommendations. Locked matches may explain profile verification but must not appear joinable.
- [ ] Extend `MissionCard` backward-compatibly with optional typed facts; preserve existing title/category/points/deadline callers.
- [ ] Format new deadline/reward facts through `creatorFormatting.ts`.
- [ ] Add bilingual dashboard/recommendation/error/empty copy.
- [ ] Rerun focused tests, dictionary parity, and type-check.
  Expected: PASS.
- [ ] Stage task files with `git add src/routes/_app.home.tsx src/routes/-_app.home.test.tsx src/components/MissionCard.tsx src/components/components.test.tsx src/lib/i18n.dict.ts src/lib/i18n.test.tsx`.
- [ ] Commit with `git commit -m "feat: make dashboard action led"`.

---

## Task 7: Add richer mission discovery and a pre-commitment summary

**Files:**

- Create: `src/components/MissionCommitmentSummary.tsx`
- Create: `src/components/MissionCommitmentSummary.test.tsx`
- Modify: `src/routes/_app.mission.index.tsx`
- Create: `src/routes/-_app.mission.index.test.tsx`
- Modify: `src/routes/_app.match.tsx`
- Modify: `src/routes/_app.mission.$missionSlug.tsx`
- Modify: `src/routes/-_app.mission.$missionSlug.test.tsx`
- Modify: `src/components/MissionFacts.tsx`
- Modify: `src/components/-MissionFacts.test.tsx`
- Modify: `src/lib/i18n.dict.ts`
- Modify: `src/lib/i18n.test.tsx`

### Commitment contract

    export function MissionCommitmentSummary(props: {
      mission: Mission;
      locale: "en" | "zh";
    }): JSX.Element;

Render only API-backed facts:

- Deliverables or a specific unavailable-detail message.
- Platforms when present.
- Deadline when valid.
- Guaranteed points and cash reward.
- Effort when present.
- Product/experience, usage rights, or cancellation only if future typed fields actually exist; do not add them in this slice.

The summary is immediately before Apply/Join for an unowned mission. Existing apply/join callbacks, endpoint errors, status display, submission form, and hook-generator behavior remain unchanged.

### Discovery behavior

- Mission list cards receive mission/access type, brand/category, platforms, deliverables, cash/points, deadline, effort, quota/filled, required level, and creator-specific status when present.
- Match cards also receive fit score, rationale, locked state, and reward context.
- Missing data is omitted. Full quota is labeled unavailable; no artificial urgency language is added.
- Mission detail emits `mission_viewed` once per mission ID/type. When onboarding is complete, opening a suitable mission may emit `creator_activated` with `activationPath: "mission_viewed"`; guard against duplicate emission per mount.

### Steps

- [ ] Add commitment component tests for deliverables/platform/deadline/reward/effort, omission of absent facts, invalid date omission, and no invented rights/cancellation copy.
- [ ] Add mission-index tests for rich facts, empty/error/loading behavior, semantic results heading, and links.
- [ ] Extend detail tests to require commitment before Join/Apply in DOM order, preserve both write handlers, preserve gate errors, and verify mission analytics.
- [ ] Extend facts tests to use locale-aware money/date presentation and retain quota/eligibility behavior.
- [ ] Run:

      npm.cmd test -- src/components/MissionCommitmentSummary.test.tsx src/routes/-_app.mission.index.test.tsx 'src/routes/-_app.mission.$missionSlug.test.tsx' src/components/-MissionFacts.test.tsx

  Expected: FAIL because the summary/index coverage and richer facts do not exist.
- [ ] Implement the commitment component from current `Mission` fields only.
- [ ] Pass rich optional props into mission cards from list and match routes; add `useMe` to list only for existing eligibility fields.
- [ ] Insert the commitment summary directly above the unowned mission action. Do not wrap or replace `apply.mutateAsync` or `join.mutateAsync`.
- [ ] Track mission view/activation with typed, non-PII properties and a per-mount duplicate guard.
- [ ] Add bilingual commitment, availability, access type, and missing-detail copy.
- [ ] Rerun focused tests, callback/write regression tests, dictionary parity, and type-check.
  Expected: PASS.
- [ ] Stage task files with `git add src/components/MissionCommitmentSummary.tsx src/components/MissionCommitmentSummary.test.tsx src/routes/_app.mission.index.tsx src/routes/-_app.mission.index.test.tsx src/routes/_app.match.tsx 'src/routes/_app.mission.$missionSlug.tsx' 'src/routes/-_app.mission.$missionSlug.test.tsx' src/components/MissionFacts.tsx src/components/-MissionFacts.test.tsx src/lib/i18n.dict.ts src/lib/i18n.test.tsx`.
- [ ] Commit with `git commit -m "feat: clarify first mission decision"`.

---

## Task 8: Produce the audit artifacts and verify the complete slice

**Files:**

- Create: `docs/CREATOR_UX_AUDIT.md`
- Create: `docs/CREATOR_JOURNEY.md`
- Create: `docs/GAMIFICATION_SYSTEM.md`
- Create: `docs/IMPLEMENTATION_REPORT.md`
- Create: `docs/assets/creator-ux/before-landing.png`
- Create: `docs/assets/creator-ux/before-creators.png`
- Create: `docs/assets/creator-ux/before-login.png`
- Create after browser verification:
  - `docs/assets/creator-ux/after-creators-mobile.png`
  - `docs/assets/creator-ux/after-login-mobile.png`
  - `docs/assets/creator-ux/after-onboarding-mobile.png`
  - `docs/assets/creator-ux/after-home-desktop.png`
  - `docs/assets/creator-ux/after-mission-mobile.png`
- Modify only if required by generated routing: `src/routeTree.gen.ts`

### Documentation contents

`CREATOR_UX_AUDIT.md`:

- Method, live URLs, code-graph/source/test evidence, viewport list, and authenticated-production constraint.
- Journey-by-journey strengths, friction, severity, evidence, implemented activation fixes, and remaining future slices.
- Accessibility, responsive, bilingual, trust, financial clarity, error/empty/loading, and analytics findings.
- Before/after screenshots with descriptive captions.

`CREATOR_JOURNEY.md`:

- Acquisition -> auth -> onboarding -> dashboard -> first mission map.
- Creator goals, questions, system evidence, failure/recovery, and events at every step.
- Clear boundary between this slice and future active-mission/revision/publication/reward/payout work.

`GAMIFICATION_SYSTEM.md`:

- Existing points, XP, levels, badges, Creator Passport, streak/check-in, rewards, and unlock mechanics.
- Which mechanics reward real value versus profile completion.
- Readiness milestones explicitly produce no points/XP.
- Anti-abuse, honesty, accessibility, and future-decision guardrails.

`IMPLEMENTATION_REPORT.md`:

- File-level change summary and architecture.
- Added event contract and privacy limits.
- Tests/commands with actual results and any baseline-only failures.
- Browser matrix with actual results, screenshot links, and live-production limitations.
- Deferred backend/product dependencies.

### Verification steps

- [ ] Copy the three already captured before screenshots from `C:/tmp` into `docs/assets/creator-ux` without recompressing them.
- [ ] Write the four docs from the approved design and actual implementation. Do not claim authenticated production verification while the rate-limit/PKCE constraint remains.
- [ ] Run focused activation tests:

      npm.cmd test -- src/lib/activationAnalytics.test.ts src/lib/authFeedback.test.ts src/lib/creatorFormatting.test.ts src/lib/creatorActivation.test.ts src/lib/useCreatorActivation.test.tsx src/components/AuthFeedback.test.tsx src/components/creator-activation.test.tsx src/components/onboarding/OnboardingShell.test.tsx src/components/MissionCommitmentSummary.test.tsx src/routes/_site.smoke.test.tsx src/routes/-_app.login.test.tsx src/routes/-_app.auth.callback.test.tsx src/routes/-_app.onboarding.test.tsx src/routes/-_app.home.test.tsx src/routes/-_app.mission.index.test.tsx 'src/routes/-_app.mission.$missionSlug.test.tsx'

  Expected: PASS.
- [ ] Run `npm.cmd run type-check`.
  Expected: PASS.
- [ ] Run `npm.cmd run lint`.
  Expected: PASS, or document only verified pre-existing failures with exact files/messages.
- [ ] Run `npm.cmd test`.
  Expected: PASS.
- [ ] Run `npm.cmd run build`.
  Expected: PASS and regenerate `src/routeTree.gen.ts` only if TanStack Router changes it.
- [ ] If local Supabase is configured, run the relevant existing integration suites:

      npm.cmd run test:integration -- server/test/bootstrap.test.ts server/test/onboarding.test.ts server/test/missions.test.ts server/test/applications.test.ts server/test/wallet.test.ts server/test/verificationGate.test.ts

  If unavailable, record that limitation; do not fabricate a result.
- [ ] Start `npm.cmd run dev` and verify:
  - `/creators`, `/login`, `/onboarding`, `/home`, `/mission`, and a real mission detail.
  - Viewports 375x812, 390x844, 768x1024, and 1440x900.
  - English and Traditional Chinese, keyboard-only traversal, visible focus, 200% text zoom, reduced motion, loading/error/empty states, and long copy.
  - Auth request recovery with a non-production/disposable address only when delivery is available.
  - No console errors, horizontal overflow, obscured actions, or false financial/mission claims.
- [ ] Capture the five after screenshots and link them in the audit/report.
- [ ] Run `git diff --check` and:

      rg -n "TBD|TODO|implement later|appropriate error handling|similar to Task|placeholder copy" docs src

  Expected: `git diff --check` has no output; every text-scan hit is reviewed and removed unless it is legitimate existing product copy outside the touched scope.
- [ ] Inspect `git status --short` and confirm only intended activation files, docs, screenshots, and any legitimate generated route change are present.
- [ ] Stage task files with `git add docs src`.
- [ ] Commit with `git commit -m "docs: report creator activation improvements"`.
- [ ] Perform a final commit-range review against this plan and the approved design specification:

      git diff --stat b0b2940..HEAD
      git diff --check b0b2940..HEAD
      git log --oneline b0b2940..HEAD

  Confirm all locked decisions, docs, tests, and browser evidence are satisfied before claiming completion.

---

## Completion Criteria

- Public creator CTAs set accurate expectations and lead to the account flow.
- Auth errors are bilingual, specific, recoverable, and never expose raw provider text.
- Onboarding is resumable, has Back/Skip/save/retry behavior, retains failed input, and ends with readiness plus a useful action.
- The dashboard always starts with one honest next action and isolates partial query failures.
- Readiness is transparent, meaningful, and awards no points or XP.
- Mission cards aid decisions with available facts; missing facts are omitted.
- Mission detail places an API-backed commitment summary immediately before Apply/Join without changing write semantics.
- Typed analytics cover acquisition through activation without PII.
- Required docs, screenshots, tests, type-check, lint, build, and browser matrix contain actual evidence and clearly stated limitations.
