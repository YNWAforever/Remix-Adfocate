import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
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
