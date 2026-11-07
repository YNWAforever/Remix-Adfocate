import {lazy,Suspense} from "react";
import type {MissionWorkItemView,MissionPublicationView} from "@/lib/activeMission";
export type MissionPublishEntryProps={submissionId:string;item:MissionWorkItemView|null;publication:MissionPublicationView|null;onReturnToProof:()=>void};
const DevEntry=/* @__PURE__ */lazy(()=>import("./MissionPublishEntryDev"));
export function MissionPublishEntryHost(props:MissionPublishEntryProps){
 if(!import.meta.env.DEV||import.meta.env.VITE_STUDIO_FIXTURE!=="true")return null;
 return <Suspense fallback={null}><DevEntry {...props}/></Suspense>;
}
