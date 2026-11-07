import { useStudioText } from "@/components/studio/StudioPrimitives";
import { canReadConnection, revocationUnresolved } from "@/lib/integrations/queries";
import type { IntegrationConnection, IntegrationList, ProviderId } from "@/lib/integrations/types";
import { IntegrationModeBadge, ProposedPermissions, ScopeDisclosure } from "./ConnectionConsent";

export function ConnectionCard({ provider, connection, enabled, mode = "mock", connecting, syncing, revoking, onConnect, onSync, onRevoke, onPurge, onPick }: {
  provider: ProviderId; connection?: IntegrationConnection; enabled: boolean; connecting: boolean; syncing: boolean; revoking: boolean;
  mode?: IntegrationList["mode"];
  onConnect: () => void; onSync: () => void; onRevoke: () => void; onPurge: () => void; onPick: () => void;
}) {
  const tx = useStudioText();
  const drive = provider === "google_drive";
  const name = drive ? "Google Drive" : "Instagram";
  const expired = connection && (connection.status === "reauth_required" || Date.parse(connection.expiresAt) <= Date.now());
  const revoked = connection?.status === "revoked";
  const blockedReconnect = revocationUnresolved(connection);
  const sample = connection?.sampleOnly !== false;
  const offline = mode === "live_pilot" || !sample;
  const read = enabled && canReadConnection(connection);
  const status = revoking ? tx("正在停止模擬連接…", "Stopping mock connection…") : revoked ? tx("已撤銷", "Revoked") : expired ? tx("已過期 · 需重新授權", "Expired · reconnect required")
    : connection?.lastError ? (/RATE|429/.test(connection.lastError) ? tx("暫時受限", "Temporarily limited") : tx("同步出錯", "Sync error"))
      : syncing ? tx("正在模擬同步…", "Syncing mock data…") : connection?.status === "partial" ? tx("部分授權", "Partial permission")
        : offline ? tx("離線 · 真實連接未啟用", "Offline · live access disabled") : connection ? tx("模擬技能已準備好", "Mock skill ready") : tx("未連接", "Not connected");
  return <section className={`i-card ${drive ? "i-mint" : "i-lilac"}`} aria-label={offline ? tx(`${name} 離線試點`, `${name} offline pilot`) : tx(`${name} 模擬技能`, `${name} mock skill`)}>
    <div className="i-row"><span className="i-provider-icon" aria-hidden>{drive ? "📁" : "📸"}</span><IntegrationModeBadge mode={mode} sampleOnly={sample} /></div>
    <div><p className="i-eyebrow">{drive ? tx("靈感背包", "Source backpack") : tx("成效雷達", "Performance radar")}</p><h2>{tx(name, name)}</h2></div>
    <p>{drive ? tx("帶上你選定的文件，讓每個想法都有出處。", "Pack the documents you choose. Give every idea a source.") : tx("從自己的成效找線索，為下一個作品多一點方向。", "Find clues in your own results for your next creation.")}</p>
    <span className={`i-badge ${connection && !expired && !revoked && !offline ? "i-ready" : ""}`} role="status">{status}</span>
    {offline && sample && connection && <small>{tx("以下帳號及狀態均為合成示例，沒有真實連線。", "The account and state below are examples only, with no live connection.")}</small>}
    <dl className="i-facts">
      <div><dt>{tx("帳號", "Account")}</dt><dd>{connection?.label ?? tx("尚未授權", "Not authorized")}</dd></div>
      <div><dt>{tx("最後同步", "Last sync")}</dt><dd>{connection?.lastSyncAt ? <time dateTime={connection.lastSyncAt}>{new Date(connection.lastSyncAt).toLocaleString(tx("zh-HK", "en-GB"))}</time> : tx("未同步", "Never synced")}</dd></div>
    </dl>
    <ProposedPermissions provider={provider} />
    {connection && <details className="i-details"><summary>{tx("查看實際權限與有效期", "Inspect granted scopes and expiry")}</summary><ScopeDisclosure scopes={connection.scopes} granted /><p>{tx("有效期至：", "Expires: ")}<time dateTime={connection.expiresAt}>{new Date(connection.expiresAt).toLocaleString(tx("zh-HK", "en-GB"))}</time></p></details>}
    {connection?.status === "partial" && <p className="i-note">{tx("只可使用已授予的權限。需要更多資料時，請重新檢視授權。", "Only granted permissions are usable. Review consent if you need more data.")}</p>}
    {revoked && <p className="i-note">{revoking ? tx("此瀏覽器已暫停使用資料，正在等候伺服器及模擬平台的撤權結果。", "Data is paused in this browser while server and mock platform revocation are confirmed.") : connection.providerRevocation === "pending"
      ? tx("本地已停止。平台撤權仍待處理；可重試。", "Stopped locally. Platform revocation pending; you can retry.")
      : connection.providerRevocation === "manual_action" ? tx("本地已停止。平台撤權需要手動處理。", "Stopped locally. Manual platform revocation required.")
        : connection.providerRevocation === "revoked" ? (sample ? tx("本地及模擬平台已撤權。重新連接不會恢復舊來源的同意。", "Local and mock platform access revoked. Reconnecting does not restore consent for old sources.") : tx("已記錄平台撤權結果。D0 沒有進行真實平台核對；重新連接不恢復舊同意。", "A platform revocation result is recorded. D0 has not checked the live provider; reconnecting does not restore old consent."))
          : tx("本地已停止。平台撤權未確認，請重試撤銷。", "Stopped locally. Platform revocation not confirmed; retry revocation.")}</p>}
    {blockedReconnect && <p className="i-note">{tx("請先解決平台撤權，再重新連接。重連須重新確認帳號與用途，不會恢復舊同意。", "Resolve platform revocation before reconnecting. Reconnection needs fresh account and purpose confirmation; old consent is not restored.")}</p>}
    {drive && connection && <small>{tx("撤銷 Google 授權可能影響同一 Google 專案內、同一帳號在其他工作區的連接；不顯示其他工作區名稱或內容。", "Revoking Google access may affect this account's connections in other workspaces in the same Google project. Their names and content remain private.")}</small>}
    <div className="i-actions">
      {offline && <button type="button" className="i-button i-primary" disabled aria-label={tx(`D0 無法連接真實 ${name}`, `Live ${name} connection unavailable in D0`)}>{tx("真實連接尚未啟用", "Live connection unavailable")}</button>}
      {!offline && (!connection || expired || revoked || connection.status === "partial") && <button type="button" className="i-button i-primary" disabled={!enabled || connecting || revoking || blockedReconnect} onClick={onConnect} aria-label={tx(`連接模擬 ${name}`, `Connect mock ${name}`)}>{connecting ? tx("準備模擬授權…", "Preparing mock consent…") : connection ? tx("重新檢視模擬授權", "Review mock consent") : tx("試用模擬連接", "Try mock connection")}</button>}
      {read && <button type="button" className="i-button i-primary" disabled={syncing || revoking} onClick={drive ? onPick : onSync}>{drive ? tx("選擇模擬 Drive 文件", "Choose mock Drive files") : syncing ? tx("正在更新…", "Updating…") : tx("更新模擬成效", "Update mock insights")}</button>}
      {connection && (!revoked || connection.providerRevocation !== "revoked") && <button type="button" className="i-button i-quiet" disabled={revoking || !sample} onClick={onRevoke} aria-label={sample ? tx(`撤銷模擬 ${name}`, `Revoke mock ${name}`) : tx(`撤銷 ${name}（D0 未啟用）`, `Revoke ${name} (unavailable in D0)`)}>{revoking ? tx("正在停止…", "Stopping…") : revoked ? tx("重試撤權", "Retry revocation") : tx("一鍵撤銷", "Revoke access")}</button>}
    </div>
    {connection && <button type="button" className="i-text-button" disabled={revoking || !sample} onClick={onPurge}>{tx("刪除匯入內容與衍生草稿", "Delete imported content and derived drafts")}</button>}
    <small>{drive ? tx("只讀所選文件；授權 scope 包含寫入能力，會在同意前完整披露。", "Read selected files only; the scope's write capability is disclosed before consent.") : tx("專業帳號適用。缺資料會標明，不補零、不推定香港受眾。", "For professional accounts. Missing data stays missing; no assumed zeros or Hong Kong audience.")}</small>
  </section>;
}
