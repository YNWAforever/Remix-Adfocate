import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";

export const Route = createFileRoute("/_app/explore")({ component: Explore });

const BENEFITS = [
  { t: "購物賺積分", d: "於合作商戶消費，每消費HK$1即可賺取1積分" },
  { t: "完成任務", d: "參與品牌任務，完成後獲得額外積分獎勵" },
  { t: "每日簽到", d: "每日登入簽到，連續簽到可獲額外獎勵" },
  { t: "兌換獎賞", d: "累積積分兌換精選禮品、優惠券及體驗" },
];
const STEPS = [
  { n: "01", t: "購物消費", d: "於合作商戶購物後保留收據" },
  { n: "02", t: "上傳收據", d: "在App內上傳收據相片以賺取積分" },
  { n: "03", t: "完成任務", d: "瀏覽並接受品牌任務，完成後獲得積分" },
  { n: "04", t: "每日簽到", d: "每日登入簽到賺取額外積分" },
];
const FAQ = [
  {
    q: "如何賺取積分？",
    a: "您可以透過購物消費、完成任務、每日簽到及上傳收據等方式賺取積分。每次符合條件的消費或任務完成後，積分會自動加入您的帳戶。",
  },
  {
    q: "積分會過期嗎？",
    a: "是的，積分有效期為獲得後12個月。您可在積分卡查看即將過期的積分及到期日。",
  },
  {
    q: "如何兌換獎賞？",
    a: "前往「積分兌換」頁面，選擇心儀獎賞，確認積分足夠後即可兌換。兌換成功後會收到確認通知。",
  },
  {
    q: "如何查看我的兌換記錄？",
    a: "登入後前往「我的」頁面，點擊「我的獎賞」即可查看所有兌換記錄及獎賞狀態。",
  },
];

function Explore() {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="mx-auto max-w-lg space-y-6 p-4">
      <h1 className="font-display text-2xl font-bold">探索 KOCmax</h1>
      <section>
        <h2 className="mb-2 font-heading font-bold">會員權益</h2>
        <div className="grid gap-3">
          {BENEFITS.map((b) => (
            <div key={b.t} className="pastel-card rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4">
              <p className="font-heading font-semibold">{b.t}</p>
              <p className="text-sm text-[var(--color-soft-ink)]">{b.d}</p>
            </div>
          ))}
        </div>
      </section>
      <section>
        <h2 className="mb-2 font-heading font-bold">如何賺取積分</h2>
        <div className="pastel-card space-y-3 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white p-4">
          {STEPS.map((s) => (
            <div key={s.n} className="flex gap-3">
              <span className="font-display text-lg font-bold text-[var(--color-magenta)]">{s.n}</span>
              <div>
                <p className="font-heading font-semibold">{s.t}</p>
                <p className="text-sm text-[var(--color-soft-ink)]">{s.d}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
      <section>
        <h2 className="mb-2 font-heading font-bold">常見問題</h2>
        <div className="space-y-2">
          {FAQ.map((f, i) => (
            <div key={f.q} className="pastel-card overflow-hidden rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-white">
              <button
                type="button"
                aria-expanded={open === i}
                aria-controls={`faq-panel-${i}`}
                onClick={() => setOpen(open === i ? null : i)}
                className="flex w-full items-center justify-between p-4 text-left font-heading font-semibold"
              >
                {f.q}{" "}
                <ChevronDown size={18} className={open === i ? "rotate-180 transition" : "transition"} aria-hidden />
              </button>
              {open === i && (
                <p id={`faq-panel-${i}`} role="region" aria-label={f.q} className="px-4 pb-4 text-sm text-[var(--color-soft-ink)]">
                  {f.a}
                </p>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
