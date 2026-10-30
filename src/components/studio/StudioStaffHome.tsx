import { Link } from "@tanstack/react-router";
import { useStaffAccess } from "@/components/admin/StaffAccessContext";
import { Sprout, StudioError, useStudioText } from "./StudioPrimitives";
export function StudioStaffHome() {
  const tx = useStudioText(), access=useStaffAccess();
  if(access?.loading) return <p role="status">{tx("正在確認工作權限…","Checking workspace access…")}</p>;
  if(access?.error) return <StudioError onRetry={()=>void access.refresh()}/>;
  const cards = [
    ["application.review","/admin/applications","📨","任務申請","Applications","確認創作者是否適合任務。","Review mission eligibility."],
    ["submission.review","/admin/active-missions","🎬","作品與發佈證明","Content & publication proof","對照版本、來源和要求，逐項給出決定。","Review versions, sources and requirements."],
    ["submission.review","/admin/submissions","📋","舊版任務審批","Legacy submissions","保留原有審批與獎勵交易。","Keep the original approval and reward transaction."],
    ["completion.approve","/admin/active-missions","✅","核實完成","Completion review","檢查全部必要證明，建立待結算記錄。","Check required proofs before creating a reward handoff."],
    ["reward.read","/admin/reward-handoffs","🎁","獎勵交接","Reward handoffs","待處理、已取消與已結算，清楚分開。","Keep pending, cancelled and settled rewards distinct."],
    ["creator.read","/admin/creators","🌱","創作者個案","Creator cases","查看任務、作品與跟進紀錄。","Review creator work and follow-up history."],
    ["mission.manage","/admin/missions","🧭","任務管理","Mission management","編輯要求與交付項目，保留版本檢查。","Manage requirements with version checks."],
    ["content.manage","/admin/content","📚","內容與學院","Content & academy","管理消息、課程與成長資源。","Manage news, lessons and learning resources."],
  ] as const;
  return <div className="s-stack"><div className="s-between"><div><span className="s-eyebrow">ONE WORKSPACE, CLEAR NEXT STEPS</span><h1>{tx("讓好作品，順利走到下一站。","Help good work reach its next step.")}</h1><p>{tx("從你的待辦開始。每個決定都連回原任務記錄。","Start with your work queue. Every decision stays with the original mission.")}</p></div><Sprout/></div><div className="s-note">{tx("工作區角色","Workspace role")}: {access?.access?.workspace?.role ?? tx("內容編輯","Content editor")} · {tx("權限以伺服器確認為準","Access verified by the server")}</div><div className="s-grid">{cards.filter(([cap])=>access?.can(cap)).map(([cap,to,icon,zh,en,body,bodyEn])=><Link key={cap+to} to={to} className="s-task"><span className="s-task-icon">{icon}</span><h2>{tx(zh,en)}</h2><p>{tx(body,bodyEn)}</p><span className="s-tag">{tx("開啟待辦 →","Open queue →")}</span></Link>)}</div><small>{tx("通過發佈不等於完成；完成核實也不等於款項已支付。只有具結算權限的管理員可入帳。","Publish approval is not completion or payment. Only an authorized administrator can settle rewards.")}</small></div>;
}
