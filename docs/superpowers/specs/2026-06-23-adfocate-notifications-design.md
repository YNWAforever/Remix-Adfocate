# Adfocate N1 — Notifications (Engagement Slice 1) — Design

**Date:** 2026-06-23
**Slice:** N1 (first engagement slice of the SaaS-CMS direction; follows C1 Content Hub)
**Branch:** `feat/notifications-n1` (off `main` @ `86142f4`)
**Migration:** `0022_notifications.sql`

## 1. Summary

A per-creator, in-app notification system. Creators get a feed of events that affect
them — submission approved/rejected, redemption code ready, level-up, application
accepted/declined — surfaced as an unread badge on the nav, a `/notifications` page, and a
transient toast when a new one arrives in-session. Notifications are **created by database
triggers** on the source tables and **rendered to text at read-time** in TypeScript, so
copy stays bilingual in the frontend and emission is impossible to bypass.

This opens the **engagement** pillar of the CMS direction. C1 covered content management;
N1 is the creator-facing re-engagement loop.

## 2. Scope (locked in brainstorming)

| Decision | Choice |
|---|---|
| Audience | **Creators only** (operators keep the `/admin` dashboard queues) |
| Events | **Earning outcomes** (submission approved/rejected, redemption ready) + **Progression** (level-up) + **Applications** (accepted/declined) |
| Delivery | **In-app only** (the table doubles as a future external-push queue) |
| Surface | **Nav unread badge + `/notifications` page + sonner toast**; freshness via **polling** (no Realtime) |
| Emission | **DB-trigger-driven** + render-at-read i18n |

**Explicitly deferred (out of scope):** broadcasts (announcement / new-mission fan-out),
operator/staff notifications, external push (WhatsApp/email), Supabase Realtime, per-type
mute/preferences.

## 3. Why DB triggers (not app-layer)

All six events are **DB-side mutations** on three tables, and the recipient's `auth.uid()`
is present directly on every source row (`creators.id` *is* the auth user id;
`mission_submissions.creator_id` and `redemptions.creator_id` both reference it):

- **Level-up has no API route** — it is a pure DB trigger (`creators_set_level` on
  `creators.xp`). Only a DB-side emitter can catch it.
- Submission approve/reject, application accept/decline, and redeem are SECURITY DEFINER
  RPCs. A trigger fires regardless of which RPC/route/manual path mutated the row.
- Triggers are a **single, testable source of truth** — mutate a row, assert a
  notification appears.

App-layer emission was rejected: it can't catch level-up and would have to instrument
every call site. Hybrid was rejected: two mechanisms for one job.

## 4. Data model — `notifications` (migration `0022`)

```sql
create table public.notifications (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.creators(id) on delete cascade,  -- = auth.uid()
  workspace_id uuid not null references public.workspaces(id),
  type         text not null check (type in (
                 'submission_approved','submission_rejected','redemption_ready',
                 'level_up','application_accepted','application_declined')),
  entity_type  text,                        -- 'mission_submission' | 'redemption' | 'creator'
  entity_id    uuid,                         -- source row id (deep-link / future dedup)
  data         jsonb not null default '{}',  -- denormalized display fields (see §6)
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index notifications_user_created_idx on public.notifications (user_id, created_at desc);
create index notifications_user_unread_idx  on public.notifications (user_id) where read_at is null;
```

**RLS & grants** — creator reads own rows; can flip only `read_at`; inserts come *only*
from SECURITY DEFINER triggers (no insert grant to `authenticated`/`anon`):

```sql
alter table public.notifications enable row level security;
create policy notifications_self_read on public.notifications
  for select to authenticated using (user_id = auth.uid());
create policy notifications_self_mark_read on public.notifications
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;  -- column-scoped: type/data tamper-proof
```

## 5. Emission triggers

Three SECURITY DEFINER trigger functions (`set search_path = public`). The four
submission/application types collapse into one trigger keyed on the status transition.

| Trigger (event) | Condition `OLD.status → NEW.status` | `type` | `data` |
|---|---|---|---|
| `mission_submissions` AFTER UPDATE OF status | `applied → joined` | `application_accepted` | `{mission_title, mission_slug}` |
| | `applied → declined` | `application_declined` | `{mission_title, mission_slug, notes: NEW.reviewer_notes}` |
| | `submitted\|under_review → approved` | `submission_approved` | `{mission_title, mission_slug, points: Δpoints_awarded, xp: Δxp_awarded}` |
| | `submitted\|under_review → rejected` | `submission_rejected` | `{mission_title, mission_slug, reason: NEW.reviewer_notes}` |
| `creators` AFTER UPDATE OF xp | `NEW.level IS DISTINCT FROM OLD.level AND NEW.xp > OLD.xp` | `level_up` | `{level: NEW.level}` |
| `redemptions` AFTER INSERT | `NEW.status = 'fulfilled'` | `redemption_ready` | `{gift_name}` |

- Each function does one small lookup (`missions.title/slug` by `NEW.mission_id`, or
  `redemption_gifts.name` by `NEW.gift_id`) then inserts the row. `entity_type`/`entity_id`
  reference the source row.
- **Deltas** (`NEW.points_awarded - OLD.points_awarded`, same for xp) avoid hardcoding the
  +100 approval bonus.
- **Level-up detection (helper-free):** the trigger is `AFTER UPDATE OF xp` — *not*
  `OF level` — because the earn flow's UPDATE targets `xp`, and `creators_set_level` (a
  BEFORE trigger) recomputes `NEW.level`; an `UPDATE OF level` trigger would never fire
  since `level` is not in the statement's SET clause. The AFTER trigger then sees the
  recomputed `NEW.level` vs the prior `OLD.level` and emits when
  `NEW.level IS DISTINCT FROM OLD.level AND NEW.xp > OLD.xp`. The `xp > OLD.xp` guard makes
  this robust without a level-ordinal helper, since xp is monotonic in normal flows (earns
  only add) and we never want a "level-up" on an xp decrease.

**Critical resilience rule — the earn loop is sacred.** These triggers fire *inside* the
approve/redeem/level transactions. A failing notification insert must **never** roll back a
creator's points. Each function wraps its body in `begin … exception when others then
null; end` so notification emission is strictly best-effort, with defensive null-handling
on lookups.

## 6. Read API — `server/routes/notifications.ts`

Mounted on the `guarded` group; all reads/writes via `makeUserClient(jwt)` so RLS scopes
to the caller. Mirrors existing route patterns (`match.ts`, `content.ts`).

- `GET /api/notifications?limit=20&before=<created_at>` → `{ items, unread_count }`
  (newest first, keyset paginated on `created_at`).
- `GET /api/notifications/unread-count` → `{ count }` (cheap endpoint for badge polling).
- `POST /api/notifications/read` `{ ids: uuid[] }` → `update read_at = now()` where unread
  and owned (idempotent).
- `POST /api/notifications/read-all` → flip all unread for the caller.

Typed try/catch; no swallowed errors. Mark-read is idempotent (`where read_at is null`).

## 7. Render-at-read (i18n in TS, never in DB)

The server returns raw `type` + `data`. A **pure** client helper
`renderNotification(type, data, t) → { title, body, href, icon }` builds display text from
`i18n.dict.ts` templates and derives the deep-link:

- submission/application types → `/missions/{data.mission_slug}`
- `level_up` → `/passport`
- `redemption_ready` → `/redemption/history`

`data` payload per type:

| type | data fields | href |
|---|---|---|
| `submission_approved` | `mission_title, mission_slug, points, xp` | `/missions/{slug}` |
| `submission_rejected` | `mission_title, mission_slug, reason` | `/missions/{slug}` |
| `application_accepted` | `mission_title, mission_slug` | `/missions/{slug}` |
| `application_declined` | `mission_title, mission_slug, notes` | `/missions/{slug}` |
| `level_up` | `level` | `/passport` |
| `redemption_ready` | `gift_name` | `/redemption/history` |

Missing `data` fields degrade gracefully (e.g. omit the points clause).

## 8. Client & UI

- **`src/lib/notifications.ts`** — types (`Notification`, `NotificationType`),
  `notificationKeys`, fetchers (`listNotifications`, `getUnreadCount`, `markRead`,
  `markAllRead`) via `apiFetch`, and the pure `renderNotification`.
- **`navItems.ts`** — add `{ to: "/notifications", labelKey: "app.nav.notifications",
  icon: Bell, exact: false, showUnreadBadge: true }` (extend `NavItem` with optional
  `showUnreadBadge`).
- **`NotificationBadge.tsx`** — `useUnreadCount()` (TanStack Query,
  `refetchOnWindowFocus` + ~60s interval); rendered by `SideNav`/`BottomNav` on the flagged
  item; capped display ("9+").
- **`_app.notifications.index.tsx`** — feed page: list of `NotificationCard` (type icon,
  title/body, relative time, unread accent), **mark-all-read** button, empty state.
  Clicking a card marks it read and navigates to its `href`; opening the page marks the
  visible items read.
- **Toast** — a small effect in `_app` compares the polled unread count to the previous
  in-session value; when it rises, fire one `sonner` toast ("你有新通知"). Pure poll, no
  Realtime.
- **`i18n.dict.ts`** — `app.notif.<type>.{title,body}` (zh + en, placeholders
  `{mission}`/`{points}`/`{xp}`/`{level}`/`{gift}`/`{reason}`), `app.notif.{title,empty,markAll}`,
  `app.nav.notifications`.

## 9. Testing

- **Unit** (`src/lib/notifications.test.ts`): `renderNotification` for all 6 types —
  title/body interpolation, `href` derivation, graceful fallback on missing `data`.
- **Integration** (`server/test/notifications.test.ts`, local Supabase stack):
  - `approve_submission` → `submission_approved` (points/xp in `data`).
  - `reject_submission` → `submission_rejected` (reason).
  - `accept_application` → `application_accepted`; `decline_application` →
    `application_declined` (notes).
  - xp crossing a level threshold → `level_up`.
  - `redeem_gift` → `redemption_ready`.
  - **RLS isolation:** creator A cannot read creator B's notifications.
  - `read` / `read-all` flip `read_at`; `unread-count` correct.
- **Frontend** (`src/routes/-_app.notifications.index.test.tsx`): renders feed, unread
  styling, mark-all.

## 10. Sequencing, deployment & dependencies

- **No code dependency on C1.** N1 shares no DB objects with C1. Migration is numbered
  **`0022`** assuming C1's `0021` (PR #40) merges first (recommended). If N1 lands first,
  renumber to `0021`; functional order is irrelevant (independent objects), only the
  filename sequence matters.
- **Prod apply:** apply `0022` via **raw SQL / Supabase MCP `execute_sql` before deploy**,
  then `notify pgrst, 'reload schema'` (house pattern — migration tracker drift). **No new
  Vercel env.**
- Build in the isolated worktree `adfocate-2-notifications-n1`; do not disturb the
  concurrent `adfocate-2/` checkout.

## 11. File manifest

**New (server):** `supabase/migrations/0022_notifications.sql`,
`server/routes/notifications.ts`, `server/test/notifications.test.ts`.
**Modified (server):** `server/app.ts` (mount `guarded.route("/notifications", …)`).
**New (client):** `src/lib/notifications.ts`, `src/lib/notifications.test.ts`,
`src/components/NotificationBadge.tsx`, `src/components/notifications/NotificationCard.tsx`,
`src/routes/_app.notifications.index.tsx`, `src/routes/-_app.notifications.index.test.tsx`.
**Modified (client):** `src/components/navItems.ts`, `src/components/SideNav.tsx`,
`src/components/BottomNav.tsx`, `src/routes/_app.tsx` (toast effect), `src/lib/i18n.dict.ts`.
