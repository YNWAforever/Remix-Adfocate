import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/_app/tnc")({ component: Tnc });

function Tnc() {
  return (
    <div className="mx-auto max-w-lg space-y-4 p-4">
      <Link to="/home" className="inline-flex items-center gap-1 text-sm"><ArrowLeft size={16} aria-hidden /> 返回</Link>
      <h1 className="font-display text-2xl font-bold">條款及細則</h1>
      <article className="pastel-card space-y-4 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4 text-sm leading-[1.65] text-[var(--color-soft-ink)]">
        <p>歡迎使用 KOCmax 會員獎賞計劃。使用本計劃即表示您同意以下條款及細則。</p>
        <h2 className="font-heading font-bold text-[var(--color-ink)]">1. 會員資格</h2>
        <p>會員資格免費，任何年滿18歲之人士均可申請。每人只限擁有一個會員帳戶。</p>
        <h2 className="font-heading font-bold text-[var(--color-ink)]">2. 積分賺取</h2>
        <p>積分可透過購物消費、完成任務、每日簽到及上傳收據等方式賺取。積分計算方式以系統記錄為準。</p>
        <h2 className="font-heading font-bold text-[var(--color-ink)]">3. 積分有效期</h2>
        <p>積分有效期為獲得後12個月，逾期積分將自動失效且不予補發。</p>
        <h2 className="font-heading font-bold text-[var(--color-ink)]">4. 獎賞兌換</h2>
        <p>獎賞一經兌換，恕不退款、退貨或更換。獎賞數量有限，換完即止。</p>
        <h2 className="font-heading font-bold text-[var(--color-ink)]">5. 一般條款</h2>
        <p>我們保留隨時修改本條款及細則的權利，修改後的條款將於發布後生效。</p>
      </article>
    </div>
  );
}
