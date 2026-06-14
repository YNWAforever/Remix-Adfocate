# Adfocate 2.0 — Profile / Account Page (Design)

> **Status:** design approved (2026-06-14). Next: `writing-plans`.
> **Branch:** new feature branch off `main` (e.g. `feat/profile-page`).
> **Context:** the app had no profile/account page and no sign-out anywhere. This adds an editable KOC profile reachable from Home. The "creator DNA" page is explicitly deferred.

## 1. Goal
Give a signed-in KOC a profile page that shows their account at a glance (avatar, name, level/XP, content categories, social handles, referral code), lets them **edit** their name / categories / social handles, and lets them **sign out** — filling a real gap (there is currently no logout in the app).

## 2. Scope

### 2.1 In scope
- New route `/profile` (`src/routes/_app.profile.tsx`), driven by the existing `useMe()`.
- Read view: avatar (image or initial), display name, level pill + XP, content categories, social handles, referral code (copyable) + the 「邀請朋友，各得 200 分」 line, quick links to 我的任務 (`/my`) and 兌換記錄 (`/redemption/history`).
- **Edit mode** (a 編輯 toggle): edit `display_name` (text), `categories` (`FilterPillsMulti`), and `social_handles` (per-platform handle inputs). Save / 取消.
- **Sign-out** button: `supabase.auth.signOut()` → clear the `["me"]` cache → redirect to `/login`.
- Home: a circular **avatar button** (top-right) linking to `/profile`.
- One new backend endpoint `PUT /api/me/profile` + one new frontend hook `useUpdateProfile`.

### 2.2 Explicitly out (deferred)
| Deferred | Note |
|---|---|
| Creator "DNA" page (persona / `scores` visualization) | own slice later |
| Avatar image **upload** | needs Supabase Storage; avatar shows `avatar_url` if present, else an initial |
| Social handle **verification** | the `verified` flag is preserved but not set here (Slice 3.5 messaging / later) |
| Editing phone / level / XP | identity + earned state, not user-editable |

## 3. Why a new endpoint (not the onboarding routes)
`PUT /onboarding/profile` does clean partial updates of `display_name`/`categories`, but it carries onboarding-step semantics. `POST /onboarding/social/connect` **only appends** to `social_handles` — re-saving from a profile editor would create duplicates and can't edit/remove. So a profile editor needs *replace* semantics and no step coupling → a dedicated `PUT /me/profile`. The onboarding routes are left untouched.

## 4. Backend — `PUT /api/me/profile`
Add to `server/routes/me.ts` (the guarded `meRoutes`, mounted at `/me`):
- Body: `{ display_name?: string; categories?: string[]; social_handles?: Array<{ platform: string; handle: string; followers?: number | null; verified?: boolean }> }`.
- Build a patch from only the provided fields and `update` the caller's `creators` row via the **user client** (`makeUserClient(c.get("jwt"))`) so RLS scopes it to `id = auth.uid()` — a creator can only edit their own row (the existing `creators_self_update` policy from migration 0003 + the column grants in 0004 already allow `display_name`, `categories`, `social_handles`).
- `social_handles`, when provided, is written **whole** (full replace), so the editor controls the exact set.
- Return the updated row (the same projection as `GET /me`) so the client can update its cache.
- Errors: typed `{ error, code }` with `500` on db error (mirrors the existing `/me` handler).
- **Also extend `GET /me`:** its current projection does **not** select `social_handles`, so add `social_handles` to the `GET /me` select **and** to the `Me` type (§5) — otherwise the profile can't display or seed the social-handle editor. Type it as `Array<{ platform: string; handle: string; followers?: number | null; verified?: boolean }>` (nullable/optional, since older rows may have `[]`).

## 5. Frontend
- **`src/lib/queries/kocmax.ts`:** `useUpdateProfile()` — `useMutation` → `apiFetch<Me>("/me/profile", { method: "PUT", body })`; `onSuccess` invalidates `["me"]`. Body type `{ display_name?; categories?; social_handles? }`.
- **`src/routes/_app.profile.tsx`:** `useMe()` for the data; local `editing` state. Read view + edit view as described in §2.1. Categories use the existing `FilterPillsMulti` (`CATEGORIES = 美容/餐飲/生活/科技/旅遊/媽媽/寵物`, the onboarding set; re-declare the constant locally). Social handle editor: rows for the existing `PLATFORMS` (`Instagram/小紅書/TikTok/YouTube`), each a text input prefilled from the current handle; on save, rebuild `social_handles` = for each platform with a non-empty handle, `{ platform, handle, followers: <existing for that platform ?? null>, verified: <existing ?? false> }` (preserves verification across edits). Save → `useUpdateProfile().mutate({...})`; on success leave edit mode (cache invalidation refreshes the view). Cancel → discard local edits.
- Referral code: shown mono; a copy button (`navigator.clipboard?.writeText`).
- Sign-out: a `登出` button → `supabase.auth.signOut()` → `queryClient.removeQueries({ queryKey: ["me"] })` → `navigate({ to: "/login" })`. (The `_app` gate also redirects anon → `/login`, so even a partial failure lands safely.)
- **`src/components/BottomNav.tsx` is unchanged.** The avatar button is added to **`src/routes/_app.home.tsx`** as a small top-right header element: a circular `Link to="/profile"` showing `avatar_url` (img) or the first character of `display_name`, `aria-label="個人檔案"`.
- i18n stays hardcoded zh-Hant-HK.

## 6. Data flow
`/profile` mounts → `useMe()` (cached by the `_app` gate) renders the view. Edit → local state seeded from `me.data` → Save → `PUT /me/profile` → row updated under RLS → `onSuccess` invalidates `["me"]` → refetch → view reflects changes. Sign-out → Supabase clears the session → `["me"]` removed → `/login`.

## 7. Error handling
- Save failure → inline message (「儲存失敗，請重試」), stay in edit mode (mirrors the onboarding pattern).
- `useMe` error is already handled by the `_app` gate (401/403 → sign-out + `/login`); on the profile page a generic load-error line covers other failures.
- Copy/clipboard guarded with `?.` (jsdom / unsupported browsers).

## 8. Testing
- **Backend integration** (`server/test/`, in the integration job): `PUT /me/profile` updates `display_name` + `categories` + `social_handles` for the caller and the change is readable via `GET /me`; a second creator cannot edit the first's row (RLS self-scope). Helper: reuse `makeCreator`.
- **Frontend component** (`src/routes/-_app.profile.test.tsx`): renders `/me` data (name, level, categories, referral code); the 編輯 toggle reveals inputs; Save calls `useUpdateProfile` with the edited values; 登出 calls `signOut`. Mock `useMe`/`useUpdateProfile` and `@/lib/supabase` like the existing route tests.
- **Home** (`src/routes/-_app.home.test.tsx` or extend): the avatar button links to `/profile`.

## 9. User-gated / operational
None. No new env, no dashboard step. (Avatar upload, if added later, would need a Supabase Storage bucket + policy.)

## 10. Risks
- **Social-handle replace vs. append:** the new endpoint replaces the array; the onboarding append endpoint is untouched, so onboarding still works. The profile editor is the only replace path.
- **Column grants:** editing `social_handles` needs the `authenticated` UPDATE column grant — `0004_grants.sql` grants `display_name, avatar_url, categories, social_handles, onboarding_step, phone`, so `social_handles` is covered. (Verify on cloud; the grant is in 0004 which is now applied.)
