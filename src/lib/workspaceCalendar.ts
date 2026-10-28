export const WORKSPACE_TIMEZONE = "Asia/Hong_Kong";
export function calendarDay(iso: string, timezone = WORKSPACE_TIMEZONE): string | null {
  const time = new Date(iso);
  if (!Number.isFinite(time.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat("en", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(time);
    const value = (kind: string) => parts.find((part) => part.type === kind)?.value;
    return `${value("year")}-${value("month")}-${value("day")}`;
  } catch { return null; }
}
export function dueLabel(dueAt: string | null, now: Date, timezone = WORKSPACE_TIMEZONE): "overdue" | "today" | "future" | "unknown" {
  if (!Number.isFinite(now.getTime())) return "unknown";
  const day = dueAt ? calendarDay(dueAt, timezone) : null;
  const today = calendarDay(now.toISOString(), timezone);
  if (!day || !today || !dueAt) return "unknown";
  if (Date.parse(dueAt) < now.getTime()) return "overdue";
  return day === today ? "today" : "future";
}
