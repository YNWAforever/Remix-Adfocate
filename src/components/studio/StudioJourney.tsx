import { useRouterState } from "@tanstack/react-router";
import { BookOpen, Compass, Gift, HeartHandshake, ShieldCheck, Sparkles, Trophy, UserRound, type LucideIcon } from "lucide-react";
import { Sprout, useStudioText } from "./StudioPrimitives";

type Journey = { match: RegExp; label: [string, string]; hint: [string, string]; icon: LucideIcon; tone?: string };
const journeys: Journey[] = [
  { match: /^\/mission/, label: ["下一個好作品", "Your next creation"], hint: ["選一個適合自己的任務，先看清要求再出發。", "Find your fit. Check the brief before you begin."], icon: Compass },
  { match: /^\/my/, label: ["創作進行中", "Work in progress"], hint: ["草稿、審核、發佈證明，每一步都在這裡。", "Your drafts, reviews and publication proof, together."], icon: Sparkles },
  { match: /^\/redemption/, label: ["把努力換成喜歡", "A little reward for your work"], hint: ["每份獎賞都有明確積分；確認後才兌換。", "Clear points, clear rewards. Redeem only after confirming."], icon: Gift, tone: "peach" },
  { match: /^\/wallet/, label: ["你的努力，有跡可循", "Every reward has a story"], hint: ["已入帳、處理中和現金收入，分開看清楚。", "Keep credited points, pending rewards and cash earnings distinct."], icon: Trophy, tone: "mint" },
  { match: /^\/campaigns/, label: ["一起完成新挑戰", "Find your next challenge"], hint: ["按自己的節奏參與，先看看活動規則。", "Join at your own pace. Start with the campaign rules."], icon: Trophy, tone: "peach" },
  { match: /^\/guide/, label: ["每天學會一點點", "Make room to grow"], hint: ["選一堂適合你的課，把靈感帶回下一個作品。", "Pick a lesson. Bring one new idea to your next creation."], icon: BookOpen, tone: "mint" },
  { match: /^\/(profile|passport|privacy|connections)/, label: ["這是你的創作名片", "Your creator identity"], hint: ["由你決定分享甚麼；未驗證資料會清楚標示。", "You choose what to share. Unverified information stays labelled."], icon: UserRound },
  { match: /^\/(match|explore)/, label: ["發現新的可能", "Explore a new possibility"], hint: ["從興趣與真實成果出發，找到合拍的機會。", "Start with your interests and real work to find a good fit."], icon: Compass, tone: "mint" },
  { match: /^\/(news|notifications|more|tnc)/, label: ["創作補給站", "Your creator pit stop"], hint: ["消息、工具與帳號設定，隨時回來找。", "News, tools and account settings, whenever you need them."], icon: Sparkles },
  { match: /^\/brand/, label: ["與創作者一起做好作品", "Create something good together"], hint: ["整理任務要求、管理進度，尊重創作者的私人資料。", "Set a clear brief, follow progress and respect creator privacy."], icon: HeartHandshake, tone: "mint" },
  { match: /^\/(admin|operator)/, label: ["讓每份努力被看見", "Give good work a fair review"], hint: ["依證據審批、保留修改紀錄，再按權限處理獎勵。", "Review evidence, retain decisions and handle rewards within your role."], icon: ShieldCheck },
];

/** Context cue, not a new workflow or a second page heading. */
export function StudioJourney() {
  const pathname = useRouterState({ select: state => state.location.pathname });
  const tx = useStudioText();
  const journey = journeys.find(item => item.match.test(pathname));
  if (!journey || ["/home", "/studio", "/admin", "/admin/", "/operator", "/operator/"].includes(pathname)) return null;
  const Icon = journey.icon;
  return <aside className={`s-journey ${journey.tone ?? "lilac"}`} aria-label={tx("這一站", "This stop")}>
    <span className="s-journey-icon"><Icon size={25} aria-hidden /></span>
    <div><strong>{tx(...journey.label)}</strong><p>{tx(...journey.hint)}</p></div>
    <Sprout small />
  </aside>;
}
