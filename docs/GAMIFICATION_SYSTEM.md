# Adfocate Gamification System

Date: 15 July 2026
Status: current repository rules plus guardrails for future progression work

## Design principles

Adfocate gamification should make real creator progress visible. It must not manufacture urgency, reward low-quality data entry, obscure financial terms, or optimize for unnecessary screen time.

1. Reward verified value: accepted work, reliable delivery, quality, verified ownership, and real campaign outcomes.
2. Separate currencies and meanings: points, XP, cash earnings, readiness, and Passport scores are not interchangeable.
3. Show source and status: creators should know why a balance or level changed.
4. Keep opportunity claims conditional: level access and matching improve eligibility; they do not guarantee work or income.
5. Fail closed on trust: unverified social ownership must not unlock trusted gates.
6. Use celebration after confirmed outcomes, never estimates.
7. Respect accessibility and reduced motion; progress must remain understandable without color, animation, or emoji.

## Mechanics inventory

| Mechanic | Current implementation evidence | Value rewarded | Guardrail |
| --- | --- | --- | --- |
| Points | Point balance and transaction ledger; welcome bonus; mission approval; campaign bonuses/prizes; redemption | Confirmed onboarding completion and approved outcomes | Never present points as HKD or award readiness points |
| Cash earnings | Available balance, pending calculation, approval transactions | Approved mission cash reward | Pending is not available or paid; withdrawal lifecycle is not implemented |
| XP | Mission ownership/acceptance, approval, perfect-rating bonus, campaign rewards | Participation accepted by the system, approved work, quality, campaign outcomes | No XP for application alone, readiness, or unverified form entry |
| Levels | L0–L6 derived from XP by database trigger | Long-term creator progression | Marketing unlock descriptions require ongoing product validation |
| Trust gate | Effective level and L2+ mission gate use XP plus verified social ownership | Proven progression and ownership | Untrusted display/gating level is capped at L1 |
| Passport scores | Influence, reliability, content, and brand safety computed from evidence | Reach, concluded outcomes, ratings, and reviewed compliance | Show `null`/insufficient evidence rather than invented zero-quality claims |
| Badges | Data-derived badges computed on read | First approval, reliability, social linking, referral, quality, compliance | No self-minted badge rows |
| Redemption | Atomic points deduction, stock/code claim, history | Meaningful point use | Reject insufficient balance, stock, closed, or invalid requests |
| Notifications | Status, level, redemption, and campaign triggers | Timely recognition and action | Best effort; notification failure cannot roll back mission/reward state |
| Readiness | Five weighted activation milestones | Clarity about setup, not a reward currency | Explicitly grants no points and no XP |
| Daily check-in/streak | Mentioned in existing copy, but no reviewed creator-facing implementation was found | Not established | Do not describe as operational until a durable rule and anti-abuse model exist |
| Weekly goals | No reviewed creator-facing implementation | Not established | Define measurable, valuable behavior before adding UI or rewards |

## Points rules

### Confirmed sources

- Onboarding completion awards 100 welcome points.
  - The `award_welcome_bonus` RPC is atomic, idempotent, and service-role only.
  - It exits without a second award when onboarding is already complete.
  - It fails rather than marking completion if the creator’s balance row is missing.
- Mission approval credits the mission’s configured `points_reward`.
  - The approval RPC is service-only and state guarded.
  - The point transaction references the mission submission and records the balance after the credit.
- Campaign completion bonuses and prize tiers may award configured points.
- Redemptions deduct points atomically and can fail for insufficient points, stock, closed state, or missing authentication.
- Administrative adjustments and other ledger types exist, but the creator UI should always show their source description.

### Points are not awarded for

- Readiness milestone completion.
- Entering a display name, category, or unverified handle.
- Viewing a mission.
- Applying to an application-gated mission.
- Repeated clicking or screen time.

## XP rules

| Trigger | XP | Evidence and qualification |
| --- | ---: | --- |
| Join an open mission | 10 | Successful server join under status, deadline, quota, level, and trust gates |
| Application submitted | 0 | Applying alone does not prove accepted work |
| Application accepted | 10 | Service-only `applied -> joined` transition; idempotent |
| Submission approved | 100 | Service-only approval from `submitted` or `under_review` |
| Perfect 5-star approval | Additional 50 | Stored quality rating equals 5 |
| Campaign completion/prize | Configured amount | Awarded by campaign settlement rules when configured |

Declined, rejected, expired, or repeated idempotent transitions do not mint XP through these rules.

## Level system

The database computes level as a pure function of total XP. The frontend uses the same thresholds.

| Level | Name | XP threshold | Current localized unlock copy |
| --- | --- | ---: | --- |
| L0 | Shopper | 0 | Base discovery state |
| L1 | KOC Starter | 500 | Affiliate links, review missions, point redemption |
| L2 | Trusted KOC | 2,000 | Paid UGC work, CPM track, Studio |
| L3 | Nano Creator | 6,000 | Event fees, full Copilot tools |
| L4 | Micro-Influencer | 15,000 | Live commerce, priority mission matching |
| L5 | Influencer | 40,000 | Brand ambassador, Finance Readiness |
| L6 | Creator Entrepreneur | 100,000 | Custom brand partnerships, Creator Capital |

The labels above describe the current dictionary. They are product copy, not a guarantee that inventory or income exists. Required-level fields control mission and academy eligibility. A database trigger recalculates level whenever XP changes.

### Trusted access

Trust requires both:

- At least 2,000 XP.
- At least one social account with verified ownership.

Until trusted, the effective display/gating level is capped at L1 even if raw XP would otherwise produce a higher level. L2+ missions additionally require verified social ownership. This prevents unverified metrics from unlocking higher-trust opportunities.

## Creator Passport

The Passport is computed from source data rather than manually awarded profile claims.

### Scores

- Influence: follower total across available social handles, mapped to 0/20/50/80/100 bands; `null` when no handles exist.
- Reliability: approved submissions divided by all concluded submissions (`approved + rejected + expired`); `null` before any conclusion.
- Content: average 1–5 quality rating multiplied by 20; `null` without ratings.
- Brand safety: non-rejection rate over reviewed submissions (`approved + rejected`), excluding expired; `null` without reviewed work.

### Badges

| Badge key | Rule |
| --- | --- |
| `level_l1` | Level is L1 or above |
| `first_approval` | At least one approved submission |
| `reliable` | At least three concluded submissions and reliability at least 80 |
| `social_linked` | At least one social handle |
| `referrer` | At least one referred creator |
| `perfect_rating` | At least one 5-star quality rating |
| `content_pro` | At least three ratings and content score at least 80 |
| `spotless` | At least three reviewed submissions and brand-safety score exactly 100 |

Public Passport exposure should continue to use explicit share controls and should never reveal private creator or mission data.

## Activation readiness

Readiness answers “how prepared is my account for matching?” It is not XP, points, creator quality, or mission performance.

The five weighted milestones are account created, onboarding completed, interests selected, social profile added, and social ownership verified. Each is worth 20 percentage points. Payment readiness, first mission viewed, and first mission joined are visible zero-weight milestones.

**Readiness milestones award no points and no XP.** The percentage is derived client-side from existing evidence and does not write to a reward ledger.

## Rewards and financial honesty

- Points and cash are always presented as separate values.
- Mission cards may show configured points and cash; absent values are omitted.
- Pending cash is the sum of configured cash rewards on submitted/under-review missions. It is not available, paid, or guaranteed until approval.
- Available cash is credited on approval, but the reviewed product has no withdrawal or paid-state workflow.
- Redemption gifts can be voucher, physical, digital, or experience rewards and must respect stock and status.
- Campaign completion and prize rewards may combine cash, points, and XP; each type must be labeled independently.
- Celebrate only after a server-confirmed award. Do not animate an estimate as if paid.

## Streaks, check-ins, and weekly goals

Existing legal and FAQ copy refers to daily check-ins as a way to earn points. The reviewed source did not reveal a creator check-in endpoint, ledger rule, streak state, or creator-facing check-in UI. The `/api/cron/daily` route is an internal scheduled content/campaign job, not a creator check-in.

Before launching a daily or weekly mechanic, decide and document:

- The valuable behavior being encouraged.
- Hong Kong time-zone boundaries and grace period.
- Offline, travel, outage, and missed-day behavior.
- Whether a streak can pause without payment.
- Duplicate-device and automation prevention.
- Maximum reward exposure and ledger idempotency.
- Accessible progress and a reduced-motion celebration.
- Opt-out and notification preferences.

Preferred weekly goals are outcome based: complete an accepted mission on time, respond to verified feedback, finish a learning activity with assessment, or improve a measured quality/reliability result. Avoid goals based on opening the app or repeated applications.

## Unlockable benefits

Benefits should use one of three labels:

- Available: the creator can use it now.
- Eligible: the creator meets criteria, but supply or brand selection still applies.
- Progressing: the creator has remaining verified criteria.

Mission required level, verified ownership, mission status, deadline, quota, and application/open access are real gates. Marketing language such as “priority matching,” “brand ambassador,” or “Creator Capital” must not be presented as guaranteed without an operational entitlement and inventory source.

## Anti-abuse protections

Existing protections to preserve:

- Reward and state-changing RPCs use security definer functions with restricted execute grants.
- Approval, application acceptance, welcome bonus, campaign reward, and redemption paths are idempotent or uniquely referenced.
- Mission joins enforce active status, deadline, quota, access type, required level, and verified ownership where required.
- Creator reads are RLS scoped; creators cannot directly mint points, XP, badges, or mission approval.
- Passport badges are derived on read from source records.
- Submission approval awards only after valid workflow states.
- Redemptions atomically deduct points and claim stock/code.

Future rules should add velocity limits and anomaly review where spam applications, duplicate content, referral farming, or artificial engagement become measurable risks. Do not penalize creators from proxy metrics without an appeal path.

## Celebration rules

1. Confirm the server mutation before celebrating.
2. Name the exact outcome: points credited, submission approved, level advanced, or redemption ready.
3. Keep the next action available immediately; animation cannot block navigation.
4. Respect `prefers-reduced-motion` and never rely on animation alone.
5. Use one celebration per durable event. The `level_seen` field exists to prevent repeat level celebrations.
6. Do not celebrate pending cash as earnings received.
7. Do not celebrate readiness percentage with points, XP, or an implied professional credential.

## Notification rules

Current best-effort triggers cover:

- Application accepted or declined.
- Submission approved or rejected.
- Level up.
- Redemption ready.
- Campaign started, goal reached, and prize awarded where campaign migrations apply.

Notification rows store type and structured data; localized display text is rendered at read time. Notification failure must never roll back the mission or earn loop.

Future notification work should add creator preferences, quiet hours, channel consent, deadline/reminder policy, deep-link validation, deduplication, and notification-to-action analytics. No fake urgency, repeated nagging, or earnings implication is acceptable.

## Analytics events

The current activation contract records acquisition through first suitable-mission view. Relevant progression events are:

- `landing_page_viewed`
- `signup_started`
- `signup_completed`
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

Auth-link request/failure events support funnel diagnosis. Payloads must remain PII-free and exclude creator-authored content.

Later progression events should be added only when the corresponding durable states exist: application completed, accepted, draft submitted, revision requested, approved to publish, publication proof submitted, completed, reward approved, withdrawal started/completed, and level advanced acknowledgement.

## Features requiring backend or product support

- Creator-facing daily check-in and streak ledger.
- Weekly goal definitions, progress storage, and reward idempotency.
- Learning completion and assessment rules if learning is to award XP.
- Canonical revision/publication/proof workflow.
- Reward pending and payout states, payment methods, compliance, reversals, and disputes.
- Operational entitlement source for marketing unlock promises.
- Notification preferences and external delivery channels.
- Experiment assignment and holdouts for proving retention value without manipulative design.

## Decision checklist for any new mechanic

Before implementation, answer:

1. What verified creator or brand value does this reward?
2. Which authoritative record proves completion?
3. Can it be repeated, and how is double award prevented?
4. Is the reward points, XP, cash, access, recognition, or guidance?
5. What does failure or reversal mean?
6. Can a creator understand the rule before acting?
7. Does it disadvantage a creator because of platform, audience size, disability, time zone, or access to equipment?
8. What support and appeal route exists?
9. Which event measures value without collecting unnecessary personal data?
10. How can the mechanic be removed without corrupting balances or status history?
