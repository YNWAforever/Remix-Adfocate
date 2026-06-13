import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/lib/supabase";
import { apiFetch } from "@/lib/api";

export const Route = createFileRoute("/kocmax/$slug/login")({ component: Login });

function Login() {
  const { slug } = Route.useParams();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"email" | "code">("email");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim() });
    setBusy(false);
    if (error) { setError(error.message); return; }
    setStage("code");
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code, type: "email" });
    if (error) { setBusy(false); setError(error.message); return; }
    // First-login bootstrap creates the creator + balance if absent. It is idempotent:
    // an already-bootstrapped user still gets 200, so ANY error here is a real failure
    // (missing SUPABASE_SERVICE_KEY, a 5xx, or a network error) — not "already bootstrapped".
    // The session refresh below is what makes the token carry workspace_id, so a failed
    // refresh is equally fatal. Surface either failure and stop, because navigating would
    // land the session on a workspace-less, broken Home with no recovery path. refreshSession
    // reports failure via a returned { error } (not a throw), so re-throw it into this catch.
    try {
      await apiFetch("/me/bootstrap", { method: "POST", body: JSON.stringify({ slug }) });
      const { error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError) throw refreshError;
    } catch {
      setBusy(false);
      setError("登入未能完成，請稍後再試");
      return;
    }
    setBusy(false);
    navigate({ to: "/kocmax/$slug", params: { slug } });
  }

  return (
    <div className="mx-auto max-w-sm space-y-4 p-8">
      <h1 className="font-display text-2xl font-bold">登入 KOCmax</h1>
      <p className="text-sm text-[var(--color-soft-ink)]">輸入電郵以接收一次性驗證碼登入或註冊</p>
      {error && <p className="text-sm text-[var(--color-magenta)]">{error}</p>}
      {stage === "email" ? (
        <form onSubmit={sendCode} className="space-y-3">
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com"
            className="w-full rounded-xl border-2 border-[var(--color-ink)] bg-white p-3" aria-label="電郵地址" />
          <button type="submit" disabled={busy} className="btn-primary w-full rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] py-3 font-heading font-bold text-[var(--color-ink)] disabled:opacity-50">
            {busy ? "傳送中…" : "傳送驗證碼"}
          </button>
        </form>
      ) : (
        <form onSubmit={verify} className="space-y-3">
          <input inputMode="numeric" required maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="6 位數驗證碼"
            className="w-full rounded-xl border-2 border-[var(--color-ink)] bg-white p-3 tracking-[0.4em]" aria-label="驗證碼" />
          <button type="submit" disabled={busy} className="btn-primary w-full rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] py-3 font-heading font-bold text-[var(--color-ink)] disabled:opacity-50">
            {busy ? "驗證中…" : "登入"}
          </button>
          <button type="button" onClick={() => setStage("email")} className="w-full text-center text-sm text-[var(--color-soft-ink)]">使用其他電郵</button>
        </form>
      )}
    </div>
  );
}
