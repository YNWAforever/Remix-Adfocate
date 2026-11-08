import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { MockNativeJourney, type DemoReviewDecision, type DemoRevocation, type DemoAccountKey } from "@/lib/creatorGrowth/mockNativeJourney";
import { createMockReviewSummary } from "@/lib/creatorGrowth/mockReviewSummary";
import { PublishPreview, type PublishPreviewModel } from "./PublishPreview";
import { prepareSyntheticJpeg } from "@/lib/creatorGrowth/jpegPreparation";
import { useStudioText } from "./StudioPrimitives";

/** Imported only by GrowthImageWorkspaceDev, excluded from production builds. */
export function MockNativePilot({ownerKey}:{ownerKey:string}){
  return <MockNativePilotSession key={ownerKey} ownerKey={ownerKey}/>;
}

function MockSummaryDownload({evidence,decision}:{evidence:ReturnType<MockNativeJourney["reviewEvidence"]>;decision:DemoReviewDecision}){
  const tx=useStudioText();
  const summary=createMockReviewSummary(evidence,decision);
  const [href,setHref]=useState<string|null>(null);
  useEffect(()=>{
    const localUrl=URL.createObjectURL(new Blob([summary],{type:"application/json;charset=utf-8"}));
    setHref(localUrl);
    return ()=>URL.revokeObjectURL(localUrl);
  },[summary]);
  return <div><p>{tx("下載只包含此示例的文案、圖片雜湊及模擬結果，不是正式證明，也不會上傳。","Download contains this example's caption, image hash and simulated result. It is not official evidence and is not uploaded.")}</p>
    {href&&<a className="s-publish-button" href={href} download="kocmax-mock-review.json">{tx("下載示例核對摘要（JSON）","Download demo review summary (JSON)")}</a>}
  </div>;
}

function MockNativePilotSession({ownerKey}:{ownerKey:string}){
  const tx=useStudioText(), id=useId();
  const [caption,setCaption]=useState("今天練習把一個小靈感，變成一份完整作品。🌱");
  const [scenario,setScenario]=useState("receipt");
  const [format,setFormat]=useState<"image/png"|"image/webp">("image/png");
  const [account,setAccount]=useState<DemoAccountKey>("primary"),[publishing,setPublishing]=useState(false);
  const [busy,setBusy]=useState(false),[preview,setPreview]=useState<PublishPreviewModel|null>(null);
  const [meta,setMeta]=useState(""),[status,setStatus]=useState(""),[error,setError]=useState("");
  const [proof,setProof]=useState<ReturnType<MockNativeJourney["proposeProof"]>|null>(null),[checked,setChecked]=useState(false);
  const [evidence,setEvidence]=useState<ReturnType<MockNativeJourney["reviewEvidence"]>|null>(null);
  const [review,setReview]=useState<DemoReviewDecision|null>(null);
  const [revocation,setRevocation]=useState<DemoRevocation|null>(null);
  const scenarioControl=useRef<HTMLSelectElement>(null),errorNotice=useRef<HTMLParagraphElement>(null),revokedNotice=useRef<HTMLDivElement>(null);
  const [focusRequest,setFocusRequest]=useState<{target:"scenario"|"error"|"revoked"}|null>(null);
  useLayoutEffect(()=>{
    if(!focusRequest)return;
    const target=focusRequest.target==="scenario"?scenarioControl.current:focusRequest.target==="error"?errorNotice.current:revokedNotice.current;
    target?.focus();
  },[focusRequest]);
  const journey=useRef<MockNativeJourney|null>(null),url=useRef<string|null>(null),generation=useRef(0);
  function dispose(){generation.current++;journey.current?.stop();journey.current=null;if(url.current)URL.revokeObjectURL(url.current);url.current=null;}
  useEffect(()=>()=>{dispose();},[]);
  function reset(){dispose();setBusy(false);setPublishing(false);setPreview(null);setProof(null);setChecked(false);setStatus("");setError("");setMeta("");setEvidence(null);setReview(null);setRevocation(null);setFocusRequest({target:"scenario"});}
  function revoke(){
    if(!journey.current)return;
    const result=journey.current.revoke(ownerKey);
    reset();setCaption(tx("今天練習把一個小靈感，變成一份完整作品。🌱","Today I am turning a small idea into a complete creation. 🌱"));setRevocation(result);setFocusRequest({target:"revoked"});
  }
  function simulateReview(decision:DemoReviewDecision){
    try{if(!proof||!journey.current)return;setReview(journey.current.simulateReview(ownerKey,proof,decision).decision);}
    catch{setError(tx("示例審核已失效，請重新開始。","Demo review is no longer available. Start again."));}
  }
  async function prepare(){
    if(journey.current||revocation)return;
    const current=new MockNativeJourney(ownerKey,{account,prepareImage:()=>prepareSyntheticJpeg(format),publishOutcome:scenario==="unknown"?"timeout_after_accept":"published",simulateImageFailure:scenario==="conversion_error",simulateExpiredPreview:scenario==="expired"});journey.current=current;
    const revision=generation.current;setBusy(true);setError("");
    try{
      const p=await current.prepare(caption);if(generation.current!==revision)return;
      url.current=URL.createObjectURL(new Blob([new Uint8Array(p.image.bytes).buffer],{type:p.image.mime}));
      setMeta(`${format==="image/webp"?"WebP":"PNG"} → JPEG · ${p.image.width} × ${p.image.height} · ${p.image.byteSize.toLocaleString()} bytes`);
      setPreview({mode:"synthetic",identityKey:ownerKey,fingerprint:p.fingerprint,nonce:p.nonce,expiresAt:p.expiresAt,
        account:{...p.account,appId:"synthetic-app-only"},
        image:{src:url.current,alt:tx("已轉換的合成 JPEG 圖片","Converted synthetic JPEG image"),sha256:p.image.sha256},caption:p.caption,
        disclosure:{sponsored:false,captionText:"",platformLabel:"not_required",brandTag:"not_required"},mission:null,eligible:true});
    }catch{if(generation.current===revision){setError(tx("圖片轉換未完成，請重開示例。","Image conversion failed. Restart the example."));setFocusRequest({target:"error"});}}
    finally{if(generation.current===revision)setBusy(false);}
  }
  const locked=busy||!!preview||!!status||!!revocation||!!error;
  const activeStep=revocation?-1:evidence?3:status?2:preview?1:0;
  const steps=[tx("準備圖片","Prepare image"),tx("確認預覽","Confirm preview"),status==="outcome_unknown"?tx("結果待確認","Outcome unknown"):tx("交接證明","Hand off proof"),tx("查看審核","Review result")];
  return <section className="s-publish-demo" aria-label={tx("離線原生流程演練","Offline native pipeline rehearsal")}>
    <h3>{tx("一張圖，走完一次示例流程","One image, one complete example")}</h3>
    <ol aria-label={tx("示例流程進度","Demo journey progress")} style={{display:"grid",gridTemplateColumns:"repeat(2,minmax(0,1fr))",gap:8,listStyle:"none",padding:0}}>
      {steps.map((step,index)=><li key={index} aria-current={index===activeStep?"step":undefined} style={{padding:"8px 10px",borderRadius:12,background:index===activeStep?"#ede2ff":"#f6f1e8",color:"#493364",fontWeight:index===activeStep?700:400}}>{index+1}. {step}</li>)}
    </ol>
    <p>{tx("演練只留在此頁。離開、重新載入或切換帳號後，請重新開始並再次確認。","This rehearsal stays on this page. After leaving, reloading or switching accounts, restart and confirm again.")}</p>
    <p className="s-publish-notice">{tx("合成圖片在此瀏覽器轉成 JPEG → mock adapter → 示例任務待審核。不會提交真實任務，也不會加分。","Synthetic image converted to JPEG in this browser → mock adapter → demo review. No real mission submission or rewards.")}</p>
    <label htmlFor={`${id}-scenario`}>{tx("原生流程示例情境","Native pipeline scenario")}</label>
    <select ref={scenarioControl} id={`${id}-scenario`} disabled={locked} value={scenario} onChange={e=>setScenario(e.target.value)}><option value="receipt">{tx("收到示例回執","Receive sample receipt")}</option><option value="unknown">{tx("模擬逾時","Simulate timeout")}</option><option value="conversion_error">{tx("模擬圖片轉換失敗","Simulate image conversion failure")}</option><option value="expired">{tx("模擬預覽已過期","Simulate expired preview")}</option></select>
    {(scenario==="conversion_error"||scenario==="expired")&&!revocation&&<p className="s-publish-notice">{tx("刻意安排的失敗示例：不處理真實上傳，也不會發佈。可返回正常情境重新確認。","Deliberate failure fixture: no real uploads or publishing. Return to the normal scenario for a fresh confirmation.")}</p>}
    <label htmlFor={`${id}-account`}>{tx("示例目標帳號","Demo target account")}</label>
    <select id={`${id}-account`} disabled={locked} value={account} onChange={e=>setAccount(e.target.value==="secondary"?"secondary":"primary")}>
      <option value="primary">A · @kocmax_demo_only</option><option value="secondary">B · @kocmax_demo_other</option>
    </select>
    <p>{tx("兩個目標都是合成帳號；不會查找或連接真實 Instagram。","Both targets are synthetic; no real Instagram account is looked up or connected.")}</p>
    <label htmlFor={`${id}-format`}>{tx("示例圖片格式","Sample image format")}</label>
    <select id={`${id}-format`} value={format} disabled={locked} onChange={e=>setFormat(e.target.value==="image/webp"?"image/webp":"image/png")}><option value="image/png">PNG</option><option value="image/webp">WebP</option></select>
    <p>{tx("WebP 僅演練本機產生的靜態圖片；不接受動畫或真實上傳。","WebP rehearses locally generated still images only; no animation or real uploads.")}</p>
    <label htmlFor={`${id}-caption`}>{tx("示例文案","Demo caption")}</label>
    <textarea id={`${id}-caption`} rows={3} maxLength={2200} disabled={locked} value={caption} onChange={e=>setCaption(e.target.value)} style={{width:"100%",boxSizing:"border-box"}}/>
    <button className="s-publish-button" disabled={locked||!caption.trim()} onClick={()=>void prepare()}>{busy?tx("正在本機轉換…","Converting locally…"):tx("轉換示例圖片","Convert sample image")}</button>
    {meta&&<p role="status">{meta}</p>}
    {error&&<p ref={errorNotice} role="alert" tabIndex={-1}>{error}</p>}
    {(scenario==="conversion_error"||scenario==="expired")&&!revocation&&<button className="s-publish-button" onClick={()=>{reset();setScenario("receipt");}}>{tx("返回正常情境","Return to normal scenario")}</button>}
    {preview&&<PublishPreview model={preview} onConfirm={async confirmation=>{
      const current=journey.current,revision=generation.current;if(!current)return;
      setPublishing(true);
      try{const receipt=await current.publish(ownerKey,confirmation);if(generation.current!==revision)return;
        setStatus(receipt.state);setPreview(null);
      }finally{if(generation.current===revision)setPublishing(false);}
    }} onEdit={reset} onCancel={reset} onManualProof={()=>setError(tx("此演練只使用合成回執；真實作品請沿用原任務流程。","Only synthetic receipts here; use the original mission for real work."))}/>}
    {preview&&<button className="s-publish-button" disabled={publishing} onClick={()=>{if(publishing)return;reset();setAccount(account==="primary"?"secondary":"primary");}}>{tx("切換示例目標（重新確認）","Switch demo target (confirm again)")}</button>}
    {status&&!review&&<div role="status"><strong>{status==="published"?tx("示例回執已收到","Sample receipt received"):status==="demo_pending_review"?tx("示例證明待審核","Demo proof awaiting review"):tx("示例結果待確認","Sample outcome unknown")}</strong><p>{status==="outcome_unknown"?tx("沒有官方回執，不能交接，也不會自動重試發佈。","No official receipt: no handoff or automatic publishing retry."):tx("僅此頁示例，沒有真實貼文連結、保存或獎勵。","Page-only sample: no real post link, saved record or reward.")}</p></div>}
    {status==="published"&&!proof&&<button className="s-publish-button" onClick={()=>{try{setProof(journey.current!.proposeProof(ownerKey));}catch{setError(tx("此示例回執不能交接。","This sample receipt cannot be handed off."));}}}>{tx("核對示例任務交接","Review demo mission handoff")}</button>}
    {proof&&status==="published"&&<div className="s-publish-notice">
      <p>{tx("把已確認的同一張圖、同一份文案與示例回執交給示例審核。真實任務仍會拒絕這份合成回執。","Send the same confirmed image, caption and sample receipt to demo review. Real missions still reject this synthetic receipt.")}</p>
      <details><summary>{tx("核對版本與回執","Check version and receipt")}</summary><p style={{overflowWrap:"anywhere"}}>SHA-256: {proof.imageSha256}</p><p>{tx("示例媒體 ID","Sample media ID")}: {proof.mediaId}</p></details>
      <label><input type="checkbox" checked={checked} onChange={e=>setChecked(e.target.checked)}/>{tx("我已核對示例圖片、文案及回執","I checked the sample image, caption and receipt")}</label>
      <button className="s-publish-button" disabled={!checked} onClick={()=>{try{setStatus(journey.current!.confirmProof(ownerKey,proof).state);setEvidence(journey.current!.reviewEvidence(ownerKey));}catch{setError(tx("確認已失效，請重開示例。","Confirmation expired. Restart the example."));}}}>{tx("確認示例交接","Confirm demo handoff")}</button>
    </div>}
    {evidence&&<section aria-label={tx("示例審核證據","Demo review evidence")} className="s-publish-notice">
      <h4>{tx("作品、文案、回執，一起核對","Review image, caption and receipt together")}</h4>
      <p>{tx("示例目標","Demo target")}: @{evidence.accountLabel}</p>
      {url.current&&<img src={url.current} alt={tx("已交接的合成圖片","Handed-off synthetic image")} style={{display:"block",maxWidth:"100%",maxHeight:300,objectFit:"contain",borderRadius:16}}/>}
      <p style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{evidence.caption}</p>
      <details><summary>{tx("核對證據版本","Inspect evidence version")}</summary><p style={{overflowWrap:"anywhere"}}>SHA-256: {evidence.imageSha256}</p><p>{tx("示例媒體 ID","Sample media ID")}: {evidence.mediaId}</p></details>
      <p>{tx("開發用審核演練：下方按鈕只模擬回覆，不代表你有審批權限。真實核實及積分仍由原任務流程處理。","Developer review rehearsal: buttons simulate a response, not review authority. Real verification and rewards remain in the original mission workflow.")}</p>
      {!review&&<><button className="s-publish-button" onClick={()=>simulateReview("verified")}>{tx("模擬審核：核實通過","Simulate review: verified")}</button><button className="s-publish-button" onClick={()=>simulateReview("needs_information")}>{tx("模擬審核：需要補充","Simulate review: more information")}</button></>}
      {review&&<div role="status"><strong>{review==="verified"?tx("示例核實通過 · 未發放獎勵","Demo verified · no rewards awarded"):tx("示例需要補充資料","Demo needs more information")}</strong><p>{review==="verified"?tx("這次演練完成了！真實成果須經原任務核實與結算才會獲得獎勵。","Rehearsal complete! Real work needs original mission verification and settlement before rewards."):tx("示例回覆：請補充文案中的實際體驗。重新編輯後，圖片、文案及交接都需要再次確認。","Sample feedback: add your actual experience to the caption. Editing requires a new image, caption and handoff confirmation.")}</p></div>}
      {review&&<MockSummaryDownload evidence={evidence} decision={review}/>}
      {review==="needs_information"&&<button className="s-publish-button" onClick={reset}>{tx("重新編輯示例","Edit example again")}</button>}
    </section>}
    {journey.current&&!revocation&&<button className="s-publish-button" onClick={revoke}>{tx("模擬撤銷本次授權","Simulate revoking this authorization")}</button>}
    {revocation&&<div ref={revokedNotice} className="s-publish-notice" role="status" tabIndex={-1}><strong>{tx("示例授權已撤銷","Demo authorization revoked")}</strong>
      <p>{revocation.priorOutcome==="published"?tx("撤銷前已收到模擬回執。停止授權不代表刪除既有貼文；此處沒有連接或刪除真實貼文。","A sample receipt arrived before revocation. Stopping authorization does not delete an existing post; no real post was connected or deleted here."):revocation.priorOutcome==="outcome_unknown"?tx("先前結果仍待確認。撤銷不代表發佈失敗，也不會自動重試。","The previous outcome remains unknown. Revocation does not mean publication failed, and nothing is retried automatically."):tx("本次示例尚未要求發佈，舊確認已失效。","This example had not requested publication; its old confirmation is invalid.")}</p>
      <p>{tx("預覽、交接與下載入口已清除。已下載到本機的檔案不會被刪除。這只是本頁演練，不會撤銷任何真實帳號。","Preview, handoff and download access are cleared. Files already downloaded remain on your device. This page-only rehearsal does not revoke any real account.")}</p>
      <button className="s-publish-button" onClick={reset}>{tx("開始全新示例","Start a fresh example")}</button>
    </div>}
    {(locked||error)&&!revocation&&<button className="s-publish-button" onClick={reset}>{tx("清除此頁演練","Clear this page's rehearsal")}</button>}
  </section>;
}
