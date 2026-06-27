# Campaigns & Challenges (G1) — Slice 1 (operator + creator) — design

**Date:** 2026-06-28
**Branch:** `feat/campaigns-g1` (new, off `main`)
**Status:** approved design, ready for implementation plan
**Migration:** `0025_campaigns.sql` (new) — applied via **raw SQL**, not `db push` (tracker is out of sync; see §12)

## Context & goal

Adfocate has a mature creator earn loop (join → submit → approve → points + XP + cash),
a leveling/passport system, notifications, and — as of PRs #46–#49 — a brand self-serve
portal. The next engagement lever is **Campaigns & Challenges (G1)**: time-boxed,
goal-driven challenges that group a set of missions, give every creator who hits the goal a
**completion bonus**, rank participants on a **live leaderboard**, and pay **top-N cash
prizes** when the campaign settles.

This is the platform's first **competitive, multi-creator reward surface** and its first
**out-of-loop payout system** (bonuses + prizes granted outside the per-submission approve
flow). Because it pays cash + points + XP, it is designed as a **payout ledger**: exactly-once
grants, crash-safe, correct under concurrent approvals, with the existing append-only ledgers
(`point_transactions`, `earnings_transactions`, `workspace_budget_transactions`) as the
source of truth. The whole feature is **additive around the unchanged earn loop** — it does
**not** modify `approve_submission`.

The design below was produced through a grounding pass over every subsystem it touches and an
adversarial design review (payout / concurrency / security lenses) that caught two critical
payout bugs in the first draft (wrong-workspace credit; an unguarded brand cash path). Those
fixes are baked in.

## Locked decisions (from brainstorming)

1. **Campaign = first-class entity.** A campaign is a named, time-boxed challenge with its own
   config, participant roster, and lifecycle — not a read-time view. (Completion bonuses,
   prizes, and the leaderboard all need persisted, idempotent state.)
2. **Goal model = metric + explicit mission set.** Goal metric for MVP = **count of approved
   `mission_submissions`** on the campaign's hand-picked mission set, within the window.
   `goal_metric` is a forward-compat column; only `approved_submissions` is valid at MVP.
3. **Reward = both.** (a) A **completion bonus** (points + XP, platform-issued) for **every**
   participant who reaches the goal. (b) **Top-N leaderboard prizes** (cash + points + XP),
   tiered by final rank, settled at campaign close. Completion bonus is points+XP only so it is
   never blocked by budget; cash appears only in prizes at settlement.
4. **Cash prizes debit the workspace budget** via the existing 402 hard-cap path
   (`workspace_budgets`), reused verbatim from `approve_submission`.
5. **Participation = auto-enroll.** A participant row is created automatically on a creator's
   first qualifying approved submission. **No creator-callable join endpoint** (avoids the
   "did the work, forgot to join, lost the bonus" failure mode; keeps participation derivable
   from an already-validated approved submission).
6. **Window keyed on `submitted_at`** (delivered-in-window), not `reviewed_at`/`now()` — so
   on-time-delivered work still counts even when reviewed during the post-close grace window.
7. **Mission exclusivity = one active campaign per mission** (DB-enforced). One approved
   submission advances exactly one campaign's goal — never two bonuses for one unit of work.
8. **Settlement = manual** two-phase `close` → `settle` (a human gate on cash payout). No cron
   in Slice 1.
9. **Phasing = operator-first.** Slice 1 ships the creator loop + operator authoring; brand
   self-serve authoring is Slice 1b (no new migration).

## Scope

### Slice 1 — this spec (operator + creator)
- Migration `0025_campaigns.sql`: 3 tables + RLS + idempotency indexes + `rank_campaign()` +
  3 RPCs + the approval trigger + the notification CHECK extension. **The migration is
  complete here** (including brand RLS policies — additive, harmless without brand routes).
- **Creator UI:** `/campaigns` list (active/upcoming) + `/campaigns/$slug` detail (goal,
  countdown, mission set, live progress, leaderboard, reward tiers). Creator nav entry.
- **Operator authoring:** `/admin/campaigns` (list + new + `$id` manage): create/edit/publish,
  attach/detach missions, set goal + bonus + prize tiers, **close** + **settle**.
- **Engines:** completion-bonus trigger + `grant_campaign_completion_bonus`; manual
  `close_campaign` → `settle_campaign`; `rank_campaign` leaderboard.
- **Notifications:** `campaign_goal_reached`, `campaign_prize_awarded`.

### Slice 1b — fast-follow (no migration)
- Brand self-serve `/brand/campaigns` (list + new + `$id` manage) via `requireBrand` +
  `makeUserClient` for config writes; **close/settle gated by `brandOwnsCampaign` (404 before
  the cash RPC)**. Reuses the brand RLS policies already shipped in `0025`. Brand nav entry.

### Deferred (future slices)
- Cron auto-**close** of past-deadline campaigns (settlement stays manual).
- `campaign_started` broadcast notification (needs fan-out; discovery is the list page).
- Multi-metric goals (points-/cash-/quality-weighted), per-tier goals, multi-campaign overlap.
- Persistent leaderboard snapshots / rank-movement ("↑3") history.

---

## Section 1 — Data model (`0025_campaigns.sql`)

All tables keyed on `workspace_id → workspaces(id) on delete cascade`. No authoritative
balances live on campaign tables — points/XP/cash totals stay in the existing ledgers.

### `campaigns` — config + 4-state machine
| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk default gen_random_uuid() | |
| `workspace_id` | uuid not null | FK → workspaces |
| `slug` | text not null | `unique(workspace_id, slug)` |
| `title` | text not null | |
| `description` | text | |
| `status` | text not null default 'draft' | check in `('draft','active','closed','settled')` |
| `starts_at` | timestamptz not null | |
| `ends_at` | timestamptz not null | check `ends_at > starts_at` |
| `goal_metric` | text not null default 'approved_submissions' | check in `('approved_submissions')` (forward-compat) |
| `goal_target` | int not null | check `>= 1` |
| `completion_bonus_points` | int not null default 0 | check `>= 0` |
| `completion_bonus_xp` | int not null default 0 | check `>= 0` |
| `prize_tiers` | jsonb not null default '[]' | ordered ranges `[{rank_from,rank_to,cash,points,xp}]`; validated in `campaignAuthoring.ts` **and** re-validated in `settle_campaign` |
| `published_at` `closed_at` `settled_at` | timestamptz | lifecycle timestamps; `settled_at` is the settlement idempotency guard |
| `created_by` | uuid | |
| `created_at` | timestamptz not null default now() | |
| `updated_at` | timestamptz not null default now() | |

- `unique(workspace_id, slug)`.
- **`unique(workspace_id, id)`** — composite key so `campaign_missions` can carry a composite
  FK that DB-guarantees workspace equality.
- Indexes: `(workspace_id, status)`; `(status, starts_at, ends_at)` (the trigger's active-window lookup).

`closed ≠ settled` is load-bearing: `close` stops counting; the grace window before `settle`
lets a human finish reviewing in-window-delivered submissions before ranks lock.

### `campaign_missions` — explicit set, DB-guaranteed workspace equality
| Column | Type | Notes |
|---|---|---|
| `campaign_id` | uuid not null | |
| `mission_id` | uuid not null | |
| `workspace_id` | uuid not null | = campaign workspace, FK-guaranteed |
| `added_at` | timestamptz not null default now() | |
| `removed_at` | timestamptz | **soft removal** |

- `pk(campaign_id, mission_id)`.
- **`foreign key (workspace_id, campaign_id) references campaigns(workspace_id, id) on delete cascade`**
- **`foreign key (workspace_id, mission_id) references missions(workspace_id, id) on delete cascade`**
  — these two composite FKs make `campaign_missions.workspace_id = campaigns.workspace_id =
  missions.workspace_id` a **DB invariant**, not an authoring-time assertion that can drift.
  (Requires `missions` to have `unique(workspace_id, id)` — add it in `0025`; no-op given `id`
  is PK.)
- **One active campaign per mission** (locked decision #7):
  ```sql
  create unique index campaign_missions_one_active_uniq
    on campaign_missions (mission_id) where removed_at is null;
  ```
  Plus a guard in `campaignAuthoring.ts` that refuses to attach a mission already attached
  (`removed_at is null`) to a different active/overlapping campaign. Rationale: a single
  approved submission must advance exactly one campaign's goal, or one unit of work pays two
  completion bonuses (per-campaign `source_ref` does not dedupe across campaigns). The cash
  path must not depend on UI enforcement.

### `campaign_participants` — auto-enroll roster + per-creator idempotency ledger
| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk default gen_random_uuid() | |
| `campaign_id` | uuid not null | |
| `creator_id` | uuid not null | FK → creators on delete cascade |
| `workspace_id` | uuid not null | = campaign workspace (FK-guaranteed) |
| `approved_count` | int not null default 0 | check `>= 0`; **trigger-maintained cache, for live goal-crossing only — never shown as authoritative rank** |
| `goal_reached_at` | timestamptz | set-once when count first crosses `goal_target` (bonus idempotency key) |
| `bonus_granted_at` | timestamptz | set after the bonus ledger writes commit |
| `prize_rank` | int | written at settlement |
| `prize_granted_at` | timestamptz | per-winner idempotency guard |
| `first_approved_at` `last_approved_at` | timestamptz | |

- `foreign key (workspace_id, campaign_id) references campaigns(workspace_id, id) on delete cascade`.
- `unique(campaign_id, creator_id)`; index `(campaign_id)`.

### Idempotency backbone — partial-unique indexes on the existing ledgers
Double-payout is made impossible at the DB layer:
```sql
create unique index pt_campaign_bonus_uniq  on point_transactions
  (source_ref) where left(source_ref, 15) = 'campaign_bonus:';
create unique index pt_campaign_prize_uniq  on point_transactions
  (source_ref) where left(source_ref, 15) = 'campaign_prize:';
create unique index et_campaign_prize_uniq  on earnings_transactions
  (source_ref) where left(source_ref, 15) = 'campaign_prize:';
create unique index wbt_campaign_prize_uniq on workspace_budget_transactions
  (source_ref) where left(source_ref, 15) = 'campaign_prize:';
```
- `left(source_ref,15) = '…'` (not `LIKE`) avoids underscore-escape ambiguity.
- `source_ref = 'campaign_bonus:<campaign_id>:<creator_id>'` and
  `'campaign_prize:<campaign_id>:<creator_id>'` — **per-(campaign,creator), never per-tier**
  (a creator wins at most one rank, so re-settlement after a top-up stays idempotent).
- One shared `source_ref` builder used by every paying RPC + every test, asserting the prefix
  matches the index predicate.
- A racing duplicate insert raises `23505`, caught per-statement as a no-op — the **backstop**;
  the primary guards are `goal_reached_at` / `prize_granted_at` under row lock.

---

## Section 2 — Window semantics (`submitted_at`)

Both completion-bonus eligibility **and** final ranking key on
`submitted_at ∈ [starts_at, ends_at)` with `status='approved'` at evaluation time — not
`reviewed_at`, not `now()`. Keying on `reviewed_at` would make the grace window inert for its
own purpose (work delivered on time but reviewed after `ends_at` would be silently excluded).
Keying on `submitted_at` means a creator who **delivered before `ends_at`** but is **reviewed
during the grace window** still counts.

- **Trigger (live bonus):** on a submission becoming `approved`, count it iff
  `new.submitted_at ∈ [starts_at, ends_at)`, the mission is in the campaign's active set, and
  `campaign.status <> 'settled'` (so grace-window reviews of in-window work still pay).
- **`rank_campaign` + `settle_campaign`:** identical predicate, via the one shared ranker (§5).

---

## Section 3 — Completion-bonus engine

**Trigger** `campaign_progress_on_approval AFTER UPDATE OF status ON mission_submissions`,
in the same transaction as `approve_submission` (atomic with the approval; fires for **both**
operator and brand approval paths, so they cannot diverge; `approve_submission` is untouched).

- **Ordering:** named so it sorts **before** `notifications_on_submission_change` (`c` < `n`),
  so the bonus's XP bump fires `notify_on_level_up` before the submission notification.
- **Not best-effort for payout:** the participant increment + `grant_campaign_completion_bonus`
  ledger writes are **not** wrapped in `exception when others then null` — a real failure rolls
  back the approval (all-or-nothing money semantics). **Only the notification insert is swallowed.**
- **Fences against close:** reads the campaign row `select … for share`, conflicting with
  `close_campaign`'s `for update` — an in-flight approval either commits its count before close
  or blocks and re-reads post-close status.

**Trigger body** (monotonic, increment-only — there is **no decrement branch**; `approved` is
terminal, `reject_submission` raises `wrong_state` on an approved row):
- On `old.status <> 'approved' AND new.status = 'approved'`, for the (unique) live campaign C
  where `mission_id ∈ campaign_missions(removed_at is null)`, `C.status <> 'settled'`,
  `select C … for share`, and `new.submitted_at ∈ [C.starts_at, C.ends_at)`:
  1. upsert participant `on conflict (campaign_id, creator_id) do nothing` (**auto-enroll**),
     then `select … for update` that row.
  2. `approved_count += 1` (read from the **locked participant row**, never a live recount of
     `mission_submissions`), set `last_approved_at`, `first_approved_at` if null.
  3. if `approved_count >= goal_target AND goal_reached_at is null`: set
     `goal_reached_at = now()`, call `grant_campaign_completion_bonus(C.id, creator_id)`.

**`grant_campaign_completion_bonus(p_campaign uuid, p_creator uuid)`** — SECURITY DEFINER,
`set search_path = public`, execute granted to `service_role` only (modeled on
`award_welcome_bonus`):
1. `select … from campaign_participants for update`; if `bonus_granted_at is not null` return.
2. `select workspace_id, completion_bonus_points, completion_bonus_xp, status from campaigns
   where id = p_campaign for share`; re-assert `status <> 'settled'` and
   `participant.workspace_id = campaign.workspace_id`.
3. **Resolve the creator's HOME workspace** `v_home_ws = (select workspace_id from creators
   where id = p_creator)`. **Points credit `point_balances.balance` keyed `(p_creator, v_home_ws)`
   — NOT the campaign workspace.** If the balance row is missing, seed it (`insert … on conflict
   do nothing`) then update — never silently no-op. (This **intentionally diverges** from the
   `award_welcome_bonus` template, which `raise`s on a missing row; here the seed is defensive —
   a home `point_balances` row is guaranteed by onboarding — so we never `raise`.) Insert
   `point_transactions(creator_id, workspace_id = v_home_ws, type='bonus',
   source_ref='campaign_bonus:<c>:<cr>')`, that one insert wrapped `exception when
   unique_violation then return`.
4. If xp > 0: `update creators set xp = xp + completion_bonus_xp where id = p_creator` (the
   `0008` level trigger recomputes level; `notify_on_level_up` fires the celebration for free).
   **No bump to `mission_submissions.xp_awarded`** (campaign-scoped, not submission-scoped).
5. `set bonus_granted_at = now()`; emit `campaign_goal_reached` (this insert, and only this
   insert, wrapped `begin … exception when others then null; raise warning …; end;`).

Idempotency: `goal_reached_at` set-once in trigger → `bonus_granted_at` under `for update` →
`pt_campaign_bonus_uniq` DB backstop. Points + XP only ⇒ never touches `workspace_budgets`.

---

## Section 4 — Prize-settlement engine (manual `close` → `settle`)

Two RPCs, both SECURITY DEFINER, `set search_path = public`, execute to `service_role` only.

**`close_campaign(p_campaign uuid)`** — `select … for update`; assert `status='active'`; set
`status='closed', closed_at=now()`. Stops counting; opens the review grace window.

**`settle_campaign(p_campaign uuid)`**:
1. `select campaign for update`; if `settled_at is not null` return (idempotent); assert
   `status='closed'`.
2. **Re-validate `prize_tiers` in-RPC** (never trust the app validator): each tier
   `cash>=0, points>=0, xp>=0, rank_from>=1, rank_to>=rank_from`; tiers non-overlapping and
   ascending; else `raise 'invalid_prize_tiers'`.
3. **Rank via the shared `rank_campaign(p_campaign)`** (§5). Write `prize_rank` onto the top-N
   participant rows (defensively creating any missing top-N row).
   Tiebreak: `approved desc → avg_quality desc → goal_reached_at asc (nulls last) → creator_id
   asc (raw uuid, no ::text/locale collation)`.
4. For each tier, for each participant with `rank ∈ [rank_from, rank_to]` and
   `prize_granted_at is null`, **inside a savepoint** (a stray `23505` is a per-winner no-op
   skip, not a full abort):
   - **Cash:** the verbatim `workspace_budgets` hard-cap debit from `approve_submission` —
     `select balance, enforced … for update` on **the campaign's** `workspace_id`; if
     `enforced and balance < cash` → `raise 'insufficient_budget'` (propagates past the
     savepoint → rolls back the **entire** settlement, no partial payout). Else debit
     `workspace_budgets` (campaign workspace) + `workspace_budget_transactions(type='debit',
     source_ref='campaign_prize:…')`. **Credit `earnings_balances.available` on the creator's
     HOME workspace** (the column `approve_submission` credits) +
     `earnings_transactions(type='earn', source_ref='campaign_prize:…')`. `type='earn'` (the
     CHECK only allows `earn`/`adjust`; `source_ref` distinguishes prizes).
   - **Points** → `point_balances += points` on the creator's home workspace +
     `point_transactions(type='bonus', source_ref='campaign_prize:…')`.
   - **XP** → `update creators set xp = xp + xp`.
   - `set prize_granted_at = now()`; emit `campaign_prize_awarded` (best-effort insert only).
5. `set status='settled', settled_at=now()`.

**Empty/insufficient budget:** `insufficient_budget` rolls back the whole settlement; route →
**402**. Operator tops up via the existing `credit_workspace_budget` RPC and re-calls — safe
because `settled_at` + per-winner `prize_granted_at` + the prize unique indexes pay only unpaid
winners. **Two simultaneous Settle clicks:** `campaigns for update` serializes; the second sees
`settled` → idempotent no-op/409.

---

## Section 5 — Leaderboard (`rank_campaign`, single source of truth)

The ranking logic lives in **one SQL function `rank_campaign(p_campaign uuid)` returning
`(creator_id, rank, approved, avg_quality)`**, used by **both** `settle_campaign` (§4 step 3)
and the read API — so the leaderboard a creator sees is byte-identical to the ranks that get
paid (no SQL-vs-TS / collation drift).

`rank_campaign` conventions:
- Row counts iff `status='approved' AND submitted_at ∈ [starts_at, ends_at)` (narrow set, not
  radar's `'applied'`-inclusive set).
- `avg_quality` = average over rated rows only, `0` if none (the `topCreators` convention, not
  radar's `?? 3`).
- Order: `approved desc → avg_quality desc → goal_reached_at asc nulls last → creator_id asc`
  (raw uuid). 1-based `rank` via `row_number()`. **The function `LEFT JOIN`s
  `campaign_participants` on `(campaign_id = p_campaign, creator_id)` to source `goal_reached_at`
  for the tiebreak** (it is not derivable from the `mission_submissions` aggregation alone). The
  join is total for any counted creator — auto-enroll guarantees a participant row exists once a
  creator has an approved in-window submission.
- **Mission set = as-of-approval** (§6): a submission counts iff its mission was attached at
  approval time — `added_at <= s.reviewed_at AND (removed_at is null OR s.reviewed_at < removed_at)`.
- Returns the full ranked list (no `slice`; the route paginates/caps for display).

**`server/lib/campaignLeaderboard.ts`** is a thin shaper: calls `rank_campaign` via
`serviceClient().rpc(...)` and decorates rows with name/avatar/level (from `creators`, joined
globally — `mission_submissions.workspace_id` is the authoritative scope, so do **not** filter
`creators` by workspace). `num()`-coerce every PostgREST numeric. Per-creator "am I winning?" =
`rank_campaign` filtered to the caller + `bonus_granted_at`. Progress bar denominator =
`goal_target`, labelled "已批核 X / Y" (a completion metric, never `filled`/capacity).

---

## Section 6 — One mission-set semantics (shared by trigger + leaderboard + settle)

A submission counts for a campaign iff its mission was **attached at approval time**:
```
added_at <= s.reviewed_at  AND  (removed_at is null OR s.reviewed_at < removed_at)
```
Note the deliberate use of two different timestamps: the **attachment** check keys on
`reviewed_at` (the approval moment — when the submission became countable), while **window
eligibility** (§2) keys on `submitted_at` (delivery time). These are intentionally distinct —
do not "unify" them.
- The live trigger fires only on `removed_at is null` rows (you can't approve onto a detached
  mission going forward), but **historical evaluation** (`rank_campaign`, settle) uses the
  as-of-approval window, so a mission removed mid-campaign does **not** retroactively erase
  approvals earned while it was attached.
- Mission **removal is locked once `status ∈ ('closed','settled')`** (authoring guard).
- Guarantees: leaderboard seen == settled ranks == the progress the bonus was paid against.

---

## Section 7 — Notifications

Ship two new types only; defer `campaign_started` (no single recipient). Both emitted by direct
`insert into notifications` inside the two RPCs, wrapped `begin … exception when others then
null; raise warning …; end;` (best-effort — never rolls back the bonus/prize).
- `campaign_goal_reached` → recipient = participant creator; `user_id = creator_id`,
  `workspace_id = campaign.workspace_id`; `data = {campaign_title, campaign_slug, points, xp}`.
- `campaign_prize_awarded` → recipient = each winner; `data = {campaign_title, campaign_slug,
  rank, cash, points, xp}`.

**Silent-failure trap (ships in `0025`):** extend the `notifications.type` CHECK to add both
literals, **in the same migration as the emitting RPCs**, after **verifying the live constraint
name in prod** (raw-SQL schema drift). If skipped, the wrapped insert fails silently.

**Client wiring** (`src/lib/notifications.ts`): add both literals to `NotificationType`; add
`ICONS` entries (`Trophy`/`Award` — confirm the lucide icon is exported; precedent: `Facebook`
was not); `paramsFor()` cases supplying every `{placeholder}` (`campaign_title` via `s()`,
`rank`/`cash`/`points`/`xp` via `n()`); `hrefFor()` deep-linking `/campaigns/$slug`. Add
`app.notif.campaign_goal_reached.{title,body}` + `app.notif.campaign_prize_awarded.{title,body}`
to **both** the en and zh blocks of `i18n.dict.ts`. Add emission cases to
`server/test/notifications-triggers.test.ts`, render cases to `src/lib/notifications.test.ts`.

---

## Section 8 — Auth / RLS

### New-table RLS (all ship in `0025`, additive)
- `campaigns` + `campaign_missions`: copy the 4 additive brand policies from `0023_brand_access.sql`
  **verbatim** (`*_brand_{select,insert,update}` keyed on `workspace_id in (select workspace_id
  from public.brand_users where user_id = auth.uid() and active)`; `*_brand_delete` requires
  `role='owner'`). **The `and active` clause is the durable-revocation guard — verbatim.**
- `campaign_participants`: brand SELECT-only on the same idiom (denormalized
  `participants.workspace_id`) **+ creator-self-read** `using (creator_id = auth.uid())`. **No
  insert/update to `authenticated`** — all writes are SECURITY-DEFINER trigger/RPC only.
- `grant all` on all three to `service_role`.

### Cross-creator leaderboard read = the isolation point
`mission_submissions` has no brand/operator RLS, so the leaderboard **must** use `serviceClient()`
hard-filtered by `workspace_id` — never `makeUserClient`, never a request param. `rank_campaign`
(SECURITY DEFINER) hard-filters internally; the route derives `campaignMissionIds` server-side
from `campaign_missions`, never from a body.
- **Operator route:** `serviceClient` scoped by the campaign row's own `workspace_id`
  (`select workspace_id from campaigns where id=?`), **never the optional `?workspace=` filter**.
- **Brand route (Slice 1b):** load campaign via `makeUserClient` (RLS proves ownership → 404 if
  not), then read via `serviceClient` scoped to `c.var.brand.workspaceId`.

### Brand close/settle ownership gate (Slice 1b — the first brand cash-paying path)
`settle_campaign`/`close_campaign` are SECURITY DEFINER and pay cash. Two layers:
1. **Route gate:** brand path calls `brandOwnsCampaign(svc, campaignId, c.var.brand.workspaceId)`
   → `select id from campaigns where id=? and workspace_id=?` → **404 before the RPC** (mirrors
   `brandOwnsSubmission`). A brand user from workspace A POSTing workspace B's `campaign_id`
   gets 404, never reaches the RPC.
2. **Defense-in-depth in the RPC:** re-reads `campaigns.workspace_id` and asserts it matches the
   proven workspace passed by the route.

### Two surfaces — `missionAuthoring` shared-seam pattern
- **Operator (Slice 1):** `server/routes/adminCampaigns.ts` mounted under `admin.ts` (staff JWT
  / `x-admin-secret` break-glass), `serviceClient()` everywhere, workspace from the campaign row.
- **Brand (Slice 1b):** `server/routes/campaigns.ts` under `brand.ts` `requireBrand()`; config
  writes via `makeUserClient` (RLS-isolated, `workspace_id` forced from `c.var.brand.workspaceId`);
  close/settle via `serviceClient` after the `brandOwnsCampaign` 404 check. Map `23505 → 422`
  for slug collisions.
- One pure `server/lib/campaignAuthoring.ts` (validate / edit-lock matrix / prize-tier
  validation / attach-overlap guard) mirroring `missionAuthoring.ts`; operator route exports
  col/helper sets, brand imports them.

---

## Section 9 — Migration `0025_campaigns.sql` contents (in order)

1. (If absent) `alter table missions add constraint missions_ws_id_uniq unique (workspace_id, id)`.
2. `create table campaigns` (+ `unique(workspace_id, slug)`, `unique(workspace_id, id)`, 2 indexes).
3. `create table campaign_missions` (soft `removed_at`, two composite FKs, `campaign_missions_one_active_uniq`).
4. `create table campaign_participants` (caches + idempotency timestamps, composite FK, unique, index).
5. RLS: enable on all three; brand policies from `0023` (with `and active`) on campaigns +
   campaign_missions; participants brand-SELECT + creator-self-read; grants (authenticated
   select/insert/update/delete on campaigns + campaign_missions, select on participants;
   `service_role` all).
6. Four `campaign_bonus:` / `campaign_prize:` partial-unique idempotency indexes (`left(...,15)`).
7. SQL function `rank_campaign(uuid)` (§5/§6).
8. RPCs (SECURITY DEFINER, `set search_path=public`, revoke from public/anon/authenticated,
   grant execute to `service_role`): `grant_campaign_completion_bonus(uuid,uuid)`,
   `close_campaign(uuid)`, `settle_campaign(uuid)`.
9. Trigger function `campaign_progress_on_approval()` + `AFTER UPDATE OF status ON
   mission_submissions` (increment-only, `for share`, auto-enroll, fire bonus on crossing;
   payout writes NOT swallowed).
10. Extend `notifications.type` CHECK to add `campaign_goal_reached`, `campaign_prize_awarded`
    — **after verifying the live constraint name in prod.**

**Does NOT touch `approve_submission`.** Honor house rules: `.js` import extensions on all new
`server/` files (CI-guarded `npm run check:esm`); add `server/test/campaigns.test.ts` to the
explicit `test:integration` list in `package.json`; run `npm run type-check` after adding
routes; never `vercel --prod` from local (Git deploys).

**Prod application:** the migration **tracker is out of sync** (records only through `0022`,
yet `0018–0024` are applied — their tables exist). A `db push` would replay `0018–0024` and
conflict. **Apply `0025` via raw SQL** (Supabase MCP `apply_migration` / `execute_sql` against
prod `mhkoayftiuojxlrkollf`), verify the `notifications.type` constraint name first, then issue
a PostgREST schema reload. Document it as "applied via raw SQL — not in tracker, do not re-apply."

---

## Section 10 — Surfaces, API & client

### Server routes (Slice 1: operator only)
- `server/routes/adminCampaigns.ts` (mounted under `admin.ts`): list / get / create / edit /
  publish / attach-mission / detach-mission / close / settle. `serviceClient`, workspace from
  the campaign row.
- Creator read routes (under the guarded creator router): `GET /campaigns` (active list),
  `GET /campaigns/:slug` (detail + my progress), `GET /campaigns/:slug/leaderboard` (via
  `rank_campaign` + `campaignLeaderboard.ts`).

### Client (TanStack routes + React Query)
- Creator: `src/routes/_app.campaigns.tsx` (layout `<Outlet/>`) + `_app.campaigns.index.tsx`
  (list) + `_app.campaigns.$slug.tsx` (detail). `useCampaigns()` / `useCampaign(slug)` /
  `useCampaignLeaderboard(slug)` in `src/lib/queries/kocmax.ts`. Nav entry in
  `src/components/navItems.ts`.
- Operator: `src/routes/admin.campaigns.index.tsx` + `admin.campaigns.new.tsx` +
  `admin.campaigns.$id.tsx`. Keys/fetchers/mutations in `adminKeys` (`src/lib/admin.ts`). Nav
  entry in `src/components/admin/adminNavItems.ts`.
- i18n: campaign keys in **both** en + zh blocks of `i18n.dict.ts` (identical key sets).

### Creator detail page (per the approved mockup)
Title + brand chip, countdown to `ends_at`, goal progress (`已批核 X / Y` + bar), reward tiers
(completion bonus + top-N cash prizes), the campaign mission set with per-mission status, and
the live leaderboard with the caller's row highlighted ("差 N 名入獎" when just outside the
prize cutoff).

---

## Section 11 — Edge-case decision table

| Case | Handling |
|---|---|
| Double completion-bonus (trigger fires twice / concurrent approvals cross together) | 3 layers: `goal_reached_at` set-once (count from the **locked** participant row) → `bonus_granted_at` under `for update` → `pt_campaign_bonus_uniq`. Exactly-once. |
| One submission, mission in two active campaigns | **Impossible** — `campaign_missions_one_active_uniq` + authoring overlap guard. |
| Concurrent operator + brand approval same campaign | Single trigger; both increment the same participant row under `for update`. Bonus fires at most once. |
| Late approval in grace window (delivered before `ends_at`, reviewed after) | Counts for bonus + ranking — eligibility keys on `submitted_at ∈ window`, not `reviewed_at`/`now()`. Bonus fires while `status <> 'settled'`. |
| Wrong-workspace credit (operator cross-workspace campaign) | Points + cash credit the creator's **home** workspace; cash **debit** hits the **campaign** budget. Two different `workspace_id`s, never conflated. Missing balance row seeded, never no-op'd. |
| Empty / insufficient budget at settlement | `insufficient_budget` rolls back the **entire** settlement; route → 402; top-up + re-call pays only unpaid winners. Completion bonus is points+XP only → never budget-blocked. |
| Malformed / negative `prize_tiers` (direct SQL) | `settle_campaign` re-validates in-RPC → `raise 'invalid_prize_tiers'`. |
| Prize cash ledger type | `type='earn'` (CHECK allows only `earn`/`adjust`); `source_ref='campaign_prize:…'` distinguishes. |
| Mission removed mid-campaign | Soft `removed_at`; as-of-approval mission-set rule used by trigger gate, `rank_campaign`, settle — removal never erases earned progress; removal locked once closed/settled. |
| Approval while draft / out-of-window | Gated by `submitted_at ∈ window` + `status <> 'settled'`. Publish does not backfill earlier approvals. |
| Goal reached, then sub un-approved | **Cannot occur** — `approved` is terminal; no decrement branch. (If un-approve is added later, the trigger must be revisited — flagged.) |
| RLS leak on cross-creator leaderboard | Never `makeUserClient`; `rank_campaign` SECURITY-DEFINER hard-filters `workspace_id`; route derives mission ids server-side. |
| Brand settles a campaign it doesn't own (1b) | `brandOwnsCampaign` → 404 before the RPC; RPC re-asserts workspace. |
| Deactivated `brand_user` reads roster (1b) | `and active` in the brand-SELECT policy → zero rows. |
| Two Settle clicks | `campaigns for update` + assert `status='closed'`; second sees `settled` → no-op/409. |
| In-flight approval racing `close` | Trigger `for share` conflicts with close's `for update`; boundary deterministic via `submitted_at`. |
| Tie at a cash boundary | Tiebreak `approved → avg_quality → goal_reached_at → creator_id (raw uuid)`. Single `rank_campaign` → rank seen == rank paid. |
| PostgREST numerics as strings; null `quality_rating` | `num()`/`?? 0` coercion; `avg_quality` over rated rows only, `0` if none. |
| Slug collision on concurrent create | `unique(workspace_id, slug)` → `23505` → route maps to **422** (tested). |
| Bonus XP past L2 but creator unverified | `effective_level` is L1-capped until social-verified; L2 celebration won't fire until verified — expected; don't promise it as part of the bonus. |
| Notification CHECK not extended / wrong name | Wrapped insert fails silently (logs `raise warning`); bonus/prize still succeeds. Verify the live name before drop/recreate; ship the CHECK extension in the same migration. |

---

## Section 12 — Testing strategy

- **Pure unit** (`campaignAuthoring.test.ts`, `campaignLeaderboard.test.ts`): validation +
  prize-tier checks + edit-lock matrix + attach-overlap guard; ranker decoration / numeric
  coercion / null-quality handling.
- **Integration** (`server/test/campaigns.test.ts`, added to the `test:integration` list,
  `--no-file-parallelism`, against the local stack with `.env.test.local` exported):
  - completion bonus exactly-once across two crossing approvals (one notification, one
    `campaign_bonus:` row);
  - `submitted_at`-in-window grace case (delivered in-window, reviewed after close → counts);
  - settle: ranks, tiered cash debit on the campaign budget + credit on the creator's home
    workspace, `type='earn'`, idempotent re-settle;
  - `insufficient_budget` → 402, whole settlement rolled back, then top-up + re-settle pays
    only unpaid winners;
  - one-active-campaign-per-mission constraint rejects a second attach;
  - mission removed mid-campaign preserves rank + bonus basis;
  - `reject_submission` on an approved row raises `wrong_state` (locks the monotonic invariant);
  - RLS: creator-self-read only on participants; (1b) deactivated brand_user → zero rows;
    brand cross-workspace settle → 404.
- **Route-stub** (`src/routes/-_app.campaigns.test.tsx`, `-admin.campaigns.test.tsx`): render
  `Route.options.component` with mocked query hooks.

---

## Section 13 — Open questions (resolved) & risks

All brainstorming open questions are resolved (see Locked decisions). Residual risks:
- **Raw-SQL migration on prod** — highest-risk step; the tracker drift means a careless
  `db push` conflicts. Mitigation: apply via MCP raw SQL, verify constraint names first, reload
  PostgREST, document as out-of-tracker.
- **First out-of-loop payout system** — mitigated by the idempotency backbone + integration
  tests above; settlement is manual (human gate) in Slice 1.
- **`approve_submission` is duplicated across `0009`/`0024`** — we do not touch it; the trigger
  is the single campaign entry point, so no divergence risk from this feature.
- **Lucide icon availability** for notification icons — confirm `Trophy`/`Award` are exported
  before wiring (precedent: `Facebook` was not).

---

## Out of scope (future)

Brand self-serve authoring is **Slice 1b** (fast-follow, no migration). Cron auto-close,
`campaign_started` broadcast, multi-metric / per-tier goals, multi-campaign overlap, and
persistent leaderboard snapshots are deferred to later slices.
