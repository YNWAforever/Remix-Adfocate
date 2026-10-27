export function canShowPreviousData(error: unknown): boolean {
  const status = typeof error === "object" && error !== null && "status" in error ? error.status : null;
  return status !== 401 && status !== 403 && status !== 404;
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
