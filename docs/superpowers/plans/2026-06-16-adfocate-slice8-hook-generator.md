# Hook Generator (Creator Copilot) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Creator Copilot **Hook Generator** — `POST /api/copilot/hook-generator` returns 5 angle-tagged zh-HK content hooks for a mission, surfaced from a button on the mission detail page.

**Architecture:** Mirrors Slice 7. A pure deterministic library (`hookGen.ts`) always returns a 5-angle baseline; a best-effort AI Gateway rewrite (`enhanceHooks` in `llm.ts`) improves it when `AI_GATEWAY_API_KEY` is set, falling back silently to the template; a thin RLS-scoped route (`copilot.ts`) wires them together; a `HookPanel` component renders them.

**Tech Stack:** TypeScript, Hono, Supabase (RLS user client), React 19 + TanStack Query/Router, Vitest (jsdom unit + node integration).

**Design spec:** `docs/superpowers/specs/2026-06-16-adfocate-slice8-hook-generator-design.md`

**No database migration.** Reuses existing env (`AI_GATEWAY_API_KEY`, `AI_GATEWAY_MODEL`).

---

## File Structure

- Create `server/lib/hookGen.ts` — pure `buildHooks()` + `Hook`/`HookAngle`/`BuildHooksInput` types.
- Create `server/lib/hookGen.test.ts` — unit tests.
- Modify `server/lib/llm.ts` — add `enhanceHooks()` + `HookPlatform` type (reuse module constants).
- Modify `server/lib/llm.test.ts` — add `enhanceHooks` tests.
- Create `server/routes/copilot.ts` — `POST /hook-generator`.
- Modify `server/app.ts` — mount `guarded.route("/copilot", copilotRoutes)`.
- Create `server/test/copilot.test.ts` — integration tests.
- Modify `package.json` — append the new integration test file to the `test:integration` list.
- Modify `src/lib/queries/kocmax.ts` — `Hook`/`HookResult` types + `useGenerateHooks()`.
- Create `src/components/HookPanel.tsx` — platform picker + generate + results + copy.
- Create `src/components/HookPanel.test.tsx` — component + `normalizePlatform` tests.
- Modify `src/routes/_app.mission.$missionSlug.tsx` — trigger button toggling `<HookPanel/>`.
- Modify `src/routes/-_app.mission.$missionSlug.test.tsx` — stub `HookPanel`, assert toggle.

---

## Task 1: Pure hook library (`server/lib/hookGen.ts`)

**Files:**
- Create: `server/lib/hookGen.ts`
- Test: `server/lib/hookGen.test.ts`

- [ ] **Step 1: Write the failing test**

`server/lib/hookGen.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { buildHooks } from "./hookGen";

const base = { title: "夏日保濕面膜", description: "試用裝", category: "美容", creatorNiche: "美妝" };

describe("buildHooks", () => {
  it("returns exactly 5 hooks with the five angles in order", () => {
    expect(buildHooks(base).map((h) => h.angle)).toEqual(["問題式", "好奇式", "優惠式", "體驗式", "對比式"]);
  });

  it("interpolates the mission title and category into the hooks", () => {
    const hooks = buildHooks(base);
    expect(hooks.every((h) => h.text.includes("夏日保濕面膜"))).toBe(true);
    expect(hooks.find((h) => h.angle === "優惠式")!.text).toContain("美容");
    expect(hooks.find((h) => h.angle === "問題式")!.text).toContain("美容揀唔啱");
  });

  it("falls back to creatorNiche for 優惠式 when category is null", () => {
    expect(buildHooks({ ...base, category: null }).find((h) => h.angle === "優惠式")!.text).toContain("美妝");
  });

  it("uses neutral fallbacks when category and creatorNiche are both null (no null leaks)", () => {
    const hooks = buildHooks({ title: "神秘任務", description: null, category: null, creatorNiche: null });
    for (const h of hooks) expect(h.text).not.toMatch(/null|undefined/);
    expect(hooks.find((h) => h.angle === "優惠式")!.text).toContain("呢個範疇");
    expect(hooks.find((h) => h.angle === "問題式")!.text).toContain("揀唔啱嘢");
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npx vitest run server/lib/hookGen.test.ts`
Expected: FAIL (`buildHooks` not defined).

- [ ] **Step 3: Implement `server/lib/hookGen.ts`**

```ts
/** Deterministic 5-angle content-hook baseline for the Creator Copilot Hook Generator.
 *  Pure, no I/O. The AI layer (llm.ts enhanceHooks) optionally rewrites these. */

export type HookAngle = "問題式" | "好奇式" | "優惠式" | "體驗式" | "對比式";
export type Hook = { angle: HookAngle; text: string };

export type BuildHooksInput = {
  title: string;
  description: string | null; // carried for the AI layer; unused in the baseline
  category: string | null;
  creatorNiche: string | null;
};

const FALLBACK_CAT = "呢個範疇";
const FALLBACK_PAIN = "揀唔啱嘢";

/** Always returns exactly 5 hooks (one per angle, fixed order). */
export function buildHooks(input: BuildHooksInput): Hook[] {
  const topic = input.title;
  const cat = input.category ?? input.creatorNiche ?? FALLBACK_CAT;
  const catPain = input.category ? `${input.category}揀唔啱` : FALLBACK_PAIN;
  return [
    { angle: "問題式", text: `仲喺度為${catPain}煩緊？「${topic}」可能幫到你` },
    { angle: "好奇式", text: `原來「${topic}」可以咁樣玩，睇到最後你會驚喜` },
    { angle: "優惠式", text: `${cat}控注意⚠️ 今次「${topic}」唔講你蝕底` },
    { angle: "體驗式", text: `我親身試咗「${topic}」，真心話一次過話你知` },
    { angle: "對比式", text: `試完先知，「${topic}」同你平時用嘅差幾遠？` },
  ];
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npx vitest run server/lib/hookGen.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add server/lib/hookGen.ts server/lib/hookGen.test.ts
git commit -m "feat(slice8): pure 5-angle hook generator lib"
```

---

## Task 2: AI Gateway enhancement (`enhanceHooks` in `server/lib/llm.ts`)

**Files:**
- Modify: `server/lib/llm.ts` (add `HookPlatform` + `enhanceHooks`; reuse `ENDPOINT`/`DEFAULT_MODEL`/`TIMEOUT_MS`/`stripFences`)
- Test: `server/lib/llm.test.ts` (add a describe block)

Context: `llm.ts` already exports `enhanceRationales` and defines `ENDPOINT`, `DEFAULT_MODEL`, `TIMEOUT_MS`, and `stripFences`. The existing test file already has `mockFetch()` and `jsonResponse(content, ok)` helpers and sets/clears `AI_GATEWAY_API_KEY` in `beforeEach`/`afterEach`.

- [ ] **Step 1: Write the failing tests**

Append to `server/lib/llm.test.ts` (add the import at the top, the fixtures, and the describe block):
```ts
import { enhanceHooks } from "./llm";
import type { Hook } from "./hookGen";

const hookItems: Hook[] = [
  { angle: "問題式", text: "a" }, { angle: "好奇式", text: "b" }, { angle: "優惠式", text: "c" },
  { angle: "體驗式", text: "d" }, { angle: "對比式", text: "e" },
];
const hookInput = { hooks: hookItems, platform: "instagram" as const, title: "T", category: "美容", description: null };
const hooksJson = (texts: string[]) => JSON.stringify(hookItems.map((h, i) => ({ angle: h.angle, text: texts[i] })));

describe("enhanceHooks", () => {
  it("returns null and never calls fetch when no key is set", async () => {
    delete process.env.AI_GATEWAY_API_KEY;
    const f = vi.fn(); vi.stubGlobal("fetch", f);
    expect(await enhanceHooks(hookInput)).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it("returns null on empty hooks without calling fetch", async () => {
    const f = vi.fn(); vi.stubGlobal("fetch", f);
    expect(await enhanceHooks({ ...hookInput, hooks: [] })).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it("parses a valid 5-item array (same angles) into rewritten hooks", async () => {
    mockFetch(() => jsonResponse(hooksJson(["A", "B", "C", "D", "E"])));
    const out = await enhanceHooks(hookInput);
    expect(out).toEqual([
      { angle: "問題式", text: "A" }, { angle: "好奇式", text: "B" }, { angle: "優惠式", text: "C" },
      { angle: "體驗式", text: "D" }, { angle: "對比式", text: "E" },
    ]);
  });

  it("tolerates a ```json fenced array", async () => {
    mockFetch(() => jsonResponse("```json\n" + hooksJson(["A", "B", "C", "D", "E"]) + "\n```"));
    expect((await enhanceHooks(hookInput))![0]).toEqual({ angle: "問題式", text: "A" });
  });

  it("returns null on a non-2xx response", async () => {
    mockFetch(() => jsonResponse(hooksJson(["A", "B", "C", "D", "E"]), false));
    expect(await enhanceHooks(hookInput)).toBeNull();
  });

  it("returns null on malformed content", async () => {
    mockFetch(() => jsonResponse("not json"));
    expect(await enhanceHooks(hookInput)).toBeNull();
  });

  it("returns null when the array length differs", async () => {
    mockFetch(() => jsonResponse(JSON.stringify([{ angle: "問題式", text: "A" }])));
    expect(await enhanceHooks(hookInput)).toBeNull();
  });

  it("returns null when an angle does not match", async () => {
    mockFetch(() => jsonResponse(hooksJson(["A", "B", "C", "D", "E"]).replace("好奇式", "亂噏式")));
    expect(await enhanceHooks(hookInput)).toBeNull();
  });

  it("returns null (never throws) when fetch rejects", async () => {
    mockFetch(() => Promise.reject(new Error("aborted")));
    await expect(enhanceHooks(hookInput)).resolves.toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `npx vitest run server/lib/llm.test.ts`
Expected: FAIL (`enhanceHooks` not exported).

- [ ] **Step 3: Implement `enhanceHooks` in `server/lib/llm.ts`**

Add this import near the top (ESM `.js` extension, matching the codebase):
```ts
import type { Hook } from "./hookGen.js";
```

Append after `enhanceRationales`:
```ts
export type HookPlatform = "instagram" | "xiaohongshu" | "tiktok" | "youtube";

const PLATFORM_TONE: Record<HookPlatform, string> = {
  instagram: "Instagram：精緻、短句、可加 emoji",
  xiaohongshu: "小紅書：種草口吻、標題黨、實用感",
  tiktok: "TikTok：快節奏、頭三秒就要鈎住觀眾",
  youtube: "YouTube：似影片開場白、引起好奇",
};

/** Best-effort AI rewrite of the 5 template hooks, toned for the target platform. Returns the
 *  rewritten 5 (same angles, same order) or null on any problem (no key / non-2xx / timeout /
 *  parse / shape mismatch) so the caller keeps the deterministic templates. Never throws. */
export async function enhanceHooks(input: {
  hooks: Hook[];
  platform: HookPlatform;
  title: string;
  category: string | null;
  description: string | null;
}): Promise<Hook[] | null> {
  const key = process.env.AI_GATEWAY_API_KEY;
  if (!key || input.hooks.length === 0) return null;

  const model = process.env.AI_GATEWAY_MODEL ?? DEFAULT_MODEL;
  const sys =
    "你係香港 KOC 平台嘅內容文案助手。下面有 5 句『內容鈎子』草稿，每句有一個 angle。" +
    `請按目標平台語氣改寫到更吸引、更口語化嘅廣東話（每句 30 字以內），平台語氣：${PLATFORM_TONE[input.platform]}。` +
    '必須保留同樣 5 個 angle、同樣次序。只回覆一個 JSON 陣列，每個元素係 {"angle":..., "text":...}，唔好有其他文字。';
  const user = JSON.stringify({ title: input.title, category: input.category, description: input.description, hooks: input.hooks });

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
        temperature: 0.7,
        stream: false,
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") return null;
    const parsed = JSON.parse(stripFences(content)) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== input.hooks.length) return null;
    const out: Hook[] = [];
    for (let i = 0; i < parsed.length; i++) {
      const item = parsed[i] as { angle?: unknown; text?: unknown };
      const angle = input.hooks[i].angle;
      if (item?.angle !== angle || typeof item.text !== "string" || !item.text.trim()) return null;
      out.push({ angle, text: item.text.trim() });
    }
    return out;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 4: Run the tests, verify they pass**

Run: `npx vitest run server/lib/llm.test.ts`
Expected: PASS (existing `enhanceRationales` tests + 9 new `enhanceHooks` tests).

- [ ] **Step 5: Commit**

```bash
git add server/lib/llm.ts server/lib/llm.test.ts
git commit -m "feat(slice8): best-effort AI Gateway hook rewrite"
```

---

## Task 3: API route (`server/routes/copilot.ts`) + mount + integration test

**Files:**
- Create: `server/routes/copilot.ts`
- Modify: `server/app.ts` (import + mount in the `guarded` group)
- Create: `server/test/copilot.test.ts`
- Modify: `package.json` (append the test file to `test:integration`)

- [ ] **Step 1: Write the failing integration test**

`server/test/copilot.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../app";
import { makeCreator, makeMission, cleanup, hasSupabaseEnv } from "./helpers";

const { app } = createApp();
const suite = hasSupabaseEnv ? describe : describe.skip;

function req(path: string, jwt: string, init: RequestInit = {}) {
  return app.request(`/api${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${jwt}`, "X-Workspace-Slug": "demo", "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

suite("copilot hook generator", () => {
  let koc: { userId: string; jwt: string };
  beforeAll(async () => {
    await cleanup();
    koc = await makeCreator("hooks@test.local", 0);
    await makeMission({ slug: "test-hooks-mission", title: "夏日保濕面膜", category: "美容" });
  });
  afterAll(cleanup);

  it("returns 5 template hooks (no AI key) for a real mission", async () => {
    const res = await req("/copilot/hook-generator", koc.jwt, {
      method: "POST", body: JSON.stringify({ mission_slug: "test-hooks-mission", platform: "instagram" }),
    });
    expect(res.status).toBe(200);
    const { hooks, source } = await res.json();
    expect(source).toBe("template");
    expect(hooks).toHaveLength(5);
    expect(hooks.map((h: { angle: string }) => h.angle)).toEqual(["問題式", "好奇式", "優惠式", "體驗式", "對比式"]);
    expect(hooks.every((h: { text: string }) => h.text.includes("夏日保濕面膜"))).toBe(true);
  });

  it("404s for an unknown mission slug", async () => {
    const res = await req("/copilot/hook-generator", koc.jwt, {
      method: "POST", body: JSON.stringify({ mission_slug: "test-nope", platform: "instagram" }),
    });
    expect(res.status).toBe(404);
  });

  it("400s when mission_slug is missing", async () => {
    const res = await req("/copilot/hook-generator", koc.jwt, { method: "POST", body: JSON.stringify({ platform: "instagram" }) });
    expect(res.status).toBe(400);
  });

  it("requires authentication", async () => {
    const res = await app.request("/api/copilot/hook-generator", {
      method: "POST", headers: { "X-Workspace-Slug": "demo", "Content-Type": "application/json" },
      body: JSON.stringify({ mission_slug: "test-hooks-mission", platform: "instagram" }),
    });
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Add the test file to the `test:integration` script**

In `package.json`, append ` server/test/copilot.test.ts` to the end of the `test:integration` value (after `server/test/match.test.ts`).

- [ ] **Step 3: Run the test, verify it fails**

Run: `set -a && . ./.env.test.local && set +a && RUN_INTEGRATION=1 npx vitest run --no-file-parallelism server/test/copilot.test.ts`
Expected: FAIL (route 404s on `/copilot/hook-generator` — not mounted yet). Requires the local stack (`supabase start`).

- [ ] **Step 4: Implement `server/routes/copilot.ts`**

```ts
import { Hono } from "hono";
import type { Env } from "../app.js";
import { makeUserClient } from "../lib/supabase.js";
import { buildHooks } from "../lib/hookGen.js";
import { enhanceHooks, type HookPlatform } from "../lib/llm.js";

export const copilotRoutes = new Hono<Env>();

const PLATFORMS: HookPlatform[] = ["instagram", "xiaohongshu", "tiktok", "youtube"];

/** POST /api/copilot/hook-generator — 5 angle-tagged zh-HK content hooks for a mission.
 *  Deterministic template baseline + best-effort AI Gateway rewrite (template fallback).
 *  RLS-scopes every read to the caller. */
copilotRoutes.post("/hook-generator", async (c) => {
  const userId = c.get("userId");
  const workspaceId = c.get("workspaceId");
  const supabase = makeUserClient(c.get("jwt"));

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const missionSlug = typeof body.mission_slug === "string" ? body.mission_slug : "";
  if (!missionSlug) return c.json({ error: "mission_slug required", code: "bad_request" }, 400);
  const platform: HookPlatform = PLATFORMS.includes(body.platform as HookPlatform)
    ? (body.platform as HookPlatform)
    : "instagram";

  const [{ data: mission, error: mErr }, { data: creator, error: cErr }] = await Promise.all([
    supabase.from("missions").select("title, description, category").eq("workspace_id", workspaceId).eq("slug", missionSlug).single(),
    supabase.from("creators").select("categories").eq("id", userId).single(),
  ]);
  if (mErr) {
    if (mErr.code === "PGRST116") return c.json({ error: "mission not found", code: "not_found" }, 404);
    return c.json({ error: mErr.message, code: "db_error" }, 500);
  }
  if (cErr) return c.json({ error: cErr.message, code: "db_error" }, 500);

  const creatorNiche = (((creator?.categories as string[] | null) ?? [])[0]) ?? null;
  const title = mission.title as string;
  const description = (mission.description as string | null) ?? null;
  const category = (mission.category as string | null) ?? null;

  const hooks = buildHooks({ title, description, category, creatorNiche });
  const enhanced = await enhanceHooks({ hooks, platform, title, category, description });
  return c.json({ hooks: enhanced ?? hooks, source: enhanced ? "ai" : "template" });
});
```

- [ ] **Step 5: Mount the route in `server/app.ts`**

Add the import alongside the others:
```ts
import { copilotRoutes } from "./routes/copilot.js";
```
Add the mount in the `guarded` group (e.g. after the `/match` line):
```ts
  guarded.route("/copilot", copilotRoutes);
```

- [ ] **Step 6: Run the test, verify it passes**

Run: `set -a && . ./.env.test.local && set +a && RUN_INTEGRATION=1 npx vitest run --no-file-parallelism server/test/copilot.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add server/routes/copilot.ts server/app.ts server/test/copilot.test.ts package.json
git commit -m "feat(slice8): POST /copilot/hook-generator route + integration test"
```

---

## Task 4: Frontend query hook + `HookPanel` component

**Files:**
- Modify: `src/lib/queries/kocmax.ts` (`Hook`/`HookResult` types + `useGenerateHooks`)
- Create: `src/components/HookPanel.tsx`
- Test: `src/components/HookPanel.test.tsx`

- [ ] **Step 1: Write the failing component test**

`src/components/HookPanel.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const hoisted = vi.hoisted(() => ({
  gen: { mutateAsync: vi.fn(), isPending: false, isError: false, data: undefined as unknown },
  me: { data: { social_handles: [{ platform: "tiktok", handle: "@x" }] } as unknown },
}));
vi.mock("@/lib/queries/kocmax", () => ({
  useGenerateHooks: () => hoisted.gen,
  useMe: () => hoisted.me,
}));

import { HookPanel, normalizePlatform } from "./HookPanel";

describe("normalizePlatform", () => {
  it("maps known platform strings, defaulting to instagram", () => {
    expect(normalizePlatform("小紅書")).toBe("xiaohongshu");
    expect(normalizePlatform("TikTok")).toBe("tiktok");
    expect(normalizePlatform("YouTube")).toBe("youtube");
    expect(normalizePlatform("instagram")).toBe("instagram");
    expect(normalizePlatform(undefined)).toBe("instagram");
  });
});

describe("HookPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.gen.isPending = false; hoisted.gen.isError = false; hoisted.gen.data = undefined;
    hoisted.me.data = { social_handles: [{ platform: "tiktok", handle: "@x" }] };
    hoisted.gen.mutateAsync.mockResolvedValue(undefined);
  });

  it("defaults the platform to the creator's primary handle", () => {
    render(<HookPanel missionSlug="m1" />);
    expect(screen.getByRole("button", { name: "TikTok" })).toHaveAttribute("aria-pressed", "true");
  });

  it("generates hooks with the selected platform", async () => {
    render(<HookPanel missionSlug="m1" />);
    fireEvent.click(screen.getByText("生成"));
    await waitFor(() => expect(hoisted.gen.mutateAsync).toHaveBeenCalledWith({ mission_slug: "m1", platform: "tiktok" }));
  });

  it("renders 5 hooks with angle pills, source badge, and copy buttons", () => {
    hoisted.gen.data = { source: "template", hooks: [
      { angle: "問題式", text: "h1" }, { angle: "好奇式", text: "h2" }, { angle: "優惠式", text: "h3" },
      { angle: "體驗式", text: "h4" }, { angle: "對比式", text: "h5" },
    ] };
    render(<HookPanel missionSlug="m1" />);
    expect(screen.getByText("範本")).toBeInTheDocument();
    expect(screen.getByText("h1")).toBeInTheDocument();
    expect(screen.getAllByLabelText("複製")).toHaveLength(5);
  });

  it("shows an error message on failure", () => {
    hoisted.gen.isError = true;
    render(<HookPanel missionSlug="m1" />);
    expect(screen.getByText("生成失敗，請重試")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npx vitest run src/components/HookPanel.test.tsx`
Expected: FAIL (`./HookPanel` not found).

- [ ] **Step 3: Add the query hook to `src/lib/queries/kocmax.ts`**

`useMutation` is already imported. Add near the other mission hooks:
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

- [ ] **Step 4: Implement `src/components/HookPanel.tsx`**

```tsx
import { useState } from "react";
import { useGenerateHooks, useMe, type Hook } from "@/lib/queries/kocmax";
import { BadgePill } from "@/components/BadgePill";

const PLATFORMS: { value: string; label: string }[] = [
  { value: "instagram", label: "Instagram" },
  { value: "xiaohongshu", label: "小紅書" },
  { value: "tiktok", label: "TikTok" },
  { value: "youtube", label: "YouTube" },
];

/** Map a stored social-handle platform string to a HookPlatform value (default instagram). */
export function normalizePlatform(raw?: string | null): string {
  const s = (raw ?? "").toLowerCase();
  if (/(xiaohongshu|xhs|小紅書|小红书|red)/.test(s)) return "xiaohongshu";
  if (/(tiktok|抖音|douyin)/.test(s)) return "tiktok";
  if (/(youtube|yt)/.test(s)) return "youtube";
  return "instagram";
}

export function HookPanel({ missionSlug }: { missionSlug: string }) {
  const me = useMe();
  const gen = useGenerateHooks();
  const [platform, setPlatform] = useState(() => normalizePlatform(me.data?.social_handles?.[0]?.platform));

  return (
    <section className="pastel-card space-y-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4">
      <h3 className="font-heading font-bold">內容靈感</h3>
      <div className="flex flex-wrap gap-2">
        {PLATFORMS.map((p) => (
          <button
            key={p.value}
            onClick={() => setPlatform(p.value)}
            aria-pressed={platform === p.value}
            className={`rounded-full border-2 border-[var(--color-ink)] px-3 py-1 text-sm font-heading ${platform === p.value ? "bg-[var(--color-acid)]" : "bg-white"}`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <button
        onClick={() => gen.mutateAsync({ mission_slug: missionSlug, platform })}
        disabled={gen.isPending}
        className="btn-primary block w-full rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] py-2 text-center font-heading font-bold text-[var(--color-ink)]"
      >
        {gen.isPending ? "生成中…" : "生成"}
      </button>
      {gen.isError && <p className="text-sm text-[var(--color-magenta)]">生成失敗，請重試</p>}
      {gen.data && (
        <div className="space-y-2">
          <BadgePill>{gen.data.source === "ai" ? "AI 生成" : "範本"}</BadgePill>
          <ul className="space-y-2">
            {gen.data.hooks.map((h: Hook, i: number) => (
              <li key={i} className="flex items-start gap-2 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-2">
                <BadgePill>{h.angle}</BadgePill>
                <p className="flex-1 text-sm">{h.text}</p>
                <button
                  aria-label="複製"
                  onClick={() => navigator.clipboard?.writeText(h.text)}
                  className="shrink-0 rounded border border-[var(--color-ink)] px-2 py-0.5 text-xs"
                >
                  複製
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 5: Run the test, verify it passes**

Run: `npx vitest run src/components/HookPanel.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/queries/kocmax.ts src/components/HookPanel.tsx src/components/HookPanel.test.tsx
git commit -m "feat(slice8): useGenerateHooks + HookPanel component"
```

---

## Task 5: Wire the trigger into the mission detail page

**Files:**
- Modify: `src/routes/_app.mission.$missionSlug.tsx`
- Test: `src/routes/-_app.mission.$missionSlug.test.tsx`

- [ ] **Step 1: Add the failing test**

In `src/routes/-_app.mission.$missionSlug.test.tsx`, stub the panel (so this test stays isolated from `HookPanel` internals and its `useGenerateHooks`/`useMe` deps) by adding this mock near the top, after the `@tanstack/react-router` mock:
```tsx
vi.mock("@/components/HookPanel", () => ({ HookPanel: () => <div>HOOK_PANEL</div> }));
```
Then add this test inside the `describe("Mission detail writes", ...)` block:
```tsx
it("reveals the hook generator panel when the CTA is clicked", () => {
  renderDetail();
  expect(screen.queryByText("HOOK_PANEL")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "生成內容靈感" }));
  expect(screen.getByText("HOOK_PANEL")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npx vitest run "src/routes/-_app.mission.\$missionSlug.test.tsx"`
Expected: FAIL (no `生成內容靈感` button).

- [ ] **Step 3: Implement the wiring in `src/routes/_app.mission.$missionSlug.tsx`**

Add the icon + component imports:
```ts
import { ArrowLeft, Star, Clock, Lightbulb } from "lucide-react";
import { HookPanel } from "@/components/HookPanel";
```
Add panel state next to the existing `const [urls, setUrls] = useState("");`:
```ts
const [showHooks, setShowHooks] = useState(false);
```
In the action zone, immediately after the `{isApplication ? ... : ...}` block (still inside the `space-y-4 p-4` container), add the trigger for non-application missions:
```tsx
{!isApplication && (
  <>
    <button
      onClick={() => setShowHooks((v) => !v)}
      aria-label="生成內容靈感"
      className="flex w-full items-center justify-center gap-2 rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-magenta)] py-3 text-center font-heading font-bold text-white"
    >
      <Lightbulb size={18} aria-hidden /> 生成內容靈感
    </button>
    {showHooks && <HookPanel missionSlug={missionSlug} />}
  </>
)}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npx vitest run "src/routes/-_app.mission.\$missionSlug.test.tsx"`
Expected: PASS (existing 5 tests + the new one).

- [ ] **Step 5: Commit**

```bash
git add "src/routes/_app.mission.\$missionSlug.tsx" "src/routes/-_app.mission.\$missionSlug.test.tsx"
git commit -m "feat(slice8): mission-page hook generator trigger"
```

---

## Final Verification (after all tasks)

- [ ] **Unit/component suite:** `npm test` — all pass (new: `hookGen` 4, `enhanceHooks` 9, `HookPanel`/`normalizePlatform` 6, mission-detail +1).
- [ ] **Integration suite:** `set -a && . ./.env.test.local && set +a && ADMIN_SECRET=test-admin-secret npm run test:integration` — all pass incl. new `copilot hook generator` (4). Requires `supabase start`.
- [ ] **Type-check:** `npm run type-check` (runs `tsr generate && tsc --noEmit`) — clean. (No new route file, but run it anyway.)
- [ ] **Lint:** `npm run lint` — clean.
- [ ] **Build:** `npm run build` — clean.

Do **not** add `AI_GATEWAY_API_KEY` to `.env.test.local` — the integration test asserts the `source:"template"` path.
