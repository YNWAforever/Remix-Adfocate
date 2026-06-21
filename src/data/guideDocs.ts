import account from "../../content/help/account.zh-HK.md?raw";
import leveling from "../../content/help/leveling.zh-HK.md?raw";
import missions from "../../content/help/missions.zh-HK.md?raw";
import points from "../../content/help/points.zh-HK.md?raw";
import profile from "../../content/help/profile.zh-HK.md?raw";
import redemption from "../../content/help/redemption.zh-HK.md?raw";
import submission from "../../content/help/submission.zh-HK.md?raw";
import wallet from "../../content/help/wallet.zh-HK.md?raw";

export type GuideCategory = "start" | "missions" | "rewards" | "account";
export type GuideDoc = { id: string; titleKey: string; category: GuideCategory; emoji: string; body: string };

export const guideDocs: GuideDoc[] = [
  { id: "account",    titleKey: "app.guide.doc.account",    category: "account",  emoji: "👤", body: account },
  { id: "leveling",   titleKey: "app.guide.doc.leveling",   category: "start",    emoji: "⭐", body: leveling },
  { id: "missions",   titleKey: "app.guide.doc.missions",   category: "missions", emoji: "🎯", body: missions },
  { id: "submission", titleKey: "app.guide.doc.submission", category: "missions", emoji: "📤", body: submission },
  { id: "points",     titleKey: "app.guide.doc.points",     category: "rewards",  emoji: "🪙", body: points },
  { id: "redemption", titleKey: "app.guide.doc.redemption", category: "rewards",  emoji: "🎁", body: redemption },
  { id: "wallet",     titleKey: "app.guide.doc.wallet",     category: "rewards",  emoji: "💰", body: wallet },
  { id: "profile",    titleKey: "app.guide.doc.profile",    category: "account",  emoji: "🪪", body: profile },
];
