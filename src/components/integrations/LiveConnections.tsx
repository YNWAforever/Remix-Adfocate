import { useState } from "react";
import { useStudioText, StudioLoginRequired } from "@/components/studio/StudioPrimitives";
import { ApiError } from "@/lib/api";
import { beginProviderLogin } from "@/lib/integrations/navigation";
import { canUseConnection, useIntegrationCommand, useLiveStart } from "@/lib/integrations/queries";
import type { IntegrationConnection, LiveAuthorization, ProviderId } from "@/lib/integrations/types";
import { IntegrationDialog, IntegrationError, LiveBadge, ScopeDisclosure } from "./ConnectionConsent";
import "./integrations.css";

const LABEL: Record<ProviderId, string> = { instagram: "Instagram", google_drive: "Google Drive" };
const PROVIDERS: readonly ProviderId[] = ["instagram", "google_drive"];

function LiveProvider({ provider, connection }: { provider: ProviderId; connection?: IntegrationConnection }) {
  const tx = useStudioText();
  const start = useLiveStart(), command = useIntegrationCommand();
  const [authorization, setAuthorization] = useState<LiveAuthorization | null>(null);
  const [purge, setPurge] = useState(false);
  const [notice, setNotice] = useState("");
  const name = LABEL[provider];
  const readable = connection && canUseConnection(connection);
  const error = start.error ?? command.error;
  const signedOut = error instanceof ApiError && error.status === 401;
  if (signedOut) return <StudioLoginRequired context="connections" />;
  const status = !connection ? tx("未連接", "Not connected")
    : connection.status === "revoked" ? tx("已撤銷", "Revoked")
      : connection.status === "reauth_required" || Date.parse(connection.expiresAt) <= Date.now() ? tx("已過期，需要重新連接", "Expired, reconnect required")
        : connection.lastError ? (/RATE|429/.test(connection.lastError) ? tx("暫時受到限制", "Temporarily limited") : tx("同步出錯", "Sync error"))
          : connection.status === "partial" ? tx("部分權限", "Partial permission") : tx("已連接", "Connected");
  const begin = async () => {
    setNotice("");
    start.reset();
    try { setAuthorization(await start.mutateAsync(provider)); }
    catch { /* Sanitized error below. */ }
  };
  const sync = () => {
    if (!connection) return;
    setNotice("");
    command.mutate({ action: "sync", connectionId: connection.id, requestId: crypto.randomUUID() }, {
      onSuccess: result => {
        if (!("status" in result)) return;
        setNotice(result.status === "rate_limited"
          ? tx("同步暫時受到限制，請稍後再試。", "Sync is temporarily limited; try later.")
          : result.status === "partial" ? tx("已同步部分見解，未提供的資料保持未提供。", "Partial insights updated; missing data stays missing.")
            : tx("見解已同步。", "Insights synced."));
      },
    });
  };
  return <section className={`i-card ${provider === "google_drive" ? "i-mint" : "i-lilac"}`} aria-label={`${name} live connection`}>
    <div className="i-row"><span className="i-provider-icon" aria-hidden>{provider === "google_drive" ? "📁" : "📸"}</span><LiveBadge/></div>
    <div><p className="i-eyebrow">{provider === "google_drive" ? tx("來源背包", "Source backpack") : tx("成效雷達", "Performance radar")}</p><h2>{name}</h2></div>
    <p>{provider === "google_drive" ? tx("把你揀選的文件帶進討論。", "Bring the documents you choose into a discussion.") : tx("從自己的成效訊號找下一個靈感。", "Find clues in your own results for your next creation.")}</p>
    <span className={`i-badge ${connection && readable ? "i-ready" : ""}`} role="status">{status}</span>
    <dl className="i-facts">
      <div><dt>{tx("帳戶", "Account")}</dt><dd>{connection?.label ?? tx("尚未授權", "Not authorized")}</dd></div>
      <div><dt>{tx("上次同步", "Last sync")}</dt><dd>{connection?.lastSyncAt ? <time dateTime={connection.lastSyncAt}>{new Date(connection.lastSyncAt).toLocaleString(tx("zh-HK", "en-GB"))}</time> : tx("從未同步", "Never synced")}</dd></div>
    </dl>
    {connection && <details className="i-details"><summary>{tx("查看已授權範圍與到期時間", "Inspect granted scopes and expiry")}</summary><ScopeDisclosure scopes={connection.scopes} granted/><p>{tx("到期：", "Expires: ")}<time dateTime={connection.expiresAt}>{new Date(connection.expiresAt).toLocaleString(tx("zh-HK", "en-GB"))}</time></p></details>}
    {notice && <p role="status" className="i-note">{notice}</p>}
    {start.isError && !authorization && <IntegrationError error={start.error}/>}
    {command.isError && <IntegrationError error={command.error}/>}
    <div className="i-actions">
      <button type="button" className="i-button i-primary" disabled={start.isPending || command.isPending} onClick={() => void begin()}>
        {start.isPending ? tx("正在準備授權…", "Preparing authorization…") : connection ? tx("重新連接", "Reconnect") : tx(`連接 ${name}`, `Connect ${name}`)}
      </button>
      {provider === "instagram" && readable && <button type="button" className="i-button" disabled={command.isPending} onClick={sync}>{command.isPending ? tx("正在同步…", "Syncing…") : tx("同步見解", "Sync insights")}</button>}
      {connection && <button type="button" className="i-button i-quiet" disabled={command.isPending} onClick={() => command.mutate({ action: "revoke", connectionId: connection.id, requestId: crypto.randomUUID() })}>{tx("撤銷存取", "Revoke access")}</button>}
    </div>
    {provider === "google_drive" && connection && <p className="i-note">{tx("即時檔案揀選會於下一階段開放；此連接已可撤銷。", "Live file selection arrives next; this connection can already be revoked.")}</p>}
    {connection && <button type="button" className="i-text-button" disabled={command.isPending} onClick={() => setPurge(true)}>{tx("刪除已匯入內容及衍生草稿", "Delete imported content and derived drafts")}</button>}
    {purge && connection && <IntegrationDialog title={tx("刪除已匯入內容", "Delete imported content")} busy={command.isPending} badge={<LiveBadge/>} onClose={() => setPurge(false)}>
      <p>{tx("這會刪除已匯入的來源及相關衍生草稿；獨立撰寫的內容與必要的任務紀錄會保留。", "This deletes imported sources and related derived drafts; independently written content and necessary mission records remain.")}</p>
      {command.isError && <IntegrationError error={command.error}/>}
      <div className="i-actions"><button type="button" className="i-button" disabled={command.isPending} onClick={() => setPurge(false)}>{tx("取消", "Cancel")}</button>
        <button type="button" className="i-button i-danger" disabled={command.isPending} onClick={() => command.mutate({ action: "purge", connectionId: connection.id, requestId: crypto.randomUUID() }, { onSuccess: () => { setPurge(false); setNotice(tx("已刪除已匯入內容。", "Imported content deleted.")); } })}>{command.isPending ? tx("正在刪除…", "Deleting…") : tx("確認刪除", "Confirm deletion")}</button>
      </div>
    </IntegrationDialog>}
    {authorization && <IntegrationDialog title={tx(`連接 ${name}`, `Connect ${name}`)} badge={<LiveBadge/>} busy={start.isPending} onClose={() => setAuthorization(null)}>
      <p>{tx("你將前往平台登入並授權 KOCmax 讀取以下範圍；完成後會返回此頁。", "You will sign in with the provider and grant KOCmax the scopes below, then return here.")}</p>
      <ScopeDisclosure scopes={authorization.scopes}/>
      <p className="i-note">{provider === "instagram" ? tx("需要 Instagram 專業帳戶（Business / Creator）。個人帳戶可繼續使用手動來源。", "Insights need a Business or Creator account. Personal accounts can keep using manual sources.") : tx("只讀取你揀選的檔案。", "Selected files only.")}</p>
      <small>{tx("授權只代表資料存取；AI 使用與分享仍需另行確認。", "Access only grants data reading; AI processing and sharing need separate confirmation.")}</small>
      <div className="i-actions"><button type="button" className="i-button" disabled={start.isPending} onClick={() => setAuthorization(null)}>{tx("取消", "Cancel")}</button>
        <button type="button" className="i-button i-primary" disabled={start.isPending || Date.parse(authorization.expiresAt) <= Date.now()} onClick={() => beginProviderLogin(authorization.authorizationUrl)}>{tx(`前往 ${name} 登入`, `Continue to ${name}`)}</button>
      </div>
    </IntegrationDialog>}
  </section>;
}

export function LiveProviders({ connections }: { connections: IntegrationConnection[] }) {
  return <div className="i-grid">{PROVIDERS.map(provider => <LiveProvider key={provider} provider={provider} connection={connections.find(item => item.provider === provider)} />)}</div>;
}
