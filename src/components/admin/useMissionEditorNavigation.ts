import { useCallback, useRef } from "react";
import { useBlocker } from "@tanstack/react-router";
import { useI18n } from "@/lib/i18n";

export function useMissionEditorNavigation() {
  const dirty = useRef(false);
  const { t } = useI18n();
  const confirmDiscard = useCallback(() => {
    if (!dirty.current) return true;
    if (!window.confirm(t("app.admin.missionEditor.unsavedLeave"))) return false;
    dirty.current = false;
    return true;
  }, [t]);
  useBlocker({ shouldBlockFn: () => !confirmDiscard(), enableBeforeUnload: () => dirty.current });
  const changed = useCallback((value: boolean) => { dirty.current = value; }, []);
  const saved = useCallback(() => { dirty.current = false; }, []);
  return { changed, saved, confirmDiscard };
}
