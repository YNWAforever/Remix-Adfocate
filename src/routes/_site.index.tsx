import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { supabase } from "@/lib/supabase";
import { WHATSAPP_LOGIN } from "@/lib/features";

export const Route = createFileRoute("/_site/")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session) throw redirect({ to: "/home" });
  },
  component: Landing,
});

function Landing() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-[var(--color-paper)] p-8 text-center text-[var(--color-ink)]">
      <span className="font-mono text-[11px] uppercase tracking-[0.18em]">ADFOCATE · KOCMAX</span>
      <h1 className="font-display text-4xl font-bold leading-[1.05]">完成任務<br/>賺積分換獎賞</h1>
      <p className="max-w-xs text-sm text-[var(--color-soft-ink)]">加入 KOCmax 會員平台，完成品牌任務、賺取積分、換領心儀獎賞。</p>
      <Link to="/login" className="btn-primary rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] px-8 py-3 font-heading font-bold">{WHATSAPP_LOGIN ? "用 WhatsApp 加入" : "立即登入"}</Link>
      <Link to="/mission" className="text-sm underline text-[var(--color-soft-ink)]">先睇睇任務</Link>
    </div>
  );
}
