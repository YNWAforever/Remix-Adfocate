import { useEffect, useId, useRef, useState } from "react";
import { useStudioText } from "@/components/studio/StudioPrimitives";
import { canReadConnection, useConnections, useIntegrationCommand, useIntegrationIdentity, useIntegrationResources } from "@/lib/integrations/queries";
import type { Availability, IntegrationResource } from "@/lib/integrations/types";
import { D0Notice, IntegrationError, IntegrationModeBadge } from "./ConnectionConsent";
import { DriveSourcePicker } from "./DriveSourcePicker";
import "./integrations.css";

type Props = { threadId: string; revision: number; onImported: () => void };
function ResourceDetails({ resource }: { resource: IntegrationResource }) {
  const tx = useStudioText();
  const availability = (value: Availability) => ({
    available: tx("可用", "Available"), missing: tx("缺資料", "Missing"), unsupported: tx("未支援", "Unsupported"),
    stale: tx("資料過期", "Stale"), revoked: tx("已撤銷", "Revoked"), rate_limited: tx("暫時受限", "Rate limited"),
  })[value];
  const metricNames: Record<string, string> = { views: tx("觀看次數", "Views"), reach: tx("觸及人數", "Reach"), likes: tx("讚好", "Likes"), comments: tx("留言數", "Comments"), shares: tx("分享次數", "Shares"), saved: tx("收藏次數", "Saves"), saves: tx("收藏次數", "Saves"), followers: tx("追蹤人數", "Followers") };
  return <details className="i-details"><summary>{tx("來源、摘錄與權限", "Source, excerpt & rights")}</summary>
    <dl className="i-facts">
      <div><dt>{tx("來源版本", "Source version")}</dt><dd>{resource.version}</dd></div>
      <div><dt>{tx("文件／媒體參照", "File / media reference")}</dt><dd>{resource.externalId}</dd></div>
      {resource.evidence && <>
        <div><dt>{tx("API 版本", "API version")}</dt><dd>{resource.evidence.apiVersion}</dd></div>
        <div><dt>{tx("取得方法", "Acquisition endpoint")}</dt><dd>{resource.evidence.endpoint}</dd></div>
        <div><dt>{tx("指標期間", "Measurement period")}</dt><dd>{resource.evidence.measurementPeriod}</dd></div>
        {resource.evidence.selectionPeriod && <div><dt>{tx("媒體挑選期間", "Media selection period")}</dt><dd>{resource.evidence.selectionPeriod.start} — {resource.evidence.selectionPeriod.end}</dd></div>}
      </>}
      <div><dt>{tx("資料狀態", "Availability")}</dt><dd>{availability(resource.availability)}</dd></div>
      <div><dt>{tx("觀察時間", "Observed")}</dt><dd><time dateTime={resource.observedAt}>{resource.observedAt}</time></dd></div>
      <div><dt>{tx("擷取時間", "Fetched")}</dt><dd><time dateTime={resource.fetchedAt}>{resource.fetchedAt}</time></dd></div>
      <div><dt>{tx("地區", "Region")}</dt><dd>{resource.coverage.region ?? tx("地區未知", "Region unknown")}</dd></div>
      <div><dt>{tx("語言", "Language")}</dt><dd>{resource.coverage.language ?? tx("語言未知", "Language unknown")}</dd></div>
      <div><dt>{tx("權利", "Rights")}</dt><dd>{resource.rights === "owned" ? tx("本人擁有", "Owned") : resource.rights === "licensed" ? tx("已獲授權", "Licensed") : tx("轉分享權未知", "Sharing rights unknown")}</dd></div>
    </dl>
    <p className="i-note">{resource.coverage.partial ? tx("部分資料 · 結論未驗證", "Partial coverage · conclusions unverified") : tx("結論未驗證；來源出處不代表任務已核實。", "Conclusions unverified; provenance does not verify mission completion.")}</p>
    {resource.evidence && <small>{tx("媒體挑選期間與指標統計期間不同。lifetime 不是近 30 日新增表現；觸及人數不能相加當作去重受眾。", "Media selection and metric measurement periods differ. Lifetime is not the last 30 days' incremental performance; reach cannot be summed as a deduplicated audience.")}</small>}
    {Object.keys(resource.metrics).length > 0 && <dl className="i-metrics">{Object.entries(resource.metrics).map(([name, metric]) => <div key={name}><dt>{metricNames[name] ?? name}</dt><dd>{metric.value === null ? "—" : metric.value}<small>{availability(metric.availability)}{metric.reason ? ` · ${metric.reason}` : ""}</small></dd></div>)}</dl>}
    {resource.excerpt && resource.availability === "available" && <blockquote className="i-excerpt">{resource.excerpt}</blockquote>}
    <small>{tx("模擬私人資料，不是香港或繁中市場的實測證據。", "Mock private data, not measured evidence of a Hong Kong or Traditional Chinese market.")}</small>
  </details>;
}

export function IntegrationSourcePanel(props: Props) {
  // Thread changes never carry source selection, questions or rights into another thread.
  const identity = useIntegrationIdentity();
  return <SourceForm key={`${identity}:${props.threadId}`} {...props} />;
}

function SourceForm({ threadId, revision, onImported }: Props) {
  const tx = useStudioText(), query = useConnections(), command = useIntegrationCommand(), sync = useIntegrationCommand();
  const [connectionId, setConnectionId] = useState("");
  const connections = query.data?.connections ?? [];
  const connection = connections.find(item => item.id === connectionId) ?? connections.find(canReadConnection);
  const ready = query.data?.mode === "mock" && canReadConnection(connection);
  const resourcesQuery = useIntegrationResources(connection, ready);
  const resources = (resourcesQuery.data?.resources ?? []).filter(item => item.sampleOnly === true && item.connectionId === connection?.id);
  const [question, setQuestion] = useState("");
  const [selection, setSelection] = useState<{ scope: string; keys: string[] }>({ scope: "", keys: [] });
  const scope = `${threadId}:${revision}:${connection?.id}:${connection?.generation}`;
  const resourceKey = (item: IntegrationResource) => `${item.id}:${item.version}`;
  const selected = resources.filter(item => selection.scope === scope && selection.keys.includes(resourceKey(item)) && item.availability === "available" && item.selected && item.canDownload);
  const selectionKey = JSON.stringify(selected.map(resourceKey));
  const consentScope = JSON.stringify([scope, selectionKey, question.trim()]);
  const [rights, setRights] = useState({ scope: "", modelConsent: false, processingRights: false, shareRights: false });
  useEffect(() => {
    setRights({ scope: consentScope, modelConsent: false, processingRights: false, shareRights: false });
  }, [consentScope]);
  useEffect(() => {
    // Remove lost selections permanently; a later successful fetch is not consent.
    setSelection(previous => {
      const keys: string[] = JSON.parse(selectionKey);
      return previous.scope === scope && JSON.stringify(previous.keys) === selectionKey ? previous : { scope, keys };
    });
  }, [scope, selectionKey]);
  const consent = rights.scope === consentScope ? rights : { modelConsent: false, processingRights: false, shareRights: false };
  const shareAllowed = selected.length > 0 && selected.every(item => item.rights === "owned" || item.rights === "licensed");
  const [picker, setPicker] = useState(false), [notice, setNotice] = useState("");
  useEffect(() => { if (!ready) setPicker(false); }, [ready]);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const id = useId();
  const valid = ready && !resourcesQuery.isError && !resourcesQuery.isFetching && !command.isPending && selected.length > 0 && selected.length <= 5 && question.trim().length > 0 && question.length <= 500 && (!consent.modelConsent || consent.processingRights);
  const setRight = (key: "modelConsent" | "processingRights" | "shareRights", value: boolean) => setRights({ ...consent, scope: consentScope, [key]: value });
  return <section className="integration-ui i-source-panel" aria-labelledby={`${id}-heading`}>
    <div className="i-row"><span aria-hidden className="i-provider-icon">🌱</span><IntegrationModeBadge mode={query.data?.mode} /></div>
    {(query.data?.pilot?.stage === "D0" || query.data?.mode === "live_pilot") && <D0Notice />}
    <div><h3 id={`${id}-heading`}>{tx("把來源放進這個討論", "Bring sources into this discussion")}</h3><p>{tx("挑選、看清權利，再決定用途。來源預設只屬於你。", "Choose sources, review their rights, then decide their use. Sources are private by default.")}</p></div>
    {query.isPending && <p role="status">{tx("正在查看模擬連接…", "Checking mock connections…")}</p>}
    {query.isError && <IntegrationError error={query.error} onRetry={() => void query.refetch()} />}
    {(!ready && !query.isPending && !query.isError) && <p className="i-note">{tx("沒有可用的模擬連接。可在已連接帳號頁檢視授權，或繼續手動加入來源。", "No mock connection is available. Review consent on Connected accounts, or keep adding sources manually.")}</p>}
    {connections.length > 0 && <label className="i-field" htmlFor={`${id}-connection`}>{tx("模擬來源帳號", "Mock source account")}<select id={`${id}-connection`} value={connection?.id ?? ""} disabled={command.isPending} onChange={event => { setConnectionId(event.target.value); setNotice(""); setPicker(false); }}>
      {!connection && <option value="">{tx("選擇連接", "Choose connection")}</option>}
      {connections.map(item => <option key={item.id} value={item.id}>{item.provider === "instagram" ? "Instagram" : "Google Drive"} · {item.label}{!canReadConnection(item) ? tx(" · 不可用", " · unavailable") : ""}</option>)}
    </select></label>}
    {ready && connection?.provider === "google_drive" && <button type="button" className="i-button" disabled={command.isPending} onClick={() => setPicker(true)}>{tx("選擇模擬 Drive 文件", "Choose mock Drive files")}</button>}
    {ready && connection?.provider === "instagram" && <button type="button" className="i-button" disabled={sync.isPending || command.isPending} onClick={() => sync.mutate({ action: "sync", connectionId: connection.id, requestId: crypto.randomUUID() })}>{sync.isPending ? tx("正在更新…", "Updating…") : tx("更新模擬成效", "Update mock insights")}</button>}
    {resourcesQuery.isFetching && ready && <p role="status">{tx("正在核對模擬來源…", "Checking mock sources…")}</p>}
    {resourcesQuery.isError && <IntegrationError error={resourcesQuery.error} onRetry={() => void resourcesQuery.refetch()} />}
    {sync.isError && <IntegrationError error={sync.error} />}
    {ready && resourcesQuery.isSuccess && resources.length === 0 && <p className="i-empty">{tx("尚無所選來源。先選擇模擬文件或更新成效。", "No selected sources yet. Choose mock files or update insights first.")}</p>}
    <fieldset className="i-resources"><legend>{tx("本討論的模擬來源 · 最多 5 項", "Mock sources for this discussion · up to 5")}</legend>{resources.map(resource => {
      const checked = selected.some(item => item.id === resource.id);
      return <article className={`i-resource ${checked ? "i-selected" : ""}`} key={resource.id}>
        <label aria-label={resource.title} className="i-check" htmlFor={`${id}-${resource.id}`}><input id={`${id}-${resource.id}`} type="checkbox" checked={checked} disabled={!ready || command.isPending || resourcesQuery.isFetching || resource.availability !== "available" || !resource.canDownload || !resource.selected || (!checked && selected.length >= 5)} onChange={() => {
          const keys = selected.map(resourceKey);
          setSelection({ scope, keys: checked ? keys.filter(key => key !== resourceKey(resource)) : [...keys, resourceKey(resource)] });
        }} /><span><strong>{resource.title}</strong><small>{tx("模擬 · 私人 · 未驗證", "Mock · private · unverified")}</small></span></label>
        <ResourceDetails resource={resource} />
      </article>;
    })}</fieldset>
    <label className="i-field" htmlFor={`${id}-question`}>{tx("這些來源要回答甚麼問題？", "Question for these sources")}<textarea id={`${id}-question`} maxLength={500} rows={3} value={question} disabled={command.isPending} onChange={event => { setQuestion(event.target.value); setNotice(""); }} placeholder={tx("例如：哪個開場更適合下一篇貼文？", "For example: which opening could suit the next post?")} /></label>
    <small>{tx(`${question.length} / 500 字元`, `${question.length} / 500 characters`)}</small>
    <fieldset className="i-rights"><legend>{tx("每項用途，由你決定", "Each use is your choice")}</legend>
      <p className="i-note">{tx("本期只模擬 AI 處理，不會把內容送至外部模型。正式處理商、處理地區及保留政策仍待批准；本次同意只適用於模擬。", "AI processing is simulated here; no content is sent to an external model. Live processors, processing locations and retention policies await approval. This consent applies only to the mock experience.")}</p>
      <label className="i-check"><input type="checkbox" checked={consent.modelConsent} disabled={command.isPending} onChange={event => setRight("modelConsent", event.target.checked)} /><span>{tx("允許 AI 處理所選模擬來源，以回答本問題", "Allow AI processing of selected mock sources for this question")}</span></label>
      <label className="i-check"><input type="checkbox" checked={consent.processingRights} disabled={command.isPending} onChange={event => setRight("processingRights", event.target.checked)} /><span>{tx("我有權將所選內容交給處理服務使用", "I have permission to send the selected content to a processing service")}</span></label>
      <label className="i-check"><input type="checkbox" checked={shareAllowed && consent.shareRights} disabled={!shareAllowed || command.isPending} onChange={event => setRight("shareRights", event.target.checked)} /><span>{tx("我擁有將所選內容分享給任務接收者的權利", "I have rights to share the selected content with mission recipients")}</span></label>
      <small>{tx("可閱讀不代表有轉分享權。權利未知的來源只作私人用途。這不是分享操作；提交前仍須確認段落、引用與接收者。", "Reading access does not grant sharing rights. Unknown rights allow private use only. This does not share anything; sections, citations and recipients still need confirmation before submission.")}</small>
      {consent.modelConsent && !consent.processingRights && <p className="i-note">{tx("如要使用 AI，亦須獨立確認處理權利；否則可取消 AI 選項作私人匯入。", "AI use also requires independent processing rights. Uncheck AI to import privately instead.")}</p>}
      {!consent.modelConsent && <p className="i-note">{tx("沒有 AI 同意時只作私人匯入，不可送給模型；未確認處理權利時只保留允許的資料與權限提示。", "Without AI consent, import remains private and cannot be sent to a model. Without processing rights, only permitted metadata and rights notices are retained.")}</p>}
    </fieldset>
    {command.isError && <IntegrationError error={command.error} />}
    {notice && <p role="status" className="i-note">{notice}</p>}
    <button type="button" className="i-button i-primary" disabled={!valid} onClick={() => {
      if (!valid || !connection) return;
      command.mutate({ action: "import", connectionId: connection.id, input: {
        threadId, revision, resourceIds: selected.map(item => item.id), question: question.trim(), modelConsent: consent.modelConsent,
        processingRights: consent.processingRights, shareRights: shareAllowed && consent.shareRights, requestId: crypto.randomUUID(),
      } }, { onSuccess: () => {
        if (!alive.current) return;
        setSelection({ scope: "", keys: [] }); setRights({ scope: "", modelConsent: false, processingRights: false, shareRights: false });
        setNotice(tx("模擬來源已私下加入本討論，尚未分享。", "Mock sources added privately to this discussion; nothing has been shared.")); onImported();
      } });
    }}>{command.isPending ? tx("正在私人匯入…", "Importing privately…") : tx("私人匯入模擬來源", "Import mock sources privately")}</button>
    {picker && connection && ready && <DriveSourcePicker key={`${connection.id}:${connection.generation}`} connection={connection} onCancel={() => setPicker(false)} onSelected={() => setPicker(false)} />}
  </section>;
}
