import { Link } from "@tanstack/react-router";
import { Compass, Gift, MessageCircle, ShieldCheck } from "lucide-react";
import { Sprout, useStudioText } from "./StudioPrimitives";

export function StudioExplore() {
  const tx=useStudioText();
  const steps=[
    ["選一張任務卡","Pick a mission","先看資格、交付要求、時間和獎勵。","Check eligibility, requirements, timing and rewards.",Compass],
    ["把想法聊清楚","Talk through your idea","加入有權使用的來源，另存一份私人 Brief。","Use sources you may access, then save a private brief.",MessageCircle],
    ["交出可核實的作品","Submit verifiable work","沿原有任務流程審核、發佈並提交證明。","Follow the mission's review, publication and proof steps.",ShieldCheck],
    ["收下已入帳獎勵","Enjoy credited rewards","待結算不等於已入帳。獎勵記錄以錢包為準。","Pending rewards are not credited points. Check your wallet.",Gift],
  ] as const;
  return <div className="s-stack"><header className="s-between"><div><span className="s-eyebrow">YOUR CREATOR FIELD GUIDE</span><h1>{tx("一起開始創作冒險", "Your creator adventure")}</h1><p className="s-muted">{tx("不用先連接帳號。從一個真實想法開始。", "No connection required. Start with one real idea.")}</p></div><Sprout small/></header>
    <div className="s-grid">{steps.map(([zh,en,detail,detailEn,Icon],i)=><article key={en} className="s-card s-stack"><span className="s-task-icon"><Icon aria-hidden size={23}/></span><span className="s-step-number">STEP 0{i+1}</span><h2>{tx(zh,en)}</h2><p className="s-muted">{tx(detail,detailEn)}</p></article>)}</div>
    <div className="s-note">🌱 {tx("休息不會扣分。登入、重複提問或重複提交不會自動賺取積分。", "Breaks never cost points. Visits, repeated questions and repeated submissions do not automatically earn points.")}</div>
    <section className="s-card s-stack"><h2>{tx("出發前的小問題", "Before you begin")}</h2>{[
      ["如何賺取積分？","How do I earn points?","完成任務要求及所需核實，由原有獎勵流程處理。每個任務的積分、經驗值及現金分開列明。","Complete the requirements and verification. Points, XP and cash follow each mission's reward contract."],
      ["積分會過期嗎？","Do points expire?","請查看錢包顯示的有效期與適用條款；未提供的日期不會推算。","Check the expiry shown in your wallet and the applicable terms. Missing dates are not estimated."],
      ["怎樣兌換獎賞？","How do I redeem?","到獎賞商店查看所需積分及庫存，核對內容後再確認兌換。","Check the points and stock in the rewards shop, then review and confirm."],
      ["哪裡查看兌換記錄？","Where are my redemptions?","在獎賞商店的「兌換記錄」查看狀態及已發放的兌換碼。","Open Redemption history in the rewards shop to view status and issued codes."],
    ].map(([zh,en,detail,detailEn])=><details className="s-source" key={en}><summary>{tx(zh,en)}</summary><p className="s-muted">{tx(detail,detailEn)}</p></details>)}</section>
    <div className="s-row"><Link className="s-btn s-primary" to="/mission">{tx("找我的下一個任務", "Find my next mission")}</Link><Link className="s-btn" to="/redemption/history">{tx("查看兌換記錄", "Redemption history")}</Link></div>
  </div>;
}
