import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { useAssistantChat, type AssistantCitation, type AssistantReply } from "@/lib/queries/kocmax";
import { apiFetch } from "@/lib/api";
import { RequestFeedback } from "@/components/RequestFeedback";
import { useI18n } from "@/lib/i18n";
import { AssistantMessage } from "./AssistantMessage";

type Turn = { side: "user" | "assistant"; text: string; citations?: AssistantCitation[]; requestId?: string };

export function AssistantPanel({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const chat = useAssistantChat();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState<string | undefined>();
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const pendingRequest = useRef<{ id: string; message: string; conversationId?: string } | null>(null);
  const [feedback, setFeedback] = useState("");
  const [saved, setSaved] = useState(false);

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

  function receive(reply: AssistantReply) {
    const id = pendingRequest.current?.id;
    if (!id || reply.request_id !== id) return;
    if (reply.answer) setTurns((prev) => [...prev.filter((turn) => !(turn.side === "assistant" && turn.requestId === id)), {
      side: "assistant", requestId: id, text: reply.persistence === "saved" ? reply.answer! : `未確認保存 / Not confirmed saved: ${reply.answer}`, citations: reply.citations,
    }]);
    if (reply.persistence === "saved") {
      if (reply.conversation_id) setConversationId(reply.conversation_id);
      setInput(""); pendingRequest.current = null; setSaved(true); setFeedback("已保存 / Saved");
    } else { setSaved(false); setFeedback("尚未確認保存；輸入已保留。請查看同一要求的結果，系統不會自動再次生成。 / Saving is not confirmed. Your input is retained. Check this request; generation will not restart automatically."); }
  }
  function send(message: string) {
    const text = message.trim();
    if (!text || chat.isPending) return;
    if ([...message].length > 4000) { setSaved(false); setFeedback("訊息上限為 4,000 字。 / Limit: 4,000 Unicode characters."); return; }
    if (pendingRequest.current && pendingRequest.current.message !== text) { setSaved(false); setFeedback("請先查看上一個要求，或明確開始新問題。 / Check the previous request or start a new question first."); return; }
    if (!pendingRequest.current) {
      const request = { id: crypto.randomUUID(), message: text, conversationId };
      pendingRequest.current = request;
      setTurns((prev) => [...prev, { side: "user", text, requestId: request.id }]);
    }
    setInput(text); setFeedback(""); setSaved(false);
    chat.mutate({ message: text, conversation_id: pendingRequest.current.conversationId, client_request_id: pendingRequest.current.id }, {
      onSuccess: receive,
      onError: () => { setSaved(false); setFeedback("服務未能完成或結果未知；輸入已保留。 / Request failed or its outcome is unknown. Your input is retained."); },
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
        <button type="button" aria-label={t("app.assistant.closeAria")} onClick={onClose} className="grid h-11 w-11 shrink-0 place-items-center"><X size={18} /></button>
      </header>

      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {turns.length === 0 && !chat.data && (
          <div className="space-y-2">
            <p className="text-sm text-[var(--color-soft-ink)]">{t("app.assistant.welcome")}</p>
            {starters.map((s) => (
              <button key={s} type="button" onClick={() => send(s)} className="block min-h-11 w-full rounded-[var(--radius)] border-2 border-dashed border-[var(--color-ink)] px-3 py-1.5 text-left text-sm">{s}</button>
            ))}
          </div>
        )}
        {turns.map((turn, i) => <AssistantMessage key={i} side={turn.side} text={turn.text} citations={turn.citations} />)}
        {turns.length === 0 && chat.data?.answer && (
          <AssistantMessage side="assistant" text={chat.data.answer} citations={chat.data.citations} />
        )}
        {chat.isPending && <p className="text-xs text-[var(--color-soft-ink)]">{t("app.assistant.thinking")}</p>}
        {feedback && <div role={saved ? "status" : "alert"} className="space-y-2 text-sm"><p>{feedback}</p>
          {pendingRequest.current && <button type="button" disabled={chat.isPending} onClick={async () => {
            const requestId = pendingRequest.current?.id;
            if (!requestId) return;
            try { receive(await apiFetch<AssistantReply>(`/assistant/requests/${requestId}`)); }
            catch { if (pendingRequest.current?.id === requestId) setFeedback("暫未能查閱結果，請稍後再試。 / Request status unavailable; try again later."); }
          }}>查看要求結果 / Check request</button>}
          {pendingRequest.current && <button type="button" disabled={chat.isPending} onClick={() => { pendingRequest.current = null; setFeedback(""); }}>開始新問題 / New question</button>}
        </div>}
        <RequestFeedback error={chat.error} />
      </div>

      <form className="flex gap-2 border-t-2 border-[var(--color-ink)] p-2" onSubmit={(e) => { e.preventDefault(); send(input); }}>
        <input ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} placeholder={t("app.assistant.inputPlaceholder")} aria-label={t("app.assistant.inputAria")} className="min-w-0 flex-1 rounded-[var(--radius)] border-2 border-[var(--color-ink)] px-2 py-1.5 text-sm" />
        <button type="submit" disabled={chat.isPending} className="min-h-11 shrink-0 rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-magenta)] px-3 py-1.5 text-sm font-heading font-bold text-white disabled:opacity-50">{t("app.assistant.sendBtn")}</button>
      </form>
    </div>
  );
}
