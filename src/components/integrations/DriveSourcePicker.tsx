import { useEffect, useId, useState } from "react";
import { useStudioText } from "@/components/studio/StudioPrimitives";
import { canReadConnection, useDrivePicker, useIntegrationCommand } from "@/lib/integrations/queries";
import type { IntegrationConnection } from "@/lib/integrations/types";
import type { GooglePickerBridge } from "@/lib/integrations/googlePicker";
import { D0Notice, IntegrationDialog, IntegrationError, IntegrationModeBadge } from "./ConnectionConsent";

const supportedTypes = new Set(["application/vnd.google-apps.document", "text/plain", "application/pdf"]);
export function DriveSourcePicker({ connection, onCancel, onSelected, officialPicker }: {
  connection: IntegrationConnection; onCancel: () => void; onSelected: () => void; officialPicker?: GooglePickerBridge;
}) {
  const tx = useStudioText();
  // An injected bridge is disposed with its owner. D0 never calls open or loads an SDK.
  useEffect(() => () => officialPicker?.close(), [officialPicker]);
  if (!connection.sampleOnly) return <IntegrationDialog title="Google Drive" onClose={onCancel} badge={<IntegrationModeBadge sampleOnly={false} />}>
    <D0Notice /><button type="button" className="i-button" onClick={onCancel}>{tx("關閉", "Close")}</button>
  </IntegrationDialog>;
  return <MockDriveSourcePicker key={`${connection.id}:${connection.generation}`} connection={connection} onCancel={onCancel} onSelected={onSelected} />;
}

function MockDriveSourcePicker({ connection, onCancel, onSelected }: {
  connection: IntegrationConnection; onCancel: () => void; onSelected: () => void;
}) {
  const pickerId = useId();
  const tx = useStudioText(), query = useDrivePicker(connection), command = useIntegrationCommand();
  const [selected, setSelected] = useState<string[]>([]);
  const files = query.data?.sampleOnly === true ? query.data.files : [];
  const chosen = files.filter(file => selected.includes(file.id) && file.canDownload && supportedTypes.has(file.mimeType));
  const eligible = canReadConnection(connection) && !query.isError && !query.isFetching;
  return <IntegrationDialog title={tx("模擬 Drive 文件選擇器", "Mock Drive file picker")} onClose={onCancel} busy={command.isPending}>
    <p>{tx("只可選擇下列模擬清單中的檔案，每次最多 5 份。沒有真實 Drive 登入、上載或整個資料夾存取。", "Choose up to 5 files from this mock catalogue only. No live Drive login, upload or folder-wide access.")}</p>
    <p className="i-note">{tx("本期使用 Google Docs、文字及 PDF 的模擬摘錄，尚未解析真實檔案。每份上限 5 MiB、8,000 字元；加密或掃描 PDF 未支援。", "This phase uses mock extracts of Docs, text and PDF; real file parsing is not enabled. Up to 5 MiB and 8,000 characters; encrypted or scanned PDFs are unsupported.")}</p>
    {query.isPending && <p role="status">{tx("正在載入模擬清單…", "Loading mock catalogue…")}</p>}
    {query.isError && <IntegrationError error={query.error} onRetry={() => void query.refetch()} />}
    {!canReadConnection(connection) && <p role="alert" className="i-error">{tx("連接已失效，請取消並重新授權。", "The connection is no longer available. Cancel and review consent.")}</p>}
    <fieldset className="i-file-list"><legend>{tx("選擇模擬文件", "Choose mock files")}</legend>{files.map(file => {
      const supported = supportedTypes.has(file.mimeType), checked = chosen.some(item => item.id === file.id);
      const disabled = !eligible || !supported || !file.canDownload || command.isPending || (!checked && chosen.length >= 5);
      return <label aria-label={file.title} htmlFor={`${pickerId}-${file.id}`} className={`i-file ${checked ? "i-selected" : ""}`} key={file.id}>
        <input id={`${pickerId}-${file.id}`} type="checkbox" checked={checked} disabled={disabled} onChange={() => setSelected(previous => checked ? previous.filter(id => id !== file.id) : [...previous, file.id])} />
        <span><strong>{file.title}</strong><small>{file.mimeType}</small><small>{!supported ? tx("此類型未支援", "Unsupported format") : !file.canDownload ? tx("沒有下載權限", "Download permission unavailable") : file.rights === "owned" ? tx("本人擁有 · 模擬", "Owned · mock") : file.rights === "licensed" ? tx("已獲授權 · 模擬", "Licensed · mock") : tx("轉分享權未知 · 模擬", "Sharing rights unknown · mock")}</small></span>
      </label>;
    })}</fieldset>
    {query.isSuccess && files.length === 0 && <p>{tx("暫無可選的模擬文件。", "No mock files are available.")}</p>}
    <p role="status">{tx(`已選 ${chosen.length} / 5 份`, `${chosen.length} / 5 selected`)}</p>
    <small>{tx("選檔只建立私人來源清單，不會匯入討論、送給 AI 或授予分享權。伺服器會重新核對檔案及下載權限。", "Selection only registers private sources. It does not import into a discussion, send to AI or grant sharing rights. Files and download permission are checked again by the server.")}</small>
    <details className="i-details"><summary>{tx("真實 Picker 的權限邊界（未啟用）", "Live Picker access boundary (disabled)")}</summary>
      <p>{tx("真實選檔須另批，並在你開啟選檔器時才取得短暫的瀏覽器 access token。該 token 仍有 drive.file 修改能力與 Google 的實際到期時間；關閉只移除瀏覽器引用，不等於平台撤權。refresh token 不會交給瀏覽器。", "Live selection needs separate approval. A browser access token is requested only when you open the picker. It retains drive.file write capability and Google's actual expiry; closing releases browser references and is not platform revocation. The browser never receives a refresh token.")}</p>
    </details>
    {command.isError && <IntegrationError error={command.error} />}
    <div className="i-actions"><button type="button" className="i-button" disabled={command.isPending} onClick={onCancel}>{tx("取消", "Cancel")}</button><button type="button" className="i-button i-primary" disabled={!eligible || command.isPending || chosen.length === 0 || chosen.length > 5} onClick={() => command.mutate({ action: "resources", connectionId: connection.id, requestId: crypto.randomUUID(), fileIds: chosen.map(file => file.id) }, { onSuccess: onSelected })}>{command.isPending ? tx("正在登記模擬文件…", "Registering mock files…") : tx("使用所選模擬文件", "Use selected mock files")}</button></div>
  </IntegrationDialog>;
}
