import { useState } from "react";
import { X } from "lucide-react";
import { useAssistantChat, type AssistantCitation } from "@/lib/queries/kocmax";
import { AssistantMessage } from "./AssistantMessage";

type Turn = { role: "user" | "assistant"; text: string; citations?: AssistantCitation[] };
const STARTERS = ["我有幾多積分？", "點樣賺更多分？", "點解我嘅提交被拒？"];

export function AssistantPanel({ onClose }: { onClose: () => void }) {
  const chat = useAssistantChat();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState<string | undefined>();

  function send(message: string) {
    const text = message.trim();
    if (!text || chat.isPending) return;
    setTurns((t) => [...t, { role: "user", text }]);
    setInput("");
    chat.mutate({ message: text, conversation_id: conversationId }, {
      onSuccess: (r) => { setConversationId(r.conversation_id); setTurns((t) => [...t, { role: "assistant", text: r.answer, citations: r.citations }]); },
      onError: () => setTurns((t) => [...t, { role: "assistant", text: "助手暫時無法使用，請稍後再試。" }]),
    });
  }

  return (
    <div className="fixed bottom-20 right-3 z-50 flex h-[28rem] w-[20rem] flex-col rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-paper)] shadow-[4px_4px_0_0_var(--color-ink)] lg:bottom-6 lg:right-6 lg:w-[24rem]">
      <header className="flex items-center justify-between border-b-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-3 py-2">
        <span className="font-heading font-bold">AI 助手 🤖</span>
        <button type="button" aria-label="關閉" onClick={onClose}><X size={18} /></button>
      </header>

      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {turns.length === 0 && !chat.data && (
          <div className="space-y-2">
            <p className="text-sm text-[var(--color-soft-ink)]">你好！想了解任務、積分定兌換？</p>
            {STARTERS.map((s) => (
              <button key={s} type="button" onClick={() => send(s)} className="block w-full rounded-[var(--radius)] border-2 border-dashed border-[var(--color-ink)] px-3 py-1.5 text-left text-sm">{s}</button>
            ))}
          </div>
        )}
        {turns.map((t, i) => <AssistantMessage key={i} role={t.role} text={t.text} citations={t.citations} />)}
        {turns.length === 0 && chat.data && (
          <AssistantMessage role="assistant" text={chat.data.answer} citations={chat.data.citations} />
        )}
        {chat.isPending && <p className="text-xs text-[var(--color-soft-ink)]">思考中…</p>}
      </div>

      <form className="flex gap-2 border-t-2 border-[var(--color-ink)] p-2" onSubmit={(e) => { e.preventDefault(); send(input); }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="輸入訊息…" aria-label="訊息" className="flex-1 rounded-[var(--radius)] border-2 border-[var(--color-ink)] px-2 py-1.5 text-sm" />
        <button type="submit" disabled={chat.isPending} className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-magenta)] px-3 py-1.5 text-sm font-heading font-bold text-white disabled:opacity-50">傳送</button>
      </form>
    </div>
  );
}
