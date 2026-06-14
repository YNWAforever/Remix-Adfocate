import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/lib/supabase";
import { finishAuth } from "@/lib/auth-flow";

export const Route = createFileRoute("/_app/login")({ component: Login });

/** Normalise a HK number to E.164. Accepts "9123 4567", "+85291234567", etc. */
function toHkE164(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  return `+852${digits}`;
}

function Login() {
  const navigate = useNavigate();

  const [stage, setStage] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSecondary, setShowSecondary] = useState(false);

  async function sendOtp(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const { error } = await supabase.auth.signInWithOtp({
      phone: toHkE164(phone),
      options: { channel: "whatsapp" },
    });
    setBusy(false);
    if (error) { setError(error.message); return; }
    setStage("code");
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const { error } = await supabase.auth.verifyOtp({ phone: toHkE164(phone), token: code.trim(), type: "sms" });
    if (error) { setBusy(false); setError(error.message); return; }
    try {
      await finishAuth(navigate);
    } catch {
      setBusy(false);
      setError("登入未能完成，請重試");
    }
  }

  return (
    <div className="mx-auto max-w-sm space-y-4 p-8">
      <h1 className="font-display text-2xl font-bold">登入 KOCmax</h1>
      {error && <p className="text-sm text-[var(--color-magenta)]">{error}</p>}

      {stage === "phone" ? (
        <form onSubmit={sendOtp} className="space-y-3">
          <p className="text-sm text-[var(--color-soft-ink)]">輸入你的 WhatsApp 電話號碼以接收驗證碼登入或註冊</p>
          <div className="flex items-center gap-2">
            <span className="rounded-xl border-2 border-[var(--color-ink)] bg-white px-3 py-3 font-mono text-sm">+852</span>
            <input
              type="tel"
              required
              autoComplete="tel"
              inputMode="numeric"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="9123 4567"
              className="w-full rounded-xl border-2 border-[var(--color-ink)] bg-white p-3"
              aria-label="WhatsApp 電話號碼"
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            className="btn-primary w-full rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] py-3 font-heading font-bold text-[var(--color-ink)] disabled:opacity-50"
          >
            {busy ? "傳送中…" : "用 WhatsApp 收驗證碼"}
          </button>
        </form>
      ) : (
        <form onSubmit={verify} className="space-y-3">
          <p className="text-sm text-[var(--color-soft-ink)]">
            驗證碼已透過 WhatsApp 傳送至 <span className="font-bold text-[var(--color-ink)]">{toHkE164(phone)}</span>
          </p>
          <input
            type="text"
            required
            autoComplete="one-time-code"
            inputMode="numeric"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="6 位數驗證碼"
            className="w-full rounded-xl border-2 border-[var(--color-ink)] bg-white p-3 text-center font-mono text-lg tracking-widest"
            aria-label="驗證碼"
          />
          <button
            type="submit"
            disabled={busy}
            className="btn-primary w-full rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] py-3 font-heading font-bold text-[var(--color-ink)] disabled:opacity-50"
          >
            {busy ? "登入中…" : "驗證並登入"}
          </button>
          <button
            type="button"
            onClick={() => { setStage("phone"); setCode(""); setError(null); }}
            className="w-full text-center text-sm text-[var(--color-soft-ink)]"
          >
            更改電話號碼
          </button>
        </form>
      )}

      <div className="pt-2">
        <button
          type="button"
          onClick={() => setShowSecondary((s) => !s)}
          className="w-full text-center text-sm text-[var(--color-soft-ink)] underline"
        >
          其他登入方式
        </button>
        {showSecondary && <SecondaryMethods />}
      </div>
    </div>
  );
}

function SecondaryMethods() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setBusy(false);
    if (error) { setError(error.message); return; }
    setSent(true);
  }

  async function google() {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  }

  return (
    <div className="mt-3 space-y-3 rounded-xl border-2 border-[var(--color-ink)] bg-white p-4">
      {error && <p className="text-sm text-[var(--color-magenta)]">{error}</p>}
      {sent ? (
        <p className="text-sm text-[var(--color-soft-ink)]">
          登入連結已傳送至 <span className="font-bold text-[var(--color-ink)]">{email.trim()}</span>，請查看電郵。
        </p>
      ) : (
        <form onSubmit={sendLink} className="space-y-2">
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
            className="w-full rounded-full border-2 border-[var(--color-ink)] bg-white py-2 font-heading font-bold text-[var(--color-ink)] disabled:opacity-50"
          >
            {busy ? "傳送中…" : "用電郵連結登入"}
          </button>
        </form>
      )}
      <button
        type="button"
        onClick={google}
        className="w-full rounded-full border-2 border-[var(--color-ink)] bg-white py-2 font-heading font-bold text-[var(--color-ink)]"
      >
        用 Google 登入
      </button>
    </div>
  );
}
