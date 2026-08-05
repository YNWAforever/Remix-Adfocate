import type { useNavigate } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
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

/** User whose data currently populates the query cache; null once signed out. */
let cachedUserId: string | null = null;

/**
 * Single choke point that ties the query cache to the Supabase session: every
 * identity change (sign-in, sign-out, or a new user replacing another in the
 * same tab — /login is reachable while still authenticated) wipes the cache, so
 * no account can ever read the previous account's balance, notifications or
 * ["me"]. Keyed on the user id rather than the event so a routine hourly token
 * refresh keeps its cache instead of triggering a refetch storm; INITIAL_SESSION
 * only records the id, because the cache is empty on a fresh page load.
 *
 * The client is passed in rather than imported: router.tsx already reaches
 * auth-flow through the generated route tree, so importing back would cycle.
 */
export function bindQueryCacheToAuth(queryClient: QueryClient): () => void {
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    const userId = session?.user?.id ?? null;
    if (event === "INITIAL_SESSION") {
      cachedUserId = userId;
      return;
    }
    if (userId === cachedUserId) return;
    cachedUserId = userId;
    queryClient.clear();
  });
  return () => data.subscription.unsubscribe();
}
