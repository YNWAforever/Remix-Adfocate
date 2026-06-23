# Adfocate N1 — Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A per-creator, in-app notification system — DB triggers emit notifications on six earn-loop events; creators read them via a `/notifications` page, a nav unread badge, and a toast.

**Architecture:** `AFTER` triggers on `mission_submissions` / `creators` / `redemptions` insert `notifications` rows (structured `type` + `data`, no prose). A `guarded` Hono route serves them via `makeUserClient` (RLS-scoped). A pure TS helper renders bilingual text at read-time. Client hooks (TanStack Query) drive the page, badge (polling), and toast.

**Tech Stack:** Supabase Postgres (RLS, SECURITY DEFINER triggers), Hono, `@supabase/supabase-js`, TanStack Router + Query, Vitest, custom i18n (`useI18n`), sonner.

**Spec:** `docs/superpowers/specs/2026-06-23-adfocate-notifications-design.md`

**Working dir:** `/Users/willylai/Documents/Claude/Projects/New Adfocate/adfocate-2-notifications-n1` (branch `feat/notifications-n1` off `main` @ `86142f4`).

---

## Conventions (read before starting)

- **ESM imports:** relative server imports MUST end in `.js` (e.g. `import { makeUserClient } from "../lib/supabase.js"`). Enforced by `npm run check:esm`.
- **Local Supabase only:** integration tests run against the local stack. Confirm `echo $SUPABASE_URL` resolves to `http://127.0.0.1:54321` (or `http://localhost:54321`) before running — NEVER point tests at prod. The integration runner is `npm run test:integration`.
- **Applying a migration locally:** `supabase migration up --local` may fail on history drift; the reliable path is:
  `docker exec -i supabase_db_adfocate-2 psql -U postgres -d postgres < supabase/migrations/0022_notifications.sql`
  (container name may differ — find it with `docker ps --format '{{.Names}}' | grep supabase_db`).
- **i18n:** `en` and `zh` key sets MUST be identical (enforced by `src/lib/i18n.test.ts`). Add every new key to BOTH blocks. `t(key, params)` replaces `{x}` with `params.x`; **a missing param leaves `{x}` literal**, so callers must pass every referenced field (coalesce to `""`).
- **TanStack routes:** new route files are picked up by `tsr generate` (runs inside `type-check` and `build`). Do not hand-edit `routeTree.gen.ts`.
- **Commit after every task.**

## File structure

**New (server):**
- `supabase/migrations/0022_notifications.sql` — table, indexes, RLS, grants, 3 trigger fns + triggers.
- `server/routes/notifications.ts` — read API (`guarded` group).
- `server/test/notifications-triggers.test.ts` — trigger behavior + RLS (integration).
- `server/test/notifications-api.test.ts` — route endpoints (integration).

**Modified (server):**
- `server/app.ts` — mount `guarded.route("/notifications", notificationRoutes)`.
- `package.json` — add both new test files to the `test:integration` script.

**New (client):**
- `src/lib/notifications.ts` — types + pure `renderNotification` + `iconFor`.
- `src/lib/notifications.test.ts` — unit tests for `renderNotification`.
- `src/components/NotificationBadge.tsx` + `src/components/NotificationBadge.test.tsx`.
- `src/components/notifications/NotificationCard.tsx`.
- `src/routes/_app.notifications.tsx` — the feed page.
- `src/routes/-_app.notifications.test.tsx` — frontend route test.
- `src/components/NotificationToaster.tsx` — in-session new-notification toast.

**Modified (client):**
- `src/lib/queries/kocmax.ts` — `useNotifications`, `useUnreadCount`, `useMarkRead`, `useMarkAllRead`, types.
- `src/components/navItems.ts` — add Notifications item + optional `showUnreadBadge`.
- `src/components/SideNav.tsx`, `src/components/BottomNav.tsx` — render the badge.
- `src/routes/_app.tsx` — mount `<NotificationToaster />`.
- `src/lib/i18n.dict.ts` — `app.notif.*` + `app.nav.notifications` (both langs).

---

### Task 1: Migration `0022_notifications.sql` + trigger/RLS integration test

**Files:**
- Create: `supabase/migrations/0022_notifications.sql`
- Test: `server/test/notifications-triggers.test.ts`
- Modify: `package.json` (the `test:integration` script)

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0022_notifications.sql`:

```sql
-- N1: per-creator notifications. Rows are created ONLY by the SECURITY DEFINER
-- triggers below (creators never insert); creators may read their own rows and flip
-- read_at. Display text is rendered at read-time in TS — the DB stores only type + data.

-- 1. Table ---------------------------------------------------------------------
create table public.notifications (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.creators(id) on delete cascade,  -- = auth.uid()
  workspace_id uuid not null references public.workspaces(id),
  type         text not null check (type in (
                 'submission_approved','submission_rejected','redemption_ready',
                 'level_up','application_accepted','application_declined')),
  entity_type  text,
  entity_id    uuid,
  data         jsonb not null default '{}',
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index notifications_user_created_idx on public.notifications (user_id, created_at desc);
create index notifications_user_unread_idx  on public.notifications (user_id) where read_at is null;

-- 2. RLS + grants: read own; flip only read_at; NO insert grant (triggers insert) -
alter table public.notifications enable row level security;
create policy notifications_self_read on public.notifications
  for select to authenticated using (user_id = auth.uid());
create policy notifications_self_mark_read on public.notifications
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant all on public.notifications to service_role;

-- 3. Trigger: submission + application status transitions ----------------------
create or replace function public.notify_on_submission_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_type text;
  v_mission record;
  v_data jsonb;
begin
  if    old.status = 'applied' and new.status = 'joined'   then v_type := 'application_accepted';
  elsif old.status = 'applied' and new.status = 'declined' then v_type := 'application_declined';
  elsif old.status in ('submitted','under_review') and new.status = 'approved' then v_type := 'submission_approved';
  elsif old.status in ('submitted','under_review') and new.status = 'rejected' then v_type := 'submission_rejected';
  else return new;  -- not a notable transition
  end if;

  begin
    select title, slug into v_mission from public.missions where id = new.mission_id;
    v_data := jsonb_build_object('mission_title', coalesce(v_mission.title, ''),
                                 'mission_slug',  coalesce(v_mission.slug, ''));
    if v_type = 'submission_approved' then
      v_data := v_data || jsonb_build_object('points', new.points_awarded - old.points_awarded,
                                             'xp',     new.xp_awarded - old.xp_awarded);
    elsif v_type = 'submission_rejected' then
      v_data := v_data || jsonb_build_object('reason', coalesce(new.reviewer_notes, ''));
    elsif v_type = 'application_declined' then
      v_data := v_data || jsonb_build_object('notes', coalesce(new.reviewer_notes, ''));
    end if;

    insert into public.notifications (user_id, workspace_id, type, entity_type, entity_id, data)
      values (new.creator_id, new.workspace_id, v_type, 'mission_submission', new.id, v_data);
  exception when others then
    null;  -- notifications are best-effort; NEVER roll back the earn loop
  end;
  return new;
end;
$$;

create trigger notifications_on_submission_change
  after update of status on public.mission_submissions
  for each row execute function public.notify_on_submission_change();

-- 4. Trigger: level-up (fires on xp change; emits only when level actually rises) -
create or replace function public.notify_on_level_up() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.level is distinct from old.level and new.xp > old.xp then
    begin
      insert into public.notifications (user_id, workspace_id, type, entity_type, entity_id, data)
        values (new.id, new.workspace_id, 'level_up', 'creator', new.id,
                jsonb_build_object('level', new.level));
    exception when others then null;
    end;
  end if;
  return new;
end;
$$;

create trigger notifications_on_level_up
  after update of xp on public.creators
  for each row execute function public.notify_on_level_up();

-- 5. Trigger: redemption fulfilled --------------------------------------------
create or replace function public.notify_on_redemption() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if new.status = 'fulfilled' then
    begin
      select name into v_name from public.redemption_gifts where id = new.gift_id;
      insert into public.notifications (user_id, workspace_id, type, entity_type, entity_id, data)
        values (new.creator_id, new.workspace_id, 'redemption_ready', 'redemption', new.id,
                jsonb_build_object('gift_name', coalesce(v_name, '')));
    exception when others then null;
    end;
  end if;
  return new;
end;
$$;

create trigger notifications_on_redemption
  after insert on public.redemptions
  for each row execute function public.notify_on_redemption();
```

- [ ] **Step 2: Write the failing trigger/RLS test**

Create `server/test/notifications-triggers.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  hasSupabaseEnv, serviceForTests, userForJwt, makeCreator, makeMission,
  makeGift, addCodes, setXp, cleanup, DEMO_WS,
} from "./helpers";

const suite = hasSupabaseEnv ? describe : describe.skip;

/** Seed a submission row directly (service) in a given status; returns its id. */
async function seedSub(creatorId: string, status: string, slug: string) {
  const m = await makeMission({ slug });
  const { data, error } = await serviceForTests()
    .from("mission_submissions")
    .insert({ mission_id: m.id, creator_id: creatorId, workspace_id: DEMO_WS, status })
    .select("id")
    .single();
  if (error) throw error;
  return data!.id as string;
}

/** All notifications visible to a creator (RLS-scoped via their JWT). */
async function notifsFor(jwt: string) {
  const { data, error } = await userForJwt(jwt)
    .from("notifications").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return data as Array<{ type: string; data: Record<string, unknown>; user_id: string }>;
}

suite("notification triggers", () => {
  let koc: { userId: string; jwt: string };
  beforeAll(async () => {
    await cleanup();
    koc = await makeCreator("notif-trig@test.local", 1000);
  });
  afterAll(cleanup);

  it("submission_approved carries points + xp deltas", async () => {
    const id = await seedSub(koc.userId, "submitted", "test-notif-approve");
    await serviceForTests().rpc("approve_submission", { p_submission: id, p_notes: "good" });
    const n = (await notifsFor(koc.jwt)).find((x) => x.type === "submission_approved");
    expect(n).toBeTruthy();
    expect(n!.data.points).toBeGreaterThan(0);
    expect(n!.data.xp).toBe(100);
  });

  it("submission_rejected carries the reason", async () => {
    const id = await seedSub(koc.userId, "submitted", "test-notif-reject");
    await serviceForTests().rpc("reject_submission", { p_submission: id, p_notes: "off-brief" });
    const n = (await notifsFor(koc.jwt)).find((x) => x.type === "submission_rejected");
    expect(n?.data.reason).toBe("off-brief");
  });

  it("application_accepted and application_declined fire", async () => {
    const a = await seedSub(koc.userId, "applied", "test-notif-accept");
    await serviceForTests().rpc("accept_application", { p_submission: a });
    const d = await seedSub(koc.userId, "applied", "test-notif-decline");
    await serviceForTests().rpc("decline_application", { p_submission: d, p_notes: "later" });
    const types = (await notifsFor(koc.jwt)).map((x) => x.type);
    expect(types).toContain("application_accepted");
    expect(types).toContain("application_declined");
  });

  it("level_up fires when xp crosses a threshold", async () => {
    await setXp(koc.userId, 500); // L0 -> L1
    const n = (await notifsFor(koc.jwt)).find((x) => x.type === "level_up");
    expect(n?.data.level).toBe("L1");
  });

  it("redemption_ready carries the gift name", async () => {
    const g = await makeGift({ name: "test-notif-gift", points_cost: 100 });
    await addCodes(g.id, ["TEST-CODE-1"]);
    await userForJwt(koc.jwt).rpc("redeem_gift", { p_gift: g.id });
    const n = (await notifsFor(koc.jwt)).find((x) => x.type === "redemption_ready");
    expect(n?.data.gift_name).toBe("test-notif-gift");
  });

  it("RLS isolates notifications between creators", async () => {
    const other = await makeCreator("notif-other@test.local", 0);
    const mine = await notifsFor(koc.jwt);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((n) => n.user_id === koc.userId)).toBe(true);
    const theirs = await notifsFor(other.jwt);
    expect(theirs.length).toBe(0);
  });
});
```

- [ ] **Step 3: Add the test to the integration runner**

In `package.json`, append both new files to the `test:integration` script (after `server/test/assistant.test.ts`):

```
server/test/notifications-triggers.test.ts server/test/notifications-api.test.ts
```

- [ ] **Step 4: Run the test — verify it FAILS**

Run: `npm run test:integration -- server/test/notifications-triggers.test.ts`
Expected: FAIL (relation `notifications` does not exist).

- [ ] **Step 5: Apply the migration locally**

Run (adjust container name if needed):
```bash
CID=$(docker ps --format '{{.Names}}' | grep supabase_db | head -1)
docker exec -i "$CID" psql -U postgres -d postgres < supabase/migrations/0022_notifications.sql
docker exec -i "$CID" psql -U postgres -d postgres -c "notify pgrst, 'reload schema';"
```
Expected: `CREATE TABLE`, `CREATE INDEX`, `ALTER TABLE`, `CREATE POLICY`, `GRANT`, `CREATE FUNCTION`, `CREATE TRIGGER` (no errors).

- [ ] **Step 6: Run the test — verify it PASSES**

Run: `npm run test:integration -- server/test/notifications-triggers.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0022_notifications.sql server/test/notifications-triggers.test.ts package.json
git commit -m "feat(notifications): 0022 table + RLS + emission triggers (+ integration test)"
```

---

### Task 2: Pure render module + i18n keys

**Files:**
- Create: `src/lib/notifications.ts`
- Test: `src/lib/notifications.test.ts`
- Modify: `src/lib/i18n.dict.ts`

- [ ] **Step 1: Add i18n keys (BOTH languages)**

In `src/lib/i18n.dict.ts`, inside the **`en`** block (near the other `app.*` keys), add:

```ts
    "app.notif.title": "Notifications",
    "app.notif.empty": "No notifications yet.",
    "app.notif.markAll": "Mark all read",
    "app.notif.submission_approved.title": "Submission approved!",
    "app.notif.submission_approved.body": "“{mission}” approved — +{points} pts · +{xp} XP",
    "app.notif.submission_rejected.title": "Submission needs work",
    "app.notif.submission_rejected.body": "“{mission}” was not approved. {reason}",
    "app.notif.application_accepted.title": "Application accepted",
    "app.notif.application_accepted.body": "You're in on “{mission}” — start creating!",
    "app.notif.application_declined.title": "Application declined",
    "app.notif.application_declined.body": "“{mission}” wasn't a match this time. {notes}",
    "app.notif.level_up.title": "Level up!",
    "app.notif.level_up.body": "You reached {level}. Keep going!",
    "app.notif.redemption_ready.title": "Reward ready",
    "app.notif.redemption_ready.body": "Your “{gift}” code is ready — view it in Redeem history.",
    "app.notif.toast.new": "You have a new notification",
```

In the **`zh`** block, add the identical keys with zh-HK values:

```ts
    "app.notif.title": "通知",
    "app.notif.empty": "暫時未有通知。",
    "app.notif.markAll": "全部標為已讀",
    "app.notif.submission_approved.title": "內容已通過！",
    "app.notif.submission_approved.body": "「{mission}」已獲批，+{points} 分・+{xp} XP",
    "app.notif.submission_rejected.title": "內容需要修改",
    "app.notif.submission_rejected.body": "「{mission}」未獲批。{reason}",
    "app.notif.application_accepted.title": "申請已接受",
    "app.notif.application_accepted.body": "你已加入「{mission}」，開始創作啦！",
    "app.notif.application_declined.title": "申請未獲接受",
    "app.notif.application_declined.body": "「{mission}」今次未夾，下次再試。{notes}",
    "app.notif.level_up.title": "升級喇！",
    "app.notif.level_up.body": "你已晉升至 {level}，繼續努力！",
    "app.notif.redemption_ready.title": "獎賞準備好",
    "app.notif.redemption_ready.body": "你嘅「{gift}」兌換碼已準備好，可喺兌換紀錄查看。",
    "app.notif.toast.new": "你有一則新通知",
```

- [ ] **Step 2: Write the failing unit test**

Create `src/lib/notifications.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { renderNotification, type NotificationType } from "./notifications";
import { dict } from "./i18n.dict";

// Real interpolating t bound to a locale (mirrors i18n.tsx).
function makeT(locale: "en" | "zh") {
  return (key: string, params?: Record<string, string | number>) => {
    const s = dict[locale][key] ?? dict.en[key] ?? key;
    return params ? s.replace(/\{(\w+)\}/g, (_, k) => (k in params ? String(params[k]) : `{${k}}`)) : s;
  };
}
const t = makeT("zh");

function row(type: NotificationType, data: Record<string, unknown> = {}) {
  return { id: "n1", type, data, entity_id: null, entity_type: null, read_at: null, created_at: "2026-06-23T00:00:00Z" };
}

describe("renderNotification", () => {
  it("renders submission_approved with points/xp and links to the mission", () => {
    const r = renderNotification(row("submission_approved", { mission_title: "夏日開箱", mission_slug: "summer", points: 200, xp: 100 }), t);
    expect(r.title).toBe("內容已通過！");
    expect(r.body).toContain("夏日開箱");
    expect(r.body).toContain("200");
    expect(r.body).toContain("100");
    expect(r.href).toBe("/mission/summer");
  });

  it("renders level_up linking to passport", () => {
    const r = renderNotification(row("level_up", { level: "L2" }), t);
    expect(r.title).toBe("升級喇！");
    expect(r.body).toContain("L2");
    expect(r.href).toBe("/passport");
  });

  it("renders redemption_ready linking to redemption history", () => {
    const r = renderNotification(row("redemption_ready", { gift_name: "Starbucks 券" }), t);
    expect(r.body).toContain("Starbucks 券");
    expect(r.href).toBe("/redemption/history");
  });

  it("never leaks a raw {placeholder} when a data field is missing", () => {
    const r = renderNotification(row("submission_rejected", { mission_title: "X", mission_slug: "x" }), t);
    expect(r.body).not.toMatch(/\{[a-z_]+\}/);
  });

  it("returns an icon name for every type", () => {
    (["submission_approved","submission_rejected","redemption_ready","level_up","application_accepted","application_declined"] as NotificationType[])
      .forEach((ty) => expect(renderNotification(row(ty), t).icon).toBeTruthy());
  });
});
```

- [ ] **Step 3: Run the test — verify it FAILS**

Run: `npx vitest run src/lib/notifications.test.ts`
Expected: FAIL (cannot find module `./notifications`).

- [ ] **Step 4: Implement the pure module**

Create `src/lib/notifications.ts`:

```ts
import { CheckCircle2, XCircle, Gift, TrendingUp, UserCheck, UserX, Bell, type LucideIcon } from "lucide-react";

export type NotificationType =
  | "submission_approved" | "submission_rejected" | "redemption_ready"
  | "level_up" | "application_accepted" | "application_declined";

export type NotificationRow = {
  id: string;
  type: NotificationType;
  data: Record<string, unknown>;
  entity_type: string | null;
  entity_id: string | null;
  read_at: string | null;
  created_at: string;
};

export type RenderedNotification = { title: string; body: string; href: string; icon: LucideIcon };

type T = (key: string, params?: Record<string, string | number>) => string;

const ICONS: Record<NotificationType, LucideIcon> = {
  submission_approved: CheckCircle2,
  submission_rejected: XCircle,
  redemption_ready: Gift,
  level_up: TrendingUp,
  application_accepted: UserCheck,
  application_declined: UserX,
};

export function iconFor(type: NotificationType): LucideIcon {
  return ICONS[type] ?? Bell;
}

/** Build the full {param} set each template might reference, coalescing missing
 *  fields to "" so t() never leaves a raw {placeholder} (see i18n interpolate). */
function paramsFor(data: Record<string, unknown>): Record<string, string | number> {
  const s = (k: string) => (data[k] == null ? "" : String(data[k]));
  const n = (k: string) => (typeof data[k] === "number" ? (data[k] as number) : 0);
  return {
    mission: s("mission_title"),
    level: s("level"),
    gift: s("gift_name"),
    reason: s("reason"),
    notes: s("notes"),
    points: n("points"),
    xp: n("xp"),
  };
}

function hrefFor(row: NotificationRow): string {
  switch (row.type) {
    case "level_up": return "/passport";
    case "redemption_ready": return "/redemption/history";
    default: {
      const slug = row.data.mission_slug;
      return typeof slug === "string" && slug ? `/mission/${slug}` : "/home";
    }
  }
}

export function renderNotification(row: NotificationRow, t: T): RenderedNotification {
  const params = paramsFor(row.data);
  return {
    title: t(`app.notif.${row.type}.title`),
    body: t(`app.notif.${row.type}.body`, params),
    href: hrefFor(row),
    icon: iconFor(row.type),
  };
}
```

- [ ] **Step 5: Run the test — verify it PASSES**

Run: `npx vitest run src/lib/notifications.test.ts && npx vitest run src/lib/i18n.test.ts`
Expected: PASS (both — i18n.test confirms en/zh parity).

- [ ] **Step 6: Commit**

```bash
git add src/lib/notifications.ts src/lib/notifications.test.ts src/lib/i18n.dict.ts
git commit -m "feat(notifications): pure renderNotification + bilingual i18n keys"
```

---

### Task 3: Read API route + mount + API integration test

**Files:**
- Create: `server/routes/notifications.ts`
- Create: `server/test/notifications-api.test.ts`
- Modify: `server/app.ts`

- [ ] **Step 1: Write the failing API test**

Create `server/test/notifications-api.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../app";
import { hasSupabaseEnv, serviceForTests, makeCreator, cleanup, DEMO_WS } from "./helpers";

const { app } = createApp();
const suite = hasSupabaseEnv ? describe : describe.skip;

function req(path: string, jwt: string, init: RequestInit = {}) {
  return app.request(`/api${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${jwt}`, "X-Workspace-Slug": "demo", "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

async function seedNotif(userId: string, type: string, read = false) {
  const { data, error } = await serviceForTests().from("notifications")
    .insert({ user_id: userId, workspace_id: DEMO_WS, type, data: { mission_title: "X", mission_slug: "x" }, read_at: read ? new Date().toISOString() : null })
    .select("id").single();
  if (error) throw error;
  return data!.id as string;
}

suite("notifications API", () => {
  let koc: { userId: string; jwt: string };
  beforeAll(async () => {
    await cleanup();
    koc = await makeCreator("notif-api@test.local", 0);
    await seedNotif(koc.userId, "level_up");
    await seedNotif(koc.userId, "submission_approved");
    await seedNotif(koc.userId, "submission_rejected", true);
  });
  afterAll(cleanup);

  it("lists notifications newest-first with an unread_count", async () => {
    const body = await (await req("/notifications", koc.jwt)).json();
    expect(body.items.length).toBe(3);
    expect(body.unread_count).toBe(2);
  });

  it("unread-count endpoint returns the count", async () => {
    const body = await (await req("/notifications/unread-count", koc.jwt)).json();
    expect(body.count).toBe(2);
  });

  it("marks specific ids read", async () => {
    const id = await seedNotif(koc.userId, "redemption_ready");
    const res = await req("/notifications/read", koc.jwt, { method: "POST", body: JSON.stringify({ ids: [id] }) });
    expect(res.status).toBe(200);
    const after = await (await req("/notifications/unread-count", koc.jwt)).json();
    expect(after.count).toBe(2); // back to 2 (the new unread one is now read)
  });

  it("marks all read", async () => {
    await req("/notifications/read-all", koc.jwt, { method: "POST" });
    const after = await (await req("/notifications/unread-count", koc.jwt)).json();
    expect(after.count).toBe(0);
  });

  it("does not leak another creator's notifications", async () => {
    const other = await makeCreator("notif-api-other@test.local", 0);
    const body = await (await req("/notifications", other.jwt)).json();
    expect(body.items.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test — verify it FAILS**

Run: `npm run test:integration -- server/test/notifications-api.test.ts`
Expected: FAIL (404 — route not mounted; `body.items` undefined).

- [ ] **Step 3: Implement the route**

Create `server/routes/notifications.ts`:

```ts
import { Hono } from "hono";
import type { Env } from "../app.js";
import { makeUserClient } from "../lib/supabase.js";

export const notificationRoutes = new Hono<Env>();

/** GET /api/notifications?limit=20&before=<ISO> — caller's notifications, newest first,
 *  plus the current unread count. RLS scopes every read to auth.uid(). */
notificationRoutes.get("/", async (c) => {
  const supabase = makeUserClient(c.get("jwt"));
  const limit = Math.min(Number(c.req.query("limit") ?? 20) || 20, 50);
  const before = c.req.query("before");

  let q = supabase
    .from("notifications")
    .select("id, type, data, entity_type, entity_id, read_at, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (before) q = q.lt("created_at", before);

  const [{ data: items, error }, { count, error: cErr }] = await Promise.all([
    q,
    supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null),
  ]);
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  if (cErr) return c.json({ error: cErr.message, code: "db_error" }, 500);
  return c.json({ items: items ?? [], unread_count: count ?? 0 });
});

/** GET /api/notifications/unread-count — cheap endpoint for the nav badge poll. */
notificationRoutes.get("/unread-count", async (c) => {
  const supabase = makeUserClient(c.get("jwt"));
  const { count, error } = await supabase
    .from("notifications").select("id", { count: "exact", head: true }).is("read_at", null);
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json({ count: count ?? 0 });
});

/** POST /api/notifications/read { ids: string[] } — mark specific rows read (idempotent). */
notificationRoutes.post("/read", async (c) => {
  const supabase = makeUserClient(c.get("jwt"));
  const body = await c.req.json().catch(() => ({}));
  const ids = Array.isArray(body.ids) ? (body.ids as string[]) : [];
  if (ids.length === 0) return c.json({ updated: 0 });
  const { error } = await supabase
    .from("notifications").update({ read_at: new Date().toISOString() }).in("id", ids).is("read_at", null);
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json({ updated: ids.length });
});

/** POST /api/notifications/read-all — mark all of the caller's unread rows read. */
notificationRoutes.post("/read-all", async (c) => {
  const supabase = makeUserClient(c.get("jwt"));
  const { error } = await supabase
    .from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
  if (error) return c.json({ error: error.message, code: "db_error" }, 500);
  return c.json({ ok: true });
});
```

- [ ] **Step 4: Mount the route**

In `server/app.ts`, add the import after the `matchRoutes` import (line ~10):
```ts
import { notificationRoutes } from "./routes/notifications.js";
```
And mount it in the `guarded` group (after the `match` line, ~line 41):
```ts
  guarded.route("/notifications", notificationRoutes);
```

- [ ] **Step 5: Run the test — verify it PASSES**

Run: `npm run test:integration -- server/test/notifications-api.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add server/routes/notifications.ts server/app.ts server/test/notifications-api.test.ts
git commit -m "feat(notifications): read API (list/unread-count/read/read-all) on guarded group"
```

---

### Task 4: Client query hooks

**Files:**
- Modify: `src/lib/queries/kocmax.ts`

- [ ] **Step 1: Add the hooks + types**

At the end of `src/lib/queries/kocmax.ts`, append:

```ts
import type { NotificationRow } from "@/lib/notifications";

export type NotificationList = { items: NotificationRow[]; unread_count: number };

export function useNotifications() {
  return useQuery({
    queryKey: ["notifications"],
    queryFn: () => apiFetch<NotificationList>("/notifications"),
  });
}

/** Lightweight unread count for the nav badge — polls on focus + interval. */
export function useUnreadCount() {
  return useQuery({
    queryKey: ["notifications-unread-count"],
    queryFn: async () => (await apiFetch<{ count: number }>("/notifications/unread-count")).count,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) =>
      apiFetch<{ updated: number }>("/notifications/read", { method: "POST", body: JSON.stringify({ ids }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
      qc.invalidateQueries({ queryKey: ["notifications-unread-count"] });
    },
  });
}

export function useMarkAllRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ ok: boolean }>("/notifications/read-all", { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
      qc.invalidateQueries({ queryKey: ["notifications-unread-count"] });
    },
  });
}
```

> Note: the codebase places the `import` for `apiFetch` at the top; the new `import type { NotificationRow }` line may be moved up next to the other imports if your linter prefers (ESLint `import/first`). Run `npm run lint` and fix if flagged.

- [ ] **Step 2: Type-check**

Run: `npm run type-check`
Expected: PASS (no errors).

- [ ] **Step 3: Commit**

```bash
git add src/lib/queries/kocmax.ts
git commit -m "feat(notifications): client query hooks (list/unread-count/read/read-all)"
```

---

### Task 5: Nav item + unread badge

**Files:**
- Modify: `src/components/navItems.ts`
- Create: `src/components/NotificationBadge.tsx`
- Test: `src/components/NotificationBadge.test.tsx`
- Modify: `src/components/SideNav.tsx`, `src/components/BottomNav.tsx`
- Modify: `src/lib/i18n.dict.ts` (`app.nav.notifications`)

- [ ] **Step 1: Add the nav label (BOTH languages)**

In `src/lib/i18n.dict.ts`, add next to the other `app.nav.*` keys:
- `en`: `"app.nav.notifications": "Alerts",`
- `zh`: `"app.nav.notifications": "通知",`

- [ ] **Step 2: Extend navItems**

In `src/components/navItems.ts`: add `Bell` to the lucide import, extend the type, and add the item:

```ts
import { Home, Target, Gift, Wallet, Compass, BookOpen, Bell, type LucideIcon } from "lucide-react";

export type NavItem = { to: string; labelKey: string; icon: LucideIcon; exact: boolean; showUnreadBadge?: boolean };

export const NAV_ITEMS: NavItem[] = [
  { to: "/home", labelKey: "app.nav.home", icon: Home, exact: true },
  { to: "/mission", labelKey: "app.nav.mission", icon: Target, exact: false },
  { to: "/notifications", labelKey: "app.nav.notifications", icon: Bell, exact: false, showUnreadBadge: true },
  { to: "/redemption", labelKey: "app.nav.redemption", icon: Gift, exact: false },
  { to: "/wallet", labelKey: "app.nav.wallet", icon: Wallet, exact: false },
  { to: "/explore", labelKey: "app.nav.explore", icon: Compass, exact: false },
  { to: "/guide", labelKey: "app.nav.guide", icon: BookOpen, exact: false },
];
```

- [ ] **Step 3: Write the failing badge test**

Create `src/components/NotificationBadge.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({ count: 0 as number | undefined }));
vi.mock("@/lib/queries/kocmax", () => ({ useUnreadCount: () => ({ data: h.count }) }));

import { NotificationBadge } from "./NotificationBadge";

describe("NotificationBadge", () => {
  it("renders nothing at zero", () => {
    h.count = 0;
    const { container } = render(<NotificationBadge />);
    expect(container.textContent).toBe("");
  });
  it("renders the count", () => {
    h.count = 3;
    render(<NotificationBadge />);
    expect(screen.getByText("3")).toBeInTheDocument();
  });
  it("caps at 9+", () => {
    h.count = 42;
    render(<NotificationBadge />);
    expect(screen.getByText("9+")).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run the test — verify it FAILS**

Run: `npx vitest run src/components/NotificationBadge.test.tsx`
Expected: FAIL (cannot find module `./NotificationBadge`).

- [ ] **Step 5: Implement the badge**

Create `src/components/NotificationBadge.tsx`:

```tsx
import { useUnreadCount } from "@/lib/queries/kocmax";

export function NotificationBadge() {
  const { data: count } = useUnreadCount();
  if (!count || count <= 0) return null;
  return (
    <span
      aria-label={`${count} unread`}
      className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-magenta)] px-1.5 text-[10px] font-bold leading-4 text-white"
    >
      {count > 9 ? "9+" : count}
    </span>
  );
}
```

- [ ] **Step 6: Render the badge in SideNav**

In `src/components/SideNav.tsx`: add `import { NotificationBadge } from "./NotificationBadge";` and, inside the `NAV_ITEMS.map` Link (after the `<span>{t(item.labelKey)}</span>`), add:
```tsx
            {item.showUnreadBadge && <NotificationBadge />}
```

- [ ] **Step 7: Render the badge in BottomNav**

In `src/components/BottomNav.tsx`: add `import { NotificationBadge } from "./NotificationBadge";` and wrap the icon so the badge can overlay. Replace the `<Icon size={20} aria-hidden />` line with:
```tsx
            <span className="relative">
              <Icon size={20} aria-hidden />
              {item.showUnreadBadge && (
                <span className="absolute -right-2 -top-1">
                  <NotificationBadge />
                </span>
              )}
            </span>
```

- [ ] **Step 8: Run the tests — verify they PASS**

Run: `npx vitest run src/components/NotificationBadge.test.tsx src/lib/i18n.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/components/navItems.ts src/components/NotificationBadge.tsx src/components/NotificationBadge.test.tsx src/components/SideNav.tsx src/components/BottomNav.tsx src/lib/i18n.dict.ts
git commit -m "feat(notifications): nav item + live unread badge"
```

---

### Task 6: Notifications page + card

**Files:**
- Create: `src/components/notifications/NotificationCard.tsx`
- Create: `src/routes/_app.notifications.tsx`
- Test: `src/routes/-_app.notifications.test.tsx`

- [ ] **Step 1: Write the failing route test**

Create `src/routes/-_app.notifications.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, Link: ({ to, children, ...rest }: { to: string; children?: React.ReactNode } & Record<string, unknown>) => (<a href={to} {...rest}>{children}</a>) };
});

const h = vi.hoisted(() => ({
  list: { data: { items: [] as unknown[], unread_count: 0 }, isLoading: false, isError: false },
}));
vi.mock("@/lib/queries/kocmax", () => ({
  useNotifications: () => h.list,
  useMarkRead: () => ({ mutate: vi.fn() }),
  useMarkAllRead: () => ({ mutate: vi.fn() }),
}));

import { Route } from "./_app.notifications";

function renderPage() {
  const C = Route.options.component as React.ComponentType;
  return render(<C />);
}

const item = (over: Record<string, unknown> = {}) => ({
  id: "n1", type: "submission_approved", data: { mission_title: "夏日開箱", mission_slug: "summer", points: 200, xp: 100 },
  entity_type: null, entity_id: null, read_at: null, created_at: "2026-06-23T00:00:00Z", ...over,
});

beforeEach(() => { h.list = { data: { items: [], unread_count: 0 }, isLoading: false, isError: false }; });

describe("Notifications page", () => {
  it("renders the heading", () => {
    renderPage();
    expect(screen.getByText("通知")).toBeInTheDocument();
  });
  it("renders the empty state", () => {
    renderPage();
    expect(screen.getByText("暫時未有通知。")).toBeInTheDocument();
  });
  it("renders a notification's rendered title + body", () => {
    h.list = { data: { items: [item()], unread_count: 1 }, isLoading: false, isError: false };
    renderPage();
    expect(screen.getByText("內容已通過！")).toBeInTheDocument();
    expect(screen.getByText(/夏日開箱/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test — verify it FAILS**

Run: `npx vitest run src/routes/-_app.notifications.test.tsx`
Expected: FAIL (cannot find module `./_app.notifications`).

- [ ] **Step 3: Implement the card**

Create `src/components/notifications/NotificationCard.tsx`:

```tsx
import { useI18n } from "@/lib/i18n";
import { renderNotification, type NotificationRow } from "@/lib/notifications";

export function NotificationCard({ row, onClick }: { row: NotificationRow; onClick?: () => void }) {
  const { t } = useI18n();
  const { title, body, href, icon: Icon } = renderNotification(row, t);
  const unread = row.read_at == null;
  return (
    <a
      href={href}
      onClick={onClick}
      className={`flex gap-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] p-3 ${unread ? "bg-[var(--color-acid)]/20" : "bg-[var(--color-paper)]"}`}
    >
      <Icon size={20} aria-hidden className="mt-0.5 shrink-0" />
      <div className="min-w-0">
        <p className="font-heading text-sm font-bold">{title}</p>
        <p className="text-sm text-[var(--color-soft-ink)]">{body}</p>
      </div>
      {unread && <span aria-hidden className="ml-auto mt-1 h-2 w-2 shrink-0 rounded-full bg-[var(--color-magenta)]" />}
    </a>
  );
}
```

- [ ] **Step 4: Implement the page**

Create `src/routes/_app.notifications.tsx`:

```tsx
import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Bell } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useNotifications, useMarkRead, useMarkAllRead } from "@/lib/queries/kocmax";
import { NotificationCard } from "@/components/notifications/NotificationCard";
import type { NotificationRow } from "@/lib/notifications";

export const Route = createFileRoute("/_app/notifications")({ component: Notifications });

function Notifications() {
  const { t } = useI18n();
  const list = useNotifications();
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();
  const items = (list.data?.items ?? []) as NotificationRow[];
  const hasUnread = (list.data?.unread_count ?? 0) > 0;

  // Mark visible unread rows read on open (one-shot per data load).
  useEffect(() => {
    const unreadIds = items.filter((n) => n.read_at == null).map((n) => n.id);
    if (unreadIds.length) markRead.mutate(unreadIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.data]);

  return (
    <div className="mx-auto w-full max-w-lg space-y-4 p-4 lg:max-w-3xl">
      <header className="flex items-center gap-2">
        <h1 className="flex items-center gap-2 font-display text-2xl font-bold">
          <Bell size={22} aria-hidden /> {t("app.notif.title")}
        </h1>
        {hasUnread && (
          <button
            type="button"
            onClick={() => markAll.mutate()}
            className="ml-auto rounded-full border-2 border-[var(--color-ink)] px-3 py-1 font-mono text-xs font-bold"
          >
            {t("app.notif.markAll")}
          </button>
        )}
      </header>

      {list.isLoading && <p className="text-sm text-[var(--color-soft-ink)]">{t("common.loading")}</p>}
      {list.isError && <p className="text-sm text-[var(--color-magenta)]">{t("common.loadFailed")}</p>}
      {!list.isLoading && !list.isError && items.length === 0 && (
        <p className="rounded-[var(--radius)] border-2 border-dashed border-[var(--color-ink)] p-6 text-center text-sm text-[var(--color-soft-ink)]">
          {t("app.notif.empty")}
        </p>
      )}

      <div className="space-y-2">
        {items.map((n) => <NotificationCard key={n.id} row={n} />)}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run the test — verify it PASSES**

Run: `npx vitest run src/routes/-_app.notifications.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/components/notifications/NotificationCard.tsx src/routes/_app.notifications.tsx src/routes/-_app.notifications.test.tsx
git commit -m "feat(notifications): /notifications page + card (auto-read on open)"
```

---

### Task 7: In-session toast on new notifications

**Files:**
- Create: `src/components/NotificationToaster.tsx`
- Modify: `src/routes/_app.tsx`

- [ ] **Step 1: Implement the toaster**

Create `src/components/NotificationToaster.tsx`:

```tsx
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { useUnreadCount } from "@/lib/queries/kocmax";

/** Fires a single toast when the polled unread count rises during a session.
 *  Renders nothing. Mounted inside the authenticated shell. */
export function NotificationToaster() {
  const { t } = useI18n();
  const { data: count } = useUnreadCount();
  const prev = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (count == null) return;
    if (prev.current != null && count > prev.current) {
      toast(t("app.notif.toast.new"));
    }
    prev.current = count;
  }, [count, t]);

  return null;
}
```

- [ ] **Step 2: Mount it in the app shell**

In `src/routes/_app.tsx`: add `import { NotificationToaster } from "@/components/NotificationToaster";` and, alongside the other `showNav && <...>` lines (near `<AssistantLauncher />`), add:
```tsx
      {showNav && <NotificationToaster />}
```

- [ ] **Step 3: Type-check + build**

Run: `npm run type-check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/NotificationToaster.tsx src/routes/_app.tsx
git commit -m "feat(notifications): in-session toast when unread count rises"
```

---

### Task 8: Full verification + final review

**Files:** none (gates only).

- [ ] **Step 1: ESM extension check**

Run: `npm run check:esm`
Expected: PASS (all relative server imports end in `.js`).

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: PASS (fix any `import/first` ordering in `kocmax.ts` or unused imports).

- [ ] **Step 3: Type-check**

Run: `npm run type-check`
Expected: PASS (tsr generate picks up `_app.notifications`).

- [ ] **Step 4: Unit tests**

Run: `npx vitest run src/lib/notifications.test.ts src/lib/i18n.test.ts src/components/NotificationBadge.test.tsx src/routes/-_app.notifications.test.tsx`
Expected: PASS.

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 6: Integration tests (local Supabase)**

Confirm `echo $SUPABASE_URL` is the LOCAL stack, then:
Run: `npm run test:integration -- server/test/notifications-triggers.test.ts server/test/notifications-api.test.ts`
Expected: PASS (triggers 6 + API 5). If the full suite is run, expect the known env-only afterAll/auth flakiness under concurrent load — each new file passes in isolation.

- [ ] **Step 7: Self-review the diff**

Run: `git diff main...HEAD --stat` and skim. Confirm: no `dangerouslySetInnerHTML`; no prose stored in the DB; triggers are SECURITY DEFINER with the `exception when others then null` guard; route uses `makeUserClient` only (no `serviceClient`); both new test files are in `test:integration`.

- [ ] **Step 8: Final commit (if review produced fixes)**

```bash
git add -A && git commit -m "chore(notifications): verification fixes"
```

---

## Deployment (user-gated, after merge)

1. Apply `0022` to PROD via Supabase MCP `execute_sql` (raw SQL — the migration tracker has drift; do NOT use `apply_migration`), **before** deploying the code.
2. `notify pgrst, 'reload schema';`
3. No new Vercel env required.
4. Migration is numbered `0022` assuming C1's `0021` (PR #40) is merged first. If N1 merges first, rename to `0021` (objects are independent; only filename order matters).
