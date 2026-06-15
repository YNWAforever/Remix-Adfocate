# Adfocate 2.0 — Slice 7: Mission Matcher Design

**Date:** 2026-06-16
**Status:** Approved (brainstorming → spec)
**Branch:** `feat/slice7-mission-matcher`

## 1. Goal

Build the creator-facing **Mission Matcher** — the **"今日整乜好？"** flow. Given the signed-in
creator, rank the workspace's open missions into a fit-scored list (0–100), each with a one-line
rationale. Ranking is **deterministic** (pure, unit-tested). An optional LLM call polishes the
rationale text via the **Vercel AI Gateway**, with a templated rationale as the guaranteed fallback.

This consumes the passport signals shipped in Slice 6C (reliability / brand-safety / content) plus
the creator's niches (`creators.categories`) and the open missions.

## 2. Scope

**In scope (this slice):**
- Pure scoring + template rationale library (`server/lib/missionMatch.ts`).
- Minimal AI Gateway client (`server/lib/llm.ts`), best-effort, off by default.
- `GET /api/match` endpoint (`server/routes/match.ts`).
- Frontend: `useMissionMatch()` hook, `/_app.match.tsx` page, a home CTA entry.

**Out of scope (deferred — see §12):**
- §5.2 brand-side auto-pairing + invite push (Brand Dashboard phase) — this is the *creator→missions*
  direction only, not *missions→creators*.
- Hook Generator co-flow (§5.1), `mission_matches` persistence, other Copilot tools.
- Per-category past-performance bonus (data-sparse; passport readiness already aggregates performance).

**No database migration.** Every field already exists (`creators.categories/level`,
`missions.*`, `mission_submissions.status/quality_rating`). This slice ships zero DDL.

## 3. Architecture

Mirrors the Slice 6C passport pattern (pure lib fed raw rows by a thin route).

| File | Responsibility |
|---|---|
| `server/lib/missionMatch.ts` (new) | Pure scoring + tiering + template rationale. No DB, no I/O. Source of truth for the formula. |
| `server/lib/llm.ts` (new) | Minimal AI Gateway `fetch` wrapper. Best-effort: returns `null` on no-key / non-2xx / timeout / parse error. Never throws. |
| `server/routes/match.ts` (new) | `GET /api/match`: reads creator + open missions + own submissions, scores, best-effort LLM-enhances rationale, returns ranked list. |
| `server/app.ts` (modify) | Mount `matchRoutes` under the authed `/api` group. |
| `src/lib/queries/kocmax.ts` (modify) | `MissionMatch` type + `useMissionMatch()`. |
| `src/routes/_app.match.tsx` (new) | "今日整乜好？" ranked-list page. |
| `src/routes/_app.home.tsx` (modify) | Add a prominent "✨ 今日整乜好？" CTA linking to `/match`. |
| `.env.example` (modify) | Document optional `AI_GATEWAY_API_KEY` + `AI_GATEWAY_MODEL`. |

## 4. Data sources (all via the per-request user client, RLS self-scoped)

No service client needed (no cross-creator data, unlike the passport referrer count).

- `creators` (caller row): `level`, `categories`.
- `mission_submissions` (caller's): `mission_id, status, quality_rating` — used for (a) excluding
  missions the creator is already engaged with, and (b) computing **live** readiness via the
  passport pure functions (single source of truth; no dependency on the `creators.scores` snapshot).
- `missions` (workspace): `id, slug, title, category, mission_type, access_type, required_level,
  points_reward, cash_reward, deadline, quota, filled, status`.

## 5. Fit-score formula (deterministic, 0–100)

Pure function `scoreMissions(creator, missions, now)` in `missionMatch.ts`. Each term is normalized
to `0..1`, then weighted. Weights sum to 100:

```
fit = 35·category + 25·reward + 15·urgency + 15·readiness + 10·levelFit
```

**Inputs:**
```ts
type MatchCreator = {
  level: string;              // "L0".."L6"
  categories: string[];       // niches; may be empty
  reliability: number | null; // 0..100 (passport)
  brandSafety: number | null; // 0..100
  content: number | null;     // 0..100
};
type MatchMission = {
  id: string; slug: string; title: string;
  category: string | null; mission_type: string;
  required_level: string;     // "L0".."L6"
  points_reward: number; cash_reward: number | null;
  deadline: string | null;    // ISO date (yyyy-mm-dd)
  quota: number; filled: number;
};
```

**Term definitions:**

1. **category** (`categoryTerm`)
   - `creator.categories.length === 0` → `0.5` (new creator: neutral, never zeroed).
   - else `mission.category && creator.categories.includes(mission.category)` → `1`, else `0`.

2. **reward** (`rewardTerm`) — proportional to the strongest reward in the candidate set (unit-agnostic):
   - `maxPoints = max(points_reward over set)`, `maxCash = max(cash_reward ?? 0 over set)`.
   - `normPoints = maxPoints > 0 ? points_reward / maxPoints : 0`.
   - `normCash = maxCash > 0 ? (cash_reward ?? 0) / maxCash : 0`.
   - `rewardTerm = max(normPoints, normCash)` (a high-points OR high-cash mission both rank well).

3. **urgency** (`urgencyTerm`, needs `now`) — days until deadline (`days = ceil((deadline − now)/1d)`):
   - no deadline → `0.4`; `days ≤ 3` → `1.0`; `days ≤ 7` → `0.7`; `days ≤ 14` → `0.4`; else → `0.2`.
   - (Past-deadline missions are filtered out before scoring; a defensive `days < 0` → `0`.)

4. **readiness** (`readinessTerm`) — creator-level, same across all missions:
   - average of the non-null of `[reliability, brandSafety, content]`, each `/100`.
   - all null (new creator) → `0.5`.
   - *Note: constant per creator → sets the absolute %, does not reorder. Ordering is driven by
     category + reward + urgency + levelFit.*

5. **levelFit** (`levelFitTerm`) — reuse `levelOrdinal` from `passport.ts`:
   - `eligible = levelOrdinal(creator.level) >= levelOrdinal(mission.required_level)`.
   - eligible → `1`, locked → `0`.

`fit_score = clamp(round(35·cat + 25·reward + 15·urg + 15·ready + 10·levelFit), 0, 100)`.

## 6. Candidate set (eligibility filter)

The route filters before scoring. Include a mission iff **all**:
- `status` is active (`status === 'active'`),
- `access_type === 'open'` (application-type apply flow ships Slice 8),
- not full: `filled < quota`,
- deadline not past: `deadline == null || deadline >= today`,
- the creator has **no** submission row for it (any status) — i.e. not joined/submitted/concluded.

**Level-locked missions are kept** (required_level above the creator's level) — they pass the filter
and are scored, but tiered last (§7) with a 🔒 rationale, to motivate leveling up.

## 7. Ranking / tiering

`rankMissions` returns the scored missions sorted by:
1. `locked` ascending (eligible group entirely above locked group — guarantees locked sink to the
   bottom regardless of strong category/reward/urgency signals),
2. then `fit_score` descending,
3. then `deadline` ascending (sooner first; nulls last),
4. then `points_reward` descending.

## 8. Rationale (template — always produced)

`rationaleFor(mission, scoredTerms)` builds an ordered `reasons: string[]` from the dominant
contributors, and a short `rationale` string = the top 1–2 reasons joined by " · ":

- locked → `🔒 升級至 {required_level} 解鎖` (headline reason for locked missions).
- category matched (term === 1) → `啱你嘅{category}範疇`.
- `rewardTerm ≥ 0.8` → `高積分回報` (and/or `有現金獎` when `cash_reward > 0`).
- `urgencyTerm ≥ 0.7` (≤ 7 days) → `即將截止`.
- fallback when no reason fired → `為你推薦`.

The template rationale is **always** present in the response (zero-dependency baseline).

## 9. LLM rationale enhancement (optional, Vercel AI Gateway)

When `AI_GATEWAY_API_KEY` is set, the route makes **one batched** best-effort call to rewrite the
template rationales into smoother colloquial zh-HK one-liners; otherwise the template is returned
verbatim. Any failure (no key, non-2xx, timeout, parse error) → templates kept.

**Client (`server/lib/llm.ts`):**
- `POST https://ai-gateway.vercel.sh/v1/chat/completions` (OpenAI-compatible, plain `fetch` — no new npm dep).
- Header `Authorization: Bearer ${process.env.AI_GATEWAY_API_KEY}`, `Content-Type: application/json`.
- Body: `{ model: process.env.AI_GATEWAY_MODEL ?? "deepseek/deepseek-v4-flash", messages: [...], stream: false, temperature: 0.4 }`.
- `AbortController` timeout (default 6000ms). On no key → return `null` immediately (no fetch).
- Export a focused helper, e.g. `enhanceRationales(items: {id, title, category, rationale, locked}[]): Promise<Record<string,string> | null>`:
  one system+user prompt asking for a JSON object mapping `id →` a ≤ ~20-char zh-HK rationale;
  parse `choices[0].message.content` as JSON; on any problem return `null`.

**Merge:** for each mission, `rationale = enhanced[id] ?? templateRationale`.

**Model choice:** cheapest current Gateway text model, `deepseek/deepseek-v4-flash`
($0.14/$0.28 per M tokens) — also strong at Traditional Chinese. Overridable via `AI_GATEWAY_MODEL`.
Because the rationale is non-critical (template guaranteed), the cheapest model carries no page risk.

## 10. API contract

```
GET /api/match            (auth required; same middleware as other /api routes)
→ 200 { matches: MissionMatch[] }
→ 500 { error, code: "db_error" }   (on a DB read failure)

MissionMatch = {
  id: string; slug: string; title: string;
  category: string | null; mission_type: string;
  required_level: string;
  points_reward: number; cash_reward: number | null;
  deadline: string | null; quota: number; filled: number;
  fit_score: number;        // 0..100
  reasons: string[];        // ordered template reason tags
  rationale: string;        // template, or LLM-polished when enabled
  locked: boolean;          // required_level above creator level
}
```

Only un-engaged missions are returned (no `my_status` field needed). An empty `matches` array is a
valid response (no error).

## 11. Frontend

**`src/lib/queries/kocmax.ts`:** add `MissionMatch` type and
`useMissionMatch()` → `apiFetch<{ matches: MissionMatch[] }>("/match")`, `queryKey: ["mission-match"]`.

**`src/routes/_app.match.tsx`** (`/_app/match`):
- Header "今日整乜好？" + short subtitle.
- Loading: skeleton/placeholder. Error: `載入失敗，請重試` (magenta). Empty: `暫時冇啱你嘅任務，遲啲再嚟睇睇`.
- List: each row reuses `<MissionCard>` (title/category/points/deadline) plus:
  - a fit badge `{fit_score}% 啱你`,
  - a rationale chip (the `rationale` string),
  - locked styling (dimmed + 🔒) when `locked`.
- Each row links to `/mission/$missionSlug` (locked rows still open the detail page).

**`src/routes/_app.home.tsx`:** add a full-width CTA above the existing quick-action grid:
`✨ 今日整乜好？` → `Link to="/match"`. The 2×2 grid and `精選任務` section stay unchanged.

## 12. Deferrals (YAGNI)

- Per-category past-performance bonus (data-sparse; readiness already aggregates performance).
- Brand-side auto-pairing + invite push (§5.2) — Brand Dashboard phase.
- Hook Generator in the same flow (§5.1); `mission_matches` table persistence.
- LLM streaming; multi-call per-mission rationale (we batch one call).
- Wiring AI Gateway in Vercel prod is a later, **non-blocking** step (page ships working without it).

## 13. Testing

- **`server/lib/missionMatch.test.ts`** (unit, no DB): category match / no-match / empty-categories
  neutral; reward normalization (max → 1.0, proportional, all-zero → 0, single mission); urgency
  buckets incl. no-deadline and defensive past; readiness average incl. all-null neutral + partial
  null; levelFit eligible/locked; `fit_score` composition + clamp; **tiering** (a locked mission with
  strong category+reward still sorts below every eligible mission); reasons + template rationale string.
- **`server/lib/llm.test.ts`** (unit, mocked `fetch`): no key → `null` (no fetch); 200 + valid JSON →
  parsed map; non-2xx → `null`; abort/timeout → `null`; malformed content → `null`. Never throws.
- **`server/test/match.test.ts`** (integration, local Supabase): seed a creator (`categories: ['美妝']`,
  `level: 'L1'`) with a few submissions; seed missions covering in-niche-eligible, out-niche-eligible,
  in-niche-**locked** (required `L3`), **full** (`filled === quota`), **application**-type,
  **past-deadline**, and **already-joined** (submission row exists), plus a high-cash mission. Assert:
  only un-engaged / open / non-full / future missions returned; locked included but last; in-niche
  eligible ranked above out-niche eligible; every `fit_score ∈ [0,100]`; `rationale` non-empty (template
  path — no `AI_GATEWAY_API_KEY` in the test env). Reuse the existing integration harness helpers.
- **`src/routes/-_app.match.test.tsx`** (component, mocked hook): renders ranked list, fit badge,
  rationale chip, a locked card, empty state, and error state.
- **`src/routes/-_app.home.test.tsx`** (extend): asserts the `今日整乜好？` CTA renders and links to `/match`.

## 14. Risks & mitigations

- **LLM latency in the request path** → `AbortController` timeout + off-by-default (no key) + template
  fallback. Default path (no key) does zero network work.
- **`creators.categories` frequently empty** (onboarding may not populate niches) → the `0.5` neutral
  category term keeps ranking sensible; reward/urgency/levelFit still differentiate. (Spec §line 596:
  setting niches improves matching — a future nudge, not required here.)
- **Small candidate sets** → proportional-to-max reward normalization is stable for n ≥ 1.
- **Readiness is creator-constant** → accepted; affects the displayed % only, not ordering.
- **AI Gateway model availability** → `AI_GATEWAY_MODEL` override; default verified against
  vercel.com/ai-gateway/models at implementation time.
