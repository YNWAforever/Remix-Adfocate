import { useEffect, useId, useRef, useState } from "react";
import { ApiError, apiFetch } from "@/lib/api";
import { adminFetch, AdminRequestError } from "@/lib/admin";
import { useI18n } from "@/lib/i18n";
import type { AssistContext, MissionAssistReply } from "@/lib/missionAssist";
import type { AssistChecklistItem } from "./MissionAssistLauncher";

/** Default off. Offline harnesses may opt into mocked transport; production callers never do. */
export default function MissionAssistPanel({ context, checklist, staffWorkspace, onClose, enabled = false }: {
  context: AssistContext; checklist: AssistChecklistItem[]; staffWorkspace?: string; onClose: () => void; enabled?: boolean;
}) {
  const { lang } = useI18n();
  const en = lang === "en";
  const headingId = useId(), inputId = useId();
  const [question, setQuestion] = useState("");
  const [reply, setReply] = useState<MissionAssistReply | null>(null);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false), [blocked, setBlocked] = useState(false);
  const attempt = useRef<{ id: string; message: string } | null>(null);
  const active = useRef<AbortController | null>(null);
  const scope = JSON.stringify(context);
  useEffect(() => {
    setReply(null); setFeedback(""); setBlocked(false); setBusy(false); attempt.current = null;
    return () => { active.current?.abort(); };
  }, [scope]);

  async function send() {
    if (!enabled || busy || blocked) return;
    const message = question.trim();
    if (!message || [...message].length > 4000) { setFeedback(en ? "Enter a question of at most 4,000 characters." : "請輸入問題，上限為 4,000 字。"); return; }
    if (attempt.current && attempt.current.message !== message) { setFeedback(en ? "Start a new question to change this request." : "請先按「開始新問題」以更改此要求。"); return; }
    attempt.current ??= { id: crypto.randomUUID(), message };
    const controller = new AbortController(); active.current?.abort(); active.current = controller;
    setBusy(true); setFeedback(""); setReply(null);
    try {
      const init: RequestInit = { method: "POST", signal: controller.signal, body: JSON.stringify({
        message, client_request_id: attempt.current.id, locale: en ? "en" : "zh-HK", assist_context: context,
      }), ...(staffWorkspace ? { headers: { "X-Workspace-Slug": staffWorkspace } } : {}) };
      const value = staffWorkspace ? await adminFetch<MissionAssistReply>("/admin/assistant/mission-assist", init)
        : await apiFetch<MissionAssistReply>("/assistant/mission-assist", init);
      if (controller.signal.aborted) return;
      setReply(value); setBlocked(true);
      setFeedback(en ? "Mock explanation completed; it is not saved. Your input is retained." : "模擬解說已完成，未保存；原有輸入保留。");
    } catch (error) {
      if (controller.signal.aborted) return;
      const status = error instanceof ApiError || error instanceof AdminRequestError ? error.status : 0;
      const unknown = !status || status >= 500;
      setBlocked(unknown || status === 409);
      setFeedback(unknown ? (en ? "The outcome is unknown. Your input is retained. No automatic retry; check with the reviewer before starting a new question." : "結果未知；輸入已保留，不會自動重試。開始新問題前請向審稿人確認。")
        : status === 409 ? (en ? "The source changed. Your input is retained. Reload the workflow and compare versions before starting a new question." : "來源版本已變；輸入保留。請重載工作流程及比較版本，再開始新問題。")
          : status === 403 || status === 404 ? (en ? "This context is unavailable to your role. Your input is retained; ask the workspace owner to check access." : "此角色無法讀取這個範圍；輸入保留，請工作區負責人核對權限。")
            : status === 429 ? (en ? "Too many requests. Wait and retry the same request; your input is retained." : "要求過多；請稍後重試同一要求，輸入已保留。")
              : (en ? "The request could not be completed. Your input is retained." : "未能完成要求；輸入已保留。"));
    } finally { if (!controller.signal.aborted) setBusy(false); }
  }
  return <section aria-labelledby={headingId} className="min-w-0 space-y-4 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-paper)] p-4">
    <div className="flex items-start justify-between gap-3">
      <h3 id={headingId} className="font-heading text-lg font-bold">{en ? "Brief coach" : "任務解說"}</h3>
      <button type="button" onClick={onClose} className="min-h-11 shrink-0 px-3 font-bold">{en ? "Close help" : "關閉解說"}</button>
    </div>
    <div><h4 className="font-bold">{en ? "Source checklist" : "原有要求清單"}</h4>
      {checklist.length ? <ul className="list-disc space-y-2 pl-5">{checklist.map((r, i) => <li key={`${r.id}-${i}`} className="break-words">{r.text}{r.complete === true ? (en ? " · checked by you" : " · 你已勾選") : ""}</li>)}</ul>
        : <p>{en ? "No checklist is available. Ask the reviewer to clarify the requirements." : "未有清單，請向審稿人確認要求。"}</p>}
    </div>
    <p className="text-sm">{en ? "Rules come from the brief and checklist. AI suggestions require human review and cannot approve work, publish or change rewards. Unsaved edits are excluded." : "規則以 brief 及清單為準；AI 建議須人手核對，不能批稿、發布或更改獎勵。未保存修改不會送出。"}</p>
    {!enabled && <p role="status" className="font-bold">{en ? "AI explanation is disabled pending provider evaluation. The checklist remains available." : "AI 解說尚未啟用，待 provider 驗收；仍可使用原有清單。"}</p>}
    <form onSubmit={e => { e.preventDefault(); void send(); }} className="space-y-2">
      <label htmlFor={inputId} className="block font-bold">{en ? "Question about this brief or version" : "關於這個 brief 或版本的問題"}</label>
      <textarea id={inputId} rows={3} value={question} onChange={e => setQuestion(e.target.value)} className="w-full rounded-xl border-2 border-[var(--color-ink)] bg-white p-3" />
      <div className="flex flex-wrap gap-2"><button type="submit" disabled={!enabled || busy || blocked} className="min-h-11 rounded-full border-2 border-[var(--color-ink)] px-4 py-2 font-bold disabled:opacity-50">{en ? "Explain with AI" : "AI 解說"}</button>
        {attempt.current && <button type="button" disabled={busy} onClick={() => { attempt.current = null; setBlocked(false); setFeedback(""); setReply(null); }} className="min-h-11 px-4 py-2 underline">{en ? "Start a new question" : "開始新問題"}</button>}
      </div>
    </form>
    {busy && <p role="status">{en ? "Preparing explanation…" : "正在整理解說…"}</p>}
    {feedback && <p role={reply ? "status" : "alert"}>{feedback}</p>}
    {reply && <div className="space-y-3 break-words">
      <p className="font-bold">{en ? "Mock output · not saved · human review required" : "模擬結果 · 未保存 · 須人手核對"}</p>
      {reply.basisVersion.stale && <p role="alert">{en ? "This is an old version. Reload and compare the latest version before any decision." : "這是舊版本；作決定前請重載及比較最新版本。"}</p>}
      <p className="whitespace-pre-wrap">{reply.answer}</p>
      <p>{en ? "Basis version" : "依據版本"}: {reply.basisVersion.versionNumber === null ? (reply.basisVersion.missionUpdatedAt ?? (en ? "date unknown" : "日期未知")) : `v${reply.basisVersion.versionNumber}`}</p>
      {reply.basisVersion.versionApproved !== undefined && <p>{reply.basisVersion.versionApproved
        ? (en ? "Selected version: current approved snapshot." : "所選版本：目前批准的快照。")
        : (en ? "Selected version: not the current approved snapshot." : "所選版本：並非目前批准的快照。")}</p>}
      {reply.basisVersion.previousVersionId && <p>{reply.basisVersion.previousVersionApproved
        ? (en ? "Previous comparison version: current approved snapshot." : "上一個比較版本：目前批准的快照。")
        : (en ? "Previous comparison version: approval is not confirmed by the current work item." : "上一個比較版本：目前工作項目未能確認其批准狀態。")}</p>}
      <ul aria-label={en ? "Sources" : "來源"}>{reply.citations.map(c => <li key={c.sourceRef}>{c.title} <span className="break-all text-xs">{c.sourceRef}</span></li>)}</ul>
      <ul aria-label={en ? "Limitations" : "限制"}>{reply.limitations.map(l => <li key={l}>{limitationLabel(l, en)}</li>)}</ul>
    </div>}
  </section>;
}

function limitationLabel(code: string, en: boolean) {
  const labels: Record<string, [string, string]> = {
    human_review_required: ["A human must check the sources before deciding.", "作決定前須由人手核對來源。"],
    no_business_actions: ["This explanation makes no approvals or reward changes.", "解說不會作出審批或更改獎勵。"],
    payment_and_processing_date_unknown: ["Payment status and processing dates are unknown.", "付款狀態及處理日期未知。"],
    private_notes_and_assets_excluded: ["Private notes and assets are excluded.", "未有讀取內部筆記或私人資產。"],
    bounded_text_projection: ["Only a limited text excerpt is included; check the full sources.", "只包括部分文字，請同時核對完整來源。"],
    stale_version: ["This explanation uses an older version.", "解說依據舊版本。"],
    previous_version_unavailable: ["The previous version is unavailable; changes cannot be confirmed.", "未有上一個版本，無法確認修改差異。"],
    insufficient_context: ["There is not enough source information.", "來源資料不足。"],
    unknown_answer: ["The sources do not answer this question.", "來源未能回答此問題。"],
    tool_request_denied: ["An unsupported action was blocked; use the source checklist.", "已拒絕不支援的動作，請以原有清單為準。"],
    invalid_provider_result: ["The explanation could not be verified; use the source checklist.", "未能核實解說，請以原有清單為準。"],
  };
  return labels[code]?.[en ? 0 : 1] ?? (en ? "Unconfirmed information; ask the reviewer." : "資料未能確認，請向審稿人查詢。");
}
