import { lazy, Suspense, useId, useRef, useState } from "react";
import type { AssistContext } from "@/lib/missionAssist";
import { useI18n } from "@/lib/i18n";

const MissionAssistPanel = lazy(() => import("./MissionAssistPanel"));
export type AssistChecklistItem = { id: string; text: string; complete?: boolean };

export function MissionAssistLauncher({ context, checklist, staffWorkspace }: {
  context: AssistContext; checklist: AssistChecklistItem[]; staffWorkspace?: string;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const { lang } = useI18n();
  return <div className="space-y-3">
    <button ref={trigger} type="button" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(v => !v)}
      className="min-h-11 rounded-full border-2 border-[var(--color-ink)] bg-white px-4 py-2 font-bold">
      {lang === "en" ? "Brief help" : "任務解說"}
    </button>
    {open && <div id={panelId}><Suspense fallback={<p role="status">{lang === "en" ? "Loading brief help…" : "載入任務解說…"}</p>}>
      <MissionAssistPanel context={context} checklist={checklist} staffWorkspace={staffWorkspace}
        onClose={() => { setOpen(false); trigger.current?.focus(); }} />
    </Suspense></div>}
  </div>;
}
