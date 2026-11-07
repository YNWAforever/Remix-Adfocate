import {useEffect,useRef,useState} from "react";
import type {PilotMockPreview,PilotMockStatus,PilotMockConfirmation} from "../../../../server/lib/creatorGrowth/pilot/missionService";
export interface PilotTaskApi{current():Promise<PilotMockStatus|null>;preview():Promise<PilotMockPreview>;approve(c:PilotMockConfirmation):Promise<PilotMockStatus>;reconcile():Promise<PilotMockStatus|null>;image():Promise<string>}
/** This component is reachable only through the existing opt-in DEV entry. */
export function PilotTaskPublish({api,approvedVersionId,instructionRevision,onReturnToProof}:{api:PilotTaskApi;approvedVersionId:string;instructionRevision:number;onReturnToProof:()=>void}){
 const [preview,setPreview]=useState<PilotMockPreview|null>(null),[status,setStatus]=useState<PilotMockStatus|null>(null),[image,setImage]=useState<string|null>(null),[consent,setConsent]=useState(false),[busy,setBusy]=useState(true),[error,setError]=useState(false);
 const generation=useRef(0),pending=useRef(false),imageRef=useRef<string|null>(null);
 const clearImage=()=>{if(imageRef.current&&typeof URL.revokeObjectURL==="function")URL.revokeObjectURL(imageRef.current);imageRef.current=null;};
 useEffect(()=>{
  const key=++generation.current;pending.current=false;setPreview(null);setStatus(null);setConsent(false);setError(false);setBusy(true);clearImage();setImage(null);
  api.current().then(s=>{if(key===generation.current){if(s?.sampleOnly!==true&&s!==null)throw new Error("INVALID");setStatus(s);setBusy(false);}}).catch(()=>{if(key===generation.current){setError(true);setBusy(false);}});
  return()=>{generation.current++;clearImage();};
 },[api,approvedVersionId,instructionRevision]);
 async function act(kind:"preview"|"approve"|"reconcile"){
  if(pending.current)return;pending.current=true;const key=generation.current;setBusy(true);setError(false);
  try{
   if(kind==="preview"){
    const p=await api.preview();if(p.sampleOnly!==true||p.approvedVersionId!==approvedVersionId||p.instructionRevision!==instructionRevision)throw new Error("STALE");
    const url=await api.image();if(key!==generation.current){if(typeof URL.revokeObjectURL==="function")URL.revokeObjectURL(url);return;}
    clearImage();imageRef.current=url;setImage(url);setPreview(p);setConsent(false);
   }else{
    if(kind==="approve"&&(!consent||!preview||Date.parse(preview.expiresAt)<=Date.now()))throw new Error("CONFIRMATION_REQUIRED");
    const s=kind==="approve"?await api.approve({...preview!.confirmation,confirmed:true}):await api.reconcile();
    if(s!==null&&s.sampleOnly!==true)throw new Error("INVALID");
    if(key===generation.current){setStatus(s);setPreview(null);setConsent(false);clearImage();setImage(null);}
   }
  }catch{if(key===generation.current){setError(true);setPreview(null);setStatus(null);setConsent(false);clearImage();setImage(null);}}
  finally{if(key===generation.current){pending.current=false;setBusy(false);}}
 }
 const label=status?.state==="published"?"模擬已發佈":status?.state==="outcome_unknown"?"結果待確認":status?.state==="invalidated"?"核准內容已更新":"正在確認這次結果";
 return <section data-fixture="CONTROLLED_PILOT_MOCK_ONLY" className="s-card s-stack" aria-label="受控試點任務發佈" style={{minWidth:0,overflowWrap:"anywhere"}}>
  <div className="s-between"><h2>核准作品，準備出發 ✦</h2><span className="s-tag">本機 mock · 私人</span></div>
  <p>只演練這份核准作品，不會連接或發佈到 Instagram。</p>
  {busy&&<p role="status">正在核對這次記錄…</p>}
  {error&&<div role="alert"><p>登入、版本或授權需要重新核對。內容已隱藏，不會自動重送。</p><button className="s-btn" style={{minHeight:44}} disabled={busy} onClick={()=>void act("reconcile")}>只查詢這次結果</button></div>}
  {!busy&&!error&&!preview&&(!status||status.state==="creator_approved")&&<button className="s-btn primary" style={{minHeight:44}} onClick={()=>void act("preview")}>查看核准作品</button>}
  {preview&&<><div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,260px),1fr))",gap:20,minWidth:0}}>
   <div>{image&&<img src={image} alt="已核准的合成茶杯 JPEG" style={{width:"100%",maxWidth:440,borderRadius:24,display:"block"}}/>}<small>最終 JPEG · 來源已允許本機演練 · HK／繁中成效未驗證</small></div>
   <div className="s-stack"><span className="s-tag">已核准版本 · {preview.approvedVersionId.slice(-4)}</span><h3>{preview.accountLabel}</h3><p style={{whiteSpace:"pre-wrap"}}>{preview.caption}</p><p>披露：{preview.disclosures.join("、")} · 模擬平台合作標籤</p><p>品牌對象：茶日和（合成示例）</p><p>公開範圍：Instagram 貼文（本次只模擬）</p><small>這次核對指示版本 {preview.instructionRevision}；私人 brief 不會一併分享。</small></div>
  </div><label style={{display:"flex",alignItems:"center",gap:12,minHeight:44}}><input type="checkbox" checked={consent} disabled={busy} onChange={e=>setConsent(e.target.checked)}/>我已核對圖片、完整文案、帳號與合作披露。</label><button className="s-btn primary" style={{minHeight:44}} disabled={!consent||busy} onClick={()=>void act("approve")}>確認這篇模擬發佈</button></>}
  {status&&<div className="s-stack" role="status"><h3>{label}</h3><p>{status.accountLabel} · 本機要求 {status.id.slice(-8)}</p><p>發佈、提交證明、核實、結算是不同步驟。本次 mock 不會提交真實證明或增加積分。</p><button className="s-btn" style={{minHeight:44}} disabled={busy} onClick={()=>void act("reconcile")}>只查詢這次結果</button></div>}
  <button className="s-btn" style={{minHeight:44}} onClick={onReturnToProof}>返回原任務證明（不自動提交）</button>
 </section>;
}
