# Mission completion and reward-handoff operations

This runbook covers the read-only finance handoff created when an authorized
operator completes an active mission. It is additive to the active-mission and
publication-proof runbooks. `reward_pending` means that finance review is
pending; it does not mean issued, credited, available, withdrawn, or paid.

Use only an authorized disposable local environment for acceptance. Operational
records may contain opaque workflow, decision, and handoff identifiers plus
classified outcomes. Never record JWTs, email addresses, proof URLs, signed
URLs, environment values, credentials, or operator-authored notes in logs or
release evidence.

## Release status and ordered local gate

Keep the release as draft or partial until the database, application, static,
and browser gates are all recorded. Do not infer a database or browser pass
from unit tests.

```powershell
npx.cmd --yes supabase@2.110.0 db reset --local --yes
npm.cmd run seed:reward-handoff-acceptance
npm.cmd run test:integration
npm.cmd run test:active-missions
npm.cmd test
npm.cmd run lint
npm.cmd run type-check
npm.cmd run build
git diff --check
```

The seed is destructive to disposable `test-*` fixture data and must never
point at a hosted or production project. Its output is intentionally limited to
named scenario labels and structural counts. The expected scenarios are a new
join contract, a workflow needing backfill, eligible and blocked proof states,
pending and cancelled handoffs, and configured and missing SLA workspaces.

Stop the release if migrations fail, either reward integration suite is skipped,
seed counts differ from one per scenario, or any neutrality snapshot differs.

## Reward-contract backfill

An existing workflow cannot be completed until it has one immutable contract.
Current mission settings are reference only; they are not historical evidence.
An authorized workspace operator must verify the historical promise from an
acceptable source and record both the bounded evidence-source category and a
specific reason.

Acceptable source categories are the bounded values enforced by the backfill
RPC, including the operator record used by the current interface. Evidence must
be a contemporaneous approved campaign brief, signed creator agreement, or
other retained operator record that states the promised points, cash, currency,
and XP. Do not guess from current settings, analytics, or creator-authored
messages. Do not paste evidence content into the reason field.

Backfill is server-controlled, append-only, and cannot overwrite a contract.
On `REWARD_CONTRACT_EXISTS`, re-read the frozen contract. On a non-enumerating
not-found or authorization response, confirm workspace membership without
probing another workspace.

## Workspace processing window

The processing window is a calendar-day promise from 0 through 365. Set or
remove it through the authorized reward-processing setting; do not update old
handoffs after a setting change. Approval snapshots the current value and
computes `target_at`. A missing value is valid and produces a null target; tell
the creator that finance review is pending without inventing a date.

Before changing the setting, record the workspace and approved change ticket.
Afterward, verify only the resulting day count or null. Do not log the operator
identity or session material.

## Approve mission completion

Approval is available only while the workflow is exactly `proof_verified` and
every required publication item has an exact accepted proof-attempt and review
anchor. Optional items do not block approval.

1. Open the operator completion panel and verify the immutable reward contract,
   required-item evidence, workflow revision, and SLA preview.
2. Confirm that the warning says completion creates a pending handoff and does
   not issue a reward.
3. Submit once with the displayed workflow revision and one idempotency key.
   Preserve that key across an ambiguous transport retry.
4. On `WORKFLOW_STALE` or `WRONG_STATE`, discard the client key, reload the
   canonical workflow, and reassess. On `IDEMPOTENCY_CONFLICT`, stop and compare
   the normalized request rather than generating repeated attempts.
5. Verify one approval decision, one pending handoff, the `reward_pending`
   workflow state, and one completion timeline event.

Never repair a failed approval by editing proof history, the contract, a
completion decision, balances, ledgers, or budgets.

## Cancel before issuance and return to reassessment

Cancellation is allowed only for a currently pending handoff. Select the
bounded reason category and enter a non-empty internal audit note. The note must
not enter notifications, analytics, or operational logs.

Submit with the current `reward_pending` revision and one idempotency key. A
successful cancellation appends a cancellation decision, moves only the
handoff from `pending` to `cancelled`, returns the workflow to
`proof_verified`, and preserves the contract, approval, proof attempts,
reviews, and timeline. Tell the creator that the handoff returned for
reassessment; never say credited funds were reversed.

## Notification retry

Notifications are failure-isolated from the durable decision. If an in-app
notification is absent, first verify the completion or cancellation decision,
handoff, and owning creator using the canonical tenant joins. Retry only the
existing failure-isolated notification path for that decision. Do not rerun the
completion or cancellation command and do not create a hand-authored duplicate.

Use the authenticated admin retry endpoint after the canonical decision and
handoff checks pass. Set NOTIFICATION_TYPE to either
mission_reward_pending or mission_reward_pending_cancelled:

    curl.exe --fail-with-body -X POST "$ADFOCATE_BASE_URL/api/admin/reward-handoffs/$PENDING_REWARD_ID/notifications/retry" -H "Authorization: Bearer $STAFF_ACCESS_TOKEN" -H "X-Workspace-Slug: $WORKSPACE_SLUG" -H "Content-Type: application/json" --data ('{"notificationType":"{0}"}' -f $NOTIFICATION_TYPE)

The operation is deduplicated by the durable pending-reward semantic key and
returns a bounded delivered/idempotent outcome. Never print the bearer token or
include it in an incident record.
A retry record may include the decision and handoff identifiers plus a bounded
outcome. It must not include recipient email, proof URL, signed evidence,
operator note, raw error, or credentials. Verify the notification link opens the
exact creator mission state.

## Finance reconciliation

The finance queue is a read-only projection over `mission_pending_rewards`.
The default view contains only pending records and orders by earliest non-null
target, then oldest creation time, with stable identifiers as tie-breakers.
Cancelled records remain available only through audit filters.

For each discrepancy, reconcile the handoff to its reward contract, approval
decision, workflow, submission, creator, mission, and workspace. Confirm frozen
points, cash, currency, XP, processing window, target, evidence availability,
and timeline link. The queue has no issue, pay, release, mark-paid, or mutation
action. Escalate relational or tenant mismatches as release-stopping defects.

## Creator support wording

Use: “Your mission is complete and the reward is pending finance review. It is
not yet credited or available. We can check the handoff status and target date,
but we cannot promise an issuance or payout time.”

After cancellation use: “The reward handoff returned for reassessment. Your
verified proof history is preserved. We can help confirm the current mission
state.” Do not say funds were removed, reversed, paid, or withdrawn.

## Reward-neutrality snapshots

Capture exact before and after values for the same creator and workspace around
approval and cancellation:

- points balance and point-transaction count;
- creator XP;
- earnings available balance and earnings-transaction count;
- approved legacy submissions and their awarded points/XP as issued-reward
  anchors;
- redemption count and reward-catalog inventory;
- workspace budget balance and budget-transaction count; and
- legacy submission status.

Every value and count must be exactly equal. A difference is release-stopping.
Store numeric values, counts, and opaque record identifiers only. Never export
raw content URLs, signed URLs, authored notes, account handles, or credentials.

## Explicitly unsupported

This phase does not issue rewards, write financial ledgers, reserve or debit
workspace budget, release cash, configure payment methods, process withdrawals
or payouts, mark anything paid, reverse post-issuance value, or open formal
disputes. Those states require separately designed and audited future phases.