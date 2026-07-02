import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { useAssistantChat, type AssistantCitation } from "@/lib/queries/kocmax";
import { useI18n } from "@/lib/i18n";
import { AssistantMessage } from "./AssistantMessage";

type Turn = { side: "user" | "assistant"; text: string; citations?: AssistantCitation[] };

export function AssistantPanel({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const chat = useAssistantChat();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState<string | undefined>();
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Move focus into the panel on open, let Escape close it, and trap Tab/Shift+Tab
  // inside the panel — role="dialog" aria-modal="true" claims modal behaviour, so
  // focus must not be able to leave to the page behind it.
  useEffect(() => {
    inputRef.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const starters = useMemo(
    () => [t("app.assistant.starter1"), t("app.assistant.starter2"), t("app.assistant.starter3")],
    [t],
  );

  function send(message: string) {
    const text = message.trim();
    if (!text || chat.isPending) return;
    setTurns((prev) => [...prev, { side: "user" as const, text }]);
    setInput("");
    chat.mutate({ message: text, conversation_id: conversationId }, {
      onSuccess: (r) => { setConversationId(r.conversation_id); setTurns((prev) => [...prev, { side: "assistant" as const, text: r.answer, citations: r.citations }]); },
      onError: () => setTurns((prev) => [...prev, { side: "assistant" as const, text: t("app.assistant.error") }]),
    });
  }

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="assistant-panel-title"
      className="fixed inset-x-3 bottom-20 z-50 flex h-[70vh] max-h-[28rem] flex-col rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-paper)] shadow-[4px_4px_0_0_var(--color-ink)] lg:inset-x-auto lg:bottom-6 lg:right-6 lg:h-[28rem] lg:w-[24rem]"
    >
      <header className="flex items-center justify-between border-b-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-3 py-2">
        <span id="assistant-panel-title" className="font-heading font-bold">{t("app.assistant.title")}</span>
        <button type="button" aria-label={t("app.assistant.closeAria")} onClick={onClose}><X size={18} /></button>
      </header>

      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {turns.length === 0 && !chat.data && (
          <div className="space-y-2">
            <p className="text-sm text-[var(--color-soft-ink)]">{t("app.assistant.welcome")}</p>
            {starters.map((s) => (
              <button key={s} type="button" onClick={() => send(s)} className="block w-full rounded-[var(--radius)] border-2 border-dashed border-[var(--color-ink)] px-3 py-1.5 text-left text-sm">{s}</button>
            ))}
          </div>
        )}
        {turns.map((turn, i) => <AssistantMessage key={i} side={turn.side} text={turn.text} citations={turn.citations} />)}
        {turns.length === 0 && chat.data && (
          <AssistantMessage side="assistant" text={chat.data.answer} citations={chat.data.citations} />
        )}
        {chat.isPending && <p className="text-xs text-[var(--color-soft-ink)]">{t("app.assistant.thinking")}</p>}
      </div>

      <form className="flex gap-2 border-t-2 border-[var(--color-ink)] p-2" onSubmit={(e) => { e.preventDefault(); send(input); }}>
        <input ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} placeholder={t("app.assistant.inputPlaceholder")} aria-label={t("app.assistant.inputAria")} className="flex-1 rounded-[var(--radius)] border-2 border-[var(--color-ink)] px-2 py-1.5 text-sm" />
        <button type="submit" disabled={chat.isPending} className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-magenta)] px-3 py-1.5 text-sm font-heading font-bold text-white disabled:opacity-50">{t("app.assistant.sendBtn")}</button>
      </form>
    </div>
  );
}
