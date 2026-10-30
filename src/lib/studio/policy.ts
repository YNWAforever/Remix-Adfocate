import type { PublicMission, StudioSection, StudioSource } from "./types";

/** Deliberately never spreads a DB row into a public response. */
export function publicMission(row: Record<string, unknown>, now = new Date()): PublicMission | null {
  if (row.status !== "active" || typeof row.slug !== "string" || typeof row.title !== "string" || typeof row.points_reward !== "number" || !Number.isFinite(row.points_reward) || row.points_reward < 0) return null;
  const deadline = typeof row.deadline === "string" ? row.deadline : null;
  if (deadline && (!Number.isFinite(Date.parse(deadline)) || Date.parse(deadline) <= now.getTime())) return null;
  return { slug: row.slug, title: row.title, points: row.points_reward, level: typeof row.required_level === "string" ? row.required_level : "L0", deadline };
}

export function studioReturn(path: unknown): string {
  if (typeof path !== "string" || /[\\%]/.test(path) || [...path].some(char => char.charCodeAt(0) <= 32) || !/^\/(home|studio|mission|my|campaigns|redemption|wallet|guide|explore|profile|passport|notifications|match|news)(\/|\?|#|$)/.test(path)) return "/home";
  return path;
}

/** Settlement is a handoff state, not a new workflow state. */
export function taskProgress(state: string, reward: string | null): { earned: boolean; step: number } {
  if (state === "cancelled" || state === "expired" || reward === "cancelled") return { earned: false, step: 0 };
  if (reward === "settled") return { earned: true, step: 6 };
  const step = state === "reward_pending" ? 5 : state === "proof_verified" ? 4 : ["publication_in_progress", "proof_submitted", "proof_under_review", "proof_correction_requested"].includes(state) ? 3 : state === "approved_to_publish" ? 2 : ["submitted", "in_review", "revision_requested"].includes(state) ? 1 : 0;
  return { earned: false, step };
}

export function buildSharedCaption(sections: StudioSection[], sources: StudioSource[], selected: string[]): string {
  if (!selected.length || new Set(selected).size !== selected.length || selected.some(id => !sections.some(section => section.id === id))) throw new Error("INVALID_SELECTION");
  return sections.filter(section => selected.includes(section.id)).map(section => {
    const citations = section.sourceIds.map(id => {
      const source = sources.find(s => s.id === id);
      if (!source || source.revoked_at) throw new Error("SOURCE_UNAVAILABLE");
      if (!source.shareable) throw new Error("SOURCE_PRIVATE");
      const time = new Date(Date.parse(source.observed_at) + 8 * 60 * 60 * 1000).toISOString().slice(0,16).replace("T", " ");
      return `\n來源：${source.title} · ${source.platform} · ${time} HKT · HK / 繁中 · 未驗證${source.url ? ` · ${source.url}` : ""}\n問題：${source.question}`;
    });
    return section.text + citations.join("");
  }).join("\n\n");
}

export function sourceInput(input: Record<string, unknown>): Omit<StudioSource, "id" | "thread_id" | "revoked_at"> {
  const text = (key: string, max: number) => {
    const value = input[key];
    if (typeof value !== "string" || !value.trim() || [...value].length > max) throw new Error("INVALID_SOURCE");
    return value.trim();
  };
  if (input.region !== "HK" || input.language !== "zh-Hant") throw new Error("UNSUPPORTED_COVERAGE");
  let url: string | null = null;
  if (input.url) {
    try { const parsed = new URL(String(input.url)); if (parsed.protocol !== "https:" || parsed.username || parsed.password || String(input.url).length > 2000) throw new Error(); url = parsed.href; }
    catch { throw new Error("INVALID_SOURCE"); }
  }
  const observed_at = text("observed_at", 40);
  if (!Number.isFinite(Date.parse(observed_at))) throw new Error("INVALID_SOURCE");
  if (!["manual", "public", "private"].includes(String(input.kind))) throw new Error("INVALID_SOURCE");
  return { title: text("title", 160), content: text("content", 8000), question: text("question", 500), platform: text("platform", 80), observed_at,
    url, kind: input.kind as StudioSource["kind"], shareable: input.shareable === true, region: "HK", language: "zh-Hant", status: "unverified" };
}
