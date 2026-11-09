import { useEffect, useRef, useState } from "react";
import { Link, useBlocker } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, FileText, LockKeyhole, MessageCircle, Paperclip, Send, Sparkles } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api";
import { fetchAssistantProgress, useAssistantChat, useMe, useMyMissions, type AssistantReply } from "@/lib/queries/kocmax";
import type { ActiveMissionWorkspace } from "@/lib/activeMission";
import { buildSharedCaption } from "@/lib/studio/policy";
import { copySavedBrief } from "@/lib/studio/savedOutputs";
import { SavedOutputCards } from "./SavedOutputCards";
import { useStudioCommand, useStudioThread, useStudioThreads, studioKeys } from "@/lib/studio/queries";
import type { StudioBrief, StudioDetail, StudioSection, StudioShare } from "@/lib/studio/types";
import type { GrowthSkillId } from "@/lib/creatorGrowth/skillManifest";
import { IntegrationSourcePanel } from "../integrations/IntegrationSourcePanel";
import { GrowthImageWorkspaceEntry } from "./GrowthImageWorkspaceEntry";
import { StudioSkillSummary } from "./StudioSkillSummary";
import { StudioStarter } from "./StudioHome";
import { Sprout, StudioError, StudioLoginRequired, StudioProgress, useStudioText } from "./StudioPrimitives";

export function StudioWorkspace({ threadId, skill, autoSend }: { threadId?: string; skill?: GrowthSkillId; autoSend?: boolean }) {
  const tx = useStudioText(), [page, setPage] = useState(0), history = useStudioThreads(page), detail = useStudioThread(threadId ?? ""), me = useMe();
  const [commandLoginRequired, setCommandLoginRequired] = useState(false);
  const loginRequired = (history.isError && history.error instanceof ApiError && history.error.status === 401)
    || (threadId && detail.isError && detail.error instanceof ApiError && detail.error.status === 401);
  useEffect(() => { if (loginRequired) setCommandLoginRequired(true); }, [loginRequired]);
  if (loginRequired || commandLoginRequired) return <StudioLoginRequired/>;
  const unavailable = detail.error instanceof ApiError && [403, 404].includes(detail.error.status);
  const readError = unavailable ? <StudioError>
    <p>{tx("目前無法開啟這段討論。你可以返回工作室，繼續自己的創作。", "This chat is unavailable. Return to your studio to continue creating.")}</p>
    <Link to="/home" className="s-btn">{tx("返回我的工作室", "Return to my studio")}</Link>
  </StudioError> : <StudioError onRetry={() => void detail.refetch()}/>;
  return <div className="s-stack"><div className="s-between"><Link to="/home" className="s-btn"><ArrowLeft size={17}/>{tx("工作室", "Studio")}</Link><Link to="/studio" className="s-btn">＋ {tx("新討論", "New chat")}</Link></div>
    <nav className="s-history" aria-label={tx("歷史討論串", "Chat history")}>{history.data?.threads.map(t => <Link key={t.id} to="/studio" search={{ thread:t.id }} aria-current={t.id === threadId ? "page" : undefined}>{t.title}</Link>)}{page > 0 && <button className="s-btn" onClick={() => setPage(p => p - 1)}>{tx("上一頁", "Previous")}</button>}{history.data?.nextPage !== null && history.data?.nextPage !== undefined && <button className="s-btn" onClick={() => setPage(p => p + 1)}>{tx("更早的討論", "Older chats")}</button>}</nav>
    {threadId ? detail.isPending ? <p role="status">{tx("正在打開你的靈感…", "Opening your ideas…")}</p> : detail.isError ? readError : detail.data && <ThreadContent key={`${threadId}:${me.data?.id ?? "pending"}`} detail={detail.data} skill={skill} autoSend={autoSend} identityKey={me.data?.id ?? "pending"} onLoginRequired={() => setCommandLoginRequired(true)}/> : <><div className="s-between"><div><span className="s-eyebrow">YOUR IDEAS LIVE HERE</span><h1>{tx("每個主題，一段自己的討論", "A home for every idea")}</h1><p>{tx("證據、Brief 和任務成果，都有自己的位置。", "Keep each chat, its evidence and its brief together.")}</p></div><Sprout/></div><StudioStarter onLoginRequired={() => setCommandLoginRequired(true)}/></>}
  </div>;
}

function progressLabel(step: string, tx: (zh: string, en: string) => string) {
  if (step === "thinking") return tx("正在理解你的問題…", "Understanding your question…");
  if (step === "skills") return tx("正在準備資料技能…", "Preparing data skills…");
  if (step === "answering") return tx("正在整理回覆…", "Writing the answer…");
  if (step.startsWith("tool:")) {
    const name = step.slice(5);
    if (name.startsWith("mcp__")) {
      const server = name.split("__")[1] ?? "";
      return tx("使用 " + server + " 技能…", "Using the " + server + " skill…");
    }
    return tx("查閱你的帳戶資料…", "Checking your account data…");
  }
  return tx("正在處理…", "Working…");
}

function ThreadContent({ detail, skill, autoSend, identityKey, onLoginRequired }: { detail: StudioDetail; skill?: GrowthSkillId; autoSend?: boolean; identityKey: string; onLoginRequired: () => void }) {
  const tx = useStudioText(), client = useQueryClient();
  const [tab, setTab] = useState<"chat"|"evidence"|"brief"|"skill">(skill ? "skill" : "chat"), [input, setInput] = useState(detail.messages.length ? "" : detail.thread.initial_prompt ?? "");
  const [growthDirty, setGrowthDirty] = useState(false);
  const chat = useAssistantChat(), command = useStudioCommand<StudioBrief | StudioShare>();
  const latest = detail.briefs.reduce<StudioBrief | undefined>((best, brief) => !best || brief.version > best.version ? brief : best, undefined);
  const [sections, setSections] = useState<StudioSection[]>(latest?.sections ?? []);
  const [selected, setSelected] = useState<string[]>([]), [confirmed, setConfirmed] = useState(false), [feedback, setFeedback] = useState("");
  const [sourceOpen, setSourceOpen] = useState(false), [submissionId, setSubmissionId] = useState(""), [workItemId, setWorkItemId] = useState("");
  const [receipt, setReceipt] = useState<StudioShare | null>(null);
  const [pendingChat, setPendingChat] = useState<{ id: string; message: string } | null>(null);
  const [ephemeral, setEphemeral] = useState<Array<{ id: string; role: "user" | "assistant"; content: string }>>([]);
  const [pendingProposals, setPendingProposals] = useState<Array<{ kind: "brief"; sections: string[]; token?: string }>>([]);
  const [elapsed, setElapsed] = useState(0);
  const sentInitial = useRef(false);
  useEffect(() => {
    if (!chat.isPending) { setElapsed(0); return; }
    const timer = setInterval(() => setElapsed(value => value + 1), 1000);
    return () => clearInterval(timer);
  }, [chat.isPending]);
  const progress = useQuery({
    queryKey: ["assistant", "progress", pendingChat?.id ?? "none"],
    queryFn: () => fetchAssistantProgress(pendingChat!.id),
    enabled: Boolean(pendingChat && chat.isPending),
    retry: false,
    refetchInterval: 800,
  });
  const latestStep = progress.data?.steps?.at(-1)?.step ?? "";
  const [usedTools, setUsedTools] = useState<string[]>([]);
  const pendingCommand = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const [commandOutstanding, setCommandOutstanding] = useState(false);
  const [pendingCopyId, setPendingCopyId] = useState<string | null>(null);
  const [copiedFromVersion, setCopiedFromVersion] = useState<number | null>(null);
  const [savedCopy, setSavedCopy] = useState<{ fingerprint: string; revision: number } | null>(null);
  const copyTrigger = useRef<HTMLElement | null>(null);
  const briefHeading = useRef<HTMLHeadingElement | null>(null);
  const focusCopied = useRef(false);
  useEffect(() => { if (focusCopied.current && tab === "brief") { briefHeading.current?.focus(); focusCopied.current = false; } });
  const my = useMyMissions();
  const workspace = useQuery({ queryKey:["active-mission",submissionId], queryFn:() => apiFetch<ActiveMissionWorkspace>(`/my-missions/${submissionId}/workspace`), enabled:Boolean(submissionId) });
  const workItem = workspace.data?.workItems.find(i => i.id === workItemId);
  const activeSources = detail.sources.filter(s => !s.revoked_at);
  const sectionFingerprint = JSON.stringify(sections);
  const dirty = sectionFingerprint !== (savedCopy && detail.thread.revision <= savedCopy.revision ? savedCopy.fingerprint : JSON.stringify(latest?.sections ?? []));
  useBlocker({ enableBeforeUnload: Boolean(dirty || growthDirty || input || pendingChat), shouldBlockFn: () => (dirty || growthDirty) && !window.confirm(tx("還有未保存的修改。離開並放棄這些本機內容？", "You have unsaved changes. Leave and discard this local work?")) });
  useEffect(() => { const warn = (event: BeforeUnloadEvent) => { if (dirty || growthDirty || input || pendingChat) { event.preventDefault(); event.returnValue = ""; } }; window.addEventListener("beforeunload",warn); return () => window.removeEventListener("beforeunload",warn); }, [dirty,growthDirty,input,pendingChat]);
  const localRevision = useRef(detail.thread.revision);
  // A loaded confirmation stays bound to the version displayed when it was prepared.
  const confirmationKey = `${detail.thread.revision}:${latest?.id}:${selected.join(",")}:${submissionId}:${workItemId}:${workItem?.draft?.revision}`;
  const confirmedKey = useRef("");
  const copyDisabled = command.isPending || commandOutstanding
    ? tx("請先確認上次保存或分享的結果，再複製成果。", "Resolve the last save or transfer before copying.") : undefined;
  function applyCopy(briefId: string) {
    if (command.isPending || pendingCommand.current) return;
    const brief = detail.briefs.find(b => b.id === briefId);
    try {
      if (!brief) throw new Error("BRIEF_UNAVAILABLE");
      const copy = copySavedBrief(brief, detail.thread.id, detail.sources, () => crypto.randomUUID());
      setSections(copy); setCopiedFromVersion(brief.version); setSavedCopy(null);
      setSelected([]); setConfirmed(false); confirmedKey.current = "";
      setSubmissionId(""); setWorkItemId(""); setReceipt(null); setPendingCopyId(null);
      focusCopied.current = true; setTab("brief");
      setFeedback(tx("已建立私人草稿，原版本不變。確認內容後再保存。", "Private draft created. The original is unchanged; review before saving."));
    } catch {
      setPendingCopyId(null);
      setFeedback(tx("版本或來源已改變，暫不能複製。你的草稿仍保留。", "The version or its sources changed. Copy unavailable; your draft is retained."));
    }
  }
  function requestCopy(briefId: string) {
    if (command.isPending || pendingCommand.current) return;
    copyTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Pointer-triggered buttons are not consistently focused by every browser.
    if (copyTrigger.current?.tagName !== "BUTTON") copyTrigger.current = document.querySelector<HTMLElement>(`[data-copy-brief="${briefId}"]`);
    if (dirty) setPendingCopyId(briefId); else applyCopy(briefId);
  }
  let preview = "", shareError = "";
  if (latest && selected.length) { try { preview = buildSharedCaption(latest.sections, detail.sources, selected); } catch (error) { shareError = error instanceof Error ? error.message : "SOURCE_UNAVAILABLE"; } }

  function rejectUnauthorized(error: unknown) {
    if (!(error instanceof ApiError) || error.status !== 401) return false;
    pendingCommand.current = null;
    confirmedKey.current = "";
    onLoginRequired();
    return true;
  }
  async function mutate(action: "save_brief"|"share_brief", payload: Record<string,unknown>) {
    const fingerprint = JSON.stringify({ action,payload });
    if (pendingCommand.current && pendingCommand.current.fingerprint !== fingerprint) throw new Error("PENDING_COMMAND_CHANGED");
    pendingCommand.current ??= { fingerprint,requestId:crypto.randomUUID() };
    setCommandOutstanding(true);
    try {
      const response = await command.mutateAsync({ action,payload,requestId:pendingCommand.current.requestId });
      pendingCommand.current = null;
      return response.result;
    } catch (error) {
      if (error instanceof ApiError && [400,403,404,409].includes(error.status)) pendingCommand.current = null;
      throw error;
    } finally {
      setCommandOutstanding(pendingCommand.current !== null);
    }
  }
  const toolLabels: Record<string, [string, string]> = {
    get_my_points: ["積分", "Points"],
    get_my_missions: ["我的任務", "My missions"],
    get_my_mission_requirements: ["任務要求", "Mission requirements"],
    get_my_earnings: ["收益", "Earnings"],
    get_open_missions: ["公開任務", "Open missions"],
    get_my_redemptions: ["兌換記錄", "Redemptions"],
    get_my_notifications: ["通知", "Notifications"],
    get_my_points_history: ["積分紀錄", "Point history"],
    get_my_earnings_history: ["收益紀錄", "Earnings history"],
    get_my_recent_threads: ["近期討論", "Recent discussions"],
  };
  function toolLabel(name: string): [string, string] {
    if (name.startsWith("mcp__")) {
      const parts = name.split("__");
      const skill = parts[parts.length - 1];
      return [`技能 · ${skill}`, `Skill · ${skill}`];
    }
    return toolLabels[name] ?? [name, name];
  }
  async function receive(reply: AssistantReply, sentMessage?: string) {
    setPendingProposals(reply.proposals ?? []);
    setUsedTools(reply.tools_used ?? []);
    if (reply.persistence === "saved") { setInput(""); setPendingChat(null); setEphemeral([]); setFeedback(tx("已保存討論。回覆是建議，任務操作仍需你確認。", "Chat saved. Replies are proposals; you confirm every mission action.")); await client.invalidateQueries({ queryKey:studioKeys.detail(detail.thread.id) }); }
    else if(reply.persistence==="failed" && reply.code==="studio_context_changed") {setPendingChat(null);setFeedback(tx("來源或任務要求已更新，上次尚未開始的要求已取消。文字仍保留；核對後再按送出，會建立新的要求。", "Sources or mission rules changed. The unstarted request was cancelled. Your text is retained; review it and press Send to create a new request."));}
    else if(reply.answer) {
      // Show the generated answer even when the save boundary is unresolved; the durable turn is
      // reconciled through the explicit pending-request check, never by replaying silently.
      setEphemeral(current => current.some(message => message.id === `assistant-${reply.request_id}`) ? current : [...(sentMessage ? [{ id:`user-${reply.request_id}`, role:"user" as const, content:sentMessage }] : []), { id:`assistant-${reply.request_id}`, role:"assistant" as const, content:reply.answer! }]);
      setFeedback(tx("回覆未保存。輸入仍保留；繼續前先確認這個要求。", "Reply not saved. Input retained; confirm this request before continuing."));
    }
    else setFeedback(tx("結果尚未確認。輸入已保留，請查看同一要求。", "Outcome not confirmed. Input retained; check this request."));
  }
  async function send(text = input) {
    const message = text.trim();
    if (!message || chat.isPending) return;
    if (pendingChat && pendingChat.message !== message) { setFeedback(tx("請先查看上一個要求的結果。", "Check the previous request first.")); return; }
    const request = pendingChat ?? { id:crypto.randomUUID(),message }; setPendingChat(request);
    setEphemeral([{ id:"user-" + request.id, role:"user" as const, content: message }]);
    setUsedTools([]);
    try { await receive(await chat.mutateAsync({ message:request.message,conversation_id:detail.thread.conversation_id,client_request_id:request.id }), request.message); }
    catch (error) { if (rejectUnauthorized(error)) return; setFeedback(tx("暫時未能回覆。輸入已保留，也可以直接整理證據與 Brief。", "No reply yet. Your input is safe; you can still work on evidence and a brief.")); }
  }
  useEffect(() => {
    if (!autoSend || sentInitial.current || chat.isPending) return;
    if (detail.messages.length > 0) return;
    const initial = detail.thread.initial_prompt?.trim();
    if (!initial) return;
    sentInitial.current = true;
    void send(initial);
  }, [autoSend, chat.isPending, detail.messages.length, detail.thread.initial_prompt, send]);

  function generate() {
    setCopiedFromVersion(null);
    const sources = activeSources.slice(0,8);
    setSections([
      { id:crypto.randomUUID(),text:tx(`創作方向：${detail.thread.title}\n先用真實體驗交代觀眾想知道的問題。`,`Creative direction: ${detail.thread.title}\nStart with a real experience and the audience's question.`),sourceIds:[] },
      { id:crypto.randomUUID(),text:sources.length ? sources.map(s => `${s.title}：${s.content.slice(0,300)}`).join("\n\n") : tx("補上你想呈現的觀察與例子。未驗證的成效不填數字。","Add your observations and examples. Leave unverified metrics unknown."),sourceIds:sources.map(s => s.id) },
      { id:crypto.randomUUID(),text:tx("拍攝清單\n1. 場景與產品近鏡\n2. 真實體驗與細節\n3. 清楚標示合作關係\n提交前再對照任務要求。","Shot list\n1. Scene and product detail\n2. Honest experience\n3. Clear collaboration disclosure\nCheck the mission requirements before submitting."),sourceIds:[] },
    ]); setSelected([]); setConfirmed(false); setTab("brief"); setFeedback(tx("這是可編輯的整理範本，並非已核實的成效報告。", "This is an editable planning template, not a verified performance report."));
  }
  async function executeProposal(proposal: { kind: "brief"; sections: string[]; token?: string }) {
    if (!proposal.token) return;
    setFeedback("");
    try {
      await apiFetch("/studio/proposals/execute", { method: "POST", body: JSON.stringify({ token: proposal.token, sections: proposal.sections }) });
      setPendingProposals([]);
      setFeedback(tx("已保存私人 Brief。", "Private brief saved."));
      await client.invalidateQueries({ queryKey: studioKeys.detail(detail.thread.id) });
    } catch (error) {
      if (rejectUnauthorized(error)) return;
      setFeedback(tx("未能保存，內容仍保留；請再試一次。", "Could not save; your content is retained. Try again."));
    }
  }

  function applyProposal(proposal: { kind: "brief"; sections: string[] }) {
    setSections(proposal.sections.map(text => ({ id: crypto.randomUUID(), text, sourceIds: [] })));
    setConfirmed(false);
    setPendingProposals([]);
    setTab("brief");
    setFeedback(tx("已套用建議到 Brief 編輯器，請檢視後再保存。", "Proposal applied to the brief editor; review it before saving."));
  }
  async function save() {
    if (command.isPending) return;
    setFeedback("");
    const revision = localRevision.current;
    try { const result = await mutate("save_brief", { threadId:detail.thread.id,revision,sections }); localRevision.current=revision+1; if (result && "sections" in result) setSavedCopy({fingerprint:JSON.stringify(result.sections),revision:revision+1}); setSelected([]); setConfirmed(false); setFeedback(tx("私人 Brief 已保存。下一步選擇要送到任務的段落。", "Private brief saved. Choose the sections to transfer to your mission.")); }
    catch (error) { if (rejectUnauthorized(error)) return; if (error instanceof ApiError && error.status===409) pendingCommand.current=null; setFeedback(tx("未能保存，草稿仍在。若版本有變，先讀取最新版本再確認。", "Save failed; your draft is retained. Review the latest version before retrying.")); }
  }
  async function share() {
    if (!latest || !workItem?.draft || dirty || !confirmed || confirmedKey.current!==confirmationKey || command.isPending) return;
    try { const result = await mutate("share_brief", { threadId:detail.thread.id,revision:detail.thread.revision,briefId:latest.id,sectionIds:selected,submissionId,workItemId,draftRevision:workItem.draft.revision }); setReceipt(result as StudioShare); setConfirmed(false); localRevision.current=detail.thread.revision+1; }
    catch (error) { if (rejectUnauthorized(error)) return; if(error instanceof ApiError && error.status===409) { pendingCommand.current=null; setConfirmed(false); } setFeedback(tx("未能確認轉存。保留草稿，重新檢查來源和任務版本；未增加積分。", "Transfer not confirmed. Check sources and mission version. No points were added.")); }
  }
  return <><div className="s-thread-head"><div><h1>{detail.thread.title}</h1><div className="s-row" style={{marginTop:10}}><span className="s-tag"><LockKeyhole size={13}/>{tx("私人討論", "Private chat")}</span>{activeSources.some(source=>source.integration)&&<span className="s-tag ghost">{tx("含模擬來源 · 未驗證", "Mock sources · unverified")}</span>}</div></div><Sprout small/></div>
    <div className="s-thread-layout"><div className="s-thread-main s-stack"><div className="s-tabs" role="tablist" aria-label={tx("創作步驟", "Creation steps")}>{([["chat","討論","Chat",MessageCircle],["evidence","證據","Evidence",Paperclip],["brief","Brief 與成果","Brief & output",FileText],["skill","技能","Skill",Sparkles]] as const).map(([id,zh,en,Icon]) => <button key={id} role="tab" tabIndex={tab===id?0:-1} onKeyDown={event=>{const ids=["chat","evidence","brief","skill"] as const;const index=ids.indexOf(id);const next=event.key==="ArrowRight"?ids[(index+1)%4]:event.key==="ArrowLeft"?ids[(index+3)%4]:event.key==="Home"?ids[0]:event.key==="End"?ids[3]:null;if(next){event.preventDefault();setTab(next);document.getElementById(`studio-tab-${next}`)?.focus();}}} aria-selected={tab===id} aria-controls={`studio-panel-${id}`} id={`studio-tab-${id}`} onClick={() => setTab(id)}><Icon size={14} style={{display:"inline",marginRight:5}}/>{tx(zh,en)}</button>)}</div>
      {pendingCopyId && <div className="s-note s-stack" role="group" aria-label={tx("保留或替換草稿", "Keep or replace draft")}><p>{tx("還有未保存的修改，要保留嗎？", "You have unsaved changes. Keep them?")}</p><button className="s-btn" onClick={()=>{setPendingCopyId(null);copyTrigger.current?.focus();}}>{tx("保留目前草稿", "Keep current draft")}</button><button className="s-btn" disabled={Boolean(copyDisabled)} onClick={()=>applyCopy(pendingCopyId)}>{tx("以此版本建立草稿", "Use this version as a draft")}</button></div>}
      {feedback && <div role="status" className="s-note">{feedback}</div>}
      {tab==="chat" && <section id="studio-panel-chat" role="tabpanel" aria-labelledby="studio-tab-chat" className="s-stack"><div className="s-chat" aria-busy={chat.isPending}>{detail.messages.length===0 && ephemeral.length===0 && <div className="s-chat-empty"><strong>🌱 {tx("一起把想法變清楚", "Let's make your idea clear")}</strong><span>{tx("先選任務或補上來源；我來整理拍攝方向。", "Pick a mission or add sources; I'll shape the direction.")}</span></div>}{detail.messages.map(m => <div className={`s-bubble ${m.role==="user"?"user":""}`} key={m.id}>{m.content}{m.role==="assistant" && (m.tools?.length ?? 0) > 0 && <><div className="s-row" style={{marginTop:8}} aria-label={tx("已查閱的資料", "Data checked")}>{m.tools!.map(name => { const label = toolLabel(name); return <span className="s-tag ghost" key={name}>{tx(label[0], label[1])}</span>; })}</div><details className="s-why"><summary>{tx("為什麼這個答案？", "Why this answer?")}</summary><p className="s-muted">{tx("已查閱：", "Checked: ")}{m.tools!.map(name => { const label = toolLabel(name); return tx(label[0], label[1]); }).join(" · ")}</p><small>{tx("只顯示工具名稱，不含帳戶資料內容。", "Tool names only; no account data is included.")}</small></details></>}</div>)}{ephemeral.map(m => <div className={`s-bubble ${m.role==="user"?"user":""}`} key={m.id}>{m.content}{m.role==="assistant" && <small style={{display:"block",marginTop:8}}>{tx("未保存 · 建議內容", "Not saved · proposal")}</small>}</div>)}{chat.isPending && <div className="s-bubble s-pending" role="status" aria-live="polite"><span className="s-typing" aria-hidden="true"><i/><i/><i/></span><small>{latestStep ? progressLabel(latestStep, tx) : tx("AI 正在查閱資料與技能…", "Working with your data and skills…")}{elapsed > 0 ? " · " + elapsed + "s" : ""}</small></div>}</div>{usedTools.length>0 && <><div className="s-row" aria-label={tx("已查閱的資料", "Data checked")}>{usedTools.map(name => { const label = toolLabel(name); return <span className="s-tag ghost" key={name}>{tx(label[0], label[1])}</span>; })}</div><details className="s-why"><summary>{tx("為什麼這個答案？", "Why this answer?")}</summary><p className="s-muted">{tx("已查閱：", "Checked: ")}{usedTools.map(name => { const label = toolLabel(name); return tx(label[0], label[1]); }).join(" · ")}</p><small>{tx("只顯示工具名稱，不含帳戶資料內容。", "Tool names only; no account data is included.")}</small></details></>}{pendingProposals.map((proposal, index) => <article className="s-card s-stack" key={`${index}-${proposal.sections[0]?.slice(0, 12)}`}><div className="s-between"><h2>{tx("建議的私人 Brief", "Proposed private brief")}</h2><span className="s-tag ghost">{tx("未保存", "Not saved")}</span></div><ol style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 6 }}>{proposal.sections.map((section, sectionIndex) => <li key={sectionIndex}>{section}</li>)}</ol><div className="s-row">{proposal.token ? <button type="button" className="s-btn s-primary" onClick={() => void executeProposal(proposal)}>{tx("確認並保存私人 Brief", "Confirm and save private brief")}</button> : null}<button type="button" className="s-btn" onClick={() => applyProposal(proposal)}>{tx("套用到 Brief 編輯器", "Apply to brief editor")}</button><button type="button" className="s-btn" onClick={() => setPendingProposals(current => current.filter((_, currentIndex) => currentIndex !== index))}>{tx("忽略", "Dismiss")}</button></div><small>{tx("不會自動保存；你仍可在 Brief 分頁檢查及保存。", "Nothing is saved automatically; review and save from the Brief tab.")}</small></article>)}<form className="s-ask" onSubmit={e => {e.preventDefault();void send();}}><label htmlFor="thread-question">{tx("繼續討論", "Continue the conversation")}</label><textarea id="thread-question" value={input} maxLength={4000} onChange={e=>setInput(e.target.value)} placeholder={tx("我想拍一段…", "I would like to create…")}/><div className="s-ask-footer"><button type="button" className="s-btn" onClick={()=>setTab("evidence")}><Paperclip size={15}/>{tx("選擇來源", "Sources")}</button><button className="s-btn s-primary" disabled={!input.trim() || chat.isPending}><Send size={16}/>{chat.isPending ? tx("等待回覆…", "Waiting…") : tx("送出", "Send")}</button></div></form><p className="s-ask-note">{tx("回覆是建議，不會執行任務操作。", "Replies are proposals; no mission action is taken.")}</p>{pendingChat && <button className="s-btn" onClick={async()=>{try{await receive(await apiFetch<AssistantReply>(`/assistant/requests/${pendingChat.id}`), pendingChat.message);}catch(error){if(rejectUnauthorized(error))return;setFeedback(tx("尚未取得結果，請稍後再試。", "No result yet. Try again later."));}}}>{tx("查看上次要求結果", "Check last request")}</button>}</section>}
      {tab==="evidence" && <section id="studio-panel-evidence" role="tabpanel" aria-labelledby="studio-tab-evidence" className="s-stack"><div className="s-between"><div><h2>{tx("每個建議，都有出處", "Know what supports your idea")}</h2><p className="s-muted">{tx("手動與模擬內容均標示未驗證；地區和語言依實際來源顯示。", "Manual and mock evidence stay unverified; coverage follows each source.")}</p></div><button className="s-btn" onClick={()=>setSourceOpen(!sourceOpen)}>＋ {tx("加入來源", "Add source")}</button></div>{sourceOpen && <SourceForm onLoginRequired={onLoginRequired} threadId={detail.thread.id} revision={detail.thread.revision} onSaved={()=>{setSourceOpen(false);localRevision.current=detail.thread.revision+1;}}/>}
        <IntegrationSourcePanel onLoginRequired={onLoginRequired} threadId={detail.thread.id} revision={detail.thread.revision} onImported={()=>{localRevision.current=detail.thread.revision+1;setSelected([]);setConfirmed(false);}}/><StudioSkillSummary/>
        {detail.sources.map(s=><article className="s-source s-stack" key={s.id}><div className="s-between"><h3>{s.title}</h3><span className="s-tag ghost">{s.revoked_at?tx("已撤銷", "Revoked"):tx("未驗證", "Unverified")}</span></div><p className="s-muted">{s.question}</p><small>{s.platform} · {new Intl.DateTimeFormat("zh-HK",{dateStyle:"medium",timeStyle:"short",timeZone:"Asia/Hong_Kong"}).format(new Date(s.observed_at))} HKT · {s.region??tx("地區未知", "Region unknown")} / {s.language??tx("語言未知", "Language unknown")}{s.integration&&` · ${s.integration.source_version} · ${s.integration.sample_only ? tx("模擬", "Mock") : tx("平台來源", "Provider source")}${s.integration.evidence ? ` · API ${s.integration.evidence.apiVersion} · ${tx("指標期間", "Measurement period")}: ${s.integration.evidence.measurementPeriod}` : ""}`}</small><details><summary>{tx("展開來源內容", "Expand source")}</summary><p style={{whiteSpace:"pre-wrap"}}>{s.content}</p>{s.url && <a href={s.url} target="_blank" rel="noreferrer" className="s-btn">{tx("原始連結", "Original source")}</a>}</details><div className="s-between"><span className="s-tag">{s.shareable?tx("已聲明有分享權", "Sharing rights declared"):tx("只限私人整理", "Private use only")}</span>{!s.revoked_at && <RevokeSource onLoginRequired={onLoginRequired} detail={detail} sourceId={s.id} onRevoked={()=>{setSections(current=>current.filter(section=>!section.sourceIds.includes(s.id)));localRevision.current=detail.thread.revision+1;setSelected([]);setConfirmed(false);setFeedback(tx("已撤銷來源，並移除編輯草稿中由它產生的整段內容。先前已轉存的副本仍保留在任務記錄。", "Source revoked and derived draft paragraphs removed. Previously transferred copies remain in the mission record."));}}/>}</div></article>)}{!detail.sources.length && <div className="s-empty">{tx("加入任務要求、公開連結或你自己的觀察，讓 Brief 有依據。", "Add a requirement, public link or your own observation to support your brief.")}</div>}<button className="s-btn s-primary" onClick={generate}>{tx("從這些來源整理 Brief", "Build a brief from these sources")}</button></section>}
      {tab==="brief" && <section id="studio-panel-brief" role="tabpanel" aria-labelledby="studio-tab-brief" className="s-stack"><div className="s-between"><h2 ref={briefHeading} tabIndex={-1}>{tx("你的拍攝 Brief", "Your shooting brief")}</h2><span className="s-tag">{copiedFromVersion !== null ? tx(`由 v${copiedFromVersion} 複製 · ${dirty ? "未保存" : "已保存"} · 私人`, `Copied from v${copiedFromVersion} · ${dirty ? "Unsaved" : "Saved"} · Private`) : `${latest ? `v${latest.version}` : tx("未保存", "Unsaved")} · ${tx("私人", "Private")}`}</span></div><p className="s-muted">{tx("內容可編輯。來源標記跟隨整段文字；移除來源須重建相關段落。", "Edit freely. Sources stay attached to each paragraph; removing a source requires rebuilding that paragraph.")}</p>{sections.length===0 && <button className="s-btn s-lime-btn" onClick={generate}>{tx("建立拍攝範本", "Create a shooting outline")}</button>}{sections.map((section,i)=><div className="s-brief-section" key={section.id}><label htmlFor={`brief-${section.id}`}>{tx("段落", "Section")} {i+1}</label><textarea id={`brief-${section.id}`} maxLength={3000} value={section.text} onChange={e=>{setSections(current=>current.map(s=>s.id===section.id?{...s,text:e.target.value}:s));setConfirmed(false);}}/><div className="s-row">{section.sourceIds.length?section.sourceIds.map(id=><span className="s-tag ghost" key={id}>📎 {detail.sources.find(s=>s.id===id)?.title ?? tx("來源未提供", "Source unavailable")}</span>):<small>{tx("創作者自訂內容／構思，並非已驗證數據", "Creator-authored idea, not verified data")}</small>}</div><button className="s-btn" onClick={()=>{setSections(current=>current.filter(s=>s.id!==section.id));setConfirmed(false);}}>{tx("移除此段", "Remove section")}</button></div>)}<div className="s-safe-actions"><button className="s-btn" disabled={sections.length>=12} onClick={()=>setSections(current=>[...current,{id:crypto.randomUUID(),text:"",sourceIds:[]}])}>＋ {tx("加入自己的構思", "Add my own idea")}</button><button className="s-btn s-primary" disabled={!sections.length || sections.some(s=>!s.text.trim()) || command.isPending || !dirty} onClick={()=>void save()}><LockKeyhole size={15}/>{tx("保存私人 Brief", "Save private brief")}</button></div>
        {detail.thread.revision!==localRevision.current && <div className="s-note">{tx("記錄已有更新。編輯內容仍保留，先核對最新版本再保存。", "The record changed. Your draft is retained; review the latest version before saving.")}<button className="s-btn" disabled={Boolean(copyDisabled)} onClick={()=>{if(pendingCommand.current)return;localRevision.current=detail.thread.revision;setFeedback(tx("已確認最新記錄；你可保存目前的編輯版本。", "Latest record acknowledged; you may save your current edit."));}}>{tx("已核對最新版本", "I reviewed the latest version")}</button></div>}
        {latest && <div className="s-card lilac s-stack"><h2>{tx("只把你選的內容送到任務", "Transfer only what you choose")}</h2><p className="s-muted">{tx("接收對象：這個任務的審核工作人員。這一步會更新原有任務草稿；提交仍需在任務頁確認。", "Recipient: this mission's reviewers. This updates the original task draft; submission is confirmed on the mission page.")}</p>{dirty && <span className="s-tag peach">{tx("先保存修改，再確認分享", "Save changes before confirming")}</span>}{latest.sections.map((section,i)=><label className="s-check" key={section.id}><input type="checkbox" checked={selected.includes(section.id)} disabled={dirty} onChange={e=>{setSelected(current=>e.target.checked?[...current,section.id]:current.filter(id=>id!==section.id));setConfirmed(false);}}/><span>{tx("段落", "Section")} {i+1} · {section.text.slice(0,100)}</span></label>)}
          <label>{tx("選擇已接任務", "Choose an accepted mission")}<select value={submissionId} onChange={e=>{setSubmissionId(e.target.value);setWorkItemId("");setConfirmed(false);}}><option value="">{tx("請選擇", "Choose a mission")}</option>{my.data?.filter(m=>m.creator_workflow_mode==="active_workspace" || m.missions.creator_workflow_mode==="active_workspace").map(m=><option key={m.id} value={m.id}>{m.missions.title}</option>)}</select></label>
          {workspace.data && <label>{tx("選擇交付項目", "Choose a deliverable")}<select value={workItemId} onChange={e=>{setWorkItemId(e.target.value);setConfirmed(false);}}><option value="">{tx("請選擇", "Choose a deliverable")}</option>{workspace.data.workItems.map(i=><option key={i.id} value={i.id} disabled={!i.draft || !["drafting","revision_requested"].includes(i.state)}>{i.title}</option>)}</select></label>}
          {(my.isError||workspace.isError) && <StudioError/>}{shareError && <StudioError>{tx("所選段落含私人、已撤銷或未提供的來源。請取消該整段，或先重建內容並取得來源分享權。", "Selected sections use private, revoked or unavailable sources. Exclude the whole section or rebuild it with shareable sources.")}</StudioError>}{preview && <div><h3>{tx("送出內容預覽", "Transfer preview")}</h3><pre className="s-share-preview">{preview}</pre></div>}<label className="s-check"><input type="checkbox" checked={confirmed && confirmedKey.current===confirmationKey} onChange={e=>{setConfirmed(e.target.checked);confirmedKey.current=confirmationKey;}} disabled={Boolean(shareError)||!preview||dirty||!workItem?.draft}/><span>{tx("我已檢查所選內容與來源分享權，確認此版本可供任務審核。", "I reviewed these sections and source sharing rights, and approve this version for task review.")}</span></label><button className="s-btn s-primary" disabled={!confirmed||confirmedKey.current!==confirmationKey||Boolean(shareError)||dirty||!workItem?.draft||command.isPending} onClick={()=>void share()}><Check size={16}/>{tx("存入原任務草稿", "Save into mission draft")}</button><small>{tx("舊版任務仍使用原有提交入口；不會自動轉換工作流。", "Legacy missions keep their original submission entry; workflows are not converted.")}</small><Link to="/my" className="s-btn">{tx("開啟所有原有任務", "Open all original missions")}</Link></div>}
        {receipt && <div role="status" className="s-achievement"><strong>✓ {tx("已保存到原任務", "Saved to the original mission")}</strong><p>{tx("現在可以核對要求、上載作品並提交。尚未發放獎勵。", "Now review requirements, upload your work and submit. No reward has been issued yet.")}</p><Link className="s-btn s-primary" to="/my/$submissionId" params={{submissionId:receipt.submission_id}}>{tx("前往任務核對並提交", "Review & submit in mission")}</Link><small>{tx("回執", "Receipt")}: {receipt.id} · {tx("草稿版本", "Draft revision")} {receipt.draft_revision}</small></div>}
      </section>}
      <div hidden={tab !== "skill"} id="studio-panel-skill" role="tabpanel" aria-labelledby="studio-tab-skill" className="s-stack"><GrowthImageWorkspaceEntry threadId={detail.thread.id} identityKey={identityKey} skillId={skill ?? "image_diagnosis"} onChooseImage={()=>undefined} onDescribeImage={()=>undefined} onSaveDraft={()=>undefined} onOpenBrief={()=>setTab("brief")} onDirtyChange={setGrowthDirty}/></div>
    </div><aside className="s-thread-aside"><div className="s-card mint s-stack"><h3>🌱 {tx("先做好一份作品", "One good creation at a time")}</h3><p className="s-aside-flow">{tx("對話 → 證據 → Brief → 確認分享 → 原任務提交", "Chat → Evidence → Brief → Confirm → Original submission")}</p></div>{workspace.data && <StudioProgress state={workspace.data.workflow.state} reward={workspace.data.pendingReward?.status}/>}<div className="s-card s-stack"><h3>{tx("來源與帳號", "Sources & accounts")}</h3><p className="s-muted">{activeSources.length} {tx("項來源 · 未驗證", "sources · unverified")}</p><Link className="s-btn" to="/connections">{tx("查看資料技能", "View data skills")}</Link></div><SavedOutputCards threadId={detail.thread.id} briefs={detail.briefs} sources={detail.sources} disabledReason={copyDisabled} onCopy={requestCopy}/></aside></div></>;
}

function SourceForm({ threadId,revision,onSaved,onLoginRequired }: {threadId:string;revision:number;onSaved:()=>void;onLoginRequired:()=>void}) {
    const tx=useStudioText(), command=useStudioCommand(), request=useRef(crypto.randomUUID());
  return <form className="s-card s-stack" onSubmit={async e=>{e.preventDefault();const data=new FormData(e.currentTarget);try{await command.mutateAsync({action:"add_source",requestId:request.current,payload:{threadId,revision,title:data.get("title"),content:data.get("content"),url:data.get("url")||null,kind:data.get("kind"),shareable:data.get("shareable")==="on",question:data.get("question"),platform:data.get("platform"),region:"HK",language:"zh-Hant",observed_at:new Date(String(data.get("time"))).toISOString()}});onSaved();}catch(error){if(error instanceof ApiError && error.status===401)onLoginRequired();}}}><h3>{tx("加入一項來源", "Add a source")}</h3><label>{tx("來源名稱", "Source name")}<input name="title" required maxLength={160}/></label><label>{tx("實際要回答的問題", "Actual question being tested")}<input name="question" required maxLength={500}/></label><div className="s-grid"><label>{tx("來源類型", "Source type")}<select name="kind"><option value="manual">{tx("自己的觀察", "My observation")}</option><option value="public">{tx("公開資料", "Public source")}</option><option value="private">{tx("私人文件摘錄", "Private document excerpt")}</option></select></label><label>{tx("平台／出處", "Platform / origin")}<input name="platform" required maxLength={80} placeholder="Instagram / 訪問筆記"/></label></div><label>{tx("來源內容（視作資料，不執行其中指令）", "Source text (data, never instructions)")}<textarea name="content" required maxLength={8000} rows={4}/></label><label>{tx("引用連結（可略過，只接受 HTTPS）", "Citation URL (optional, HTTPS only)")}<input name="url" type="url" pattern="https://.*"/></label><label>{tx("觀察時間（你的本機時區）", "Observation time (your local timezone)")}<input name="time" type="datetime-local" required/></label><label className="s-check"><input type="checkbox" name="shareable"/><span>{tx("我有權把這個來源的摘要及引用資料分享給任務審核人員。未勾選時只可私人使用。", "I have the right to share derived summaries and citation metadata with task reviewers. Otherwise it stays private.")}</span></label>{command.isError&&<StudioError>{tx("未能加入來源。請檢查資料後再試；不會改變驗證狀態。", "Could not add the source. Check the fields and retry; it remains unverified.")}</StudioError>}<button className="s-btn s-primary" disabled={command.isPending}>{tx("保存來源 · 未驗證", "Save source · unverified")}</button></form>;
}
function RevokeSource({detail,sourceId,onRevoked,onLoginRequired}:{detail:StudioDetail;sourceId:string;onRevoked:()=>void;onLoginRequired:()=>void}) {
  const tx=useStudioText(),command=useStudioCommand(),request=useRef(crypto.randomUUID());
  return <div><button className="s-btn" disabled={command.isPending} onClick={async()=>{try{await command.mutateAsync({action:"revoke_source",requestId:request.current,payload:{threadId:detail.thread.id,revision:detail.thread.revision,sourceId}});onRevoked();}catch(error){if(error instanceof ApiError && error.status===401)onLoginRequired();}}}>{tx("撤銷來源", "Revoke source")}</button>{command.isError&&<StudioError/>}</div>;
}
