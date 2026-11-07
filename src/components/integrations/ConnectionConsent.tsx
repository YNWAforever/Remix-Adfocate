import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ApiError } from "@/lib/api";
import type { IntegrationList, ProviderId, StartConnection } from "@/lib/integrations/types";
import { useStudioText } from "@/components/studio/StudioPrimitives";
import "./integrations.css";

export function MockBadge() {
  const tx = useStudioText();
  return <span className="i-badge i-mock">{tx("模擬 · 無真實連線", "Mock · no live connection")}</span>;
}

export function D0Notice() {
  const tx = useStudioText();
  return <aside role="note" aria-label={tx("D0 離線驗證", "D0 offline verification")} className="i-note i-offline">
    <strong>{tx("D0 · 僅離線驗證", "D0 · offline verification only")}</strong>
    <p>{tx("只提供示例資料。真實帳號授權、平台讀取及外部 AI 均未開啟。本機檢查不代表真實平台或任務核實已通過。", "Sample data only. Live account authorization, platform reads and external AI are disabled. Local checks do not verify real providers or mission completion.")}</p>
    <small>{tx("你的私人草稿仍屬於你；手動來源與基本任務可繼續使用。", "Your private drafts remain yours. Manual sources and basic missions remain available.")}</small>
  </aside>;
}

export function IntegrationModeBadge({ mode, sampleOnly = true }: { mode?: IntegrationList["mode"]; sampleOnly?: boolean }) {
  const tx = useStudioText();
  if (mode === "live_pilot" || !sampleOnly) return <span className="i-badge i-mock">{tx("D0 · 真實連接未啟用", "D0 · live access disabled")}</span>;
  return <MockBadge />;
}

export function ProposedPermissions({ provider }: { provider: ProviderId }) {
  const tx = useStudioText();
  const scopes = provider === "google_drive" ? ["https://www.googleapis.com/auth/drive.file", "openid"] : ["instagram_business_basic", "instagram_business_manage_insights"];
  return <details className="i-details"><summary>{tx("擬議真實試點權限", "Proposed live pilot permissions")}</summary>
    <p>{tx("以下只作事前說明，尚未要求或授予真實權限。連接、選取、處理及轉存是四個獨立決定。", "For review only; no live permissions have been requested or granted. Connection, selection, processing and sharing are four separate decisions.")}</p>
    <ScopeDisclosure scopes={scopes} proposed />
    <p className="i-note">{tx("來源及 Brief 預設私人。可讀取或下載不代表有處理或轉分享權。AI 與任務接收者用途均需另行確認。", "Sources and Briefs are private by default. Reading or downloading does not grant processing or sharing rights. AI and mission-recipient use each need separate confirmation.")}</p>
  </details>;
}

export function IntegrationError({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const tx = useStudioText();
  const denied = error instanceof ApiError && [401, 403].includes(error.status);
  const limited = error instanceof ApiError && error.status === 429;
  return <div role="alert" className="i-error"><p>{denied
    ? tx("來源權限無法確認，已停止使用相關資料。你的提問仍保留。", "Source access could not be confirmed. Related data is paused; your question is kept.")
    : limited ? tx("服務暫時受限，請稍後重試。你的輸入仍保留。", "The service is temporarily limited. Try later; your inputs are kept.")
      : error instanceof ApiError && error.code === "REVOCATION_PENDING" ? tx("請先處理尚未完成的平台撤權，再重新連接。你的輸入仍保留。", "Resolve pending platform revocation before reconnecting. Your inputs are kept.")
        : tx("資料暫時無法載入。你的輸入仍保留，可繼續基本任務。", "Data is temporarily unavailable. Your inputs are kept and basic missions remain available.")}</p>
    {onRetry && <button className="i-button" type="button" onClick={onRetry}>{tx("再試一次", "Try again")}</button>}
  </div>;
}

/** A contained modal: keyboard loop, inert background, scroll lock and focus return. */
export function IntegrationDialog({ title, children, onClose, busy = false, badge = <MockBadge /> }: { title: string; children: ReactNode; onClose: () => void; busy?: boolean; badge?: ReactNode }) {
  const heading = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const close = useRef(onClose); close.current = onClose;
  const pending = useRef(busy); pending.current = busy;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    const siblings = Array.from(document.body.children).filter(node => node !== overlay.current && node instanceof HTMLElement) as HTMLElement[];
    const inert = siblings.map(node => node.inert);
    siblings.forEach(node => { node.inert = true; });
    document.body.style.overflow = "hidden";
    dialog.current?.focus();
    const containFocus = (event: FocusEvent) => {
      if (!dialog.current?.contains(event.target as Node)) dialog.current?.focus();
    };
    document.addEventListener("focusin", containFocus);
    return () => {
      document.removeEventListener("focusin", containFocus);
      siblings.forEach((node, i) => { node.inert = inert[i]; });
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return createPortal(<div ref={overlay} className="integration-ui i-overlay" role="presentation" onMouseDown={event => {
    if (event.target === event.currentTarget && !pending.current) close.current();
  }}>{/* Keyboard navigation belongs to the modal dialog container. */}
    {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
    <div ref={dialog} className="i-dialog" role="dialog" aria-modal="true" aria-labelledby={heading} aria-busy={busy} tabIndex={-1}
    onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (!pending.current) close.current(); }
      if (event.key !== "Tab") return;
      const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') ?? []).filter(node => !node.closest("[hidden]"));
      const first = controls[0], last = controls.at(-1), active = document.activeElement;
      if (!first) { event.preventDefault(); dialog.current?.focus(); }
      else if (event.shiftKey && (active === first || active === dialog.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (active === last || active === dialog.current)) { event.preventDefault(); first.focus(); }
    }}>
    {badge}<h2 id={heading}>{title}</h2>{children}
  </div></div>, document.body);
}

export function ScopeDisclosure({ scopes, granted = false, proposed = false }: { scopes: string[]; granted?: boolean; proposed?: boolean }) {
  const tx = useStudioText();
  return <div className="i-scopes"><h3>{proposed ? tx("擬議權限 · 尚未授權", "Proposed scopes · not granted") : granted ? tx("實際授予的全部權限", "All granted scopes") : tx("這次要求的全部權限", "All requested scopes")}</h3>
    {scopes.length === 0 ? <p>{tx("未授權", "Not authorized")}</p> : <ul>{scopes.map(scope => <li key={scope}><code>{scope}</code><p>{
      scope === "https://www.googleapis.com/auth/drive.file"
        ? tx("Google 的 drive.file 授權包含建立及修改指定檔案的能力，並非平台層只讀。KOCmax 本期只提供選定內容的讀取；不提供編輯、上載或更改分享。", "Google's drive.file scope can create and modify selected files; it is not read-only authorization. KOCmax only offers selected-content reading in this stage, with no editing, uploading or sharing changes.")
        : scope === "openid" ? tx("只核對 Google 帳號的穩定識別碼 sub，避免選錯帳號；不要求 email、profile 或 Gmail，也不取代 KOCmax 登入。", "Match Google's stable account identifier (sub) to prevent an account mismatch; no email, profile or Gmail access, and no replacement of KOCmax sign-in.")
          : scope === "instagram_business_basic" ? tx("辨識授權帳號及讀取自有媒體。連接不代表身分或作品已核實。", "Identify the authorized account and read owned media. A connection does not verify identity or work.")
          : scope === "instagram_business_manage_insights" ? tx("讀取專業帳號與自有媒體成效，不授予發文、訊息或留言管理。", "Read professional-account and owned-media insights; no publishing, messaging or comment management.")
            : tx("額外授予的權限；本期沒有對應工具。", "Additional granted scope; no corresponding tool is enabled in this stage.")
    }</p></li>)}</ul>}
  </div>;
}

export function ConnectionConsent({ request, busy, error, onCancel, onComplete }: {
  request: StartConnection; busy: boolean; error: unknown; onCancel: () => void; onComplete: (code: "allow" | "partial" | "deny") => void;
}) {
  const tx = useStudioText();
  const name = request.provider === "instagram" ? "Instagram" : "Google Drive";
  return <IntegrationDialog title={tx(`模擬 ${name} 授權`, `Mock ${name} consent`)} onClose={onCancel} busy={busy}>
    <p>{tx("用合成資料體驗連接，不會前往平台登入或存取真實帳號。", "Explore with sample data. This does not open a provider login or access a real account.")}</p>
    <ScopeDisclosure scopes={request.scopes} />
    {request.provider === "instagram" && <p className="i-note">{tx("成效功能適用於 Business／Creator 專業帳號。個人帳號可繼續使用手動來源。", "Insights support Business / Creator professional accounts. Personal accounts can continue with manual sources.")}</p>}
    <p className="i-note">{tx("連接只授予資料存取。AI 處理及分享必須另行選擇及確認，預設均不授權。", "Connection only grants data access. AI processing and sharing require separate choices and confirmation; neither is granted by default.")}</p>
    <small>{tx("取消後留在此處，原討論與輸入不變。模擬授權亦有期限；過期可重新開始。", "Cancel stays here and keeps your discussion and inputs. Mock consent also expires; you can start again.")}</small>
    {Boolean(error) && <IntegrationError error={error} />}
    <div className="i-actions">
      <button type="button" className="i-button" disabled={busy} onClick={onCancel}>{tx("取消", "Cancel")}</button>
      {request.provider === "instagram" && <button type="button" className="i-button" disabled={busy} onClick={() => onComplete("partial")}>{tx("只授予部分模擬權限", "Allow partial mock permission")}</button>}
      <button type="button" className="i-button i-primary" disabled={busy || Date.parse(request.expiresAt) <= Date.now()} onClick={() => onComplete("allow")}>{busy ? tx("處理模擬授權…", "Applying mock consent…") : tx("同意模擬連接", "Allow mock connection")}</button>
    </div>
  </IntegrationDialog>;
}
