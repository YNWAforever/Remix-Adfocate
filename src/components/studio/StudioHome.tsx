import { useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, Send, Sparkles } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useBalance, useMe, useMissions } from "@/lib/queries/kocmax";
import { progressToNext } from "@/lib/levels";
import { apiFetch } from "@/lib/api";
import { STUDIO_THREADS } from "@/lib/features";
import { STUDIO_TEMPLATES } from "@/lib/studio/templates";
import { useStudioCommand, useStudioThreads } from "@/lib/studio/queries";
import type { StudioThread, StudioTopic } from "@/lib/studio/types";
import { Sprout, StudioError, useStudioText } from "./StudioPrimitives";

export function StudioHome() {
  const tx = useStudioText(), me = useMe(), balance = useBalance();
  const progress = me.data ? progressToNext(me.data.xp) : null;
  return <div className="s-stack"><section className="s-stats" aria-label={tx("你的成長紀錄", "Your progress")}>
    <div className="s-stat"><small>{tx("創作者等級", "Creator level")}</small><strong>🌱 {me.data?.level ?? "—"}</strong><small>{tx("按已核實成果成長", "Grow through verified work")}</small></div>
    <div className="s-stat"><small>{tx("經驗值", "Experience")}</small><strong>{me.data ? `${me.data.xp.toLocaleString()} XP` : "—"}</strong>{progress && <progress value={progress.pct} max={100} aria-label={tx("升級進度", "Level progress")}/>}</div>
    <Link to="/wallet" className="s-stat"><small>{tx("可用積分", "Available points")}</small><strong>✦ {balance.data ? balance.data.balance.toLocaleString() : "—"}</strong><small>{balance.isError ? tx("暫時無法讀取", "Unavailable") : tx("以帳本入帳為準", "Confirmed ledger balance")}</small></Link>
    <div className="s-stat"><small>{tx("連續登入", "Visit streak")}</small><strong>☀ {tx("未提供", "Unavailable")}</strong><small>{tx("休息不扣分", "No penalty for breaks")}</small></div>
  </section>
  {me.isError && <StudioError onRetry={() => void me.refetch()}/>}
  <div className="s-home-grid"><div className="s-stack"><div className="s-between s-welcome"><div><span className="s-eyebrow">YOUR NEXT LITTLE WIN</span><h1>{tx("今天，想創作些甚麼？", "What will you create today?")}</h1><p>{tx("問一句，我們一起把靈感變成成果。", "Ask a question. Turn your idea into something real.")}</p></div><Sprout/></div>
    {STUDIO_THREADS ? <StudioStarter/> : <div className="s-card"><h2>{tx("先挑一個任務開始", "Start with a mission")}</h2><p>{tx("工作室對話尚未開放，你仍可完成所有原有任務。", "Studio chat is not enabled yet. All missions remain available.")}</p><Link className="s-btn s-primary" to="/mission">{tx("找任務", "Find missions")}</Link></div>}
  </div><aside className="s-stack"><NextMissionCards/>{STUDIO_THREADS && <RecentThreads/>}<div className="s-card peach s-stack"><div className="s-row"><span className="s-task-icon">🎁</span><h3>{tx("下一份小獎賞", "Your next little reward")}</h3></div><p className="s-muted">{tx("清楚知道所需積分，再選喜歡的獎賞。沒有隨機抽獎。", "See the points needed and choose a reward. No random draws.")}</p><Link to="/redemption" className="s-btn">{tx("逛逛獎賞商店", "Explore rewards")}<ArrowRight size={16}/></Link></div></aside></div></div>;
}

export function StudioStarter() {
  const tx = useStudioText(), navigate = useNavigate(), missions = useMissions();
  const [prompt, setPrompt] = useState(""), [missionId, setMissionId] = useState(""), [topic, setTopic] = useState<StudioTopic>("creation");
  const command = useStudioCommand<StudioThread>();
  const intent = useRef<{ fingerprint: string; id: string } | null>(null);
  async function start(text = prompt, selectedTopic = topic) {
    if (!text.trim() || command.isPending) return;
    const payload = { title: [...text.trim()].slice(0, 100).join(""), initialPrompt: text.trim(), topic: selectedTopic, missionId: missionId || null };
    const fingerprint = JSON.stringify(payload);
    if (intent.current && intent.current.fingerprint !== fingerprint) { intent.current = null; }
    intent.current ??= { fingerprint, id: crypto.randomUUID() };
    try { const response = await command.mutateAsync({ action: "create_thread", requestId: intent.current.id, payload });
      void navigate({ to: "/studio", search: { thread: response.result.id } });
    } catch { /* Preserve input and request UUID for an explicit retry. */ }
  }
  return <div className="s-stack"><form className="s-ask" onSubmit={e => { e.preventDefault(); void start(); }}><label htmlFor="studio-question" className="sr-only">{tx("想問甚麼？", "What would you like to ask?")}</label><textarea id="studio-question" value={prompt} maxLength={4000} onChange={e => setPrompt(e.target.value)} placeholder={tx("例如：幫我把這個試飲任務變成一段 30 秒短片…", "Help me turn this tasting mission into a 30-second video…")}/><div className="s-grid" style={{ marginBottom: 14 }}><label><small>{tx("任務上下文（可略過）", "Mission context (optional)")}</small><select value={missionId} onChange={e => setMissionId(e.target.value)}><option value="">{tx("先自由討論", "Start a free chat")}</option>{missions.data?.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}</select></label><label><small>{tx("討論主題", "Topic")}</small><select value={topic} onChange={e => setTopic(e.target.value as StudioTopic)}><option value="creation">{tx("內容創作", "Creation")}</option><option value="missions">{tx("接任務", "Missions")}</option><option value="performance">{tx("成效檢討", "Performance")}</option><option value="rewards">{tx("積分與獎賞", "Rewards")}</option></select></label></div><div className="s-ask-footer"><small>🔒 {tx("討論預設私人", "Private by default")}</small><button className="s-btn s-primary" disabled={!prompt.trim() || command.isPending}><Send size={16}/>{command.isPending ? tx("準備中…", "Starting…") : tx("開始討論", "Start chatting")}</button></div></form>
    {command.isError && <StudioError>{tx("未確認建立成功。輸入已保留，再按開始會查看同一要求。", "Creation is not confirmed. Your input is retained; retry uses the same request.")}</StudioError>}
    <div className="s-between"><h2>{tx("不知道從哪開始？挑一張卡", "Pick a starting point")}</h2><span className="s-tag">10 {tx("個靈感", "ideas")}</span></div>
    <div className="s-grid">{STUDIO_TEMPLATES.map(card => <button key={card.id} className="s-task" disabled={command.isPending} onClick={() => { setPrompt(tx(...card.prompt)); setTopic(card.topic); document.getElementById("studio-question")?.focus(); }}><div className="s-task-icon" aria-hidden>{card.icon}</div><h3>{tx(...card.title)}</h3><p>{tx(...card.prompt)}</p><div className="s-row"><span className="s-tag ghost">{tx(...card.difficulty)}</span><span className="s-tag ghost">{card.minutes} {tx("分鐘", "min")}</span><span className="s-tag">{tx("積分按任務", "Mission points")}</span></div></button>)}</div><small>{tx("範本不另發分。任務卡上的獎勵須經核實及結算；時間為整理內容的估算。", "Templates do not award extra points. Mission rewards require verification and settlement. Times are planning estimates.")}</small></div>;
}
function NextMissionCards() {
  const tx = useStudioText(), missions = useMissions();
  return <section className="s-card mint s-stack"><div className="s-row"><Sparkles size={20}/><h3>{tx("今日可以前進一小步", "A small step for today")}</h3></div>{missions.isPending ? <p role="status">{tx("正在找任務…", "Loading missions…")}</p> : missions.isError ? <StudioError onRetry={() => void missions.refetch()}/> : missions.data?.slice(0, 2).map(m => <Link key={m.id} to="/mission/$missionSlug" params={{ missionSlug: m.slug }} className="s-source"><h3>{m.title}</h3><span className="s-tag mint">✦ {m.points_reward} {tx("積分 · 核實後", "points · after verification")}</span></Link>)}{missions.data?.length === 0 && <p>{tx("暫時沒有開放任務。先整理下一個靈感吧。", "No open missions. Plan your next idea meanwhile.")}</p>}<Link to="/campaigns" className="s-btn">{tx("每週挑戰與限時活動", "Weekly challenges & events")}</Link></section>;
}
function RecentThreads() {
  const tx = useStudioText(), threads = useStudioThreads();
  const badges = useQuery({ queryKey: ["studio", "badges"], queryFn: () => apiFetch<{ badges: Array<{ id: string }> }>("/studio/badges") });
  return <section className="s-card s-stack"><h3>{tx("接著上次的靈感", "Pick up where you left off")}</h3>{threads.data?.threads.slice(0, 3).map(thread => <Link key={thread.id} to="/studio" search={{ thread: thread.id }} className="s-btn">{thread.title}</Link>)}{threads.data?.threads.length === 0 && <p className="s-muted">{tx("第一段討論，從你的一句話開始。", "Your first chat starts with one question.")}</p>}{threads.isError && <StudioError onRetry={() => void threads.refetch()}/>}<Link to="/studio" className="s-btn">{tx("所有討論與成果", "All chats & briefs")}</Link>{badges.data?.badges.length ? <div className="s-achievement">🏅 {tx("第一份核實成果", "First verified creation")}</div> : null}</section>;
}
