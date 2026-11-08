import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useI18n } from "@/lib/i18n";
import { taskProgress } from "@/lib/studio/policy";
import "./studio.css";

export function useStudioText() { const { lang } = useI18n(); return (zh: string, en: string) => lang === "en" ? en : zh; }
export function StudioLogo({ home = "/home" }: { home?: string }) { return <Link to={home} className="s-logo" aria-label="KOCmax"><span className="s-logo-mark" aria-hidden>✦</span><span>KOC<b>max</b></span></Link>; }
export function Sprout({ small = false }: { small?: boolean }) { return <svg className={`s-mascot${small ? " small" : ""}`} viewBox="0 0 140 140" aria-hidden="true"><ellipse cx="70" cy="126" rx="42" ry="7" fill="#322b4312"/><path d="M68 48C35 49 26 23 28 13c28-3 42 14 40 35Z" fill="#9ac665" stroke="#304632" strokeWidth="2.5"/><path d="M69 46c0-29 22-41 39-37 0 25-16 39-39 37Z" fill="#cbe887" stroke="#304632" strokeWidth="2.5"/><path d="M71 48v14" stroke="#304632" strokeWidth="3"/><path d="M24 92C20 60 40 46 70 46s51 15 47 46c-4 29-23 38-48 38S28 120 24 92Z" fill="#d8ef9c" stroke="#304632" strokeWidth="2.5"/><ellipse cx="49" cy="85" rx="4" ry="6" fill="#302a45"/><ellipse cx="91" cy="85" rx="4" ry="6" fill="#302a45"/><path d="M61 98q9 9 18 0" fill="none" stroke="#302a45" strokeWidth="2.5" strokeLinecap="round"/><ellipse cx="39" cy="96" rx="8" ry="4" fill="#f3c9a4"/><ellipse cx="101" cy="96" rx="8" ry="4" fill="#f3c9a4"/><path d="m22 85-12 8m109-8 11 8" stroke="#304632" strokeWidth="3" strokeLinecap="round"/></svg>; }
export function StudioError({ children, onRetry }: { children?: ReactNode; onRetry?: () => void }) { const tx = useStudioText(); return <div role="alert" className="s-error">{children ?? tx("暫時讀取不到資料，已保存的內容不受影響。", "We could not load this. Saved work is safe.")}{onRetry && <button className="s-btn" onClick={onRetry}>{tx("再試一次", "Try again")}</button>}</div>; }
export function StudioLoginRequired({ context = "studio" }: { context?: "studio" | "connections" } = {}) {
  const tx = useStudioText();
  return <StudioError>
    <h1>{tx("請重新登入，再繼續創作", "Sign in again to continue creating")}</h1>
    <p>{context === "connections" ? tx("目前無法確認登入狀態，帳號資料與操作已隱藏。同步、撤權或清除結果須在重新登入後核對。", "We could not verify your session, so account details and controls are hidden. Check sync, revocation or deletion outcomes after signing in again.") : tx("目前無法確認登入狀態，私人討論已隱藏。未保存的內容不會自動提交。", "We could not verify your session, so private chats are hidden. Unsaved work will not be submitted automatically.")}</p>
    <Link to="/login" className="s-btn">{tx("前往登入", "Go to sign in")}</Link>
  </StudioError>;
}
export function StudioProgress({ state, reward }: { state: string; reward?: string | null }) {
  const tx = useStudioText(), progress = taskProgress(state, reward ?? null);
  return <section className="s-card s-stack" aria-label={tx("任務進度", "Mission progress")}><div className="s-between"><h3>{tx("每一步，都算數", "Every step counts")}</h3><span className="s-tag">{tx("原任務記錄", "Mission record")}</span></div>
    <ol className="s-progress">{[tx("整理與提交", "Draft & submit"), tx("審核作品", "Review"), tx("獲准發佈", "Publish approval"), tx("提交證明", "Proof"), tx("核實成果", "Verified"), tx("等待結算", "Pending reward"), tx("獎勵入帳", "Credited")].map((label, i) => <li key={label} className={i <= progress.step ? "done" : ""}><span aria-hidden>{i < progress.step ? "✓" : i + 1}</span>{label}</li>)}</ol>
    {progress.earned ? <div role="status" className="s-achievement">🏅 <strong>{tx("成果獲核實！", "Your work is verified!")}</strong><p>{tx("獎勵已記入原有帳本。你完成了這一站。", "Your reward is recorded in the original ledger.")}</p></div> : <small>{tx("通過發佈不等於完成或入帳。獎勵以核實及結算記錄為準。", "Publish approval is not completion or credit. Rewards follow verified settlement.")}</small>}
  </section>;
}
