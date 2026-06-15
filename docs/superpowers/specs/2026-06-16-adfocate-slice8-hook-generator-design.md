# Adfocate 2.0 — Slice 8: Hook Generator (Creator Copilot) — Design

**Date:** 2026-06-16
**Status:** Approved (design) → ready for implementation plan
**Depends on:** Slice 7 Mission Matcher (`server/lib/llm.ts` AI Gateway client), Slice 4 missions + mission_submissions

---

## 1. Overview & Goal

On a mission detail page, a creator taps **「生成內容靈感」**, picks a target platform, and receives **5 ranked Cantonese (zh-HK) content hooks** — each tagged with its copywriting angle and a one-tap copy button — to kick-start the content they'll produce for that mission.

This completes the **「今日整乜好？」** vision from spec §5.1: Slice 7 shipped the *Mission Matcher* (what should I do today?); this slice ships the *Hook Generator* (now that I picked one, how do I start?).

The feature reuses the exact architecture proven in Slice 7: a **pure deterministic library** that always produces a useful baseline, **best-effort AI Gateway enhancement** that improves it when a key is configured, and a **thin RLS-scoped route**. It works fully without an LLM key and degrades silently.

---

## 2. Scope

**In scope**
- `POST /api/copilot/hook-generator` returning 5 angle-tagged hooks.
- Deterministic 5-angle template baseline (always returns hooks).
- Best-effort AI rewrite (platform-toned) when `AI_GATEWAY_API_KEY` is set.
- Platform selector on the mission page (smart default from creator's primary social handle).
- Copy-to-clipboard per hook; a 「AI 生成」/「範本」 source badge.

**Out of scope (deferred — see §13)**
- Proactive auto-fire on mission join.
- Per-day rate limiting (spec §5.1: 20/day Starter).
- Other Copilot tools (Caption Writer, Brief Explainer, Compliance Check, Pricing Advisor).
- Persisting generated hooks (AgentTask table).
- Application-gated mission flows (separate future slice).

---

## 3. User Flow

1. Creator opens a mission detail page (`/mission/:slug`).
2. A **「生成內容靈感」** button is visible (prominent once they've joined the mission).
3. Tap → an inline panel reveals: a **platform selector** (defaulted to the creator's primary connected platform, fallback Instagram) + a **「生成」** button.
4. Tap 「生成」 → loading state → 5 hook rows appear, each: **angle pill** (e.g.「好奇式」) + **hook text** + **copy button**. A small badge shows whether they're **AI 生成** or **範本**.
5. On failure → inline message `生成失敗，請重試`; the button can be retried.

---

## 4. Data Model

**No database migration.** Generation is ephemeral; nothing is persisted. The route reads only existing columns:

- `missions`: `title`, `description`, `category` (by `slug` + `workspace_id`).
- `creators`: `categories` (the caller's, for `creatorNiche` flavor — `categories[0]`).

All reads use the **RLS-scoped user client** (`makeUserClient(jwt)`). No service client.

Reuses existing env only: `AI_GATEWAY_API_KEY`, `AI_GATEWAY_MODEL` (already documented in `.env.example` from Slice 7). No new env.

---

## 5. The Five Hook Angles (deterministic core)

`buildHooks` always returns exactly 5 hooks, one per copywriting angle, in this fixed order. Each template interpolates the mission's fields with graceful fallbacks.

Let `cat = category ?? creatorNiche ?? "呢個範疇"` and `topic = title`.

| # | `angle` | Template (`text`) |
|---|---------|-------------------|
| 1 | `問題式` | `仲喺度為${catPain}煩緊？「${topic}」可能幫到你` — where `catPain = category ? \`${category}揀唔啱\` : "揀唔啱嘢"` |
| 2 | `好奇式` | `原來「${topic}」可以咁樣玩，睇到最後你會驚喜` |
| 3 | `優惠式` | `${cat}控注意⚠️ 今次「${topic}」唔講你蝕底` |
| 4 | `體驗式` | `我親身試咗「${topic}」，真心話一次過話你知` |
| 5 | `對比式` | `試完先知，「${topic}」同你平時用嘅差幾遠？` |

**Fallback rules**
- Missing `category` and `creatorNiche` → `cat = "呢個範疇"`, `catPain = "揀唔啱嘢"`.
- `title` is `NOT NULL` in the schema, so `topic` is always present.
- `description` is **not** used in the deterministic baseline (it can be long/empty); it *is* passed to the AI layer (§6) as optional context.

The baseline is **platform-neutral** by design — platform tone is genuinely an AI-rewrite concern (§6). The selected platform is still surfaced in the UI and threaded to the AI layer.

---

## 6. AI Enhancement (`server/lib/llm.ts` → `enhanceHooks`)

Add a second exported function alongside `enhanceRationales`, reusing the same module constants (`ENDPOINT`, default model, `TIMEOUT_MS`, `stripFences`).

```ts
export type HookPlatform = "instagram" | "xiaohongshu" | "tiktok" | "youtube";

export async function enhanceHooks(input: {
  hooks: Hook[];                  // the 5 template hooks (from hookGen.ts)
  platform: HookPlatform;
  title: string;
  category: string | null;
  description: string | null;
}): Promise<Hook[] | null>;
```

**Behaviour**
- No `AI_GATEWAY_API_KEY`, or `hooks.length === 0` → return `null` (no fetch).
- System prompt: a zh-HK KOC copywriter; rewrite each hook punchier and **toned for the target platform**, preserving the **same 5 angles in the same order**. Platform tone hints: Instagram = 精緻短句 + emoji; 小紅書 = 種草口吻 + 標題黨; TikTok = 快節奏、頭 3 秒鈎子; YouTube = 片頭開場白.
- Request: temperature ~0.7, `stream:false`, 6 s `AbortController`.
- Model must return a JSON array of `{ angle, text }`. Parse via `stripFences` + `JSON.parse`.
- **Validation:** result must be an array of exactly 5 items whose `angle` values match the input angles (same set/order). Any mismatch, non-2xx, timeout, parse error, or empty text → return `null`.
- Never throws into the request path.

The caller keeps the deterministic templates whenever `enhanceHooks` returns `null`.

---

## 7. Pure Library (`server/lib/hookGen.ts`)

```ts
export type HookAngle = "問題式" | "好奇式" | "優惠式" | "體驗式" | "對比式";
export type Hook = { angle: HookAngle; text: string };

export type BuildHooksInput = {
  title: string;
  description: string | null;
  category: string | null;
  creatorNiche: string | null;
};

/** Always returns exactly 5 hooks (one per angle, fixed order). Deterministic, no I/O. */
export function buildHooks(input: BuildHooksInput): Hook[];
```

`Hook` is the shared shape across lib, route, and frontend. (`HookPlatform` lives in `llm.ts` since it only matters at the AI layer; the route imports it from there.)

---

## 8. API Endpoint (`server/routes/copilot.ts`)

New route file, mounted in the **guarded** group of `server/app.ts`:

```ts
guarded.route("/copilot", copilotRoutes);
```

**`POST /api/copilot/hook-generator`**

Request body:
```jsonc
{ "mission_slug": "string", "platform": "instagram" | "xiaohongshu" | "tiktok" | "youtube" }
```

Handler:
1. `userId`, `workspaceId`, `jwt` from context; `supabase = makeUserClient(jwt)`.
2. Validate `platform` against the allowed set; invalid/missing → default `"instagram"`.
3. Concurrent reads (`Promise.all`):
   - mission: `missions.select("title, description, category").eq("workspace_id", workspaceId).eq("slug", mission_slug).single()`
   - creator: `creators.select("categories").eq("id", userId).single()`
4. Mission not found (or error `PGRST116`) → `404 { error, code: "not_found" }`. Other DB error → `500 { error, code: "db_error" }`.
5. `creatorNiche = creator?.categories?.[0] ?? null`.
6. `hooks = buildHooks({ title, description, category, creatorNiche })`.
7. `enhanced = await enhanceHooks({ hooks, platform, title, category, description })`.
8. Respond `{ hooks: enhanced ?? hooks, source: enhanced ? "ai" : "template" }`.

Response:
```jsonc
{ "hooks": [{ "angle": "問題式", "text": "…" }, … 5 total], "source": "ai" | "template" }
```

---

## 9. Frontend

**`src/lib/queries/kocmax.ts`**
```ts
export type Hook = { angle: string; text: string };
export type HookResult = { hooks: Hook[]; source: "ai" | "template" };

export function useGenerateHooks() {
  return useMutation({
    mutationFn: (body: { mission_slug: string; platform: string }) =>
      apiFetch<HookResult>("/copilot/hook-generator", { method: "POST", body: JSON.stringify(body) }),
  });
}
```
A **mutation**, not a query — generation is an explicit user action with a request body and a cost; never auto-fetched/refetched.

**`src/components/HookPanel.tsx`** (new)
- Props: `{ missionSlug: string }`.
- Uses `useMe()` to default the platform from `social_handles[0].platform` via a `normalizePlatform()` map (`instagram|ig → instagram`, `小紅書|xiaohongshu|xhs → xiaohongshu`, `tiktok|抖音 → tiktok`, `youtube|yt → youtube`; fallback `instagram`).
- Platform selector (4 options), 「生成」 button bound to `useGenerateHooks`.
- States: idle, loading (skeleton), success (5 rows: angle pill + text + copy button + a `source` badge 「AI 生成」/「範本」), error (`生成失敗，請重試`).
- Copy uses `navigator.clipboard.writeText`.

**`src/routes/_app.mission.$missionSlug.tsx`** (modify)
- Add a **「生成內容靈感」** button (Sparkles/Lightbulb icon) that toggles `<HookPanel missionSlug={missionSlug} />`. Surfaced prominently once the creator has joined (a submission row exists), available regardless otherwise.

**No new TanStack route file** — `HookPanel` is a component within the existing mission route, so `tsr generate` is not required for routing. (Full gates still run.)

---

## 10. Error Handling

| Condition | Behaviour |
|---|---|
| Mission slug not found | `404 { code: "not_found" }`; panel shows inline error |
| DB read error | `500 { code: "db_error" }` |
| LLM no key / non-2xx / timeout / parse / shape mismatch | **Silent** fallback to template hooks; `source:"template"`; never 500 |
| Invalid/empty `platform` | Default to `instagram` |
| Clipboard unavailable | Copy button no-ops gracefully (guard `navigator.clipboard`) |

The request path **never** fails because of the LLM. The deterministic baseline is the floor.

---

## 11. Testing Strategy

**Unit — `server/lib/hookGen.test.ts`**
- Returns exactly 5 hooks with the 5 expected angles in order.
- Interpolates `title` and `category` into the right templates.
- Missing `category` + `creatorNiche` → uses `"呢個範疇"` / `"揀唔啱嘢"` fallbacks (no `undefined`/`null` leaks into text).
- Uses `creatorNiche` when `category` is null.

**Unit — `server/lib/llm.test.ts` (extend)**
- `enhanceHooks`: no key → `null`, no fetch.
- Parses a valid 5-item JSON array (same angles) → returns rewritten hooks.
- Tolerates a ```json fenced array.
- Non-2xx → `null`; malformed content → `null`; wrong item count / mismatched angles → `null`; fetch rejects → resolves `null` (never throws).

**Integration — `server/test/copilot.test.ts` (new, added to `test:integration` list)**
- Seeds/uses a real active mission; `POST /copilot/hook-generator` with no key set → 200, 5 hooks, `source:"template"`.
- Unknown slug → 404 `not_found`.
- Unauthenticated request → 401 (guarded route).
- **Do not** set `AI_GATEWAY_API_KEY` in `.env.test.local` (tests assert the template path).

**Component — `HookPanel` test (jsdom unit project)**
- Mocks `useGenerateHooks` + `useMe`; asserts platform default from social handle, 「生成」 triggers the mutation with the right body, renders 5 rows with angle pills + copy buttons, shows the source badge, and renders the error state.

---

## 12. Ops / Gotchas

- **Reuse env**, no new vars. To enable AI rewriting in prod, set `AI_GATEWAY_API_KEY` in Vercel (still pending from Slice 7; non-blocking — the feature works on templates without it).
- **New server test file** must be appended to the `test:integration` script list in `package.json`, or it won't run.
- **New route file** `copilot.ts` must be mounted in the guarded group of `app.ts`.
- Integration tests need the local Supabase stack (`supabase start`) and `.env.test.local` exported into the shell first (else they SKIP, not fail).
- Run the **full gates**: `npm test`, `npm run type-check`, `npm run lint`, `npm run build`, and the integration suite.

---

## 13. Deferred / Future

- Proactive auto-generation on mission join (KoLink "proactive Copilot" idea).
- Per-tier rate limiting (20/day Starter, 100/day Growth).
- Remaining Copilot tools: Caption Writer (on submit), Brief Explainer (mission detail), Compliance Check (on URL paste), Pricing Advisor (profile/earnings).
- Persisting generations + analytics (AgentTask queue).
- Richer per-hook "why it works" rationale (considered, deferred to keep responses light).
```
