import { useI18n } from "@/lib/i18n";
import { renderNotification, type NotificationRow } from "@/lib/notifications";

export function NotificationCard({ row, onClick }: { row: NotificationRow; onClick?: () => void }) {
  const { t } = useI18n();
  const { title, body, href, icon: Icon } = renderNotification(row, t);
  const unread = row.read_at == null;
  return (
    <a
      href={href}
      onClick={onClick}
      className={`flex gap-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] p-3 ${unread ? "bg-[var(--color-acid)]/20" : "bg-[var(--color-paper)]"}`}
    >
      <Icon size={20} aria-hidden className="mt-0.5 shrink-0" />
      <div className="min-w-0">
        <p className="font-heading text-sm font-bold">{title}</p>
        <p className="text-sm text-[var(--color-soft-ink)]">{body}</p>
      </div>
      {unread && <span aria-hidden className="ml-auto mt-1 h-2 w-2 shrink-0 rounded-full bg-[var(--color-magenta)]" />}
    </a>
  );
}
