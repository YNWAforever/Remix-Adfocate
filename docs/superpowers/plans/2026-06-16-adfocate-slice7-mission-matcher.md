# Mission Matcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the creator-facing "今日整乜好？" Mission Matcher — a deterministic fit-score ranking of open missions with a templated rationale, optionally polished by the Vercel AI Gateway.

**Architecture:** A pure scoring lib (`server/lib/missionMatch.ts`) fed raw rows by a thin route (`server/routes/match.ts` → `GET /api/match`), mirroring the Slice 6C passport pattern. A best-effort, never-throwing AI Gateway client (`server/lib/llm.ts`) enhances rationale text when `AI_GATEWAY_API_KEY` is set, else the template stands. Frontend: `useMissionMatch()` + `/_app.match.tsx` page + a home CTA. No database migration.

**Tech Stack:** TypeScript, Hono, Supabase (`makeUserClient` per-request RLS-scoped), TanStack Router + Query, Vitest (jsdom unit + node integration against local Supabase), Vercel AI Gateway (OpenAI-compatible `fetch`).

**Reference:** `docs/superpowers/specs/2026-06-16-adfocate-slice7-mission-matcher-design.md`.

**Conventions to follow:**
- Unit tests live beside the lib (`server/lib/*.test.ts`), run by `npm test`.
- Integration tests live in `server/test/*.test.ts`, gated by `hasSupabaseEnv` / `RUN_INTEGRATION=1`, and MUST be added to the `test:integration` script list to run.
- Run unit/build gates: `npm test`, `npx tsc --noEmit` (or `npm run build`), `npm run lint`.
- Run integration: `set -a && . ./.env.test.local && set +a && ADMIN_SECRET=test-admin-secret npm run test:integration` (requires `supabase start`; do NOT add `AI_GATEWAY_API_KEY` to `.env.test.local`, so the template path is exercised).
- Commit after each task. End commit messages with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer.

---

## File Structure

| File | New/Mod | Responsibility |
|---|---|---|
| `server/lib/missionMatch.ts` | new | Pure scoring terms, `scoreMissions`, `rankMissions`, `filterCandidates`, `rationaleFor`. |
| `server/lib/missionMatch.test.ts` | new | Unit tests for the above (no DB). |
| `server/lib/llm.ts` | new | `enhanceRationales` — best-effort AI Gateway client; null on any failure. |
| `server/lib/llm.test.ts` | new | Unit tests (mocked `fetch`). |
| `server/routes/match.ts` | new | `GET /api/match`. |
| `server/app.ts` | mod | Mount `matchRoutes` in the guarded group. |
| `server/test/helpers.ts` | mod | Add `setCreatorProfile`. |
| `server/test/match.test.ts` | new | Integration test. |
| `package.json` | mod | Add `match.test.ts` to `test:integration`. |
| `src/lib/queries/kocmax.ts` | mod | `MissionMatch` type + `useMissionMatch()`. |
| `src/routes/_app.match.tsx` | new | "今日整乜好？" page. |
| `src/routes/-_app.match.test.tsx` | new | Component test. |
| `src/routes/_app.home.tsx` | mod | Add the CTA. |
| `src/routes/-_app.home.test.tsx` | mod | Assert the CTA link. |
| `.env.example` | mod | Document optional `AI_GATEWAY_*`. |

---

## Task 1: Pure scoring library

**Files:**
- Create: `server/lib/missionMatch.ts`
- Test: `server/lib/missionMatch.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/lib/missionMatch.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  categoryTerm, rewardTerm, urgencyTerm, readinessTerm, levelFitTerm,
  scoreMissions, rankMissions, filterCandidates, rationaleFor,
  type MatchCreator, type MatchMission,
} from "./missionMatch";

const NOW = new Date("2026-06-16T00:00:00Z");
function mission(over: Partial<MatchMission> = {}): MatchMission {
  return {
    id: over.id ?? "m1", slug: over.slug ?? "s1", title: over.title ?? "T",
    category: over.category ?? "美妝", mission_type: "ugc", required_level: over.required_level ?? "L0",
    points_reward: over.points_reward ?? 100, cash_reward: over.cash_reward ?? null,
    deadline: over.deadline ?? null, quota: over.quota ?? 10, filled: over.filled ?? 0,
  };
}
function creator(over: Partial<MatchCreator> = {}): MatchCreator {
  return {
    level: over.level ?? "L1", categories: over.categories ?? ["美妝"],
    reliability: over.reliability ?? null, brandSafety: over.brandSafety ?? null, content: over.content ?? null,
  };
}

describe("categoryTerm", () => {
  it("is 1 on a niche match, 0 on a miss", () => {
    expect(categoryTerm(creator({ categories: ["美妝"] }), mission({ category: "美妝" }))).toBe(1);
    expect(categoryTerm(creator({ categories: ["美妝"] }), mission({ category: "科技" }))).toBe(0);
  });
  it("is a 0.5 neutral when the creator has no niches set", () => {
    expect(categoryTerm(creator({ categories: [] }), mission({ category: "科技" }))).toBe(0.5);
  });
});

describe("rewardTerm", () => {
  it("is proportional to the set max points", () => {
    expect(rewardTerm(mission({ points_reward: 200 }), 200, 0)).toBe(1);
    expect(rewardTerm(mission({ points_reward: 100 }), 200, 0)).toBe(0.5);
  });
  it("takes the stronger of points or cash, and is 0 when all rewards are 0", () => {
    expect(rewardTerm(mission({ points_reward: 0, cash_reward: 50 }), 0, 100)).toBe(0.5);
    expect(rewardTerm(mission({ points_reward: 0, cash_reward: null }), 0, 0)).toBe(0);
  });
});

describe("urgencyTerm", () => {
  it("buckets days-to-deadline and treats no-deadline as neutral", () => {
    expect(urgencyTerm(mission({ deadline: null }), NOW)).toBe(0.4);
    expect(urgencyTerm(mission({ deadline: "2026-06-18" }), NOW)).toBe(1);   // 2d
    expect(urgencyTerm(mission({ deadline: "2026-06-22" }), NOW)).toBe(0.7);  // 6d
    expect(urgencyTerm(mission({ deadline: "2026-06-28" }), NOW)).toBe(0.4);  // 12d
    expect(urgencyTerm(mission({ deadline: "2026-08-01" }), NOW)).toBe(0.2);  // far
    expect(urgencyTerm(mission({ deadline: "2026-06-10" }), NOW)).toBe(0);    // past (defensive)
  });
});

describe("readinessTerm", () => {
  it("averages the non-null passport scores, /100", () => {
    expect(readinessTerm(creator({ reliability: 80, brandSafety: 100, content: null }))).toBeCloseTo(0.9);
  });
  it("is 0.5 neutral for a creator with no scores yet", () => {
    expect(readinessTerm(creator({ reliability: null, brandSafety: null, content: null }))).toBe(0.5);
  });
});

describe("levelFitTerm", () => {
  it("is 1 when eligible, 0 when the required level is above the creator", () => {
    expect(levelFitTerm(creator({ level: "L1" }), mission({ required_level: "L1" }))).toBe(1);
    expect(levelFitTerm(creator({ level: "L1" }), mission({ required_level: "L3" }))).toBe(0);
  });
});

describe("scoreMissions", () => {
  it("composes a 0-100 fit_score and flags locked", () => {
    const [a] = scoreMissions(creator({ level: "L1", categories: ["美妝"], reliability: 100, brandSafety: 100, content: 100 }),
      [mission({ category: "美妝", points_reward: 100, deadline: "2026-06-18", required_level: "L1" })], NOW);
    // 35*1 + 25*1 + 15*1 + 15*1 + 10*1 = 100
    expect(a.fit_score).toBe(100);
    expect(a.locked).toBe(false);
  });
  it("clamps and marks a locked mission", () => {
    const [a] = scoreMissions(creator({ level: "L0", categories: ["美妝"] }),
      [mission({ category: "美妝", required_level: "L3" })], NOW);
    expect(a.locked).toBe(true);
    expect(a.fit_score).toBeGreaterThanOrEqual(0);
    expect(a.fit_score).toBeLessThanOrEqual(100);
  });
});

describe("rankMissions", () => {
  it("keeps every eligible mission above every locked one, regardless of raw signals", () => {
    const scored = scoreMissions(creator({ level: "L0", categories: ["美妝"] }), [
      mission({ id: "lock", slug: "locked", category: "美妝", required_level: "L5", points_reward: 999, deadline: "2026-06-17" }),
      mission({ id: "elig", slug: "eligible", category: "科技", required_level: "L0", points_reward: 1 }),
    ], NOW);
    const ranked = rankMissions(scored);
    expect(ranked[0].slug).toBe("eligible");
    expect(ranked[ranked.length - 1].slug).toBe("locked");
  });
  it("orders eligible by fit_score descending", () => {
    const scored = scoreMissions(creator({ categories: ["美妝"], level: "L1" }), [
      mission({ id: "off", slug: "off", category: "科技", points_reward: 50 }),
      mission({ id: "on", slug: "on", category: "美妝", points_reward: 100 }),
    ], NOW);
    const ranked = rankMissions(scored);
    expect(ranked[0].slug).toBe("on");
  });
});

describe("filterCandidates", () => {
  const today = "2026-06-16";
  it("drops full, past-deadline, and already-engaged missions", () => {
    const missions = [
      mission({ id: "ok", slug: "ok" }),
      mission({ id: "full", slug: "full", quota: 3, filled: 3 }),
      mission({ id: "past", slug: "past", deadline: "2026-06-10" }),
      mission({ id: "eng", slug: "eng" }),
    ];
    const out = filterCandidates(missions, new Set(["eng"]), today);
    expect(out.map((m) => m.slug)).toEqual(["ok"]);
  });
});

describe("rationaleFor", () => {
  it("leads with the lock reason and contains 解鎖", () => {
    const { reasons, rationale } = rationaleFor(mission({ required_level: "L2", category: "美妝" }),
      { category: 1, reward: 0.9, urgency: 1 }, true);
    expect(reasons[0]).toContain("解鎖");
    expect(rationale).toContain("解鎖");
  });
  it("falls back to a recommendation when no signal fires", () => {
    const { rationale } = rationaleFor(mission({ category: null }), { category: 0, reward: 0.1, urgency: 0.2 }, false);
    expect(rationale).toBe("為你推薦");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run server/lib/missionMatch.test.ts`
Expected: FAIL (`missionMatch` module not found).

- [ ] **Step 3: Implement `server/lib/missionMatch.ts`**

```ts
/** Pure Mission Matcher scoring — no DB, no I/O. The route in routes/match.ts feeds it raw
 *  rows; this module owns the fit-score formula and rationale rules (unit-testable in isolation),
 *  mirroring lib/passport.ts. */
import { levelOrdinal } from "./passport.js";

export type MatchCreator = {
  level: string;              // "L0".."L6"
  categories: string[];       // creator niches; may be empty
  reliability: number | null; // 0..100 (passport)
  brandSafety: number | null; // 0..100
  content: number | null;     // 0..100
};

export type MatchMission = {
  id: string; slug: string; title: string;
  category: string | null; mission_type: string;
  required_level: string;     // "L0".."L6"
  points_reward: number; cash_reward: number | null;
  deadline: string | null;    // "yyyy-mm-dd"
  quota: number; filled: number;
};

export type ScoredMission = MatchMission & {
  fit_score: number;          // 0..100
  reasons: string[];
  rationale: string;
  locked: boolean;
};

const W = { category: 35, reward: 25, urgency: 15, readiness: 15, levelFit: 10 };
const DAY_MS = 86_400_000;

/** 1 on a niche match, 0 on a miss; 0.5 neutral when the creator has set no niches yet. */
export function categoryTerm(creator: MatchCreator, mission: MatchMission): number {
  if (creator.categories.length === 0) return 0.5;
  return mission.category != null && creator.categories.includes(mission.category) ? 1 : 0;
}

/** Proportional to the strongest reward in the candidate set; unit-agnostic across points/cash. */
export function rewardTerm(mission: MatchMission, maxPoints: number, maxCash: number): number {
  const normPoints = maxPoints > 0 ? mission.points_reward / maxPoints : 0;
  const normCash = maxCash > 0 ? (mission.cash_reward ?? 0) / maxCash : 0;
  return Math.max(normPoints, normCash);
}

/** Bucketed days-to-deadline; no deadline → 0.4 neutral; past → 0 (defensive, filtered upstream). */
export function urgencyTerm(mission: MatchMission, now: Date): number {
  if (!mission.deadline) return 0.4;
  const days = Math.ceil((new Date(mission.deadline).getTime() - now.getTime()) / DAY_MS);
  if (days < 0) return 0;
  if (days <= 3) return 1;
  if (days <= 7) return 0.7;
  if (days <= 14) return 0.4;
  return 0.2;
}

/** Average of the creator's non-null passport scores, scaled to 0..1; 0.5 neutral when all null. */
export function readinessTerm(creator: MatchCreator): number {
  const vals = [creator.reliability, creator.brandSafety, creator.content].filter(
    (v): v is number => v != null,
  );
  if (vals.length === 0) return 0.5;
  return vals.reduce((s, v) => s + v, 0) / vals.length / 100;
}

/** 1 when the creator's level meets the mission's required level, else 0 (locked). */
export function levelFitTerm(creator: MatchCreator, mission: MatchMission): number {
  return levelOrdinal(creator.level) >= levelOrdinal(mission.required_level) ? 1 : 0;
}

/** Build the ordered reason tags + the short rationale string (top 1-2 reasons). */
export function rationaleFor(
  mission: MatchMission,
  terms: { category: number; reward: number; urgency: number },
  locked: boolean,
): { reasons: string[]; rationale: string } {
  const reasons: string[] = [];
  if (locked) reasons.push(`🔒 升級至 ${mission.required_level} 解鎖`);
  if (terms.category === 1 && mission.category) reasons.push(`啱你嘅${mission.category}範疇`);
  if (terms.reward >= 0.8) reasons.push((mission.cash_reward ?? 0) > 0 ? "高回報・有現金獎" : "高積分回報");
  if (terms.urgency >= 0.7) reasons.push("即將截止");
  if (reasons.length === 0) reasons.push("為你推薦");
  return { reasons, rationale: reasons.slice(0, 2).join(" · ") };
}

/** Score every mission (0..100) with reasons + locked flag. `now` is injected for testability. */
export function scoreMissions(creator: MatchCreator, missions: MatchMission[], now: Date): ScoredMission[] {
  const maxPoints = Math.max(0, ...missions.map((m) => m.points_reward));
  const maxCash = Math.max(0, ...missions.map((m) => m.cash_reward ?? 0));
  const readiness = readinessTerm(creator); // constant per creator

  return missions.map((m) => {
    const category = categoryTerm(creator, m);
    const reward = rewardTerm(m, maxPoints, maxCash);
    const urgency = urgencyTerm(m, now);
    const levelFit = levelFitTerm(creator, m);
    const locked = levelFit === 0;
    const raw =
      W.category * category + W.reward * reward + W.urgency * urgency +
      W.readiness * readiness + W.levelFit * levelFit;
    const fit_score = Math.max(0, Math.min(100, Math.round(raw)));
    const { reasons, rationale } = rationaleFor(m, { category, reward, urgency }, locked);
    return { ...m, fit_score, reasons, rationale, locked };
  });
}

/** Eligible-first, then fit_score desc, then deadline asc (nulls last), then points desc. */
export function rankMissions(scored: ScoredMission[]): ScoredMission[] {
  return [...scored].sort((a, b) => {
    if (a.locked !== b.locked) return a.locked ? 1 : -1;
    if (b.fit_score !== a.fit_score) return b.fit_score - a.fit_score;
    const ad = a.deadline ?? "9999-12-31";
    const bd = b.deadline ?? "9999-12-31";
    if (ad !== bd) return ad < bd ? -1 : 1;
    return b.points_reward - a.points_reward;
  });
}

/** Drop full / past-deadline / already-engaged missions. Status + access_type are filtered at
 *  the DB query; level-locked missions are KEPT (ranked last via rankMissions). */
export function filterCandidates(
  missions: MatchMission[],
  engagedMissionIds: Set<string>,
  today: string,
): MatchMission[] {
  return missions.filter(
    (m) => m.filled < m.quota && !engagedMissionIds.has(m.id) && (m.deadline == null || m.deadline >= today),
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/lib/missionMatch.test.ts`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add server/lib/missionMatch.ts server/lib/missionMatch.test.ts
git commit -m "feat(slice7): pure mission-match scoring + rationale lib

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: AI Gateway rationale client

**Files:**
- Create: `server/lib/llm.ts`
- Test: `server/lib/llm.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/lib/llm.test.ts`:

```ts
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { enhanceRationales, type RationaleItem } from "./llm";

const items: RationaleItem[] = [{ id: "m1", title: "美妝任務", category: "美妝", rationale: "啱你嘅美妝範疇", locked: false }];

function mockFetch(impl: () => Promise<Response> | Response) {
  vi.stubGlobal("fetch", vi.fn(impl));
}
function jsonResponse(content: string, ok = true) {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: ok ? 200 : 500 });
}

beforeEach(() => { process.env.AI_GATEWAY_API_KEY = "test-key"; });
afterEach(() => { vi.unstubAllGlobals(); delete process.env.AI_GATEWAY_API_KEY; });

describe("enhanceRationales", () => {
  it("returns null and never calls fetch when no key is set", async () => {
    delete process.env.AI_GATEWAY_API_KEY;
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect(await enhanceRationales(items)).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it("returns null on an empty item list", async () => {
    expect(await enhanceRationales([])).toBeNull();
  });

  it("parses a JSON map from the model content", async () => {
    mockFetch(() => jsonResponse(JSON.stringify({ m1: "啱你！美妝之選" })));
    expect(await enhanceRationales(items)).toEqual({ m1: "啱你！美妝之選" });
  });

  it("tolerates a ```json fenced response", async () => {
    mockFetch(() => jsonResponse("```json\n{\"m1\":\"快手賺分\"}\n```"));
    expect(await enhanceRationales(items)).toEqual({ m1: "快手賺分" });
  });

  it("returns null on a non-2xx response", async () => {
    mockFetch(() => jsonResponse("{}", false));
    expect(await enhanceRationales(items)).toBeNull();
  });

  it("returns null on malformed content", async () => {
    mockFetch(() => jsonResponse("not json at all"));
    expect(await enhanceRationales(items)).toBeNull();
  });

  it("returns null (never throws) when fetch rejects", async () => {
    mockFetch(() => Promise.reject(new Error("aborted")));
    await expect(enhanceRationales(items)).resolves.toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run server/lib/llm.test.ts`
Expected: FAIL (`llm` module not found).

- [ ] **Step 3: Implement `server/lib/llm.ts`**

```ts
/** Minimal Vercel AI Gateway client for best-effort rationale polishing. Returns null on ANY
 *  problem (no key, empty input, non-2xx, timeout/abort, parse error) so callers keep their
 *  templated rationale. Never throws into the request path. OpenAI-compatible endpoint, plain
 *  fetch — no SDK dependency. */

const ENDPOINT = "https://ai-gateway.vercel.sh/v1/chat/completions";
const DEFAULT_MODEL = "deepseek/deepseek-v4-flash";
const TIMEOUT_MS = 6000;

export type RationaleItem = {
  id: string; title: string; category: string | null; rationale: string; locked: boolean;
};

function stripFences(s: string): string {
  const t = s.trim();
  if (t.startsWith("```")) return t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return t;
}

export async function enhanceRationales(items: RationaleItem[]): Promise<Record<string, string> | null> {
  const key = process.env.AI_GATEWAY_API_KEY;
  if (!key || items.length === 0) return null;

  const model = process.env.AI_GATEWAY_MODEL ?? DEFAULT_MODEL;
  const sys =
    "你係香港 KOC 平台嘅文案助手。每個任務有一句『建議理由』草稿，請改寫成更自然、口語化嘅廣東話短句" +
    "（每句 20 字以內），保留原意（包括 🔒 升級提示）。只回覆一個 JSON 物件：key 係任務 id，" +
    "value 係改寫後嘅句子，唔好有其他文字。";
  const user = JSON.stringify(
    items.map((i) => ({ id: i.id, title: i.title, category: i.category, draft: i.rationale, locked: i.locked })),
  );

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: sys }, { role: "user", content: user }],
        temperature: 0.4,
        stream: false,
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") return null;
    const parsed = JSON.parse(stripFences(content)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string" && v.trim()) out[k] = v.trim();
    }
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/lib/llm.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/lib/llm.ts server/lib/llm.test.ts
git commit -m "feat(slice7): best-effort AI Gateway rationale client

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `GET /api/match` route + mount + integration test

**Files:**
- Create: `server/routes/match.ts`
- Modify: `server/app.ts` (mount), `server/test/helpers.ts` (add `setCreatorProfile`), `package.json` (`test:integration` list)
- Test: `server/test/match.test.ts`

- [ ] **Step 1: Add the `setCreatorProfile` helper**

In `server/test/helpers.ts`, add after `setXp` (it uses the existing module-local `service()`):

```ts
/** Service-role patch of a creator's matcher inputs (categories bypass the user grant). */
export async function setCreatorProfile(userId: string, patch: { categories?: string[]; level?: string }) {
  const { error } = await service().from("creators").update(patch).eq("id", userId);
  if (error) throw error;
}
```

- [ ] **Step 2: Write the failing integration test**

Create `server/test/match.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../app";
import { makeCreator, makeMission, seedSubmission, setCreatorProfile, cleanup, hasSupabaseEnv } from "./helpers";

const { app } = createApp();
const suite = hasSupabaseEnv ? describe : describe.skip;

function req(path: string, jwt: string, init: RequestInit = {}) {
  return app.request(`/api${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${jwt}`, "X-Workspace-Slug": "demo", "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const plusDays = (n: number) => iso(Date.now() + n * DAY);

suite("mission matcher", () => {
  let koc: { userId: string; jwt: string };
  beforeAll(async () => {
    await cleanup();
    koc = await makeCreator("match@test.local", 0); // default level L0
    await setCreatorProfile(koc.userId, { categories: ["美妝"] });
    await makeMission({ slug: "test-match-niche", category: "美妝", points_reward: 200, deadline: plusDays(5) });
    await makeMission({ slug: "test-match-offniche", category: "科技", points_reward: 100, deadline: plusDays(20) });
    await makeMission({ slug: "test-match-locked", category: "美妝", required_level: "L1", points_reward: 999, deadline: plusDays(2) });
    await makeMission({ slug: "test-match-full", category: "美妝", quota: 3, filled: 3 });
    await makeMission({ slug: "test-match-app", category: "美妝", access_type: "application" });
    await makeMission({ slug: "test-match-past", category: "美妝", deadline: plusDays(-2) });
    await seedSubmission(koc.userId, "joined", "test-match-joined"); // engaged → excluded
  });
  afterAll(cleanup);

  it("returns scored, ranked candidates each with a 0-100 fit_score and a rationale", async () => {
    const res = await req("/match", koc.jwt);
    expect(res.status).toBe(200);
    const { matches } = await res.json();
    const slugs = matches.map((m: { slug: string }) => m.slug);
    expect(slugs).toContain("test-match-niche");
    expect(slugs).toContain("test-match-offniche");
    expect(slugs).toContain("test-match-locked");
    for (const m of matches) {
      expect(m.fit_score).toBeGreaterThanOrEqual(0);
      expect(m.fit_score).toBeLessThanOrEqual(100);
      expect(typeof m.rationale).toBe("string");
      expect(m.rationale.length).toBeGreaterThan(0);
    }
  });

  it("excludes full / application / past-deadline / already-engaged missions", async () => {
    const { matches } = await (await req("/match", koc.jwt)).json();
    const slugs = matches.map((m: { slug: string }) => m.slug);
    expect(slugs).not.toContain("test-match-full");
    expect(slugs).not.toContain("test-match-app");
    expect(slugs).not.toContain("test-match-past");
    expect(slugs).not.toContain("test-match-joined");
  });

  it("ranks in-niche above off-niche, and sinks the locked mission to the bottom", async () => {
    const { matches } = await (await req("/match", koc.jwt)).json();
    const idx = (slug: string) => matches.findIndex((m: { slug: string }) => m.slug === slug);
    expect(idx("test-match-niche")).toBeLessThan(idx("test-match-offniche"));
    expect(idx("test-match-locked")).toBeGreaterThan(idx("test-match-niche"));
    expect(idx("test-match-locked")).toBeGreaterThan(idx("test-match-offniche"));
    const locked = matches.find((m: { slug: string }) => m.slug === "test-match-locked");
    expect(locked.locked).toBe(true);
    expect(locked.rationale).toContain("解鎖"); // template path (no AI_GATEWAY_API_KEY in test env)
  });
});
```

- [ ] **Step 3: Add `match.test.ts` to the integration script**

In `package.json`, append ` server/test/match.test.ts` to the end of the `test:integration` command string (the space-separated file list).

- [ ] **Step 4: Run it to verify it fails**

Run: `set -a && . ./.env.test.local && set +a && ADMIN_SECRET=test-admin-secret npm run test:integration`
Expected: FAIL — `match` route not mounted (404 → `res.status` not 200), module `../routes/match` missing once referenced.

- [ ] **Step 5: Implement `server/routes/match.ts`**

```ts
import { Hono } from "hono";
import type { Env } from "../app.js";
import { makeUserClient } from "../lib/supabase.js";
import { countTerminal, reliabilityFor, brandSafetyFor, contentFor } from "../lib/passport.js";
import { filterCandidates, scoreMissions, rankMissions, type MatchMission, type MatchCreator } from "../lib/missionMatch.js";
import { enhanceRationales } from "../lib/llm.js";

export const matchRoutes = new Hono<Env>();

/** GET /api/match — the "今日整乜好？" Mission Matcher. Deterministically ranks the workspace's
 *  open, joinable missions for the caller (category / reward / urgency / readiness / level-fit),
 *  then best-effort polishes each rationale via the AI Gateway (template fallback). RLS scopes
 *  every read to the caller. */
matchRoutes.get("/", async (c) => {
  const userId = c.get("userId");
  const supabase = makeUserClient(c.get("jwt"));

  const { data: creator, error: cErr } = await supabase
    .from("creators").select("level, categories").eq("id", userId).single();
  if (cErr) return c.json({ error: cErr.message, code: "db_error" }, 500);

  const { data: subs, error: sErr } = await supabase
    .from("mission_submissions").select("mission_id, status, quality_rating").eq("creator_id", userId);
  if (sErr) return c.json({ error: sErr.message, code: "db_error" }, 500);

  const { data: missions, error: mErr } = await supabase
    .from("missions")
    .select("id, slug, title, category, mission_type, required_level, points_reward, cash_reward, deadline, quota, filled")
    .eq("workspace_id", c.get("workspaceId"))
    .eq("status", "active")
    .eq("access_type", "open");
  if (mErr) return c.json({ error: mErr.message, code: "db_error" }, 500);

  // Live readiness from the caller's own submissions (single source of truth — reuse passport fns).
  const statuses = (subs ?? []).map((s) => s.status as string);
  const counts = countTerminal(statuses);
  const ratings = (subs ?? [])
    .filter((s) => s.status === "approved" && s.quality_rating != null)
    .map((s) => s.quality_rating as number);
  const creatorInput: MatchCreator = {
    level: creator.level as string,
    categories: ((creator.categories as string[] | null) ?? []),
    reliability: reliabilityFor(counts),
    brandSafety: brandSafetyFor(counts),
    content: contentFor(ratings),
  };

  const engaged = new Set((subs ?? []).map((s) => s.mission_id as string));
  const today = new Date().toISOString().slice(0, 10);
  const candidates = filterCandidates((missions ?? []) as MatchMission[], engaged, today);
  const ranked = rankMissions(scoreMissions(creatorInput, candidates, new Date()));

  // Best-effort LLM polish of the top rationales; any failure keeps the template.
  const enhanced = await enhanceRationales(
    ranked.slice(0, 8).map((m) => ({ id: m.id, title: m.title, category: m.category, rationale: m.rationale, locked: m.locked })),
  );
  const matches = ranked.map((m) => ({ ...m, rationale: enhanced?.[m.id] ?? m.rationale }));

  return c.json({ matches });
});
```

- [ ] **Step 6: Mount the route in `server/app.ts`**

Add the import beside the other route imports:

```ts
import { matchRoutes } from "./routes/match.js";
```

Add the mount inside the `guarded` group (after `guarded.route("/missions", missionRoutes);`):

```ts
  guarded.route("/match", matchRoutes);
```

- [ ] **Step 7: Run the integration test to verify it passes**

Run: `set -a && . ./.env.test.local && set +a && ADMIN_SECRET=test-admin-secret npm run test:integration`
Expected: PASS — the `mission matcher` suite green (plus all prior integration suites still green).

- [ ] **Step 8: Commit**

```bash
git add server/routes/match.ts server/app.ts server/test/helpers.ts server/test/match.test.ts package.json
git commit -m "feat(slice7): GET /api/match route + integration test

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Frontend hook + `/match` page

**Files:**
- Modify: `src/lib/queries/kocmax.ts`
- Create: `src/routes/_app.match.tsx`
- Test: `src/routes/-_app.match.test.tsx`

- [ ] **Step 1: Add the type + hook to `src/lib/queries/kocmax.ts`**

After the `useMission` hook (near the other mission queries), add:

```ts
export type MissionMatch = {
  id: string; slug: string; title: string;
  category?: string | null; mission_type: string;
  required_level: string;
  points_reward: number; cash_reward?: number | null;
  deadline?: string | null; quota: number; filled: number;
  fit_score: number; reasons: string[]; rationale: string; locked: boolean;
};
export function useMissionMatch() {
  return useQuery({
    queryKey: ["mission-match"],
    queryFn: async () => (await apiFetch<{ matches: MissionMatch[] }>("/match")).matches,
  });
}
```

- [ ] **Step 2: Write the failing component test**

Create `src/routes/-_app.match.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({ to, children, ...rest }: { to: string; children?: React.ReactNode } & Record<string, unknown>) => (
      <a href={to} {...rest}>{children}</a>
    ),
  };
});

const h = vi.hoisted(() => ({
  match: { data: [] as unknown[], isLoading: false, isError: false },
}));
vi.mock("@/lib/queries/kocmax", () => ({ useMissionMatch: () => h.match }));

import { Route } from "./_app.match";

function renderMatch() {
  const C = Route.options.component as React.ComponentType;
  return render(<C />);
}

const row = (over: Record<string, unknown> = {}) => ({
  id: "m1", slug: "s1", title: "夏日美妝開箱", category: "美妝", mission_type: "ugc",
  required_level: "L0", points_reward: 200, cash_reward: null, deadline: "2026-06-30",
  quota: 10, filled: 0, fit_score: 92, reasons: ["啱你嘅美妝範疇"], rationale: "啱你嘅美妝範疇", locked: false, ...over,
});

beforeEach(() => { h.match = { data: [], isLoading: false, isError: false }; });

describe("Match page", () => {
  it("renders the heading", () => {
    renderMatch();
    expect(screen.getByText("今日整乜好？")).toBeInTheDocument();
  });

  it("renders ranked rows with a fit badge and rationale", () => {
    h.match = { data: [row()], isLoading: false, isError: false };
    renderMatch();
    expect(screen.getByText("夏日美妝開箱")).toBeInTheDocument();
    expect(screen.getByText("92% 啱你")).toBeInTheDocument();
    expect(screen.getByText("啱你嘅美妝範疇")).toBeInTheDocument();
  });

  it("renders a locked row's rationale", () => {
    h.match = { data: [row({ locked: true, rationale: "🔒 升級至 L1 解鎖", fit_score: 40 })], isLoading: false, isError: false };
    renderMatch();
    expect(screen.getByText("🔒 升級至 L1 解鎖")).toBeInTheDocument();
  });

  it("shows the empty state when there are no matches", () => {
    renderMatch();
    expect(screen.getByText("暫時冇啱你嘅任務，遲啲再嚟睇睇")).toBeInTheDocument();
  });

  it("shows the error state", () => {
    h.match = { data: undefined, isLoading: false, isError: true };
    renderMatch();
    expect(screen.getByText("載入失敗，請重試")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run src/routes/-_app.match.test.tsx`
Expected: FAIL (`./_app.match` not found).

- [ ] **Step 4: Implement `src/routes/_app.match.tsx`**

```tsx
import { createFileRoute, Link } from "@tanstack/react-router";
import { Sparkles, Lock } from "lucide-react";
import { useMissionMatch } from "@/lib/queries/kocmax";
import { MissionCard } from "@/components/MissionCard";

export const Route = createFileRoute("/_app/match")({ component: Match });

function Match() {
  const match = useMissionMatch();
  const empty = !match.isLoading && !match.isError && (match.data?.length ?? 0) === 0;

  return (
    <div className="mx-auto max-w-lg space-y-4 p-4">
      <header>
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-soft-ink)]">ADFOCATE · KOCMAX</span>
        <h1 className="mt-1 flex items-center gap-2 font-display text-2xl font-bold leading-tight">
          <Sparkles size={22} aria-hidden /> 今日整乜好？
        </h1>
        <p className="mt-1 text-sm text-[var(--color-soft-ink)]">為你揀選最啱嘅任務</p>
      </header>

      {match.isLoading && <p className="text-sm text-[var(--color-soft-ink)]">載入中…</p>}
      {match.isError && <p className="text-sm text-[var(--color-magenta)]">載入失敗，請重試</p>}
      {empty && (
        <p className="rounded-[var(--radius)] border-2 border-dashed border-[var(--color-ink)] p-6 text-center text-sm text-[var(--color-soft-ink)]">
          暫時冇啱你嘅任務，遲啲再嚟睇睇
        </p>
      )}

      <div className="space-y-3">
        {match.data?.map((m) => (
          <Link
            key={m.id}
            to="/mission/$missionSlug"
            params={{ missionSlug: m.slug }}
            className={m.locked ? "block opacity-60" : "block"}
          >
            <MissionCard title={m.title} category={m.category ?? undefined} points={m.points_reward} deadline={m.deadline ?? undefined} />
            <div className="mt-1 flex items-center gap-2">
              <span className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-2 py-0.5 font-mono text-xs font-bold">
                {m.fit_score}% 啱你
              </span>
              <span className="flex items-center gap-1 text-xs text-[var(--color-soft-ink)]">
                {m.locked && <Lock size={12} aria-hidden />}
                {m.rationale}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/routes/-_app.match.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/queries/kocmax.ts src/routes/_app.match.tsx src/routes/-_app.match.test.tsx
git commit -m "feat(slice7): useMissionMatch hook + /match page

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Home CTA + env docs

**Files:**
- Modify: `src/routes/_app.home.tsx`, `src/routes/-_app.home.test.tsx`, `.env.example`

- [ ] **Step 1: Add the failing CTA assertion**

In `src/routes/-_app.home.test.tsx`, add inside the `describe("Home", ...)` block:

```ts
  it("shows a '今日整乜好' CTA linking to /match", () => {
    renderHome();
    expect(screen.getByLabelText("今日整乜好")).toHaveAttribute("href", "/match");
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/routes/-_app.home.test.tsx`
Expected: FAIL (no element labelled "今日整乜好").

- [ ] **Step 3: Add the CTA to `src/routes/_app.home.tsx`**

Update the lucide import to include `Sparkles`:

```ts
import { Target, Gift, Receipt, CalendarCheck, Sparkles } from "lucide-react";
```

Insert the CTA immediately above the `<section className="grid grid-cols-2 gap-3">` quick-action grid:

```tsx
      <Link
        to="/match"
        aria-label="今日整乜好"
        className="flex items-center justify-center gap-2 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-magenta)] p-4 font-heading text-lg font-bold text-white shadow-[4px_4px_0_0_var(--color-ink)]"
      >
        <Sparkles size={20} aria-hidden /> 今日整乜好？
      </Link>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/routes/-_app.home.test.tsx`
Expected: PASS.

- [ ] **Step 5: Document the optional env in `.env.example`**

Append:

```bash
# Optional — enables AI-polished Mission Matcher rationale via the Vercel AI Gateway.
# The matcher works fully without it (templated rationale fallback). Create a key at
# https://vercel.com/<org>/<project>/ai-gateway/api-keys
AI_GATEWAY_API_KEY=
AI_GATEWAY_MODEL=deepseek/deepseek-v4-flash
```

- [ ] **Step 6: Run the full unit suite + type-check + lint + build**

Run: `npm test && npx tsc --noEmit && npm run lint && npm run build`
Expected: all green (the integration suites skip without `RUN_INTEGRATION=1`).

- [ ] **Step 7: Commit**

```bash
git add src/routes/_app.home.tsx src/routes/-_app.home.test.tsx .env.example
git commit -m "feat(slice7): home '今日整乜好' CTA + AI Gateway env docs

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final Verification (after all tasks)

- [ ] Unit + types + lint + build: `npm test && npx tsc --noEmit && npm run lint && npm run build`
- [ ] Integration (local stack up): `set -a && . ./.env.test.local && set +a && ADMIN_SECRET=test-admin-secret npm run test:integration`
- [ ] Dispatch a final whole-slice code review (spec-compliance + quality), then use `superpowers:finishing-a-development-branch` to push + open the PR.

## Notes / gotchas for the implementer

- **DRY:** readiness reuses `countTerminal` / `reliabilityFor` / `brandSafetyFor` / `contentFor` from `server/lib/passport.ts`; `levelFitTerm` reuses `levelOrdinal`. Do not re-implement them.
- **Template path in tests:** never add `AI_GATEWAY_API_KEY` to `.env.test.local`; the integration test asserts the template rationale (contains "解鎖").
- **No migration.** Do not create a `supabase/migrations/00xx_*.sql` file.
- **Route ordering:** `/match` is a dedicated route group (no `/:slug` collision), unlike `/missions`.
- **Deadline compare** is lexicographic on `yyyy-mm-dd` (UTC `today`); acceptable for this slice.
