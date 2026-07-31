import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AdminAuthError } from "@/lib/admin";
import {
  fetchRewardHandoffs,
  setRewardProcessingWindow,
  type RewardHandoffListFilters,
  type RewardHandoffQueueItem,
} from "@/lib/adminRewardHandoff";
import {
  getActivationAnalyticsSinkVersion,
  subscribeActivationAnalyticsSink,
  trackActivationEvent,
} from "@/lib/activationAnalytics";
import {
  RewardHandoffQueue,
  type RewardHandoffUiFilters,
} from "@/components/admin/RewardHandoffQueue";
import { useAdminAuth } from "@/components/admin/AdminAuthContext";
import { useAdminWorkspace } from "@/components/admin/AdminWorkspaceContext";
import { useI18n } from "@/lib/i18n";

export type RewardHandoffSearch = {
  due?: "overdue" | "due_soon" | "no_target";
  component?: "points" | "cash" | "xp";
  status: "pending" | "cancelled";
};

const DUE = new Set(["overdue", "due_soon", "no_target"]);
const COMPONENT = new Set(["points", "cash", "xp"]);
const STATUS = new Set(["pending", "cancelled"]);

export function validateRewardHandoffSearch(
  search: Record<string, unknown>,
): RewardHandoffSearch {
  const due = typeof search.due === "string" && DUE.has(search.due)
    ? search.due as RewardHandoffSearch["due"]
    : undefined;
  const component = typeof search.component === "string" && COMPONENT.has(search.component)
    ? search.component as RewardHandoffSearch["component"]
    : undefined;
  const status = typeof search.status === "string" && STATUS.has(search.status)
    ? search.status as RewardHandoffSearch["status"]
    : "pending";
  return {
    ...(due ? { due } : {}),
    ...(component ? { component } : {}),
    status,
  };
}

export const Route = createFileRoute("/admin/reward-handoffs")({
  validateSearch: validateRewardHandoffSearch,
  component: AdminRewardHandoffsRoute,
});

function analyticsProperties(
  lang: "en" | "zh",
  filters: RewardHandoffSearch,
) {
  return {
    locale: lang,
    dueFilter: filters.due ?? "all",
    componentFilter: filters.component ?? "all",
    statusFilter: filters.status,
  } as const;
}

export function AdminRewardHandoffsRoute() {
  const { authed, reportAuthError } = useAdminAuth();
  const { workspaceSlug } = useAdminWorkspace();
  const { lang, localeReady, t } = useI18n();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();
  const sinkVersion = useSyncExternalStore(
    subscribeActivationAnalyticsSink,
    getActivationAnalyticsSinkVersion,
    () => 0,
  );
  const viewedRef = useRef("");
  const filteredRef = useRef("");
  const pendingFilteredRef = useRef<RewardHandoffSearch | null>(null);
  const searchDue = search.due;
  const searchComponent = search.component;
  const searchStatus = search.status;
  const filters = useMemo(
    () => validateRewardHandoffSearch({
      due: searchDue, component: searchComponent, status: searchStatus,
    }),
    [searchComponent, searchDue, searchStatus],
  );
  const queryFilters: RewardHandoffListFilters = {
    workspace: workspaceSlug,
    ...filters,
  };

  const queue = useQuery({
    queryKey: ["admin-reward-handoffs", workspaceSlug, filters],
    queryFn: () => fetchRewardHandoffs(queryFilters),
    enabled: authed && Boolean(workspaceSlug),
    retry: false,
  });
  const [additionalItems, setAdditionalItems] = useState<RewardHandoffQueueItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    setAdditionalItems([]);
    setNextCursor(queue.data?.pageInfo?.nextCursor ?? null);
  }, [queue.data, workspaceSlug, filters]);

  useEffect(() => {
    if (queue.error instanceof AdminAuthError) reportAuthError(queue.error);
  }, [queue.error, reportAuthError]);

  useEffect(() => {
    if (!localeReady || !queue.data || !workspaceSlug) return;
    const identity = [
      workspaceSlug,
      filters.due ?? "all",
      filters.component ?? "all",
      filters.status,
      queue.dataUpdatedAt,
    ].join("|");
    if (viewedRef.current === identity) return;
    if (trackActivationEvent(
      "reward_handoff_queue_viewed",
      analyticsProperties(lang, filters),
    )) {
      viewedRef.current = identity;
    }
  }, [
    filters,
    lang,
    localeReady,
    queue.data,
    queue.dataUpdatedAt,
    sinkVersion,
    workspaceSlug,
  ]);

  useEffect(() => {
    const pending = pendingFilteredRef.current;
    if (!pending || !localeReady) return;
    const identity = [pending.due ?? "all", pending.component ?? "all", pending.status].join("|");
    if (filteredRef.current === identity) {
      pendingFilteredRef.current = null;
      return;
    }
    if (trackActivationEvent(
      "reward_handoff_queue_filtered",
      analyticsProperties(lang, pending),
    )) {
      filteredRef.current = identity;
      pendingFilteredRef.current = null;
    }
  }, [lang, localeReady, sinkVersion]);

  function changeFilters(next: RewardHandoffUiFilters) {
    const safe = validateRewardHandoffSearch(next as Record<string, unknown>);
    const identity = [safe.due ?? "all", safe.component ?? "all", safe.status].join("|");
    if (!localeReady) {
      pendingFilteredRef.current = safe;
    } else if (filteredRef.current !== identity) {
      if (trackActivationEvent(
        "reward_handoff_queue_filtered",
        analyticsProperties(lang, safe),
      )) {
        filteredRef.current = identity;
        pendingFilteredRef.current = null;
      } else {
        pendingFilteredRef.current = safe;
      }
    }
    void navigate({ search: safe, replace: true });
  }

  async function saveWindow(days: number | null) {
    await setRewardProcessingWindow({ workspace: workspaceSlug, days });
    await queryClient.invalidateQueries({
      queryKey: ["admin-reward-handoffs", workspaceSlug],
    });
  }

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchRewardHandoffs({
        ...queryFilters,
        cursor: nextCursor,
        limit: queue.data?.pageInfo?.limit ?? 50,
      });
      setAdditionalItems((current) => [...current, ...page.items]);
      setNextCursor(page.pageInfo.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }

  if (!workspaceSlug) {
    return (
      <p className="text-sm text-[var(--color-soft-ink)]">
        {t("app.admin.rewardHandoff.selectWorkspace")}
      </p>
    );
  }
  if (queue.isLoading) {
    return <p className="text-sm">{t("app.admin.rewardHandoff.loading")}</p>;
  }
  if (queue.isError) {
    return (
      <div role="alert" className="space-y-2 text-sm font-bold text-red-700">
        <p>{t("app.admin.rewardHandoff.loadError")}</p>
        <button
          type="button"
          onClick={() => void queue.refetch()}
          className="rounded-full border-2 border-current px-3 py-1 hover:bg-red-50"
        >
          {t("app.admin.rewardHandoff.retry")}
        </button>
      </div>
    );
  }

  return (
    <RewardHandoffQueue
      workspaceKey={workspaceSlug}
      items={[...(queue.data?.items ?? []), ...additionalItems]}
      filters={filters}
      processingWindowDays={queue.data?.rewardProcessingWindowDays ?? null}
      onFiltersChange={changeFilters}
      onSaveProcessingWindow={saveWindow}
      hasMore={Boolean(nextCursor)}
      loadingMore={loadingMore}
      onLoadMore={loadMore}
    />
  );
}
