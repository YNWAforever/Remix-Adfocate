import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { useUnreadCount } from "@/lib/queries/kocmax";

/** Fires a single toast when the polled unread count rises during a session.
 *  Renders nothing. Mounted inside the authenticated shell. */
export function NotificationToaster() {
  const { t } = useI18n();
  const { data: count } = useUnreadCount();
  const prev = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (count == null) return;
    if (prev.current != null && count > prev.current) {
      toast(t("app.notif.toast.new"));
    }
    prev.current = count;
  }, [count, t]);

  return null;
}
