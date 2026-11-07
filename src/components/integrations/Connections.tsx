import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Sprout, StudioLoginRequired, useStudioText } from "@/components/studio/StudioPrimitives";
import { ApiError } from "@/lib/api";
import { useConnections, useIntegrationCommand, useIntegrationIdentity } from "@/lib/integrations/queries";
import type { IntegrationConnection, IntegrationList, ProviderId, StartConnection } from "@/lib/integrations/types";
import { ConnectionCard } from "./ConnectionCard";
import { ConnectionConsent, D0Notice, IntegrationDialog, IntegrationError, IntegrationModeBadge, MockBadge } from "./ConnectionConsent";
import { DriveSourcePicker } from "./DriveSourcePicker";
import "./integrations.css";

function ProviderConnection({ provider, connection, enabled, mode, onLoginRequired }: { provider: ProviderId; connection?: IntegrationConnection; enabled: boolean; mode?: IntegrationList["mode"]; onLoginRequired: () => void }) {
  const tx = useStudioText();
  const connect = useIntegrationCommand(), sync = useIntegrationCommand(), lifecycle = useIntegrationCommand();
  const [consent, setConsent] = useState<StartConnection | null>(null);
  const [picker, setPicker] = useState(false), [purge, setPurge] = useState(false);
  const [notice, setNotice] = useState("");
  const sequence = useRef(0);
  const blocked = useRef(false), alive = useRef(true);
  const unauthorized = [connect, sync, lifecycle].some(result => result.isError && result.error instanceof ApiError && result.error.status === 401);
  useEffect(() => {
    const pendingSequence = sequence;
    alive.current = true;
    return () => { alive.current = false; ++pendingSequence.current; };
  }, []);
  useEffect(() => {
    if (unauthorized && !blocked.current) { blocked.current = true; ++sequence.current; onLoginRequired(); }
  }, [unauthorized, onLoginRequired]);
  useEffect(() => {
    if (!enabled) { ++sequence.current; setConsent(null); setPicker(false); setNotice(""); }
  }, [enabled]);
  const start = async () => {
    const attempt = ++sequence.current;
    setNotice(""); connect.reset();
    try {
      const result = await connect.mutateAsync({ action: "start", provider });
      if (alive.current && !blocked.current && attempt === sequence.current && "scopes" in result && result.provider === provider) setConsent(result);
    } catch { /* Sanitized feedback below. */ }
  };
  const revoke = async () => {
    if (!connection) return;
    ++sequence.current; setConsent(null); setPicker(false); setNotice("");
    try { await lifecycle.mutateAsync({ action: "revoke", connectionId: connection.id, requestId: crypto.randomUUID() }); }
    catch { /* No cached-data rollback after a failed stop. */ }
  };
  if (unauthorized || blocked.current) return <StudioLoginRequired context="connections"/>;
  return <div className="i-provider">
    <ConnectionCard provider={provider} connection={connection} enabled={enabled} mode={mode} connecting={connect.isPending} syncing={sync.isPending} revoking={lifecycle.isPending}
      onConnect={() => void start()} onPick={() => setPicker(true)} onPurge={() => { lifecycle.reset(); setPurge(true); }} onRevoke={() => void revoke()}
      onSync={() => {
        if (!connection) return;
        setNotice("");
        sync.mutate({ action: "sync", connectionId: connection.id, requestId: crypto.randomUUID() }, { onSuccess: result => {
          if (!alive.current || blocked.current) return;
          if ("resources" in result) setNotice(result.status === "rate_limited" ? tx("模擬同步受限，請稍後再試。", "Mock sync is rate limited; try later.") : result.status === "partial" ? tx("已更新部分模擬資料。缺失項目仍標示為未提供。", "Partial mock data updated. Missing items remain unavailable.") : tx("模擬資料已更新，可在討論的證據分頁選用。", "Mock data updated. Select it in your discussion's evidence tab."));
        } });
      }} />
    {notice && <p role="status" className="i-note">{notice}</p>}
    {!consent && connect.isError && <IntegrationError error={connect.error} />}
    {sync.isError && <IntegrationError error={sync.error} />}
    {!purge && lifecycle.isError && <><IntegrationError error={lifecycle.error} /><p className="i-note">{tx("此瀏覽器已暫停使用資料；伺服器及平台撤權尚未確認。請重試撤銷。", "This browser has paused the data. Server and platform revocation are not confirmed; retry revocation.")}</p></>}
    {consent && enabled && <ConnectionConsent request={consent} busy={connect.isPending} error={connect.error} onCancel={() => { ++sequence.current; setConsent(null); connect.reset(); }} onComplete={code => {
      connect.mutate({ action: "complete", provider, state: consent.state, code }, { onSuccess: () => { if (alive.current && !blocked.current) setConsent(null); } });
    }} />}
    {picker && connection && enabled && <DriveSourcePicker connection={connection} onCancel={() => setPicker(false)} onSelected={() => { setPicker(false); setNotice(tx("模擬文件已選好，請到討論的證據分頁確認用途及匯入。", "Mock files selected. Confirm their use and import in your discussion's evidence tab.")); }} />}
    {purge && connection && <IntegrationDialog title={tx("刪除模擬匯入內容", "Delete mock imported content")} busy={lifecycle.isPending} onClose={() => setPurge(false)}>
      <p>{tx("這會停止連接，刪除匯入來源及相關衍生草稿。你獨立撰寫的內容與必要任務回執會保留。", "This stops the connection and deletes imported sources and related derived drafts. Independently written content and necessary mission receipts remain.")}</p>
      <p className="i-note">{tx("已交付予接收者的副本無法收回。本操作不會刪除 Drive 原檔。", "Previously delivered copies cannot be recalled. This does not delete original Drive files.")}</p>
      {lifecycle.isError && <IntegrationError error={lifecycle.error} />}
      <div className="i-actions"><button type="button" className="i-button" disabled={lifecycle.isPending} onClick={() => setPurge(false)}>{tx("取消", "Cancel")}</button>
        <button type="button" className="i-button i-danger" disabled={lifecycle.isPending} onClick={() => lifecycle.mutate({ action: "purge", connectionId: connection.id, requestId: crypto.randomUUID() }, { onSuccess: result => {
          if (!alive.current || blocked.current) return;
          setPurge(false); setNotice("state" in result && result.state === "complete" ? tx("模擬匯入內容已刪除。", "Imported mock content deleted.") : tx("模擬清除仍待處理，可稍後重試。", "Mock deletion is pending; retry later."));
        } })}>{lifecycle.isPending ? tx("正在清除…", "Deleting…") : tx("確認刪除", "Confirm deletion")}</button>
      </div>
    </IntegrationDialog>}
  </div>;
}

export function Connections() {
  const identity = useIntegrationIdentity();
  return <ConnectionsForOwner key={identity} />;
}

function ConnectionsForOwner() {
  const tx = useStudioText(), query = useConnections();
  const [loginRequired, setLoginRequired] = useState(false);
  const unauthorized = query.isError && query.error instanceof ApiError && query.error.status === 401;
  useEffect(() => { if (unauthorized) setLoginRequired(true); }, [unauthorized]);
  if (loginRequired || unauthorized) return <StudioLoginRequired context="connections"/>;
  return <div className="integration-ui i-page">
    <header className="i-hero"><div><p className="i-eyebrow">{tx("你的創作技能收藏", "Your creative skill collection")}</p><h1>{tx("把靈感，連在一起。", "Make room for more ideas.")}</h1><p>{tx("選一個小幫手，帶著自己的資料開始創作。每一步由你決定。", "Choose a little helper. Bring your own sources into your creative process, one choice at a time.")}</p><IntegrationModeBadge mode={query.data?.mode} /></div><Sprout /></header>
    {(query.data?.pilot?.stage === "D0" || query.data?.mode === "live_pilot") && <D0Notice />}
    <ol className="i-steps"><li><span aria-hidden>01</span>{tx("檢視連接權限", "Review access")}</li><li><span aria-hidden>02</span>{tx("挑選私人來源", "Choose private sources")}</li><li><span aria-hidden>03</span>{tx("另行確認 AI 與分享", "Decide AI & sharing")}</li></ol>
    <p className="i-note">{tx("這裡是模擬體驗，不會連接真實平台。連接、同步及匯入不會發放積分或 XP，亦不代表帳號擁有權已核實。", "This is a mock experience with no live provider connection. Connecting, syncing and importing earn no points or XP, and do not verify account ownership.")}</p>
    {query.isPending && <p role="status">{tx("準備模擬技能…", "Preparing mock skills…")}</p>}
    {query.isError && <IntegrationError error={query.error} onRetry={() => void query.refetch()} />}
    {query.data?.mode === "disabled" && <p className="i-note">{tx("模擬連接尚未啟用。手動來源與基本任務仍可使用。", "Mock connections are not enabled. Manual sources and basic missions remain available.")}</p>}
    <div className="i-grid">{(["instagram", "google_drive"] as const).map(provider => <ProviderConnection key={provider} provider={provider} mode={query.data?.mode} enabled={query.data?.mode === "mock"} connection={query.data?.connections.find(item => item.provider === provider)} onLoginRequired={() => setLoginRequired(true)} />)}</div>
    <section className="i-basic"><div><h2>{tx("先創作，也很好。", "You can start right here.")}</h2><p>{tx("連接是選項，基本任務隨時可做。", "Connections are optional. Basic missions are always available.")}</p></div><Link to="/home" className="i-button i-primary">{tx("先開始創作", "Start creating now")}</Link></section>
    <section className="i-stack" aria-labelledby="later-integrations"><div><p className="i-eyebrow">{tx("下一批小幫手", "More helpers on the way")}</p><h2 id="later-integrations">{tx("慢慢擴充你的技能收藏", "Grow your skill collection")}</h2></div>
      <div className="i-later-grid">{[["TikTok", "🎵", "短片探索", "Short video insights"], ["YouTube", "▶️", "影片洞察", "Video insights"], ["Search Console", "🔎", "搜尋線索", "Search insights"], ["Calendar", "🗓️", "創作日程", "Creator calendar"], ["Gmail", "✉️", "合作信箱（只讀）", "Collaboration inbox (read only)"], ["Telegram", "💬", "訊息線索", "Message insights"]].map(([name, icon, zh, en]) => <section className="i-later" key={name}><div className="i-row"><span aria-hidden className="i-provider-icon">{icon}</span><span className="i-badge">{tx("稍後開放", "Later")}</span></div><h3>{tx(name, name)}</h3><p>{tx(zh, en)}</p><small>{tx("未連接 · 未授權 · 未同步", "Not connected · no scopes · never synced")}</small><MockBadge /></section>)}</div>
    </section>
  </div>;
}
