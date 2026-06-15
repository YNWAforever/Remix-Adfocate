/** Minimal Vercel AI Gateway client for best-effort rationale polishing. Returns null on ANY
 *  problem (no key, empty input, non-2xx, timeout/abort, parse error) so callers keep their
 *  templated rationale. Never throws into the request path. OpenAI-compatible endpoint, plain
 *  fetch — no SDK dependency. */

import type { Hook } from "./hookGen.js";

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
