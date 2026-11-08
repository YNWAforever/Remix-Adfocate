import {PilotPrivatePanel} from "./pilot/PilotPrivatePanel";
import {PilotJourneyCard} from "./pilot/PilotJourneyCard";
import {useEffect,useState} from "react";
import {useMe} from "@/lib/queries/kocmax";
import {missionMockImage,readMissionMockContext} from "@/test/missionPublishPreview";
import {MockMissionPublishRegistry} from "@/lib/creatorGrowth/mockMissionPublish";
import {MissionPublishMock} from "./MissionPublishMock";
import type {MissionPublishEntryProps} from "./MissionPublishEntry";
import {useStudioText} from "../studio/StudioPrimitives";
import {PilotTaskPublish} from "./pilot/PilotTaskPublish";
import {createPilotMockClient} from "@/lib/creatorGrowth/pilotMockClient";
export default function MissionPublishEntryDev(props:MissionPublishEntryProps){
 const me=useMe();if(me.isError||!me.data?.id)return null;
 if(props.submissionId==="00000000-0000-4000-8000-000000001931"&&props.item?.approvedVersionId&&props.publication&&me.data.id==="00000000-0000-4000-8000-000000000011")return <PilotOwned key={me.data.id} {...props}/>;
 return <OwnedEntry key={me.data.id} {...props} ownerKey={me.data.id}/>;
}
function PilotOwned(props:MissionPublishEntryProps){const [api]=useState(createPilotMockClient),[grantRevision,setGrantRevision]=useState(0);return <><PilotPrivatePanel onGrantChange={()=>setGrantRevision(v=>v+1)}/><PilotTaskPublish key={grantRevision} api={api} approvedVersionId={props.item!.approvedVersionId!} instructionRevision={props.publication!.revision} onReturnToProof={props.onReturnToProof}/><PilotJourneyCard actorRole="creator"/></>;}
function OwnedEntry(props:MissionPublishEntryProps&{ownerKey:string}){
 const tx=useStudioText(),[registry,setRegistry]=useState<MockMissionPublishRegistry|null>(null),[scenario,setScenario]=useState("ok");
 useEffect(()=>{const r=new MockMissionPublishRegistry();setRegistry(r);return()=>r.dispose();},[]);
 const context=readMissionMockContext(props.ownerKey,props.submissionId,props.item,props.publication);
 if(!context||!registry)return null;
 if(scenario==="revoked")context.rights.grant="revoked";
 if(scenario==="missing")context.rights.grant="missing";
 if(scenario==="private")context.rights.sources="private";
 if(scenario==="label")context.rights.platformLabel="unsupported";
 if(scenario==="changed")context.item={...context.item,approvedVersionId:null};
 if(scenario==="account")context.rights.username="different_account";
 return <div className="s-stack"><label>{tx("任務發佈示例情境","Mission publication scenario")}<select value={scenario} onChange={e=>setScenario(e.target.value)} style={{minHeight:44,maxWidth:"100%"}}>
  <option value="ok">{tx("正常核准作品","Approved creation")}</option><option value="unknown">{tx("結果待確認","Outcome unknown")}</option><option value="label">{tx("合作標籤不支援","Disclosure unsupported")}</option><option value="missing">{tx("未連接發佈帳號","Account not connected")}</option><option value="revoked">{tx("授權已撤銷","Grant revoked")}</option><option value="private">{tx("來源只限私人","Private source")}</option><option value="changed">{tx("核准版本已改變","Approval changed")}</option><option value="account">{tx("帳號不符","Account mismatch")}</option>
 </select></label><p className="s-muted">{tx("演練結果僅此頁；切換情境不會重設已交出的發佈要求。","Results stay on this page; changing scenarios does not reset a submitted request.")}</p><MissionPublishMock context={context} registry={registry} prepareImage={missionMockImage} outcome={scenario==="unknown"?"timeout_after_accept":"published"} onReturnToProof={props.onReturnToProof}/></div>;
}
