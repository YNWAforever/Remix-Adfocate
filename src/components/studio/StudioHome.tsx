import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Send } from "lucide-react";
import { useBalance, useMe, useMissions } from "@/lib/queries/kocmax";
import { ApiError } from "@/lib/api";
import { STUDIO_THREADS } from "@/lib/features";
import { STUDIO_TEMPLATES } from "@/lib/studio/templates";
import { useStudioCommand, useStudioThreads } from "@/lib/studio/queries";
import { useI18n } from "@/lib/i18n";
import { trackActivationEvent } from "@/lib/activationAnalytics";
import type { StudioThread, StudioTopic } from "@/lib/studio/types";
import type { GrowthSkillId } from "@/lib/creatorGrowth/skillManifest";
import { GROWTH_SKILLS } from "@/lib/creatorGrowth/skillManifest";
import { GrowthSkillCards } from "./GrowthSkillCards";
import { StudioContinueCard } from "./StudioContinueCard";
import { StudioRecentThreads } from "./StudioRecentThreads";
import { StudioRewardCard } from "./StudioRewardCard";
import { StudioStats } from "./StudioStats";
import { StudioTodayStep } from "./StudioTodayStep";
import { Sprout, StudioError, StudioLoginRequired, useStudioText } from "./StudioPrimitives";

export function StudioHome() {
  const tx = useStudioText(), me = useMe(), balance = useBalance();
  const history = useStudioThreads(0, STUDIO_THREADS);
  const [loginRequired, setLoginRequired] = useState(false);
  const sessionQueries = STUDIO_THREADS ? [me, balance, history] : [me, balance];
  const readLoginRequired = sessionQueries.some(query => query.isError && query.error instanceof ApiError && query.error.status === 401);
  // A later refetch failure must not uncover cached data after a 401.
  useEffect(() => { if (readLoginRequired) setLoginRequired(true); }, [readLoginRequired]);
  if (loginRequired || readLoginRequired) return <StudioLoginRequired/>;
  return <div className="s-stack">
    <StudioStats me={me} balance={balance}/>
    {me.isError && <StudioError onRetry={() => void me.refetch()}/>}
    <div className="s-home-grid">
      <div className="s-stack">
        <div className="s-between s-welcome">
          <div>
            <span className="s-eyebrow">YOUR NEXT LITTLE WIN</span>
            <h1>{tx("今天，想創作些甚麼？", "What will you create today?")}</h1>
            <p>{tx("問一句，我們一起把靈感變成成果。", "Ask a question. Turn your idea into something real.")}</p>
          </div>
          <Sprout/>
        </div>
        <StudioContinueCard/>
        {STUDIO_THREADS
          ? <StudioStarter onLoginRequired={() => setLoginRequired(true)}/>
          : <div className="s-card">
              <h2>{tx("先挑一個任務開始", "Start with a mission")}</h2>
              <p>{tx("工作室對話尚未開放，你仍可完成所有原有任務。", "Studio chat is not enabled yet. All missions remain available.")}</p>
              <Link className="s-btn s-primary" to="/mission">{tx("找任務", "Find missions")}</Link>
            </div>}
      </div>
      <aside className="s-stack">
        <StudioTodayStep/>
        {STUDIO_THREADS && <StudioRecentThreads/>}
        <StudioRewardCard/>
      </aside>
    </div>
  </div>;
}

type TemplateDraft = { prompt: string; topic: StudioTopic; skill: GrowthSkillId | null };

export function StudioStarter({ onLoginRequired }: { onLoginRequired?: () => void } = {}) {
  const tx = useStudioText(), navigate = useNavigate(), missions = useMissions();
  const { lang } = useI18n();
  const [prompt, setPrompt] = useState(""), [missionId, setMissionId] = useState(""), [topic, setTopic] = useState<StudioTopic>("creation");
  const [selectedSkill, setSelectedSkill] = useState<GrowthSkillId | null>(null);
  const [showAllTemplates, setShowAllTemplates] = useState(false);
  const [appliedTemplate, setAppliedTemplate] = useState<string | null>(null);
  const draftBeforeTemplate = useRef<TemplateDraft | null>(null);
  const command = useStudioCommand<StudioThread>();
  const intent = useRef<{ fingerprint: string; id: string } | null>(null);
  const [loginRequired, setLoginRequired] = useState(false);
  const questionRef = useRef<HTMLTextAreaElement>(null);
  const focusQuestion = () => questionRef.current?.focus({ preventScroll: true });

  async function start(text = prompt, selectedTopic = topic) {
    if (!text.trim() || command.isPending || loginRequired) return;
    const payload = { title: [...text.trim()].slice(0, 100).join(""), initialPrompt: text.trim(), topic: selectedTopic, missionId: missionId || null };
    const fingerprint = JSON.stringify(payload);
    if (intent.current && intent.current.fingerprint !== fingerprint) { intent.current = null; }
    intent.current ??= { fingerprint, id: crypto.randomUUID() };
    try { const response = await command.mutateAsync({ action: "create_thread", requestId: intent.current.id, payload });
      void navigate({ to: "/studio", search: { thread: response.result.id, send: true, ...(selectedSkill ? { skill: selectedSkill } : {}) } });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        intent.current = null;
        setLoginRequired(true);
        onLoginRequired?.();
      }
      // Transient failures retain input and request UUID for an explicit retry.
    }
  }

  function chooseSkill(skillId: GrowthSkillId) {
    const skill = GROWTH_SKILLS.find((candidate) => candidate.id === skillId);
    if (!skill) return;
    const prompts: Record<GrowthSkillId, [string, string]> = {
      image_diagnosis: [
        "幫我看這張圖，指出構圖、文字和可改善的地方。",
        "Review this image for composition, visible text and improvements.",
      ],
      post_review: [
        "幫我檢討這篇貼文；缺少的數字要清楚標示。",
        "Review this post and clearly mark unavailable metrics.",
      ],
      next_caption: [
        "根據這張圖，替我整理一篇真實、不誇大的下一篇文案。",
        "Draft a truthful next-post caption from this image.",
      ],
      next_growth_step: [
        "根據已確認的檢討，安排下一步可以實行的成長行動。",
        "Turn confirmed findings into one practical next growth step.",
      ],
    };
    setSelectedSkill(skillId);
    setAppliedTemplate(null);
    setPrompt(tx(...prompts[skillId]));
    setTopic(skillId === "post_review" || skillId === "next_growth_step" ? "performance" : "creation");
    focusQuestion();
  }

  function applyTemplate(template: (typeof STUDIO_TEMPLATES)[number]) {
    draftBeforeTemplate.current ??= { prompt, topic, skill: selectedSkill };
    setSelectedSkill(null);
    setPrompt(tx(...template.prompt));
    setTopic(template.topic);
    setAppliedTemplate(template.id);
    trackActivationEvent("template_applied", { locale: lang, templateId: template.id, topic: template.topic });
    focusQuestion();
  }

  function undoTemplate() {
    const draft = draftBeforeTemplate.current;
    draftBeforeTemplate.current = null;
    setAppliedTemplate(null);
    if (!draft) return;
    setPrompt(draft.prompt);
    setTopic(draft.topic);
    setSelectedSkill(draft.skill);
    focusQuestion();
  }

  const selected = GROWTH_SKILLS.find((skill) => skill.id === selectedSkill);
  if (loginRequired) return <StudioLoginRequired/>;
  return <div className="s-stack">
    <form className="s-ask" onSubmit={event => { event.preventDefault(); void start(); }}>
      <label htmlFor="studio-question" className="sr-only">{tx("想問甚麼？", "What would you like to ask?")}</label>
      <textarea
        id="studio-question"
        ref={questionRef}
        value={prompt}
        maxLength={4000}
        onChange={event => { setPrompt(event.target.value); if (appliedTemplate) setAppliedTemplate(null); }}
        onKeyDown={event => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void start(); } }}
        placeholder={tx("例如：幫我把這個試飲任務變成一段 30 秒短片…", "Help me turn this tasting mission into a 30-second video…")}
      />
      <div className="s-grid" style={{ marginBottom: 14 }}>
        <label><small>{tx("任務（可選）", "Mission (optional)")}</small><select value={missionId} onChange={event => setMissionId(event.target.value)}><option value="">{tx("先自由討論", "Start a free chat")}</option>{missions.data?.map(mission => <option key={mission.id} value={mission.id}>{mission.title}</option>)}</select></label>
        <label><small>{tx("主題", "Topic")}</small><select value={topic} onChange={event => setTopic(event.target.value as StudioTopic)}><option value="creation">{tx("內容創作", "Creation")}</option><option value="missions">{tx("接任務", "Missions")}</option><option value="performance">{tx("成效檢討", "Performance")}</option><option value="rewards">{tx("積分與獎賞", "Rewards")}</option></select></label>
      </div>
      <div className="s-ask-footer">
        <small>🔒 {tx("討論預設私人", "Private by default")}</small>
        {prompt.length > 3600 && <small aria-live="polite">{prompt.length}/4000</small>}
        <button className="s-btn s-primary" disabled={!prompt.trim() || command.isPending}><Send size={16}/>{command.isPending ? tx("準備中…", "Starting…") : tx("開始討論", "Start chatting")}</button>
      </div>
    </form>
    {command.isError && <StudioError>{tx("未確認建立成功。輸入已保留，再按開始會查看同一要求。", "Creation is not confirmed. Your input is retained; retry uses the same request.")}</StudioError>}
    <GrowthSkillCards onChooseSkill={chooseSkill} selectedSkillId={selectedSkill} disabled={command.isPending}/>
    {selected && <div className="s-growth-selection" aria-live="polite"><span className="s-tag">{tx("已選技能", "Selected skill")}</span><div><h3>{tx(selected.titleZh, selected.titleEn)}</h3><p>{tx("只套用在這段討論。", "Applies to this chat only.")}</p></div><div className="s-growth-selection-actions"><span className="s-tag ghost">{selected.estimatedMinutes} {tx("分鐘", "min")}</span><button type="button" className="s-btn" onClick={() => setSelectedSkill(null)}>{tx("一般討論", "General chat")}</button></div></div>}
    <div className="s-between">
      <div>
        <span className="s-eyebrow">MORE WAYS TO BEGIN</span>
        <h2>{tx("更多提問靈感", "More ways to begin")}</h2>
      </div>
      {appliedTemplate ? <button type="button" className="s-btn" onClick={undoTemplate}>{tx("還原", "Undo")}</button> : null}
    </div>
    <div className="s-grid">
      {STUDIO_TEMPLATES.slice(0, showAllTemplates ? STUDIO_TEMPLATES.length : 4).map(card => {
        const applied = appliedTemplate === card.id;
        return <button
          key={card.id}
          className="s-task"
          data-applied={applied ? "true" : "false"}
          aria-pressed={applied}
          disabled={command.isPending}
          onClick={() => applyTemplate(card)}
        >
          <div className="s-task-icon" aria-hidden>{card.icon}</div>
          <h3>{tx(...card.title)}</h3>
          <p>{tx(...card.prompt)}</p>
          <div className="s-row">
            <span className="s-tag ghost">{tx(...card.difficulty)}</span>
            <span className="s-tag ghost">{card.minutes} {tx("分鐘", "min")}</span>
            {applied ? <span className="s-tag">{tx("已套用", "Applied")}</span> : <span className="s-tag">{tx("積分按任務", "Mission points")}</span>}
          </div>
        </button>;
      })}
    </div>
    {STUDIO_TEMPLATES.length > 4 && <button type="button" className="s-btn" onClick={() => setShowAllTemplates(value => !value)}>{showAllTemplates ? tx("收起靈感", "Show fewer") : tx(`顯示其餘 ${STUDIO_TEMPLATES.length - 4} 個靈感`, `Show ${STUDIO_TEMPLATES.length - 4} more ideas`)}</button>}
    <small>{tx("範本不另發分。", "Templates do not award points.")}</small>
  </div>;
}
