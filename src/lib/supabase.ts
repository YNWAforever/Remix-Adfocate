import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!supabaseUrl || !supabaseAnonKey) {
  // Fail soft: the public marketing pages must still render when the auth env
  // is absent (e.g. a Vercel Preview deploy without VITE_SUPABASE_* set).
  // Without this guard, createClient throws "supabaseUrl is required" at module
  // load and white-screens the ENTIRE SPA — even pages that never use auth.
  // Auth calls then degrade (no session) instead of crashing the whole site.
  console.error(
    "[supabase] Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — auth is disabled. " +
      "Set them for Vercel Preview + Production to enable login.",
  );
}

export const supabase = createClient(
  supabaseUrl ?? "https://placeholder.supabase.co",
  supabaseAnonKey ?? "placeholder-anon-key",
  {
    auth: {
      // Google + magic-link arrive as `?code=` (PKCE). The callback exchanges it
      // explicitly, so disable auto-detect to avoid a double-exchange race.
      // The inline WhatsApp OTP path doesn't use redirects and is unaffected.
      flowType: "pkce",
      detectSessionInUrl: false,
      persistSession: true,
      autoRefreshToken: true,
    },
  },
);
