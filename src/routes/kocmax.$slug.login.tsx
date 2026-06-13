import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/kocmax/$slug/login")({ component: Login });

function Login() {
  const { slug } = Route.useParams();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    // Magic-link sign-in: Supabase emails a one-time login link that redirects back to the
    // auth callback route, which finishes first-login bootstrap + session refresh. The redirect
    // target must be in the project's Auth → URL Configuration → Redirect URLs allow-list.
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/kocmax/${slug}/auth/callback` },
    });
    setBusy(false);
    if (error) { setError(error.message); return; }
    setSent(true);
  }

  return (
    <div className="mx-auto max-w-sm space-y-4 p-8">
      <h1 className="font-display text-2xl font-bold">登入 KOCmax</h1>
      {sent ? (
        <div className="space-y-3">
          <p className="text-sm text-[var(--color-soft-ink)]">
            登入連結已傳送至 <span className="font-bold text-[var(--color-ink)]">{email.trim()}</span>。
            請開啟電郵並點擊連結完成登入。
          </p>
          <button
            type="button"
            onClick={() => { setSent(false); setError(null); }}
            className="w-full text-center text-sm text-[var(--color-soft-ink)]"
          >
            使用其他電郵
          </button>
        </div>
      ) : (
        <>
          <p className="text-sm text-[var(--color-soft-ink)]">輸入電郵以接收一次性登入連結登入或註冊</p>
          {error && <p className="text-sm text-[var(--color-magenta)]">{error}</p>}
          <form onSubmit={sendLink} className="space-y-3">
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-xl border-2 border-[var(--color-ink)] bg-white p-3"
              aria-label="電郵地址"
            />
            <button
              type="submit"
              disabled={busy}
              className="btn-primary w-full rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] py-3 font-heading font-bold text-[var(--color-ink)] disabled:opacity-50"
            >
              {busy ? "傳送中…" : "傳送登入連結"}
            </button>
          </form>
        </>
      )}
    </div>
  );
}
