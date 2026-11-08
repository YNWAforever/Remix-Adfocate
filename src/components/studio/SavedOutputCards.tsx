import type { StudioBrief, StudioSource } from "@/lib/studio/types";
import { inspectSavedBrief } from "@/lib/studio/savedOutputs";
import { useStudioText } from "./StudioPrimitives";

export function SavedOutputCards({ threadId, briefs, sources, disabledReason, onCopy, notice }: {
  threadId: string; briefs: StudioBrief[]; sources: StudioSource[];
  notice?: string; disabledReason?: string; onCopy: (briefId: string) => void;
}) {
  const tx = useStudioText();
  const latest = Math.max(...briefs.map(b => b.version));
  return <section className="s-card s-stack s-saved-outputs" aria-label={tx("已保存成果", "Saved outputs")}>
    <h3>📚 {tx("已保存成果", "Saved outputs")}</h3>
    <small>{notice ?? tx("這裡顯示最近 20 個版本及 100 則訊息；完整記錄可從個人頁匯出。", "Showing the latest 20 versions and 100 messages. Export your full record from your profile.")}</small>
    {disabledReason && <p className="s-note">{disabledReason}</p>}
    {!briefs.length && <p className="s-muted">{tx("保存後會在這裡找到成果。", "Saved briefs will appear here.")}</p>}
    {briefs.map(brief => {
      const inspected = inspectSavedBrief(brief, threadId, sources);
      const sourceIds = [...new Set(brief.sections.flatMap(s => s.sourceIds))];
      const unavailable = tx("來源不可用，相關內容已隱藏。", "Source unavailable; related content is hidden.");
      const date = new Date(brief.created_at);
      return <article className="s-saved-output s-stack" key={brief.id}>
        <div className="s-between"><strong>Brief v{brief.version}</strong><span className="s-tag">{tx("私人", "Private")}</span></div>
        {brief.version === latest && <span className="s-tag mint">{tx("最新版本", "Latest version")}</span>}
        <small>{Number.isNaN(date.getTime()) ? tx("保存時間未提供", "Save time unavailable") : `${new Intl.DateTimeFormat("zh-HK", {dateStyle:"medium",timeStyle:"short",timeZone:"Asia/Hong_Kong"}).format(date)} HKT`}</small>
        <p className="s-saved-snippet">{inspected.sections[0]?.text?.slice(0,100) ?? unavailable}</p>
        <small>{sourceIds.length ? tx(`引用 ${sourceIds.length} 項來源`, `${sourceIds.length} sources cited`) : tx("創作者自訂構思", "Creator-authored idea")}</small>
        <details><summary>{tx(`預覽 Brief v${brief.version}`, `Preview Brief v${brief.version}`)}</summary>
          {inspected.sections.map((section,index) => <div className="s-stack" key={`${section.id}:${index}`}>
            <p className="s-saved-text">{section.text ?? unavailable}</p>
            {section.text !== null && section.sourceIds.map(id => <span key={id} className="s-tag ghost">📎 {sources.find(s=>s.id===id)?.title} · {sources.find(s=>s.id===id)?.shareable ? tx("已聲明有分享權", "Sharing rights declared") : tx("只限私人整理", "Private use only")}</span>)}
          </div>)}
        </details>
        {!inspected.copyable && <small>{tx("來源或版本不可用，暫不能複製。", "Source or version unavailable; copying is disabled.")}</small>}
        <button data-copy-brief={brief.id} className="s-btn s-lime-btn" aria-label={tx(`複製 Brief v${brief.version} 成新草稿`, `Copy Brief v${brief.version} to a new draft`)} disabled={Boolean(disabledReason) || !inspected.copyable} onClick={()=>onCopy(brief.id)}>{tx("複製成新草稿", "Copy to a new draft")}</button>
      </article>;
    })}
  </section>;
}
