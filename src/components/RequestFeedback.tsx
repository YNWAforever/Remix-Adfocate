import { useEffect, useRef, useState } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";

export function canShowPreviousData(error: unknown): boolean {
  const status = typeof error === "object" && error !== null && "status" in error ? error.status : null;
  return status !== 401 && status !== 403 && status !== 404;
}
// Keep denial evidence with the cached query, including across page remounts.
// A later outage is not evidence that access was restored.
const deniedQueries = new WeakMap<object, number>();
type CachedRead = { data?: unknown; error?: unknown; isError?: boolean; isSuccess?: boolean };
/** One subscription for dynamic useQueries results; barriers survive page remounts. */
export function useCanShowPreviousQueriesData(reads: readonly { read: CachedRead; queryKey: QueryKey }[]): boolean[] {
  const cache = useQueryClient().getQueryCache();
  const [, refresh] = useState(0);
  const hashes = JSON.stringify(reads.map(({ queryKey }) => cache.find({ queryKey, exact: true })?.queryHash ?? null));
  useEffect(() => {
    const queryHashes: (string | null)[] = JSON.parse(hashes);
    const record = (query: { state: { error: unknown; status: string; dataUpdateCount: number } }) => {
      const barrier = deniedQueries.get(query);
      if (!canShowPreviousData(query.state.error)) {
        if (barrier === query.state.dataUpdateCount) return;
        deniedQueries.set(query, query.state.dataUpdateCount);
      } else if (query.state.status === "success" && barrier !== undefined && query.state.dataUpdateCount > barrier) {
        deniedQueries.delete(query);
      } else return;
      refresh(value => value + 1);
    };
    for (const queryHash of queryHashes) {
      const query = queryHash === null ? undefined : cache.get(queryHash);
      if (query) record(query);
    }
    return cache.subscribe(event => {
      if (event.type === "updated" && queryHashes.includes(event.query.queryHash)) record(event.query);
    });
  }, [cache, hashes]);
  return reads.map(({ read, queryKey }) => {
    const query = cache.find({ queryKey, exact: true });
    const barrier = query && deniedQueries.get(query);
    return canShowPreviousData(read.error) && (barrier === undefined || Boolean(query && query.state.dataUpdateCount > barrier));
  });
}
export function useCanShowPreviousData(read: CachedRead, queryKey: QueryKey, actionError?: unknown): boolean {
  const client = useQueryClient(), cache = client.getQueryCache();
  const query = cache.find({ queryKey, exact: true });
  const [denied, setDenied] = useState(false);
  const seenActionDenial = useRef<unknown>(null);
  const deniedRead = !canShowPreviousData(read.error);
  const successfulRead = !read.error && (read.isSuccess ?? (!read.isError && read.data !== undefined));
  const newActionDenial = !canShowPreviousData(actionError) && actionError !== seenActionDenial.current;
  useEffect(() => {
    const record = (blocked: boolean, successful: boolean) => {
      if (blocked) {
        if (query) deniedQueries.set(query, query.state.dataUpdateCount);
        setDenied(true);
      } else if (successful) {
        const barrier = query && deniedQueries.get(query);
        if (query && barrier !== undefined && query.state.dataUpdateCount <= barrier) return;
        if (query) deniedQueries.delete(query);
        setDenied(false);
      }
    };
    record(deniedRead, successfulRead);
    return cache.subscribe(event => {
      if (event.type !== "updated" || event.query !== query) return;
      record(!canShowPreviousData(query.state.error), query.state.status === "success");
    });
  }, [cache, query, deniedRead, successfulRead]);
  useEffect(() => {
    if (!newActionDenial) return;
    seenActionDenial.current = actionError;
    if (query) deniedQueries.set(query, query.state.dataUpdateCount);
    setDenied(true);
  }, [actionError, newActionDenial, query]);
  const barrier = query && deniedQueries.get(query);
  const authorizedRead = successfulRead && (!query || barrier === undefined || query.state.dataUpdateCount > barrier);
  return !deniedRead && !newActionDenial && (authorizedRead || !(denied || barrier !== undefined));
}

export function RequestFeedback({ error, retry, stale = false, summary }: { error: unknown; retry?: () => void; stale?: boolean; summary?: string }) {
  if (!error) return null;
  const status = typeof error === "object" && error !== null && "status" in error ? error.status : null;
  const message = status === 409 ? "資料已更新。原有輸入已保留，請重新載入後核對。 / This record changed. Your input is retained; reload and compare."
    : status === 403 ? "目前權限不足，請聯絡工作空間負責人。 / Workspace access is required. Contact the owner."
    : "暫時未能完成要求。請重試；原有輸入已保留。 / The request could not be completed. Your input is retained; please retry.";
  return <div role="alert" className="space-y-2 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-lemon)] p-3 text-sm">
    {summary && <p className="font-bold">{summary}</p>}
    <p>{message}</p>
    {stale && <p>下列為上次載入的資料，尚未更新。 / Showing the previous saved data; refresh failed.</p>}
    {retry && <button type="button" className="font-bold underline" onClick={retry}>重試 / Retry</button>}
  </div>;
}
