# Adfocate Creator Journey and State Model

Date: 15 July 2026
Scope: acquisition, authentication, onboarding, dashboard, discovery, and first mission commitment

## Journey map

```text
Public value proposition
  -> creator signup starts
  -> magic-link request
  -> PKCE callback and creator bootstrap
  -> resume or start five-step onboarding
  -> profile basics / interests / social / recommendations / completion
  -> action-led dashboard
  -> unlocked recommendation or mission discovery
  -> mission detail and commitment summary
  -> Apply or Join
```

The implemented activation moment is evidence-based: onboarding is complete and the creator opens a suitable unlocked mission, or the persistent mission record shows that a mission has been joined. It does not imply that content has been accepted, published, paid, or completed.

## Step-by-step experience

| Step | Creator goal and question | System evidence | Primary action | Failure and recovery | Analytics |
| --- | --- | --- | --- | --- | --- |
| 1. Public acquisition | “Is this for creators, and how can I earn and grow?” | `/creators` explains the flow and progression; creator CTAs route to `/login` | Create an account | Creator can still browse missions before signup; unsupported income guarantees must not be introduced | `landing_page_viewed`, `signup_started` |
| 2. Auth request | “How do I get into my account?” | Email magic-link form with visible label, expectations, and busy status | Send login link | Preserved email; classified delivery/rate-limit feedback; retry or request a new link | `auth_link_requested`, `auth_link_failed` |
| 3. Auth callback | “Did the link work, and where am I going?” | PKCE code exchange, bootstrap, admin bypass, onboarding/home destination | Continue automatically | Expired, used, malformed, rate-limited, or unknown errors show safe actions; post-exchange retry does not replay a successful exchange | `signup_completed` only when bootstrap reports a newly created creator |
| 4. Onboarding resume | “What have I completed?” | Server `onboarding_step` and completion state seed a five-step shell | Resume saved step | Status failure offers retry; stale responses cannot move confirmed progress backward | `onboarding_step_viewed` |
| 5. Profile basics | “What identity is needed now?” | Display-name/profile input stored through existing onboarding endpoint | Save and continue | Failed input stays mounted; Back from dirty state requires explicit discard | `onboarding_step_completed` |
| 6. Interests | “How will missions be matched?” | Categories feed recommendation queries | Save or skip | Optional skip is explicit; retry preserves local selection | `onboarding_step_completed` with `saved` or `skipped` |
| 7. Social profile | “Why add a social account, and is it verified?” | Self-entered handles and connected social accounts are separate evidence; ownership verification is distinct | Add available profiles or skip | Successful handles are not repeated on retry; verification can be completed later from profile | `social_profile_added`, `onboarding_step_completed` |
| 8. Recommendations | “Is there a real opportunity for me?” | Existing recommended-missions endpoint; only returned data is rendered | Review recommendation or continue | Loading, retryable error, honest empty state, profile and guide alternatives | `onboarding_step_completed` |
| 9. Completion | “What did I achieve, and what next?” | Idempotent server completion, 100 welcome points, readiness summary, destination | Go to the useful next route | Completion failure remains retryable; no readiness points or XP are minted | `onboarding_completed` with `welcome_points` |
| 10. Dashboard | “What should I do today?” | Resolver combines profile, onboarding, social, missions, matches, and earnings | Follow one next-best action | Active missions, recommendations, earnings, and readiness have independent recovery | `dashboard_viewed`, `activation_action_viewed`, `activation_action_clicked`, `mission_recommendation_viewed` |
| 11. Discovery | “Which mission fits me, what is required, and what can I receive?” | Mission and match routes render available reward, schedule, access, effort, quota, eligibility, status, rationale, and score facts | Open a mission | Missing data is omitted; full quota is unavailable; locked matches do not become joinable | No new list-level event beyond recommendation views in this slice |
| 12. Commitment | “What am I agreeing to before Apply or Join?” | Summary of deliverables, platforms, valid deadline, points, cash, and effort immediately precedes the action | Apply or Join | Classified gate errors explain level, verification, full, closed, duplicate, or wrong access state | `mission_viewed`; `creator_activated` for an onboarded creator opening a suitable unlocked mission |

## Onboarding state model

The UI exposes five steps. The server remains the source of confirmed forward progress; local state can move backward for review without erasing the server checkpoint.

| State | Completion evidence | Allowed creator action | Recovery rule |
| --- | --- | --- | --- |
| Profile | Successful profile update and returned onboarding step | Save and continue; Back when available | Keep input on error; do not advance confirmed progress |
| Interests | Successful category update or explicit optional skip | Save, skip, Back | Preserve selection; record `saved` or `skipped` only once per locale/step |
| Social | Successful social connection attempts or explicit optional skip | Add one or more profiles, skip, Back | Retry only unsuccessful handles; self-entry does not claim ownership verification |
| Recommendations | Query returns missions, empty state, or recoverable error | Open mission, retry, review profile/guide, continue | Matching failure does not erase earlier progress |
| Completion | Server `onboarding_completed=true` and step 5 | Review readiness and follow next action | Completion RPC is idempotent; failure stays retryable |

Dirty Back navigation uses an inline alert dialog. Focus moves to the discard action and returns to Back if cancelled. It does not claim modal behavior.

## Activation readiness model

Five milestones count 20 points each toward a 100% readiness score:

1. Account created.
2. Onboarding completed.
3. Interests selected.
4. A social profile or handle added.
5. Social ownership verified.

Three additional milestones remain visible but do not affect the score:

- Payment ready.
- First mission viewed.
- First mission joined.

Readiness is explanatory UI only. Completing a readiness milestone grants no points and no XP.

## Next-best-action priority

The resolver chooses the first evidenced action in this order:

1. A joined mission -> open that mission and submit the required content evidence.
2. Onboarding incomplete -> resume onboarding.
3. A locked match exists and social ownership is not verified -> improve profile/verification.
4. An unlocked match exists -> view the highest fit-score mission.
5. No categories -> set preferences.
6. Otherwise -> review the growth guide.

The typed contract reserves `urgent_mission`, `review_feedback`, and `publish_content`, but current source does not emit them. They require richer workflow evidence and should not be activated from inference alone.

## Mission state model: current product

The persistence model currently uses these statuses:

| State | Meaning in current product | Primary creator action | Existing notification evidence |
| --- | --- | --- | --- |
| `applied` | Application submitted for an application-gated mission | Wait for operator decision | Decline or acceptance is notified when status changes |
| `joined` | Creator owns a mission slot and can submit content URLs | Open mission and submit content URL(s) | No joined notification for an open mission was added by this slice |
| `submitted` | Content evidence submitted | Wait for review | Approval/rejection transition is notified |
| `under_review` | Operator review in progress | Wait; review current status | Approval/rejection transition is notified |
| `approved` | Submission accepted; configured points, cash, and XP credited | Review reward and next opportunity | `submission_approved`; level-up can also notify |
| `rejected` | Submission rejected with operator notes | Review reason | `submission_rejected` |
| `declined` | Mission application declined | Review notes and find another mission | `application_declined` |
| `expired` | Current opportunity ended without an approved outcome | Find another mission | No specific expired notification evidenced in the reviewed trigger |

Active mission summaries treat `joined`, `submitted`, and `under_review` as active. Durable activation uses the existence of any persisted mission record; only `joined` produces the current submit-proof next action.

## Active mission completion and future finance states

The active-workspace workflow now supports a verified completion handoff:

```text
proof_verified
  -> authorized completion approval
reward_pending
  -> authorized cancellation before issuance
proof_verified
```

`reward_pending` is the canonical creator-facing state after mission completion.
It freezes the joined reward and workspace processing-window facts for finance
review without changing the legacy submission state, creator points, XP,
earnings, issued-reward records, redemptions, or workspace budget. Cancellation
preserves proof history and returns the mission to reassessment; it does not
reverse credited funds.

Reward issuance, ledger posting, available balance, withdrawal, payout
processing, paid, failed, and reversed remain future states. The interface must
not infer or promise them from a pending handoff.
## Submission and revision states

Current mission detail accepts one or more content URLs for a joined mission and then shows the persisted status. It does not provide:

- Draft saving or file upload progress.
- Structured deliverable checklist validation.
- Caption preview or platform-specific validation.
- Versioned submission history.
- Structured revision requests and resubmission.
- Approval-to-publication instructions.
- Published-post URL and proof screenshot workflow.

Until these exist, `submitted` and `under_review` must not be described as a complete active-mission workspace.

## Earnings and payment states

Current financial states are intentionally narrower than a payout lifecycle:

| State | Current evidence | Creator-facing interpretation |
| --- | --- | --- |
| Mission opportunity | Mission `points_reward` and optional `cash_reward` | Configured reward for approval; keep points and HKD distinct |
| Pending cash | Sum of cash rewards on `submitted` and `under_review` missions | Under review, not available cash |
| Available cash | `earnings_balances.available` credited on approval | Approved earnings recorded in the wallet |
| Earnings history | Immutable transaction rows for positive approval credits/adjustments | Source, amount, balance after, and date |
| Points balance | Separate point ledger | Redemption currency, not cash |
| Redemption | Atomic point deduction and reward record | Reward claim; fulfillment can trigger `redemption_ready` |

Withdrawal requested, payout processing, paid, failed, reversed, minimum threshold, payment method, compliance, and dispute are not modeled by the reviewed creator UI. The available balance must not be described as withdrawn or paid without those states.

## Error and recovery contract

| Area | Error categories | Preserved context | Recovery |
| --- | --- | --- | --- |
| Auth request | Rate limited, delivery failed, unknown | Email input | Retry request or use safe navigation |
| Auth callback | Expired, already used, malformed, rate limited, unknown | Auth phase and locale; no raw query exposed | Retry failed phase, request new link, back to login |
| Onboarding status | Query failure | Server state remains unchanged | Retry status load |
| Onboarding mutation | API failure | Current input and confirmed progress | Correct/retry; successful handles are not repeated |
| Recommendations | Loading, error, empty | Onboarding completion remains possible | Retry, improve profile, use guide, continue |
| Dashboard sections | Per-query loading/error/empty | Other sections remain usable | Section-specific refetch |
| Mission action | Verification, level, full, closed, duplicate, wrong access, unknown | Mission details and action context | Deep-link to profile for verification; otherwise explain the blocking condition |

## Notifications

Existing database triggers provide best-effort notifications for application accepted/declined, submission approved/rejected, level up, and redemption ready. Campaign migrations add campaign-start, goal, and prize notifications. Creators can read their own notifications and mark them read; notification failure never rolls back the earn loop.

The activation slice does not add signup, onboarding, recommendation, deadline, feedback-ready, or payout notifications. Category/channel preferences, delivery channels, quiet hours, and notification-to-action analytics remain future work.

## Analytics privacy contract

Activation events may use classified operational properties such as locale, device category, CTA source, auth method, error category, onboarding step/status, platform, reward type, creator level, action kind, mission ID/type, and activation path.

They must not include direct creator identifiers or creator-authored content: email, phone, display name, handle, caption, uploaded file, content URL, callback query, raw provider error, free-text feedback, or mission submission content. The event sink is disabled until explicitly configured.

## Ownership boundary

This document defines the implemented first-session experience through the first mission decision. Active mission, revision, publication proof, validation, and the reward-pending finance handoff now have backend-owned states. Reward issuance, ledger posting, withdrawal, payout, disputes, and retention remain future phases and require backend facts and product-owner decisions before they become user-facing promises.
