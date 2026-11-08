import { StudioJourney } from "./StudioJourney";
import { Link } from "@tanstack/react-router";
import { Bell, BookOpen, Compass, Gift, Home, IdCard, ListChecks, Menu, MessageCircle, Plug, Sparkles, Trophy, UserRound, Wallet } from "lucide-react";
import type { ReactNode } from "react";
import { LangToggle } from "@/components/LangToggle";
import { StudioLogo, Sprout, useStudioText } from "./StudioPrimitives";

const destinations = [
  ["/home", "工作室", "Studio", Home], ["/mission", "找任務", "Find missions", Compass], ["/my", "我的任務", "My missions", ListChecks],
  ["/studio", "討論與成果", "Chats & briefs", MessageCircle], ["/campaigns", "活動與挑戰", "Challenges", Trophy], ["/redemption", "獎賞商店", "Rewards", Gift],
  ["/wallet", "積分錢包", "Wallet", Wallet], ["/guide", "成長學院", "Academy", BookOpen], ["/explore", "探索", "Explore", Compass],
  ["/news", "最新消息", "News", Bell], ["/match", "品牌配對", "Brand match", Sparkles], ["/passport", "創作者護照", "Passport", IdCard],
  ["/connections", "已連接帳號", "Connected accounts", Plug], ["/profile", "個人與隱私", "Profile & privacy", UserRound],
] as const;
export function StudioShell({ children }: { children: ReactNode }) {
  const tx = useStudioText();
  return <div className="studio"><a className="s-skip" href="#main">{tx("跳至主要內容", "Skip to content")}</a>
    <aside className="s-rail"><StudioLogo /><nav className="s-rail-links" aria-label={tx("主要導覽", "Main navigation")}>{destinations.map(([to, zh, en, Icon]) => <Link key={to} to={to} activeOptions={{ exact: to === "/home" }}><Icon size={18} aria-hidden/>{tx(zh, en)}</Link>)}</nav><div className="s-rail-foot"><Sprout small/><strong>{tx("照自己的節奏成長", "Grow at your own pace")}</strong><p>{tx("休息不會扣積分，回來再繼續。", "Take a break. Your progress stays.")}</p></div></aside>
    <div className="s-app-body"><header className="s-top"><StudioLogo/><span className="s-top-note">{tx("創作者對話工作室 / 一次完成一件好作品", "Creator studio / One good creation at a time")}</span><div className="s-row"><LangToggle/><Link className="s-icon-btn" to="/notifications" aria-label={tx("通知", "Notifications")}><Bell size={19}/></Link><Link className="s-icon-btn" to="/profile" aria-label={tx("個人帳號", "Profile")}><UserRound size={19}/></Link></div></header><main id="main" className="s-content"><StudioJourney />{children}</main></div>
    <nav className="s-bottom" aria-label={tx("手機導覽", "Mobile navigation")}>{[["/home", "工作室", "Studio", Home], ["/mission", "找任務", "Missions", Compass], ["/my", "我的任務", "My work", ListChecks], ["/redemption", "獎賞", "Rewards", Gift], ["/more", "更多", "More", Menu]].map(([to, zh, en, Icon]) => { const I = Icon as typeof Home; return <Link key={String(to)} to={String(to)} activeOptions={{ exact: to === "/home" }}><I size={21} aria-hidden/><span>{tx(String(zh), String(en))}</span></Link>; })}</nav>
  </div>;
}
