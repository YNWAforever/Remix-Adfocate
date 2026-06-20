import { useState } from "react";
import { MessageCircle } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { AssistantPanel } from "./AssistantPanel";

export function AssistantLauncher() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      {open && <AssistantPanel onClose={() => setOpen(false)} />}
      <button
        type="button" aria-label={t("app.assistant.launchAria")} onClick={() => setOpen((v) => !v)}
        className="fixed bottom-20 right-3 z-40 grid h-14 w-14 place-items-center rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-magenta)] text-white shadow-[4px_4px_0_0_var(--color-ink)] lg:bottom-6 lg:right-6"
      >
        <MessageCircle size={24} />
      </button>
    </>
  );
}
