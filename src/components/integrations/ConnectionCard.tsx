import { useStudioText } from "@/components/studio/StudioPrimitives";
import { canReadConnection } from "@/lib/integrations/queries";
import type { IntegrationConnection, ProviderId } from "@/lib/integrations/types";
import { MockBadge, ScopeDisclosure } from "./ConnectionConsent";

export function ConnectionCard({ provider, connection, enabled, connecting, syncing, revoking, onConnect, onSync, onRevoke, onPurge, onPick }: {
  provider: ProviderId; connection?: IntegrationConnection; enabled: boolean; connecting: boolean; syncing: boolean; revoking: boolean;
  onConnect: () => void; onSync: () => void; onRevoke: () => void; onPurge: () => void; onPick: () => void;
}) {
  const tx = useStudioText();
  const drive = provider === "google_drive";
  const name = drive ? "Google Drive" : "Instagram";
  const expired = connection && (connection.status === "reauth_required" || Date.parse(connection.expiresAt) <= Date.now());
  const revoked = connection?.status === "revoked";
  const read = enabled && canReadConnection(connection);
  const status = revoking ? tx("正在停止模擬連接…", "Stopping mock connection…") : revoked ? tx("已撤銷", "Revoked") : expired ? tx("已過期 · 需重新授權", "Expired · reconnect required")
    : connection?.lastError ? (/RATE|429/.test(connection.lastError) ? tx("暫時受限", "Temporarily limited") : tx("同步出錯", "Sync error"))
      : syncing ? tx("正在模擬同步…", "Syncing mock data…") : connection?.status === "partial" ? tx("部分授權", "Partial permission")
        : connection ? tx("模擬技能已準備好", "Mock skill ready") : tx("未連接", "Not connected");
  return <section className={`i-card ${drive ? "i-mint" : "i-lilac"}`} aria-label={tx(`${name} 模擬技能`, `${name} mock skill`)}>
    <div className="i-row"><span className="i-provider-icon" aria-hidden>{drive ? "📁" : "📸"}</span><MockBadge /></div>
    <div><p className="i-eyebrow">{drive ? tx("靈感背包", "Source backpack") : tx("成效雷達", "Performance radar")}</p><h2>{tx(name, name)}</h2></div>
    <p>{drive ? tx("帶上你選定的文件，讓每個想法都有出處。", "Pack the documents you choose. Give every idea a source.") : tx("從自己的成效找線索，為下一個作品多一點方向。", "Find clues in your own results for your next creation.")}</p>
    <span className={`i-badge ${connection && !expired && !revoked ? "i-ready" : ""}`} role="status">{status}</span>
    <dl className="i-facts">
      <div><dt>{tx("帳號", "Account")}</dt><dd>{connection?.label ?? tx("尚未授權", "Not authorized")}</dd></div>
      <div><dt>{tx("最後同步", "Last sync")}</dt><dd>{connection?.lastSyncAt ? <time dateTime={connection.lastSyncAt}>{new Date(connection.lastSyncAt).toLocaleString(tx("zh-HK", "en-GB"))}</time> : tx("未同步", "Never synced")}</dd></div>
    </dl>
    {connection && <details className="i-details"><summary>{tx("查看實際權限與有效期", "Inspect granted scopes and expiry")}</summary><ScopeDisclosure scopes={connection.scopes} granted /><p>{tx("有效期至：", "Expires: ")}<time dateTime={connection.expiresAt}>{new Date(connection.expiresAt).toLocaleString(tx("zh-HK", "en-GB"))}</time></p></details>}
    {connection?.status === "partial" && <p className="i-note">{tx("只可使用已授予的權限。需要更多資料時，請重新檢視授權。", "Only granted permissions are usable. Review consent if you need more data.")}</p>}
    {revoked && <p className="i-note">{revoking ? tx("此瀏覽器已暫停使用資料，正在等候伺服器及模擬平台的撤權結果。", "Data is paused in this browser while server and mock platform revocation are confirmed.") : connection.providerRevocation === "pending"
      ? tx("本地已停止。平台撤權仍待處理；可重試。", "Stopped locally. Platform revocation pending; you can retry.")
      : connection.providerRevocation === "manual_action" ? tx("本地已停止。平台撤權需要手動處理（模擬）。", "Stopped locally. Manual platform revocation required (mock).")
        : connection.providerRevocation === "revoked" ? tx("本地及模擬平台已撤權。重新連接不會恢復舊來源的同意。", "Local and mock platform access revoked. Reconnecting does not restore consent for old sources.")
          : tx("本地已停止。平台撤權未確認，請重試撤銷。", "Stopped locally. Platform revocation not confirmed; retry revocation.")}</p>}
    <div className="i-actions">
      {(!connection || expired || revoked || connection.status === "partial") && <button type="button" className="i-button i-primary" disabled={!enabled || connecting || revoking} onClick={onConnect} aria-label={tx(`連接模擬 ${name}`, `Connect mock ${name}`)}>{connecting ? tx("準備模擬授權…", "Preparing mock consent…") : connection ? tx("重新檢視模擬授權", "Review mock consent") : tx("試用模擬連接", "Try mock connection")}</button>}
      {read && <button type="button" className="i-button i-primary" disabled={syncing || revoking} onClick={drive ? onPick : onSync}>{drive ? tx("選擇模擬 Drive 文件", "Choose mock Drive files") : syncing ? tx("正在更新…", "Updating…") : tx("更新模擬成效", "Update mock insights")}</button>}
      {connection && (!revoked || connection.providerRevocation !== "revoked") && <button type="button" className="i-button i-quiet" disabled={revoking} onClick={onRevoke} aria-label={tx(`撤銷模擬 ${name}`, `Revoke mock ${name}`)}>{revoking ? tx("正在停止…", "Stopping…") : revoked ? tx("重試撤權", "Retry revocation") : tx("一鍵撤銷", "Revoke access")}</button>}
    </div>
    {connection && <button type="button" className="i-text-button" disabled={revoking} onClick={onPurge}>{tx("刪除匯入內容與衍生草稿", "Delete imported content and derived drafts")}</button>}
    <small>{drive ? tx("只讀所選文件；授權 scope 包含寫入能力，會在同意前完整披露。", "Read selected files only; the scope's write capability is disclosed before consent.") : tx("專業帳號適用。缺資料會標明，不補零、不推定香港受眾。", "For professional accounts. Missing data stays missing; no assumed zeros or Hong Kong audience.")}</small>
  </section>;
}
