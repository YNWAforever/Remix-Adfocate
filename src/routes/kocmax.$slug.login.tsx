import { createFileRoute } from "@tanstack/react-router";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/kocmax/$slug/login")({ component: Login });

function Login() {
  const { slug } = Route.useParams();
  async function signIn() {
    await supabase.auth.signInWithOAuth({
      provider: "line" as never, // LINE enabled in Supabase Auth; see spec §6 (OTP fallback)
      options: { redirectTo: `${window.location.origin}/kocmax/${slug}/auth/callback` },
    });
  }
  return (
    <div className="p-8 space-y-4">
      <h1 className="text-2xl font-bold">登入 KOCmax</h1>
      <button onClick={signIn} className="w-full py-3 rounded bg-[var(--color-acid)] text-[var(--color-ink)] font-bold">
        使用 LINE 登入
      </button>
    </div>
  );
}
