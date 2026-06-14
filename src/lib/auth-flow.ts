import type { useNavigate } from "@tanstack/react-router";
import { supabase } from "./supabase";
import { apiFetch, setWorkspaceSlug } from "./api";

type Navigate = ReturnType<typeof useNavigate>;

/**
 * Shared post-auth branch, invoked from BOTH the inline WhatsApp verify handler
 * and the redirect callback. Bootstraps the creator, refreshes the session, then
 * routes to the wizard (onboarding incomplete) or home. Throws on any failure so
 * callers can surface a recoverable error state.
 */
export async function finishAuth(slug: string, navigate: Navigate) {
  setWorkspaceSlug(slug);
  const ref = new URLSearchParams(window.location.search).get("ref") ?? undefined;
  await apiFetch("/me/bootstrap", { method: "POST", body: JSON.stringify({ slug, ref }) });

  const { error } = await supabase.auth.refreshSession();
  if (error) throw error;

  const status = await apiFetch<{ onboarding_completed: boolean }>("/onboarding/status");
  if (status.onboarding_completed) {
    navigate({ to: "/kocmax/$slug", params: { slug } });
  } else {
    navigate({ to: "/kocmax/$slug/onboarding", params: { slug } });
  }
}
