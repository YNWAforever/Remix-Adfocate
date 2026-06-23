// src/components/admin/useAdminQueueCounts.ts
import { useQuery } from "@tanstack/react-query";
import { adminKeys, fetchApplications, fetchSubmissions } from "@/lib/admin";
import { useAdminAuth } from "./AdminAuthContext";
import { useAdminWorkspace } from "./AdminWorkspaceContext";

/**
 * Live counts for the Applications/Submissions sidebar badges. Uses the same query
 * keys the tab pages populate, so it shares the React-Query cache and triggers no
 * extra fetch (migrated out of the old AdminTabs).
 */
export function useAdminQueueCounts(): { applications?: number; submissions?: number } {
  const { authed } = useAdminAuth();
  const { workspace } = useAdminWorkspace();
  const apps = useQuery({
    queryKey: adminKeys.applications(workspace),
    queryFn: () => fetchApplications(workspace),
    enabled: authed,
    retry: false,
  });
  const subs = useQuery({
    queryKey: adminKeys.submissions("submitted", workspace),
    queryFn: () => fetchSubmissions("submitted", workspace),
    enabled: authed,
    retry: false,
  });
  return { applications: apps.data?.applications.length, submissions: subs.data?.submissions.length };
}
