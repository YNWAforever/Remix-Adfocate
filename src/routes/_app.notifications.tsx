import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Bell } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useNotifications, useMarkRead, useMarkAllRead } from "@/lib/queries/kocmax";
import { NotificationCard } from "@/components/notifications/NotificationCard";
import type { NotificationRow } from "@/lib/notifications";

export const Route = createFileRoute("/_app/notifications")({ component: Notifications });

function Notifications() {
  const { t } = useI18n();
  const list = useNotifications();
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();
  const items = (list.data?.items ?? []) as NotificationRow[];
  const hasUnread = (list.data?.unread_count ?? 0) > 0;

  // Mark visible unread rows read on open (one-shot per data load).
  useEffect(() => {
    const unreadIds = items.filter((n) => n.read_at == null).map((n) => n.id);
    if (unreadIds.length) markRead.mutate(unreadIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.data]);

  return (
    <div className="mx-auto w-full max-w-lg space-y-4 p-4 lg:max-w-3xl">
      <header className="flex items-center gap-2">
        <h1 className="flex items-center gap-2 font-display text-2xl font-bold">
          <Bell size={22} aria-hidden /> {t("app.notif.title")}
        </h1>
        {hasUnread && (
          <button
            type="button"
            onClick={() => markAll.mutate()}
            className="ml-auto rounded-full border-2 border-[var(--color-ink)] px-3 py-1 font-mono text-xs font-bold"
          >
            {t("app.notif.markAll")}
          </button>
        )}
      </header>

      {list.isLoading && <p className="text-sm text-[var(--color-soft-ink)]">{t("common.loading")}</p>}
      {list.isError && <p className="text-sm text-[var(--color-magenta)]">{t("common.loadFailed")}</p>}
      {!list.isLoading && !list.isError && items.length === 0 && (
        <p className="rounded-[var(--radius)] border-2 border-dashed border-[var(--color-ink)] p-6 text-center text-sm text-[var(--color-soft-ink)]">
          {t("app.notif.empty")}
        </p>
      )}

      <div className="space-y-2">
        {items.map((n) => <NotificationCard key={n.id} row={n} />)}
      </div>
    </div>
  );
}
