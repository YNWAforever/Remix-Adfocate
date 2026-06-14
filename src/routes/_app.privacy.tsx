import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/_app/privacy")({ component: Privacy });

function Privacy() {
  return (
    <div className="mx-auto max-w-lg space-y-4 p-4">
      <Link to="/home" className="inline-flex items-center gap-1 text-sm"><ArrowLeft size={16} aria-hidden /> 返回</Link>
      <h1 className="font-display text-2xl font-bold">私隱政策</h1>
      <article className="pastel-card space-y-4 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4 text-sm leading-[1.65] text-[var(--color-soft-ink)]">
        <p>我們重視您的私隱。本政策說明我們如何收集、使用及保護您的個人資料。</p>
        <h2 className="font-heading font-bold text-[var(--color-ink)]">1. 資料收集</h2>
        <p>我們收集您提供的個人資料，包括姓名、聯絡方式及交易記錄，用於提供會員服務。</p>
        <h2 className="font-heading font-bold text-[var(--color-ink)]">2. 資料使用</h2>
        <p>您的資料用於管理會員帳戶、處理積分及獎賞兌換、發送推廣資訊（經您同意）。</p>
        <h2 className="font-heading font-bold text-[var(--color-ink)]">3. 資料保護</h2>
        <p>我們採取合理的保安措施保護您的個人資料，防止未經授權的存取或使用。</p>
        <h2 className="font-heading font-bold text-[var(--color-ink)]">4. 查閱及更正</h2>
        <p>您有權查閱及更正您的個人資料。如有需要，請聯絡我們的客戶服務。</p>
      </article>
    </div>
  );
}
