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
