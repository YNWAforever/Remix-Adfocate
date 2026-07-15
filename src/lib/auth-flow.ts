import type { useNavigate } from "@tanstack/react-router";
import { supabase } from "./supabase";
import { apiFetch, setWorkspaceSlug } from "./api";
import { resolveWorkspace } from "./workspace";

type Navigate = ReturnType<typeof useNavigate>;

export type FinishAuthResult = {
  created: boolean;
  onboardingCompleted: boolean;
  destination: "/onboarding" | "/home";
};

/**
 * Shared post-auth branch, invoked from BOTH the inline WhatsApp verify handler
 * and the redirect callback. Bootstraps the creator, refreshes the session, then
 * routes to the wizard (onboarding incomplete) or home. Throws on any failure so
 * callers can surface a recoverable error state.
 */
export async function finishAuth(navigate: Navigate): Promise<FinishAuthResult> {
  const slug = resolveWorkspace();
  setWorkspaceSlug(slug);
  const ref = new URLSearchParams(window.location.search).get("ref") ?? undefined;
  const bootstrap = await apiFetch<{ created: boolean }>("/me/bootstrap", {
    method: "POST",
    body: JSON.stringify({ slug, ref }),
  });

  const { error } = await supabase.auth.refreshSession();
  if (error) throw error;

  const status = await apiFetch<{ onboarding_completed: boolean }>("/onboarding/status");
  const destination = status.onboarding_completed ? "/home" : "/onboarding";
  navigate({ to: destination });
  return {
    created: bootstrap.created,
    onboardingCompleted: status.onboarding_completed,
    destination,
  };
}
