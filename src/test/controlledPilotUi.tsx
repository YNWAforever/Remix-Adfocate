/** CONTROLLED_PILOT_MOCK_ONLY: loaded only by the development fixture entry. */
import {PilotJourneyCard} from "../components/active-mission/pilot/PilotJourneyCard";
import {createRoot} from "react-dom/client";
import {PilotReadinessCard} from "../components/active-mission/pilot/PilotReadinessCard";
import {PilotReadinessPanel,type PilotOperatorApi} from "../components/admin/PilotReadinessPanel";
export function createPilotRoleCards(host:HTMLElement){
 const root=createRoot(host);
 const call=async(path:string,body?:unknown)=>{const r=await fetch(`/api/controlled-pilot-mock/${path}`,body===undefined?{cache:"no-store"}:{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});if(!r.ok)throw new Error("PILOT_FIXTURE_DENIED");return r.json();};
 const api:PilotOperatorApi={read:()=>call("operator"),stop:async()=>{await call("stop",{});},scenario:async scenario=>{await call("scenario",{scenario});}};
 return (role:string)=>root.render(role==="creator"?<div className="controlled-pilot-creator"><style>{`@media(min-width:1024px){.controlled-pilot-creator{margin-left:230px}}`}</style><PilotReadinessCard/></div>:["reviewer","operator","workspace_admin"].includes(role)?<div key={role} className="studio controlled-pilot-staff" style={{minHeight:0}}><style>{`@media(min-width:768px){.controlled-pilot-staff{margin-left:240px}}`}</style>{role!=="reviewer"&&<PilotReadinessPanel api={api}/>}<PilotJourneyCard actorRole={role}/></div>:null);
}
