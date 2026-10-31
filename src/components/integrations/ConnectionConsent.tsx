import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ApiError } from "@/lib/api";
import type { StartConnection } from "@/lib/integrations/types";
import { useStudioText } from "@/components/studio/StudioPrimitives";
import "./integrations.css";

export function MockBadge() {
  const tx = useStudioText();
  return <span className="i-badge i-mock">{tx("模擬 · 無真實連線", "Mock · no live connection")}</span>;
}

export function IntegrationError({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const tx = useStudioText();
  const denied = error instanceof ApiError && [401, 403].includes(error.status);
  const limited = error instanceof ApiError && error.status === 429;
  return <div role="alert" className="i-error"><p>{denied
    ? tx("來源權限無法確認，已停止使用相關資料。你的提問仍保留。", "Source access could not be confirmed. Related data is paused; your question is kept.")
    : limited ? tx("模擬服務暫時受限，請稍後重試。你的輸入仍保留。", "The mock service is temporarily limited. Try later; your inputs are kept.")
      : tx("模擬資料暫時無法載入。你的輸入仍保留，可繼續基本任務。", "Mock data is temporarily unavailable. Your inputs are kept and basic missions remain available.")}</p>
    {onRetry && <button className="i-button" type="button" onClick={onRetry}>{tx("再試一次", "Try again")}</button>}
  </div>;
}

/** A contained modal: keyboard loop, inert background, scroll lock and focus return. */
export function IntegrationDialog({ title, children, onClose, busy = false }: { title: string; children: ReactNode; onClose: () => void; busy?: boolean }) {
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
    <MockBadge /><h2 id={heading}>{title}</h2>{children}
  </div></div>, document.body);
}

export function ScopeDisclosure({ scopes, granted = false }: { scopes: string[]; granted?: boolean }) {
  const tx = useStudioText();
  return <div className="i-scopes"><h3>{granted ? tx("實際授予的全部權限", "All granted scopes") : tx("這次要求的全部權限", "All requested scopes")}</h3>
    {scopes.length === 0 ? <p>{tx("未授權", "Not authorized")}</p> : <ul>{scopes.map(scope => <li key={scope}><code>{scope}</code><p>{
      scope === "https://www.googleapis.com/auth/drive.file"
        ? tx("Google 的 drive.file 授權包含建立及修改指定檔案的能力，並非平台層只讀。KOCmax 本期只提供選定內容的讀取；不提供編輯、上載或更改分享。", "Google's drive.file scope can create and modify selected files; it is not read-only authorization. KOCmax only offers selected-content reading in this stage, with no editing, uploading or sharing changes.")
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
