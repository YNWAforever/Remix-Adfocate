export const QUEUE_SORTS = ["last_activity", "trust_score", "level", "social_freshness"] as const;
export type QueueSearch = { ws: string; q: string; status: "all" | "needs_review" | "approved" | "flagged"; risk: "all" | "unknown" | "low" | "medium" | "high"; sort: typeof QUEUE_SORTS[number]; page: number; mission_id?: string };
export function parseCreatorQueueSearch(search: Record<string, unknown>): QueueSearch {
  const page = Number(search.page ?? 1);
  return {
    ws: typeof search.ws === "string" ? search.ws : "",
    q: typeof search.q === "string" ? [...search.q].slice(0, 200).join("") : "",
    status: ["needs_review", "approved", "flagged"].includes(String(search.status)) ? search.status as QueueSearch["status"] : "all",
    risk: ["unknown", "low", "medium", "high"].includes(String(search.risk)) ? search.risk as QueueSearch["risk"] : "all",
    sort: QUEUE_SORTS.includes(search.sort as QueueSearch["sort"]) ? search.sort as QueueSearch["sort"] : "last_activity",
    page: Number.isSafeInteger(page) && page >= 1 && page <= 1000000 ? page : 1,
    ...(typeof search.mission_id === "string" ? { mission_id: search.mission_id } : {}),
  };
}
export function creatorQueueUrl(search: QueueSearch) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) if (value !== "" && value !== "all" && value !== undefined) params.set(key, String(value));
  return `/admin/creators?${params}`;
}
export function safeCreatorQueueReturn(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/admin/creators") || /[\\\r\n]/.test(value)) return "/admin/creators";
  const parsed = new URL(value, "https://local.invalid");
  return parsed.origin === "https://local.invalid" && parsed.pathname === "/admin/creators"
    ? creatorQueueUrl(parseCreatorQueueSearch(Object.fromEntries(parsed.searchParams))) : "/admin/creators";
}
