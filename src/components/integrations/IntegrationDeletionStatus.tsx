import { useI18n } from "@/lib/i18n";

export type DeletionStatus = "loading" | "pending" | "completed" | "unknown" | "unavailable";

export function IntegrationDeletionStatus({ status }: { status: DeletionStatus }) {
  const { lang } = useI18n(), en = lang === "en";
  const labels = {
    loading: en ? "Checking receipt" : "正在核對回執",
    pending: en ? "Pending" : "處理中",
    completed: en ? "Processing completed" : "處理已完成",
    unknown: en ? "Receipt not found" : "找不到回執",
    unavailable: en ? "Status unavailable" : "暫時無法查詢狀態",
  };
  const details = {
    loading: en ? "Please wait while the recorded status is checked." : "正在查詢已記錄的處理狀態。",
    pending: en ? "This request is still being processed." : "此申請仍在處理中。",
    completed: en ? "Processing for this receipt is recorded as completed." : "此回執的處理已記錄為完成。",
    unknown: en ? "The processing result could not be confirmed. Check the original receipt link." : "未能確認處理結果，請核對原有回執連結。",
    unavailable: en ? "The processing result could not be confirmed. Please try again later." : "未能確認處理結果，請稍後再試。",
  };
  return <section className="mx-auto max-w-xl px-6 py-16" aria-labelledby="deletion-status-title">
    <h1 id="deletion-status-title" className="text-2xl font-bold">{en ? "Data deletion status" : "資料刪除狀態"}</h1>
    <p role="status" aria-live="polite" className="mt-6 font-semibold">{labels[status]}</p>
    <p className="mt-3">{details[status]}</p>
    <p className="mt-6 text-sm">{en
      ? "This receipt reports processing status only. It does not verify platform revocation or backup erasure."
      : "此頁只顯示回執處理狀態，不代表平台撤銷或備份清除已獲驗證。"}</p>
  </section>;
}
