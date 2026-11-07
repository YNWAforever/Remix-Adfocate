import {useEffect,useRef,useState} from "react";
import {inspectMissionPublish,type MissionPublishContext} from "@/lib/creatorGrowth/missionPublishContext";
import {MockMissionPublishSession,type MockMissionPublishRegistry} from "@/lib/creatorGrowth/mockMissionPublish";
import type {PreparedJpeg} from "@/lib/creatorGrowth/jpegPreparation";
import {PublishPreview,type PublishPreviewModel} from "../studio/PublishPreview";
import {useStudioText} from "../studio/StudioPrimitives";

export function MissionPublishMock({context,registry,prepareImage,onReturnToProof,outcome="published"}:{context:MissionPublishContext;registry:MockMissionPublishRegistry;prepareImage:()=>Promise<PreparedJpeg>;onReturnToProof:()=>void;outcome?:"published"|"timeout_after_accept"}) {
 const tx=useStudioText(),current=useRef(context);current.current=context;
 const eligibility=inspectMissionPublish(context),signature=eligibility.eligible?eligibility.signature:JSON.stringify(context);
 const [model,setModel]=useState<PublishPreviewModel|null>(null),[result,setResult]=useState<"published"|"outcome_unknown"|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const session=useRef<MockMissionPublishSession|null>(null),generation=useRef(0),url=useRef<string|null>(null);
 useEffect(()=>{generation.current++;setModel(null);setResult(null);setBusy(false);setError("");session.current=null;return()=>{generation.current++;session.current?.dispose();if(url.current){URL.revokeObjectURL(url.current);url.current=null;}};},[signature]);
 async function open(){
   if(!eligibility.eligible||busy)return;const epoch=generation.current;setBusy(true);setError("");
   try{
     const s=registry.getOrCreate(signature,()=>new MockMissionPublishSession(()=>current.current,prepareImage,outcome));session.current=s;
     if(s.hasAttempted()){const receipt=s.status();setResult(receipt?.state??"outcome_unknown");return;}
     const p=await s.prepare();if(epoch!==generation.current)return;
     if(url.current)URL.revokeObjectURL(url.current);url.current=URL.createObjectURL(new Blob([new Uint8Array(p.image.bytes).buffer],{type:"image/jpeg"}));
     setModel({mode:"synthetic",identityKey:context.ownerKey,fingerprint:p.fingerprint,nonce:p.nonce,expiresAt:p.expiresAt,account:{...p.account,appId:"synthetic-app-only"},image:{src:url.current,alt:tx("任務核准的合成圖片","Approved synthetic mission image"),sha256:p.image.sha256},caption:p.caption,disclosure:{sponsored:true,captionText:disclosureSpan(p.caption,context.publication.instructions.requiredDisclosures),platformLabel:context.rights.platformLabel,brandTag:context.rights.brandTag},mission:{kind:"active",state:"approved_to_publish",approvedVersionId:p.approved.approvedVersionId,instructionRevision:context.publication.revision,summary:context.item.title},eligible:true});
   }catch{if(epoch===generation.current)setError(tx("版本或授權已變更，請核對原任務。","The version or permission changed. Review the original task."));}
   finally{if(epoch===generation.current)setBusy(false);}
 }
 async function confirm(value:{fingerprint:string;nonce:string}){
   const epoch=generation.current;setBusy(true);
   try{const r=await session.current!.confirm(value);if(epoch!==generation.current)return;setResult(r.state);setModel(null);}
   catch{if(epoch===generation.current){setError(tx("未能確認結果；不要重新發佈。","Outcome not confirmed; do not publish again."));setModel(null);setResult("outcome_unknown");}}
   finally{if(epoch===generation.current)setBusy(false);}
 }
 const reasons={approval:tx("作品尚未核准或核准版本不一致。","Approval is missing or inconsistent."),asset:tx("核准素材須為一張已檢查的 JPEG。","One checked approved JPEG is required."),account:tx("發佈帳號未連接、已撤銷或不符。","Publishing account is missing, revoked or mismatched."),rights:tx("來源分享權未確認；私人內容不能直接發佈。","Source sharing rights are unconfirmed; private material cannot be published."),disclosure:tx("必要合作標籤未支援或未核實，請使用手動流程。","Required disclosure support is unavailable; use the manual flow.")};
 return <section className="s-publish-demo" aria-label={tx("任務發佈演練","Mission publishing rehearsal")}>
  <h2>{tx("核准作品，準備見觀眾 🌱","Your approved creation is ready 🌱")}</h2><p>{tx("僅合成演練 · 沒有 Instagram 連接、真實發佈或任務提交。","Synthetic rehearsal only. No Instagram connection, real publishing or task submission.")}</p>
  <p>{tx("只使用核准圖文，不附私人筆記。修改作品須走原任務審核。","Only approved content is used, without private notes. Changes require original task review.")}</p>
  {!eligibility.eligible&&<p role="status">{reasons[eligibility.reason]}</p>}
  {error&&<p role="alert">{error}</p>}
  {!model&&!result&&<button className="s-publish-button s-publish-primary" disabled={!eligibility.eligible||busy} onClick={()=>void open()}>{busy?tx("正在核對作品…","Checking the creation…"):tx("發佈到 Instagram（模擬）","Publish to Instagram (simulation)")}</button>}
  {model&&<PublishPreview model={model} disabled={busy} onConfirm={confirm} onCancel={()=>setModel(null)} onEdit={()=>{setModel(null);setError(tx("修改須返回原審核流程；這裡不會更改核准內容。","Return to the original review workflow to edit; approved content is unchanged here."));}} onManualProof={onReturnToProof}/>}
  {result&&<div role="status"><h3>{result==="published"?tx("作品已發佈（模擬）","Creation published (simulation)"):tx("發佈結果尚未確認","Publication outcome unknown")}</h3><p>{tx("示例回執 · 未提交證明，未增加積分。","Sample receipt. No proof submitted or points added.")}</p>{result==="published"?<button className="s-publish-button" onClick={onReturnToProof}>{tx("返回任務核對證明","Return to review task proof")}</button>:<button className="s-publish-button" onClick={()=>{try{setResult(session.current?.status()?.state??"outcome_unknown");setError(tx("只查詢同一要求；沒有重新發佈。","Only the same request was checked; no republishing."));}catch{setError(tx("原確認已失效，請核對任務與帳號。","The original confirmation is invalid. Review the task and account."));}}}>{tx("查詢這次結果（模擬）","Check this result (simulation)")}</button>}</div>}
  <small>{tx("演練僅此頁；重新載入不會自動發佈或保留成功狀態。","Rehearsal stays on this page; reload never auto-publishes or retains success.")}</small>
 </section>;
}

function disclosureSpan(caption:string,disclosures:readonly string[]){
 if(!disclosures.length)return "";
 const starts=disclosures.map(value=>caption.indexOf(value));
 return caption.slice(Math.min(...starts),Math.max(...disclosures.map((value,index)=>starts[index]+value.length)));
}
